use crate::macos_capture::{
    self, ImageCaptureOutcome, PermissionStatus, TextCaptureOutcome,
};
use serde::Serialize;
use std::sync::Mutex;
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder,
};

pub const FLOATING_BALL_LABEL: &str = "floating-ball";
pub const FORMULA_CAPTURED_EVENT: &str = "floating-ball:formula-captured";
pub const FLOATING_BALL_VISIBILITY_EVENT: &str = "floating-ball:visibility-changed";

const BALL_COLLAPSED_SIZE: f64 = 72.0;
const SCREEN_EDGE_MARGIN: f64 = 12.0;
const INITIAL_RIGHT_MARGIN: f64 = 28.0;

#[derive(Debug, Clone, Copy, PartialEq)]
struct LogicalRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct AnchorOffset {
    dx: f64,
    dy: f64,
}

static EXPAND_ANCHOR_OFFSET: Mutex<Option<AnchorOffset>> = Mutex::new(None);

fn clamp_position_to_work_area(
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    work_area: LogicalRect,
    margin: f64,
) -> (f64, f64) {
    let min_x = work_area.x + margin;
    let max_x = (work_area.x + work_area.width - width - margin).max(min_x);
    let min_y = work_area.y + margin;
    let max_y = (work_area.y + work_area.height - height - margin).max(min_y);
    (x.clamp(min_x, max_x), y.clamp(min_y, max_y))
}

fn compute_expanded_bounds(
    current: LogicalRect,
    target_w: f64,
    target_h: f64,
    work_area: LogicalRect,
    margin: f64,
) -> (LogicalRect, AnchorOffset) {
    let ball_center_x = current.x + current.width * 0.5;
    let work_center_x = work_area.x + work_area.width * 0.5;
    let overflows_right = current.x + target_w > work_area.x + work_area.width - margin;

    // 位于屏幕右半侧或向右展开会溢出时，保持右边缘与悬浮球对齐并向左展开
    let desired_x = if ball_center_x > work_center_x || overflows_right {
        current.x + current.width - target_w
    } else {
        current.x
    };

    // 向下展开会溢出时，保持底边缘与悬浮球对齐并向上展开
    let overflows_bottom = current.y + target_h > work_area.y + work_area.height - margin;
    let desired_y = if overflows_bottom {
        current.y + current.height - target_h
    } else {
        current.y
    };

    let (clamped_x, clamped_y) =
        clamp_position_to_work_area(desired_x, desired_y, target_w, target_h, work_area, margin);

    let next = LogicalRect {
        x: clamped_x,
        y: clamped_y,
        width: target_w,
        height: target_h,
    };
    let offset = AnchorOffset {
        dx: clamped_x - current.x,
        dy: clamped_y - current.y,
    };
    (next, offset)
}

fn compute_collapsed_bounds(
    current: LogicalRect,
    target_w: f64,
    target_h: f64,
    anchor: Option<AnchorOffset>,
    work_area: LogicalRect,
    margin: f64,
) -> LogicalRect {
    let (desired_x, desired_y) = match anchor {
        Some(offset) => (current.x - offset.dx, current.y - offset.dy),
        None => (current.x, current.y),
    };
    let (clamped_x, clamped_y) =
        clamp_position_to_work_area(desired_x, desired_y, target_w, target_h, work_area, margin);

    LogicalRect {
        x: clamped_x,
        y: clamped_y,
        width: target_w,
        height: target_h,
    }
}

