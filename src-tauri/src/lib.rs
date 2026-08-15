mod pi;
mod project;

use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(pi::PiState::default())
        .invoke_handler(tauri::generate_handler![
            pi::start_pi,
            pi::send_rpc,
            pi::stop_pi,
            pi::pi_installed,
            pi::list_sessions,
            pi::name_sessions,
            project::list_projects,
            project::set_project,
            project::pick_project,
            project::project_path_info,
            project::create_project_dir
        ])
        .setup(|app| {
            // Boot the pi subprocess together with the window — on a background
            // thread so the npm probe (`npm root -g`, ~200ms on Windows) never
            // blocks the event loop. pi keeps booting in parallel with the
            // WebView; errors are surfaced to the frontend as pi_error events.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                if let Err(e) = pi::start_pi(handle.clone()) {
                    let _ = handle.emit(
                        pi::EVENT,
                        serde_json::json!({"type": "pi_error", "message": e}),
                    );
                }
            });
            // Fallback: the frontend shows the window once its first frame is
            // committed; if it never runs (JS failed to load), reveal the
            // window after 10s so the app doesn't stay invisible. No-op when
            // the frontend already showed it.
            if let Some(win) = app.get_webview_window("main") {
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(10));
                    let _ = win.show();
                });
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                let _ = pi::stop_pi(app_handle.clone());
            }
        });
}
