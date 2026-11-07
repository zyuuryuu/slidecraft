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

/// Locate a bundled MCP file (`host.cjs` / `cli.cjs`). Dev (`debug_assertions`): the repo build output
/// relative to this crate — resource resolution is unreliable under `tauri dev`. Release: bundled at
/// the resource root via tauri.bundle.conf `bundle.resources` (`"../dist/mcp/<name>" → "<name>"`).
fn resolve_bundled(app: &tauri::AppHandle, name: &str) -> Result<std::path::PathBuf, String> {
    #[cfg(debug_assertions)]
    {
        let _ = app; // CARGO_MANIFEST_DIR = .../src-tauri ; the built bundle lives at ../dist/mcp
        Ok(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../dist/mcp").join(name))
    }
    #[cfg(not(debug_assertions))]
    {
        app.path()
            .resolve(name, tauri::path::BaseDirectory::Resource)
            .map_err(|e| e.to_string())
    }
}

/// Locate the host.cjs sidecar bundle. `SLIDECRAFT_HOST_CJS` overrides everything (escape hatch).
fn resolve_host_cjs(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    if let Ok(p) = std::env::var("SLIDECRAFT_HOST_CJS") {
        return Ok(std::path::PathBuf::from(p));
    }
    resolve_bundled(app, "host.cjs")
}

/// What the 協働 panel needs to write a registration that actually runs on THIS install (#520):
/// the OS (quoting rules), whether the `slidecraft-mcp` launcher is reachable from a shell, and the
/// real paths of the bundled node + cli.cjs as the fallback. Read-only — nothing is executed or written.
#[derive(Clone, Serialize)]
pub struct McpInstallInfo {
    /// `std::env::consts::OS`: "windows" | "macos" | "linux" (anything else is treated as POSIX by the UI).
    pub os: &'static str,
    #[serde(rename = "launcherOnPath")]
    pub launcher_on_path: bool,
    #[serde(rename = "nodePath")]
    pub node_path: String,
    #[serde(rename = "cliPath")]
    pub cli_path: String,
}

/// Is `slidecraft-mcp` resolvable from the user's shell? Checked against this process's PATH plus the
/// well-known bin dirs the installers write to (Homebrew's prefix on macOS — a Finder-launched GUI
/// inherits a minimal PATH that lacks it — and /usr/bin for deb/rpm, #519). A heuristic by design:
/// the GUI cannot observe the user's interactive shell, so a miss only means "show the real paths",
/// which work everywhere.
fn launcher_on_path() -> bool {
    let names = launcher_candidates(cfg!(windows));
    let mut dirs: Vec<std::path::PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    if !cfg!(windows) {
        for d in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
            dirs.push(std::path::PathBuf::from(d));
        }
    }
    dirs.iter().any(|d| names.iter().any(|n| d.join(n).is_file()))
}

/// File names that count as "the launcher" when probing PATH dirs. Windows: ONLY `slidecraft-mcp.cmd` —
/// the extension-less POSIX sh file is no longer bundled there (#537), and an extension-less match would
/// be a file Windows cannot execute anyway. Pure so both branches are unit-testable on any host.
fn launcher_candidates(windows: bool) -> &'static [&'static str] {
    if windows {
        &["slidecraft-mcp.cmd"]
    } else {
        &["slidecraft-mcp"]
    }
}

/// A path as the user should SEE it in a registration command (#538). `BaseDirectory::Resource` is
/// rooted at a canonicalized exe path on Windows, so cli.cjs comes back as `\\?\C:\…` (extended-length
/// form) while `resolve_node()` (plain `current_exe()`) does not. `dunce::simplified` strips the `\\?\`
/// prefix only when the plain form means the same file; on non-Windows hosts it is a pass-through.
pub(crate) fn display_path(p: &std::path::Path) -> String {
    dunce::simplified(p).to_string_lossy().into_owned()
}

#[tauri::command]
pub fn mcp_install_info(app: tauri::AppHandle) -> Result<McpInstallInfo, String> {
    install_info(&app)
}

/// The ONE resolution of the install facts: the copy snippet (`mcp_install_info`) and the one-click register
/// (claude_register.rs, #530) both read it, so they can never point at different servers (R8).
pub(crate) fn install_info(app: &tauri::AppHandle) -> Result<McpInstallInfo, String> {
    let cli = resolve_bundled(app, "cli.cjs")?;
    Ok(McpInstallInfo {
        os: std::env::consts::OS,
        launcher_on_path: launcher_on_path(),
        node_path: display_path(&resolve_node()),
        cli_path: display_path(&cli),
    })
}

/// Resolve the `node` runtime. Dev: from PATH. Release: the bundled externalBin sits next to the main
/// exe (Tauri strips the `-<target-triple>` suffix at install → `node.exe`/`node`), staged by
/// scripts/stage-node.ps1. Falls back to PATH if current_exe() is somehow unavailable.
fn resolve_node() -> std::path::PathBuf {
    #[cfg(debug_assertions)]
    {
        std::path::PathBuf::from("node")
    }
    #[cfg(not(debug_assertions))]
    {
        let name = if cfg!(windows) { "node.exe" } else { "node" };
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.join(name)))
            .unwrap_or_else(|| std::path::PathBuf::from("node"))
    }
}

