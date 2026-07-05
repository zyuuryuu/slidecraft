//! local_ai.rs — the in-app AI RUNTIME lifecycle (roadmap #2). The GUI spawns a bundled
//! `llamafile --server` (an OpenAI-compatible HTTP server) as a CHILD that Rust OWNS, on a
//! loopback EPHEMERAL port, and KILLs it on exit. A sibling of collab.rs (same supervise/reap
//! idiom) — but llamafile has NO READY-line handshake, so readiness is a `/health` HTTP poll,
//! and Rust pre-picks the free port. The webview gets the base URL via the IPC RETURN value
//! only (no discovery file — nothing external needs to find it) and points the "builtin"
//! provider at it; the existing OpenAI-compat path + egress gate + condense guardrail then work
//! unchanged. Rust never touches the DeckIR — it only supervises the process.
//!
//! Flags: `--server --host 127.0.0.1 --port <n> -m <gguf> --gpu disable -c 8192 --parallel 1`
//! (CPU-only is `--gpu disable`, NOT `-ngl 0`; `--nobrowser` was removed). `/health` returns 200
//! once the model is loaded. `-c 8192 --parallel 1` are LOAD-CRITICAL: a newer llamafile defaults
//! `--parallel` to auto (=4) and the context to the model's max (phi-3.5 = 128K), so the KV cache
//! balloons to ~60 GB and the cold-load blows past the health timeout. We serve one request at a
//! time and slide/condense prompts fit in 8K, so pinning these keeps the KV ~1/64th and the load
//! to a few seconds.

use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{Emitter, Manager};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
/// CREATE_NO_WINDOW — keep the llamafile console child from flashing a window off the GUI app.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// The default model now comes from the capability-selected TIER (`model_tier::spec_for`):
/// Small = phi-3.5-mini 3.8B (safe floor), Balanced = granite-4.1-8B dense (measured cleaner on
/// the edit contract). `SLIDECRAFT_GGUF` still overrides everything (dev escape hatch).
fn current_spec() -> crate::model_tier::ModelSpec {
    crate::model_tier::spec_for(crate::model_tier::selected_tier())
}
/// Generous cap: a 3B Q4 cold-load on CPU can take 10-60s (a 0.5B was ~1s in the spike). Windows
/// first-load adds Defender scanning + cold page cache, so allow extra margin over the observed
/// load time (the `-c`/`--parallel` pinning below keeps the actual load to a few seconds).
const HEALTH_TIMEOUT: Duration = Duration::from_secs(180);
const POLL_INTERVAL: Duration = Duration::from_millis(400);
/// Port pre-pick is a TOCTOU race (bind:0 → read → drop → child re-binds); retry a few times.
const SPAWN_ATTEMPTS: usize = 5;

#[derive(Clone, Serialize)]
pub struct LocalAiInfo {
    #[serde(rename = "baseUrl")]
    pub base_url: String,
}

#[derive(Default)]
pub struct LocalAiState {
    child: Mutex<Option<Child>>,
    info: Mutex<Option<LocalAiInfo>>,
}

/// Resolve the bundled llamafile runtime. `SLIDECRAFT_LLAMAFILE` overrides everything (point it
/// at an assimilated llamafile when testing under `tauri dev`). Dev: from PATH. Release: the
/// externalBin staged next to the main exe (Tauri strips the `-<triple>` suffix → `llamafile`).
fn resolve_llamafile() -> PathBuf {
    if let Ok(p) = std::env::var("SLIDECRAFT_LLAMAFILE") {
        return PathBuf::from(p);
    }
    #[cfg(debug_assertions)]
    {
        PathBuf::from("llamafile")
    }
    #[cfg(not(debug_assertions))]
    {
        let name = if cfg!(windows) { "llamafile.exe" } else { "llamafile" };
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.join(name)))
            .unwrap_or_else(|| PathBuf::from("llamafile"))
    }
}

/// Resolve the GGUF weights path (app-local-data/models/<name>). `SLIDECRAFT_GGUF` overrides it.
fn resolve_weights(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Ok(p) = std::env::var("SLIDECRAFT_GGUF") {
        return Ok(PathBuf::from(p));
    }
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("models");
    Ok(dir.join(current_spec().file))
}

/// SHA256 of a file, streamed (never buffers the whole ~2.4 GB).
fn sha256_file(path: &Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    std::io::copy(&mut file, &mut hasher).map_err(|e| e.to_string())?;
    Ok(format!("{:x}", hasher.finalize()))
}

/// True if the model is available (the file exists, or the SLIDECRAFT_GGUF dev override is set).
#[tauri::command]
pub fn model_weights_present(app: tauri::AppHandle) -> Result<bool, String> {
    if std::env::var("SLIDECRAFT_GGUF").is_ok() {
        return Ok(true);
    }
    Ok(resolve_weights(&app)?.exists())
}

