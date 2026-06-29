//! collab.rs — P2.3 sidecar lifecycle. The GUI hosts collaboration by spawning the Node collab
//! listener (dist/mcp/host.cjs) as a CHILD process that Rust OWNS: it captures the child's
//! `SLIDECRAFT_READY {url,token}` stdout handshake, keeps the handle in managed state, and KILLs it
//! on app exit. A `std::process::Child` is NOT auto-reaped (Windows would orphan node otherwise), so
//! `reap()` is wired to the run-loop. Rust never touches the DeckIR — it only supervises the process
//! and hands {url,token} to the webview, which connects as an equal MCP client (collab-client.ts).

use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::Manager;

#[cfg(windows)]
use std::os::windows::process::CommandExt;
/// CREATE_NO_WINDOW — keep node.exe (a console app) from flashing a console window off the GUI app.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const READY_PREFIX: &str = "SLIDECRAFT_READY ";
/// Generous cap; in practice node prints READY in ~1s, or the pipe closes instantly on a crash.
const READY_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Clone, Serialize)]
pub struct CollabInfo {
    pub url: String,
    pub token: String,
    #[serde(rename = "hostJsonPath")]
    pub host_json_path: String,
}

#[derive(Deserialize)]
struct ReadyLine {
    url: String,
    token: String,
}

#[derive(Default)]
pub struct CollabState {
    child: Mutex<Option<Child>>,
    info: Mutex<Option<CollabInfo>>,
}

/// Locate the host.cjs sidecar bundle. `SLIDECRAFT_HOST_CJS` overrides everything (escape hatch).
/// Dev (`debug_assertions`): the repo file relative to this crate — resource resolution is
/// unreliable under `tauri dev`. Release: a bundled resource at the resource root.
fn resolve_host_cjs(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    if let Ok(p) = std::env::var("SLIDECRAFT_HOST_CJS") {
        return Ok(std::path::PathBuf::from(p));
    }
    #[cfg(debug_assertions)]
    {
        let _ = app; // CARGO_MANIFEST_DIR = .../src-tauri ; the built bundle lives at ../dist/mcp
        Ok(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../dist/mcp/host.cjs"))
    }
    #[cfg(not(debug_assertions))]
    {
        app.path()
            .resolve("host.cjs", tauri::path::BaseDirectory::Resource)
            .map_err(|e| e.to_string())
    }
}

/// Spawn the collab sidecar and return its handshake. Idempotent: a live sidecar returns its
/// existing {url,token}. Sync command — the brief blocking wait for READY is on the Tauri core
/// thread only; the WebView2 webview is a separate process and stays responsive.
#[tauri::command]
pub fn start_collab(app: tauri::AppHandle, state: tauri::State<'_, CollabState>) -> Result<CollabInfo, String> {
    // Already running? hand back the live handshake. Otherwise reap a dead child and respawn.
    {
        let mut guard = state.child.lock().unwrap();
        if let Some(c) = guard.as_mut() {
            match c.try_wait() {
                Ok(None) => {
                    if let Some(info) = state.info.lock().unwrap().clone() {
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

    let host_cjs = resolve_host_cjs(&app)?;
    if !host_cjs.exists() {
        return Err(format!(
            "collab サイドカーが見つかりません: {}（先に `npm run build:host` を実行してください）",
            host_cjs.display()
        ));
    }

    // host.json under app-local-data — the discovery file for an external AI (`claude mcp add`).
    let data_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    let host_json = data_dir.join("host.json");

    let mut cmd = Command::new("node");
    cmd.arg(&host_cjs)
        .env("SLIDECRAFT_PORT", "0") // ephemeral → no port conflicts; the real url comes via READY
        .env("SLIDECRAFT_HOST_JSON", &host_json)
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit()); // host logs flow to the dev console for debugging
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("node の起動に失敗しました（PATH に node がありますか？）: {e}"))?;

    // Drain stdout on a thread; forward the first READY line over a channel (and keep draining so a
    // full pipe never blocks the child).
    let stdout = child.stdout.take().ok_or("子プロセスの stdout を取得できませんでした")?;
    let (tx, rx) = mpsc::channel::<String>();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        let mut sent = false;
        for line in reader.lines() {
            let l = match line {
                Ok(l) => l,
                Err(_) => break,
            };
            if !sent {
                if let Some(rest) = l.strip_prefix(READY_PREFIX) {
                    let _ = tx.send(rest.to_string());
                    sent = true;
                }
            }
        }
    });

    // recv_timeout returns Err on either timeout OR a closed pipe (child crashed) — reap + report.
    let ready = match rx.recv_timeout(READY_TIMEOUT) {
        Ok(j) => j,
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err("collab ホストが起動しませんでした（READY を受信できず・host.cjs の stderr を確認してください）".into());
        }
    };

    let parsed: ReadyLine = serde_json::from_str(&ready).map_err(|e| format!("READY の解析に失敗しました: {e}"))?;
    let info = CollabInfo {
        url: parsed.url,
        token: parsed.token,
        host_json_path: host_json.to_string_lossy().to_string(),
    };

    *state.child.lock().unwrap() = Some(child);
    *state.info.lock().unwrap() = Some(info.clone());
    Ok(info)
}

#[tauri::command]
pub fn stop_collab(state: tauri::State<'_, CollabState>) -> Result<(), String> {
    if let Some(mut child) = state.child.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    *state.info.lock().unwrap() = None;
    Ok(())
}

/// Kill the sidecar on app exit (wired to RunEvent::ExitRequested / Exit). Safe to call repeatedly.
pub fn reap(app: &tauri::AppHandle) {
    let state = app.state::<CollabState>();
    if let Some(mut child) = state.child.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    *state.info.lock().unwrap() = None;
}
