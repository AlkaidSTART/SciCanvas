use crate::macos_capture::{
    self, ImageCaptureOutcome, PermissionStatus, TextCaptureOutcome,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

pub const FLOATING_BALL_LABEL: &str = "floating-ball";
pub const FORMULA_CAPTURED_EVENT: &str = "floating-ball:formula-captured";
pub const FLOATING_BALL_VISIBILITY_EVENT: &str = "floating-ball:visibility-changed";

const BALL_COLLAPSED_SIZE: f64 = 72.0;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturedFormulaPayload {
    pub kind: String,
    pub content: Option<String>,
    pub source: Option<String>,
    pub data_url: Option<String>,
    pub name: Option<String>,
}

fn emit_visibility(app: &AppHandle, visible: bool) {
    let _ = app.emit_to("main", FLOATING_BALL_VISIBILITY_EVENT, visible);
}

fn show_ball_window(app: &AppHandle, window: &tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let win = window.clone();
        app.run_on_main_thread(move || {
            if let Ok(ns_window) = win.ns_window() {
                macos_capture::show_floating_ball_window(ns_window);
            }
        })
        .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        window.show().map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn floating_ball_open(app: AppHandle) -> Result<PermissionStatus, String> {
    macos_capture::ensure_frontmost_tracker();

    if let Some(window) = app.get_webview_window(FLOATING_BALL_LABEL) {
        show_ball_window(&app, &window)?;
        emit_visibility(&app, true);
        return Ok(macos_capture::check_permissions());
    }

    let mut builder = WebviewWindowBuilder::new(
        &app,
        FLOATING_BALL_LABEL,
        WebviewUrl::App("index.html?window=floating-ball".into()),
    )
    .title("SciCanvas 悬浮球")
    .inner_size(BALL_COLLAPSED_SIZE, BALL_COLLAPSED_SIZE)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .visible_on_all_workspaces(true)
    .skip_taskbar(true)
    .focused(false)
    .visible(false);

    if let Ok(Some(monitor)) = app.primary_monitor() {
        let scale = monitor.scale_factor();
        let size = monitor.size();
        let logical_w = size.width as f64 / scale;
        let logical_h = size.height as f64 / scale;
        let pos_x = (logical_w - BALL_COLLAPSED_SIZE - 28.0).max(24.0);
        let pos_y = (logical_h * 0.32).max(60.0);
        builder = builder.position(pos_x, pos_y);
    }

    let window = builder.build().map_err(|e| e.to_string())?;
    show_ball_window(&app, &window)?;
    emit_visibility(&app, true);
    Ok(macos_capture::check_permissions())
}

#[tauri::command]
pub fn floating_ball_close(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(FLOATING_BALL_LABEL) {
        window.hide().map_err(|e| e.to_string())?;
    }
    emit_visibility(&app, false);
    Ok(())
}

#[tauri::command]
pub fn floating_ball_is_open(app: AppHandle) -> bool {
    app.get_webview_window(FLOATING_BALL_LABEL)
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false)
}

#[tauri::command]
pub fn get_capture_permissions() -> PermissionStatus {
    macos_capture::check_permissions()
}

#[tauri::command]
pub fn request_capture_permission(kind: String) -> PermissionStatus {
    match kind.as_str() {
        "accessibility" => {
            let _ = macos_capture::request_accessibility_permission();
        }
        "screen_recording" => {
            let _ = macos_capture::request_screen_recording_permission();
        }
        _ => {
            let _ = macos_capture::request_accessibility_permission();
            let _ = macos_capture::request_screen_recording_permission();
        }
    }
    macos_capture::check_permissions()
}

#[tauri::command]
pub fn open_permission_settings(kind: String) -> Result<(), String> {
    macos_capture::open_permission_settings(&kind)
}

#[tauri::command]
pub fn focus_main_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn capture_selected_formula(app: AppHandle) -> Result<TextCaptureOutcome, String> {
    let outcome = tauri::async_runtime::spawn_blocking(macos_capture::capture_selected_text)
        .await
        .map_err(|e| format!("读取选中公式失败：{e}"))?;

    if outcome.ok {
        if let Some(ref text) = outcome.text {
            let payload = CapturedFormulaPayload {
                kind: "text".to_string(),
                content: Some(text.clone()),
                source: outcome.source.clone(),
                data_url: None,
                name: None,
            };
            let _ = app.emit_to("main", FORMULA_CAPTURED_EVENT, payload);
        }
    }

    Ok(outcome)
}

#[tauri::command]
pub async fn capture_formula_screenshot(app: AppHandle) -> Result<ImageCaptureOutcome, String> {
    if let Some(ball) = app.get_webview_window(FLOATING_BALL_LABEL) {
        let _ = ball.hide();
    }

    let outcome = tauri::async_runtime::spawn_blocking(macos_capture::capture_screen_region)
        .await
        .map_err(|e| format!("截图任务失败：{e}"))?;

    if let Some(ball) = app.get_webview_window(FLOATING_BALL_LABEL) {
        let _ = show_ball_window(&app, &ball);
    }

    if outcome.ok {
        if let Some(ref data_url) = outcome.data_url {
            let payload = CapturedFormulaPayload {
                kind: "image".to_string(),
                content: None,
                source: None,
                data_url: Some(data_url.clone()),
                name: Some("悬浮球框选公式.png".to_string()),
            };
            let _ = app.emit_to("main", FORMULA_CAPTURED_EVENT, payload);
            let _ = focus_main_window(app);
        }
    }

    Ok(outcome)
}
