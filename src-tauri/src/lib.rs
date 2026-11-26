mod floating_ball;
mod macos_capture;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    macos_capture::ensure_frontmost_tracker();

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            floating_ball::floating_ball_open,
            floating_ball::floating_ball_close,
            floating_ball::floating_ball_is_open,
            floating_ball::get_capture_permissions,
            floating_ball::request_capture_permission,
            floating_ball::open_permission_settings,
            floating_ball::focus_main_window,
            floating_ball::capture_selected_formula,
            floating_ball::capture_formula_screenshot,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
