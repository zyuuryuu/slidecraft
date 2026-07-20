// File IO is handled by the scoped tauri-plugin-fs: the webview can only read/write
// paths the user explicitly picked via the dialog plugin (the dialog grants those
// paths to the fs scope at runtime), instead of the old hand-rolled read_file/
// read_file_bytes/write_file commands that took an arbitrary absolute path — which
// let a compromised webview read/write anywhere. That arbitrary-fs hole is now closed.
mod collab; // P2.3: spawn / supervise / reap the Node collab sidecar (start_collab/stop_collab)
mod local_ai; // roadmap #2: spawn / supervise / reap the bundled llamafile in-app AI runtime
mod secret_store; // ADR-0016 F3: OS keychain for the BYOK API key (secret_set/get/delete)
mod model_tier; // 環境適応の既定モデル選択（RAM/コア → Small|Balanced tier）
mod file_open; // ADR-0024: `.scft` OS file association — open a project on double-click / "open with"

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Boot trace (temporary) — pinpoints how far startup gets when the window won't show:
    //  - only "run() entered"          → dies building the app / creating the webview (env/webkit)
    //  - "setup() reached" too         → window WAS created; problem is rendering/blank (display/CSP)
    eprintln!("[slidecraft] run() entered — building app");
    let mut builder = tauri::Builder::default();
    // single-instance must be registered FIRST: it intercepts a SECOND launch (a warm
    // double-click of a .scft) before other plugins init and routes that file's argv into
    // THIS instance instead of spawning a duplicate app (Windows/Linux). macOS delivers a
    // warm open via RunEvent::Opened on the existing process, so it needs no plugin.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            file_open::queue_from_args(app, argv);
        }));
    }
    let app = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .manage(collab::CollabState::default())
        .manage(local_ai::LocalAiState::default())
        .manage(file_open::PendingOpen::default())
        .invoke_handler(tauri::generate_handler![
            collab::start_collab,
            collab::stop_collab,
            local_ai::start_local_ai,
            local_ai::stop_local_ai,
            local_ai::local_ai_status,
            local_ai::ensure_model_weights,
            local_ai::evict_model_weights,
            local_ai::model_weights_present,
            secret_store::secret_set,
            secret_store::secret_get,
            secret_store::secret_delete,
            model_tier::recommended_model_tier,
            model_tier::builtin_model_info,
            file_open::take_pending_opens
        ])
        .setup(|app| {
            eprintln!("[slidecraft] setup() reached — main window created, entering event loop");
            // Cold launch on Windows/Linux: a .scft path (if the app was opened WITH a file)
            // arrives in argv. On macOS it arrives later via RunEvent::Opened, so this no-ops.
            file_open::queue_from_args(app.handle(), std::env::args());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // run-loop: reap the collab sidecar on quit so node never orphans (no Drop on std Child).
    app.run(|app_handle, event| match event {
        tauri::RunEvent::ExitRequested { .. } => {
            collab::reap(app_handle);
            local_ai::reap(app_handle);
        }
        tauri::RunEvent::Exit => {
            collab::reap(app_handle);
            local_ai::reap(app_handle);
        }
        // macOS delivers "open this document" as an Apple event (never argv), for both cold
        // and warm launches — route each .scft URL into the same queue the webview drains.
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Opened { urls } => {
            for url in urls {
                if let Ok(path) = url.to_file_path() {
                    file_open::queue_open(app_handle, path.to_string_lossy().into_owned());
                }
            }
        }
        _ => {}
    });
    eprintln!("[slidecraft] run() returned — app exited cleanly");
}
