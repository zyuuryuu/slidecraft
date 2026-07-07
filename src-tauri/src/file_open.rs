// File-open on launch — the `.scft` OS file association (double-click a project → it
// opens in SlideCraft). The OS hands us the path: Windows/Linux via the process argv,
// macOS via the Apple "open documents" event (RunEvent::Opened). That's a user gesture we
// trust, so we grant THAT one path to the fs scope and queue it. The webview only DRAINS
// the queue (take_pending_opens) and reads the granted path through the same scoped
// plugin-fs a dialog pick uses — it never supplies an arbitrary path, so no new
// arbitrary-read hole opens (the closed hole in lib.rs's header stays closed). See ADR-0024.
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_fs::FsExt;

/// Paths the OS asked us to open, not yet consumed by the webview. Drained on webview
/// mount (cold launch) and on the `scft://open-file` poke (warm launch).
#[derive(Default)]
pub struct PendingOpen(pub Mutex<Vec<String>>);

fn is_project_path(p: &str) -> bool {
    p.to_ascii_lowercase().ends_with(".scft")
}

/// Grant ONE launch-handed project path to the fs scope, queue it, and poke a running
/// webview. Non-`.scft` inputs (the exe path, flags, macOS `-psn_…` args) are ignored.
pub fn queue_open<R: Runtime>(app: &AppHandle<R>, path: String) {
    if !is_project_path(&path) {
        return;
    }
    // Same trust model as a dialog pick: grant read on exactly this file at runtime.
    let _ = app.fs_scope().allow_file(&path);
    if let Some(state) = app.try_state::<PendingOpen>() {
        if let Ok(mut q) = state.0.lock() {
            q.push(path);
        }
    }
    // Poke the webview to drain. Harmlessly missed on a cold start (no JS listener yet) —
    // the webview also drains on mount; this only matters for a warm open (app running).
    let _ = app.emit("scft://open-file", ());
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// Queue every `.scft` path in a process argv list (Win/Linux cold launch + the
/// single-instance warm-launch argv). `queue_open` filters non-project args.
pub fn queue_from_args<R: Runtime>(app: &AppHandle<R>, args: impl IntoIterator<Item = String>) {
    for a in args {
        queue_open(app, a);
    }
}

/// Drain the queue for the webview (each path is already fs-scope-granted).
#[tauri::command]
pub fn take_pending_opens(state: State<'_, PendingOpen>) -> Vec<String> {
    state
        .0
        .lock()
        .map(|mut q| std::mem::take(&mut *q))
        .unwrap_or_default()
}
