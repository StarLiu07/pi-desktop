mod pi;
mod project;

use tauri::Emitter;

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
            project::pick_project
        ])
        .setup(|app| {
            // Boot the pi subprocess together with the window.
            if let Err(e) = pi::start_pi(app.handle().clone()) {
                let _ = app.emit(
                    pi::EVENT,
                    serde_json::json!({"type": "pi_error", "message": e}),
                );
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