fn monitor_work_area_logical(monitor: &tauri::Monitor) -> LogicalRect {
    let scale = monitor.scale_factor();
    let work = monitor.work_area();
    LogicalRect {
        x: work.position.x as f64 / scale,
        y: work.position.y as f64 / scale,
        width: work.size.width as f64 / scale,
        height: work.size.height as f64 / scale,
    }
}

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
        let work = monitor_work_area_logical(&monitor);
        let pos_x = work.x + (work.width - BALL_COLLAPSED_SIZE - INITIAL_RIGHT_MARGIN).max(SCREEN_EDGE_MARGIN);
        let pos_y = work.y + (work.height * 0.32).max(24.0);
        let (clamped_x, clamped_y) = clamp_position_to_work_area(
            pos_x,
            pos_y,
            BALL_COLLAPSED_SIZE,
            BALL_COLLAPSED_SIZE,
            work,
            SCREEN_EDGE_MARGIN,
        );
        builder = builder.position(clamped_x, clamped_y);
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
pub fn floating_ball_set_expanded(
    app: AppHandle,
    expanded: bool,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let Some(window) = app.get_webview_window(FLOATING_BALL_LABEL) else {
        return Ok(());
    };

    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| app.primary_monitor().ok().flatten());

    let Some(monitor) = monitor else {
        return window
            .set_size(LogicalSize::new(width, height))
            .map_err(|e| e.to_string());
    };

    let scale = monitor.scale_factor();
    let work_area = monitor_work_area_logical(&monitor);
    let current_pos = window
        .outer_position()
        .map(|pos| pos.to_logical::<f64>(scale))
        .unwrap_or_else(|_| LogicalPosition::new(work_area.x + SCREEN_EDGE_MARGIN, work_area.y + SCREEN_EDGE_MARGIN));
    let current_size = window
        .outer_size()
        .map(|size| size.to_logical::<f64>(scale))
        .unwrap_or_else(|_| LogicalSize::new(BALL_COLLAPSED_SIZE, BALL_COLLAPSED_SIZE));

    let current = LogicalRect {
        x: current_pos.x,
        y: current_pos.y,
        width: current_size.width,
        height: current_size.height,
    };

    if expanded {
        let (target, offset) =
            compute_expanded_bounds(current, width, height, work_area, SCREEN_EDGE_MARGIN);
        if let Ok(mut guard) = EXPAND_ANCHOR_OFFSET.lock() {
            *guard = Some(offset);
        }
        // 先移至不会溢出的目标起点，再放大窗口，避免在屏幕边缘闪出屏外
        window
            .set_position(LogicalPosition::new(target.x, target.y))
            .map_err(|e| e.to_string())?;
        window
            .set_size(LogicalSize::new(target.width, target.height))
            .map_err(|e| e.to_string())?;
    } else {
        let anchor = EXPAND_ANCHOR_OFFSET
            .lock()
            .ok()
            .and_then(|mut guard| guard.take());
        let target = compute_collapsed_bounds(
            current,
            width,
            height,
            anchor,
            work_area,
            SCREEN_EDGE_MARGIN,
        );
        // 先缩小再回到悬浮球锚点位置，避免缩小过程越界
        window
            .set_size(LogicalSize::new(target.width, target.height))
            .map_err(|e| e.to_string())?;
        window
            .set_position(LogicalPosition::new(target.x, target.y))
            .map_err(|e| e.to_string())?;
    }

    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;

    const WORK_AREA: LogicalRect = LogicalRect {
        x: 0.0,
        y: 25.0,
        width: 1440.0,
        height: 875.0,
    };

    #[test]
    fn expands_leftward_from_initial_right_sidebar_without_overflow() {
        let ball = LogicalRect {
            x: 1340.0,
            y: 305.0,
            width: 72.0,
            height: 72.0,
        };
        let (expanded, offset) =
            compute_expanded_bounds(ball, 292.0, 268.0, WORK_AREA, SCREEN_EDGE_MARGIN);

        assert_eq!(expanded.x, 1120.0);
        assert_eq!(expanded.y, 305.0);
        assert!(expanded.x >= WORK_AREA.x + SCREEN_EDGE_MARGIN);
        assert!(expanded.x + expanded.width <= WORK_AREA.x + WORK_AREA.width - SCREEN_EDGE_MARGIN);
        assert!(expanded.y + expanded.height <= WORK_AREA.y + WORK_AREA.height - SCREEN_EDGE_MARGIN);
        assert_eq!(offset, AnchorOffset { dx: -220.0, dy: 0.0 });

        let collapsed = compute_collapsed_bounds(
            expanded,
            72.0,
            72.0,
            Some(offset),
            WORK_AREA,
            SCREEN_EDGE_MARGIN,
        );
        assert_eq!(collapsed, ball);
    }

    #[test]
    fn expands_up_and_left_from_bottom_right_corner_without_overflow() {
        let ball = LogicalRect {
            x: 1360.0,
            y: 820.0,
            width: 72.0,
            height: 72.0,
        };
        let (expanded, offset) =
            compute_expanded_bounds(ball, 292.0, 268.0, WORK_AREA, SCREEN_EDGE_MARGIN);

        assert!(expanded.x >= WORK_AREA.x + SCREEN_EDGE_MARGIN);
        assert!(expanded.x + expanded.width <= WORK_AREA.x + WORK_AREA.width - SCREEN_EDGE_MARGIN);
        assert!(expanded.y >= WORK_AREA.y + SCREEN_EDGE_MARGIN);
        assert!(expanded.y + expanded.height <= WORK_AREA.y + WORK_AREA.height - SCREEN_EDGE_MARGIN);

        let collapsed = compute_collapsed_bounds(
            expanded,
            72.0,
            72.0,
            Some(offset),
            WORK_AREA,
            SCREEN_EDGE_MARGIN,
        );
        assert!(collapsed.x + collapsed.width <= WORK_AREA.x + WORK_AREA.width - SCREEN_EDGE_MARGIN);
        assert!(collapsed.y + collapsed.height <= WORK_AREA.y + WORK_AREA.height - SCREEN_EDGE_MARGIN);
    }

    #[test]
    fn expands_rightward_from_left_edge_and_clamps_to_margin() {
        let ball = LogicalRect {
            x: 4.0,
            y: 28.0,
            width: 72.0,
            height: 72.0,
        };
        let (expanded, _) =
            compute_expanded_bounds(ball, 292.0, 268.0, WORK_AREA, SCREEN_EDGE_MARGIN);

        assert_eq!(expanded.x, WORK_AREA.x + SCREEN_EDGE_MARGIN);
        assert_eq!(expanded.y, WORK_AREA.y + SCREEN_EDGE_MARGIN);
    }

    #[test]
    fn supports_secondary_monitor_with_negative_origin() {
        let left_monitor = LogicalRect {
            x: -1920.0,
            y: 0.0,
            width: 1920.0,
            height: 1080.0,
        };
        let ball = LogicalRect {
            x: -100.0,
            y: 400.0,
            width: 72.0,
            height: 72.0,
        };
        let (expanded, _) =
            compute_expanded_bounds(ball, 292.0, 268.0, left_monitor, SCREEN_EDGE_MARGIN);

        assert_eq!(expanded.x, -320.0);
        assert!(expanded.x + expanded.width <= left_monitor.x + left_monitor.width - SCREEN_EDGE_MARGIN);
    }
}