/// Download the pinned GGUF into app-local-data/models on first use — streamed to a `.part` file
/// (HTTP Range resume), hashed, atomically renamed on success. Emits `builtin://download` {pct}.
/// No-op if SLIDECRAFT_GGUF is set or the file already exists. Async so the UI stays responsive.
#[tauri::command]
pub async fn ensure_model_weights(app: tauri::AppHandle) -> Result<String, String> {
    if let Ok(p) = std::env::var("SLIDECRAFT_GGUF") {
        return Ok(p); // dev override — never download
    }
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("models");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let spec = current_spec();
    let final_path = dir.join(spec.file);
    if final_path.exists() {
        return Ok(final_path.to_string_lossy().to_string());
    }
    let part_path = dir.join(format!("{}.part", spec.file));
    let have = std::fs::metadata(&part_path).map(|m| m.len()).unwrap_or(0);

    let client = reqwest::Client::new();
    let mut builder = client.get(spec.url);
    if have > 0 {
        builder = builder.header(reqwest::header::RANGE, format!("bytes={have}-"));
    }
    let mut resp = builder.send().await.map_err(|e| e.to_string())?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("モデルのダウンロードに失敗しました: HTTP {status}"));
    }
    let total = have + resp.content_length().unwrap_or(0);

    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&part_path)
        .map_err(|e| e.to_string())?;
    let mut done = have;
    let mut last = Instant::now();
    while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
        use std::io::Write;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        done += chunk.len() as u64;
        if last.elapsed() >= Duration::from_millis(250) {
            let pct = if total > 0 { (done * 100 / total) as u32 } else { 0 };
            let _ = app.emit("builtin://download", serde_json::json!({ "pct": pct, "done": done, "total": total }));
            last = Instant::now();
        }
    }
    drop(file);

    if sha256_file(&part_path)? != spec.sha256 {
        let _ = std::fs::remove_file(&part_path);
        return Err("ダウンロードしたモデルの検証に失敗しました（チェックサム不一致・再取得してください）".into());
    }
    std::fs::rename(&part_path, &final_path).map_err(|e| e.to_string())?;
    let _ = app.emit("builtin://download", serde_json::json!({ "pct": 100 }));
    Ok(final_path.to_string_lossy().to_string())
}

/// Delete the downloaded model to free disk (~2.4 GB); the next enable re-downloads it.
#[tauri::command]
pub fn evict_model_weights(app: tauri::AppHandle) -> Result<(), String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("models");
    let spec = current_spec();
    let _ = std::fs::remove_file(dir.join(spec.file));
    let _ = std::fs::remove_file(dir.join(format!("{}.part", spec.file)));
    Ok(())
}

/// Pick a free loopback port (the listener drops at end-of-fn, freeing it for llamafile).
fn pick_free_port() -> Result<u16, String> {
    let l = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    l.local_addr().map_err(|e| e.to_string()).map(|a| a.port())
}

/// Tiny blocking GET /health probe — hand-rolled over TcpStream to avoid a new HTTP dep. A
/// connection-refused (server not yet bound) returns false → the caller keeps polling.
fn health_ok(port: u16) -> bool {
    let Ok(mut s) = std::net::TcpStream::connect(("127.0.0.1", port)) else {
        return false;
    };
    let _ = s.set_read_timeout(Some(Duration::from_millis(800)));
    if s
        .write_all(b"GET /health HTTP/1.0\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .is_err()
    {
        return false;
    }
    let mut buf = String::new();
    let _ = s.read_to_string(&mut buf);
    buf.starts_with("HTTP/1.0 200") || buf.starts_with("HTTP/1.1 200")
}

enum PollErr {
    /// The child exited during startup (bad GGUF / OOM / port-in-use) — fail FAST, maybe re-pick port.
    Exited(String),
    /// The model genuinely didn't finish loading in time — don't retry (re-picking won't help).
    Timeout(String),
}

/// Poll until /health is 200, checking `try_wait()` each tick so a crashed child fails fast
/// instead of spinning the whole HEALTH_TIMEOUT (collab gets this free via a closed READY pipe).
fn poll_health(child: &mut Child, port: u16) -> Result<(), PollErr> {
    let deadline = Instant::now() + HEALTH_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                return Err(PollErr::Exited(format!(
                    "llamafile が起動中に終了しました (status {status}) — stderr を確認してください"
                )))
            }
            Ok(None) => {}
            Err(e) => return Err(PollErr::Exited(e.to_string())),
        }
        if health_ok(port) {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err(PollErr::Timeout(
                "llamafile が時間内に起動しませんでした（モデルロードがタイムアウト）".into(),
            ));
        }
        std::thread::sleep(POLL_INTERVAL);
    }
}

