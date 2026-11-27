mod floating_ball;
mod macos_capture;
mod sqlite_store;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    macos_capture::ensure_frontmost_tracker();

    tauri::Builder::default()
        .setup(|app| {
            let store = sqlite_store::SqliteStore::open_for_app(app.handle())
                .map_err(|err| std::io::Error::new(std::io::ErrorKind::Other, err))?;
            app.manage(store);
            let _ = floating_ball::floating_ball_open(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            floating_ball::floating_ball_open,
            floating_ball::floating_ball_close,
            floating_ball::floating_ball_is_open,
            floating_ball::floating_ball_set_expanded,
            floating_ball::get_capture_permissions,
            floating_ball::request_capture_permission,
            floating_ball::open_permission_settings,
            floating_ball::focus_main_window,
            floating_ball::capture_selected_formula,
            floating_ball::capture_formula_screenshot,
            sqlite_store::sqlite_list_sessions,
            sqlite_store::sqlite_get_session_detail,
            sqlite_store::sqlite_create_session,
            sqlite_store::sqlite_delete_session,
            sqlite_store::sqlite_append_message,
            sqlite_store::sqlite_save_generation,
            sqlite_store::sqlite_list_generations,
            sqlite_store::sqlite_list_llm_endpoints,
            sqlite_store::sqlite_upsert_llm_endpoint,
            sqlite_store::sqlite_set_active_llm_endpoint,
            sqlite_store::sqlite_delete_llm_endpoint,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
