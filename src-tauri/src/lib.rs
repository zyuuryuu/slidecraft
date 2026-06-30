// File IO is handled by the scoped tauri-plugin-fs: the webview can only read/write
// paths the user explicitly picked via the dialog plugin (the dialog grants those
// paths to the fs scope at runtime), instead of the old hand-rolled read_file/
// read_file_bytes/write_file commands that took an arbitrary absolute path — which
// let a compromised webview read/write anywhere. That arbitrary-fs hole is now closed.
mod collab; // P2.3: spawn / supervise / reap the Node collab sidecar (start_collab/stop_collab)

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Boot trace (temporary) — pinpoints how far startup gets when the window won't show:
    //  - only "run() entered"          → dies building the app / creating the webview (env/webkit)
    //  - "setup() reached" too         → window WAS created; problem is rendering/blank (display/CSP)
    eprintln!("[slidecraft] run() entered — building app");
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_fs::init())
        .manage(collab::CollabState::default())
        .invoke_handler(tauri::generate_handler![collab::start_collab, collab::stop_collab])
        .setup(|_app| {
            eprintln!("[slidecraft] setup() reached — main window created, entering event loop");
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // run-loop: reap the collab sidecar on quit so node never orphans (no Drop on std Child).
    app.run(|app_handle, event| match event {
        tauri::RunEvent::ExitRequested { .. } => collab::reap(app_handle),
        tauri::RunEvent::Exit => collab::reap(app_handle),
        _ => {}
    });
    eprintln!("[slidecraft] run() returned — app exited cleanly");
}