/// Spawn the collab sidecar and return its handshake. Idempotent: a live sidecar returns its
/// existing {url,token}. Sync command — it blocks the Tauri core thread until READY (~1s normally,
/// up to READY_TIMEOUT on a hang); the WebView2 webview (separate process) keeps painting, but other
/// Rust IPC calls briefly queue behind this wait. (Moving it off the core thread is a follow-up.)
#[tauri::command]
pub fn start_collab(app: tauri::AppHandle, state: tauri::State<'_, CollabState>) -> Result<CollabInfo, String> {
    // Already running? hand back the live handshake. Otherwise reap a dead child and respawn.
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

    let mut cmd = Command::new(resolve_node());
    cmd.arg(&host_cjs)
        .env("SLIDECRAFT_PORT", "0") // ephemeral → no port conflicts; the real url comes via READY
        .env("SLIDECRAFT_HOST_JSON", &host_json)
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit()); // host logs flow to the dev console for debugging
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("collab サイドカー(node)の起動に失敗しました: {e}"))?;

    // Drain stdout on a thread; forward the first READY line over a channel (and keep draining so a
    // full pipe never blocks the child).
    let stdout = match child.stdout.take() {
        Some(s) => s,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            return Err("子プロセスの stdout を取得できませんでした".into());
        }
    };
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

    let parsed: ReadyLine = match serde_json::from_str(&ready) {
        Ok(p) => p,
        Err(e) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("READY の解析に失敗しました: {e}"));
        }
    };
    let info = CollabInfo {
        url: parsed.url,
        token: parsed.token,
        host_json_path: host_json.to_string_lossy().to_string(),
    };

    *state.child.lock().unwrap_or_else(|e| e.into_inner()) = Some(child);
    *state.info.lock().unwrap_or_else(|e| e.into_inner()) = Some(info.clone());
    Ok(info)
}

#[tauri::command]
pub fn stop_collab(state: tauri::State<'_, CollabState>) -> Result<(), String> {
    if let Some(mut child) = state.child.lock().unwrap_or_else(|e| e.into_inner()).take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    clear_host_json(&state);
    Ok(())
}

/// Kill the sidecar on app exit (wired to RunEvent::ExitRequested / Exit). Safe to call repeatedly.
pub fn reap(app: &tauri::AppHandle) {
    let state = app.state::<CollabState>();
    if let Some(mut child) = state.child.lock().unwrap_or_else(|e| e.into_inner()).take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    clear_host_json(&state);
}

/// Remove the handshake file. On Windows kill() = TerminateProcess (no signal), so the sidecar's
/// SIGTERM handler that would clear host.json never runs — Rust clears it so no stale 0600 token
/// file lingers with a dead pid after every quit/stop.
fn clear_host_json(state: &CollabState) {
    if let Some(info) = state.info.lock().unwrap_or_else(|e| e.into_inner()).take() {
        let _ = std::fs::remove_file(&info.host_json_path);
    }
}

#[cfg(test)]
mod tests {
    use super::{display_path, launcher_candidates};
    use std::path::Path;

    // #537 — the Windows probe must accept ONLY the .cmd: an extension-less `slidecraft-mcp` on a Windows
    // PATH dir is the (no longer bundled) sh file, which Windows cannot run.
    #[test]
    fn windows_launcher_candidates_is_only_the_cmd() {
        assert_eq!(launcher_candidates(true), ["slidecraft-mcp.cmd"]);
    }

    #[test]
    fn posix_launcher_candidates_is_the_plain_name() {
        assert_eq!(launcher_candidates(false), ["slidecraft-mcp"]);
    }

    #[test]
    fn launcher_on_path_uses_the_candidates_for_this_host() {
        // Agreement (R8): the wiring passes cfg!(windows); a Windows build must never see the sh name.
        let names = launcher_candidates(cfg!(windows));
        assert_eq!(names.contains(&"slidecraft-mcp"), !cfg!(windows));
        assert_eq!(names.contains(&"slidecraft-mcp.cmd"), cfg!(windows));
    }

    // #538 — display_path strips the `\\?\` extended-length prefix on Windows and is a pass-through
    // everywhere else (the input is reproduced byte for byte).
    #[test]
    fn display_path_keeps_a_plain_path_unchanged() {
        for p in ["C:\\Program Files\\SlideCraft\\node.exe", "/Applications/SlideCraft.app/Contents/Resources/cli.cjs", "relative/cli.cjs"] {
            assert_eq!(display_path(Path::new(p)), p);
        }
    }

    #[cfg(windows)]
    #[test]
    fn display_path_strips_the_extended_length_prefix_on_windows() {
        assert_eq!(display_path(Path::new(r"\\?\C:\x\cli.cjs")), r"C:\x\cli.cjs");
        assert_eq!(display_path(Path::new(r"\\?\C:\Program Files\SlideCraft\cli.cjs")), r"C:\Program Files\SlideCraft\cli.cjs");
        // A verbatim UNC share is NOT a drive path — dunce (is_safe_to_strip_unc: VerbatimDisk only) leaves
        // it untouched rather than guessing; node accepts the verbatim form, so this stays correct, just long.
        assert_eq!(display_path(Path::new(r"\\?\UNC\srv\share\cli.cjs")), r"\\?\UNC\srv\share\cli.cjs");
    }

    #[cfg(not(windows))]
    #[test]
    fn display_path_is_a_pass_through_off_windows() {
        // On POSIX `\\?\C:\x\cli.cjs` is just a relative file name with backslashes — nothing to strip.
        assert_eq!(display_path(Path::new(r"\\?\C:\x\cli.cjs")), r"\\?\C:\x\cli.cjs");
    }
}