/// Spawn one llamafile server on `port`. Drains stdout on a thread (log-only) so a full pipe
/// never blocks the child under load.
fn spawn_llamafile(bin: &Path, gguf: &Path, port: u16) -> Result<Child, String> {
    let mut cmd = Command::new(bin);
    cmd.arg("--server")
        .arg("--host")
        .arg("127.0.0.1") // loopback ONLY — never 0.0.0.0
        .arg("--port")
        .arg(port.to_string())
        .arg("-m")
        .arg(gguf)
        .arg("--gpu")
        .arg("disable") // CPU-only (v1); GPU is a separate epic
        .arg("-c")
        .arg("8192") // pin context — else a newer llamafile uses the model max (phi-3.5 = 128K) → giant KV
        .arg("--parallel")
        .arg("1") // one slot — we serve a single request at a time; avoids the 4× KV of the auto default
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("llamafile の起動に失敗しました: {e}"))?;
    if let Some(out) = child.stdout.take() {
        std::thread::spawn(move || {
            for line in BufReader::new(out).lines() {
                if line.is_err() {
                    break;
                } // drain only; keeps the pipe from filling
            }
        });
    }
    Ok(child)
}

/// Start (or return the already-running) llamafile server. Lazy + idempotent. ASYNC: the blocking
/// spawn + cold-load /health poll run on a WORKER thread (tauri::async_runtime::spawn_blocking) so
/// the Tauri core thread — and the whole UI — never freezes ("応答なし") during the one-time,
/// multi-second model load. Returns { baseUrl } the webview writes into the "builtin" provider config.
#[tauri::command]
pub async fn start_local_ai(app: tauri::AppHandle) -> Result<LocalAiInfo, String> {
    tauri::async_runtime::spawn_blocking(move || start_local_ai_blocking(&app))
        .await
        .map_err(|e| format!("起動タスクの実行に失敗しました: {e}"))?
}

fn start_local_ai_blocking(app: &tauri::AppHandle) -> Result<LocalAiInfo, String> {
    let state = app.state::<LocalAiState>();
    // Already running? hand back the live base URL. Otherwise reap a dead child and respawn.
    {
        let mut guard = state.child.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(c) = guard.as_mut() {
            match c.try_wait() {
                Ok(None) => {
                    if let Some(info) = state.info.lock().unwrap_or_else(|e| e.into_inner()).clone() {
                        return Ok(info);
                    }
                }
                _ => {
                    let _ = c.kill();
                    let _ = c.wait();
                    *guard = None;
                }
            }
        }
    }

    let llamafile = resolve_llamafile();
    let gguf = resolve_weights(app)?;
    if !gguf.exists() {
        return Err(format!(
            "モデルがまだダウンロードされていません: {}（先にオフライン AI を有効化してください）",
            gguf.display()
        ));
    }

    let mut last_err = String::new();
    for _ in 0..SPAWN_ATTEMPTS {
        let port = pick_free_port()?;
        let mut child = spawn_llamafile(&llamafile, &gguf, port)?;
        match poll_health(&mut child, port) {
            Ok(()) => {
                let info = LocalAiInfo {
                    base_url: format!("http://127.0.0.1:{port}/v1"),
                };
                *state.child.lock().unwrap_or_else(|e| e.into_inner()) = Some(child);
                *state.info.lock().unwrap_or_else(|e| e.into_inner()) = Some(info.clone());
                return Ok(info);
            }
            // Early exit can be a port race (TOCTOU) → re-pick a fresh port and retry.
            Err(PollErr::Exited(msg)) => {
                let _ = child.kill();
                let _ = child.wait();
                last_err = msg;
            }
            // A genuine load timeout won't be fixed by a new port — fail now.
            Err(PollErr::Timeout(msg)) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(msg);
            }
        }
    }
    Err(format!("llamafile を起動できませんでした（{last_err}）"))
}

#[tauri::command]
pub fn stop_local_ai(state: tauri::State<'_, LocalAiState>) -> Result<(), String> {
    if let Some(mut child) = state.child.lock().unwrap_or_else(|e| e.into_inner()).take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    *state.info.lock().unwrap_or_else(|e| e.into_inner()) = None;
    Ok(())
}

/// Non-spawning probe: the live base URL if the runtime is up, else None. Lets the UI show
/// 起動中/未起動 without forcing a (slow) spawn.
#[tauri::command]
pub fn local_ai_status(
    state: tauri::State<'_, LocalAiState>,
) -> Result<Option<LocalAiInfo>, String> {
    let mut guard = state.child.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(c) = guard.as_mut() {
        if matches!(c.try_wait(), Ok(None)) {
            return Ok(state.info.lock().unwrap_or_else(|e| e.into_inner()).clone());
        }
    }
    Ok(None)
}

/// Kill the runtime on app exit (wired to RunEvent::ExitRequested / Exit). A std Child is not
/// auto-reaped, so without this llamafile orphans on Windows holding the loopback port.
pub fn reap(app: &tauri::AppHandle) {
    let state = app.state::<LocalAiState>();
    if let Some(mut child) = state.child.lock().unwrap_or_else(|e| e.into_inner()).take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    *state.info.lock().unwrap_or_else(|e| e.into_inner()) = None;
}
