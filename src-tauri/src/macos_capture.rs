use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionStatus {
    pub accessibility: bool,
    pub screen_recording: bool,
    pub supported: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextCaptureOutcome {
    pub ok: bool,
    pub text: Option<String>,
    pub needs_permission: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageCaptureOutcome {
    pub ok: bool,
    pub data_url: Option<String>,
    pub cancelled: bool,
    pub needs_permission: Option<String>,
    pub message: Option<String>,
}

#[cfg(target_os = "macos")]
mod imp {
    use super::{ImageCaptureOutcome, PermissionStatus, TextCaptureOutcome};
    use std::ffi::{c_char, c_void, CStr, CString};
    use std::io::Write;
    use std::process::{Command, Stdio};
    use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
    use std::thread;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    type CFTypeRef = *const c_void;
    type CFStringRef = *const c_void;
    type CFDictionaryRef = *const c_void;
    type AXUIElementRef = *const c_void;

    const K_CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;
    const K_CG_EVENT_FLAG_MASK_COMMAND: u64 = 0x0010_0000;
    const K_CG_HID_EVENT_TAP: u32 = 0;
    const K_VK_ANSI_C: u16 = 8;

    static LAST_EXTERNAL_PID: AtomicI32 = AtomicI32::new(0);
    static TRACKER_STARTED: AtomicBool = AtomicBool::new(false);

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        static kAXTrustedCheckOptionPrompt: CFStringRef;
        fn AXIsProcessTrusted() -> bool;
        fn AXIsProcessTrustedWithOptions(options: CFDictionaryRef) -> bool;
        fn AXUIElementCreateApplication(pid: i32) -> AXUIElementRef;
        fn AXUIElementCopyAttributeValue(
            element: AXUIElementRef,
            attribute: CFStringRef,
            value: *mut CFTypeRef,
        ) -> i32;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        static kCFBooleanTrue: CFTypeRef;
        static kCFTypeDictionaryKeyCallBacks: c_void;
        static kCFTypeDictionaryValueCallBacks: c_void;
        fn CFDictionaryCreate(
            allocator: CFTypeRef,
            keys: *const CFTypeRef,
            values: *const CFTypeRef,
            num_values: isize,
            key_callbacks: *const c_void,
            value_callbacks: *const c_void,
        ) -> CFDictionaryRef;
        fn CFStringCreateWithCString(
            alloc: CFTypeRef,
            c_str: *const c_char,
            encoding: u32,
        ) -> CFStringRef;
        fn CFStringGetLength(the_string: CFStringRef) -> isize;
        fn CFStringGetMaximumSizeForEncoding(length: isize, encoding: u32) -> isize;
        fn CFStringGetCString(
            the_string: CFStringRef,
            buffer: *mut c_char,
            buffer_size: isize,
            encoding: u32,
        ) -> bool;
        fn CFGetTypeID(cf: CFTypeRef) -> usize;
        fn CFStringGetTypeID() -> usize;
        fn CFRelease(cf: CFTypeRef);
    }

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGPreflightScreenCaptureAccess() -> bool;
        fn CGRequestScreenCaptureAccess() -> bool;
        fn CGEventCreateKeyboardEvent(
            source: *const c_void,
            virtual_key: u16,
            key_down: bool,
        ) -> *mut c_void;
        fn CGEventSetFlags(event: *mut c_void, flags: u64);
        fn CGEventPost(tap: u32, event: *mut c_void);
    }

    #[link(name = "AppKit", kind = "framework")]
    extern "C" {}

    #[link(name = "objc")]
    extern "C" {
        fn objc_getClass(name: *const c_char) -> *mut c_void;
        fn sel_registerName(name: *const c_char) -> *mut c_void;
        fn objc_msgSend();
        fn objc_autoreleasePoolPush() -> *mut c_void;
        fn objc_autoreleasePoolPop(pool: *mut c_void);
    }

    unsafe fn msg_send_0_ptr(obj: *mut c_void, sel: *mut c_void) -> *mut c_void {
        let f: extern "C" fn(*mut c_void, *mut c_void) -> *mut c_void =
            std::mem::transmute(objc_msgSend as *const c_void);
        f(obj, sel)
    }

    unsafe fn msg_send_0_i32(obj: *mut c_void, sel: *mut c_void) -> i32 {
        let f: extern "C" fn(*mut c_void, *mut c_void) -> i32 =
            std::mem::transmute(objc_msgSend as *const c_void);
        f(obj, sel)
    }

    unsafe fn msg_send_1_i32_ptr(obj: *mut c_void, sel: *mut c_void, arg: i32) -> *mut c_void {
        let f: extern "C" fn(*mut c_void, *mut c_void, i32) -> *mut c_void =
            std::mem::transmute(objc_msgSend as *const c_void);
        f(obj, sel, arg)
    }

    unsafe fn msg_send_1_usize_bool(obj: *mut c_void, sel: *mut c_void, arg: usize) -> bool {
        let f: extern "C" fn(*mut c_void, *mut c_void, usize) -> bool =
            std::mem::transmute(objc_msgSend as *const c_void);
        f(obj, sel, arg)
    }

    fn frontmost_app_pid() -> i32 {
        unsafe {
            let pool = objc_autoreleasePoolPush();
            let cls = objc_getClass(c"NSWorkspace".as_ptr());
            if cls.is_null() {
                objc_autoreleasePoolPop(pool);
                return 0;
            }
            let shared_sel = sel_registerName(c"sharedWorkspace".as_ptr());
            let workspace = msg_send_0_ptr(cls, shared_sel);
            if workspace.is_null() {
                objc_autoreleasePoolPop(pool);
                return 0;
            }
            let front_sel = sel_registerName(c"frontmostApplication".as_ptr());
            let app = msg_send_0_ptr(workspace, front_sel);
            let pid = if app.is_null() {
                0
            } else {
                let pid_sel = sel_registerName(c"processIdentifier".as_ptr());
                msg_send_0_i32(app, pid_sel)
            };
            objc_autoreleasePoolPop(pool);
            pid
        }
    }

    fn activate_app_by_pid(pid: i32) -> bool {
        if pid <= 0 {
            return false;
        }
        unsafe {
            let pool = objc_autoreleasePoolPush();
            let cls = objc_getClass(c"NSRunningApplication".as_ptr());
            if cls.is_null() {
                objc_autoreleasePoolPop(pool);
                return false;
            }
            let by_pid_sel = sel_registerName(c"runningApplicationWithProcessIdentifier:".as_ptr());
            let app = msg_send_1_i32_ptr(cls, by_pid_sel, pid);
            let ok = if app.is_null() {
                false
            } else {
                let activate_sel = sel_registerName(c"activateWithOptions:".as_ptr());
                // NSApplicationActivateIgnoringOtherApps = 1 << 1
                msg_send_1_usize_bool(app, activate_sel, 1 << 1)
            };
            objc_autoreleasePoolPop(pool);
            ok
        }
    }

    pub fn ensure_frontmost_tracker() {
        if TRACKER_STARTED
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return;
        }
        let own_pid = std::process::id() as i32;
        let current = frontmost_app_pid();
        if current > 0 && current != own_pid {
            LAST_EXTERNAL_PID.store(current, Ordering::Relaxed);
        }
        thread::spawn(move || loop {
            let pid = frontmost_app_pid();
            if pid > 0 && pid != own_pid {
                LAST_EXTERNAL_PID.store(pid, Ordering::Relaxed);
            }
            thread::sleep(Duration::from_millis(250));
        });
    }

    pub fn check_permissions() -> PermissionStatus {
        let accessibility = unsafe { AXIsProcessTrusted() };
        let screen_recording = unsafe { CGPreflightScreenCaptureAccess() };
        PermissionStatus {
            accessibility,
            screen_recording,
            supported: true,
        }
    }

    pub fn request_accessibility_permission() -> bool {
        unsafe {
            let keys = [kAXTrustedCheckOptionPrompt as CFTypeRef];
            let values = [kCFBooleanTrue];
            let options = CFDictionaryCreate(
                std::ptr::null(),
                keys.as_ptr(),
                values.as_ptr(),
                1,
                &kCFTypeDictionaryKeyCallBacks,
                &kCFTypeDictionaryValueCallBacks,
            );
            let trusted = AXIsProcessTrustedWithOptions(options);
            if !options.is_null() {
                CFRelease(options);
            }
            trusted
        }
    }

    pub fn request_screen_recording_permission() -> bool {
        unsafe { CGRequestScreenCaptureAccess() }
    }

    pub fn open_permission_settings(kind: &str) -> Result<(), String> {
        let url = match kind {
            "accessibility" => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
            }
            "screen_recording" => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
            }
            _ => "x-apple.systempreferences:com.apple.preference.security",
        };
        Command::new("open")
            .arg(url)
            .status()
            .map_err(|err| format!("无法打开系统设置：{err}"))?;
        Ok(())
    }

    unsafe fn cf_string_from_str(s: &str) -> CFStringRef {
        let cstr = CString::new(s).expect("valid C string");
        CFStringCreateWithCString(std::ptr::null(), cstr.as_ptr(), K_CF_STRING_ENCODING_UTF8)
    }

    unsafe fn cf_string_to_rust(cf_str: CFStringRef) -> Option<String> {
        if cf_str.is_null() || CFGetTypeID(cf_str) != CFStringGetTypeID() {
            return None;
        }
        let len = CFStringGetLength(cf_str);
        if len <= 0 {
            return None;
        }
        let max_size = CFStringGetMaximumSizeForEncoding(len, K_CF_STRING_ENCODING_UTF8) + 1;
        if max_size <= 1 {
            return None;
        }
        let mut buf = vec![0u8; max_size as usize];
        let ok = CFStringGetCString(
            cf_str,
            buf.as_mut_ptr() as *mut c_char,
            max_size,
            K_CF_STRING_ENCODING_UTF8,
        );
        if !ok {
            return None;
        }
        CStr::from_ptr(buf.as_ptr() as *const c_char)
            .to_str()
            .ok()
            .map(|s| s.to_string())
    }

    fn read_ax_selected_text(pid: i32) -> Option<String> {
        if pid <= 0 {
            return None;
        }
        unsafe {
            let app_elem = AXUIElementCreateApplication(pid);
            if app_elem.is_null() {
                return None;
            }
            let focused_attr = cf_string_from_str("AXFocusedUIElement");
            let mut focused_elem: CFTypeRef = std::ptr::null();
            let err = AXUIElementCopyAttributeValue(app_elem, focused_attr, &mut focused_elem);
            CFRelease(focused_attr);
            CFRelease(app_elem);

            if err != 0 || focused_elem.is_null() {
                return None;
            }

            let selected_attr = cf_string_from_str("AXSelectedText");
            let mut selected_val: CFTypeRef = std::ptr::null();
            let sel_err =
                AXUIElementCopyAttributeValue(focused_elem, selected_attr, &mut selected_val);
            CFRelease(selected_attr);
            CFRelease(focused_elem);

            if sel_err != 0 || selected_val.is_null() {
                return None;
            }
            let result = cf_string_to_rust(selected_val);
            CFRelease(selected_val);
            result.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
        }
    }

    fn read_clipboard_text() -> Option<String> {
        let output = Command::new("pbpaste")
            .env("LANG", "en_US.UTF-8")
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        String::from_utf8(output.stdout).ok()
    }

    fn write_clipboard_text(text: &str) {
        if let Ok(mut child) = Command::new("pbcopy")
            .env("LANG", "en_US.UTF-8")
            .stdin(Stdio::piped())
            .spawn()
        {
            if let Some(mut stdin) = child.stdin.take() {
                let _ = stdin.write_all(text.as_bytes());
            }
            let _ = child.wait();
        }
    }

    fn send_cmd_c() {
        unsafe {
            let key_down = CGEventCreateKeyboardEvent(std::ptr::null(), K_VK_ANSI_C, true);
            if !key_down.is_null() {
                CGEventSetFlags(key_down, K_CG_EVENT_FLAG_MASK_COMMAND);
                CGEventPost(K_CG_HID_EVENT_TAP, key_down);
                CFRelease(key_down as CFTypeRef);
            }
            let key_up = CGEventCreateKeyboardEvent(std::ptr::null(), K_VK_ANSI_C, false);
            if !key_up.is_null() {
                CGEventSetFlags(key_up, K_CG_EVENT_FLAG_MASK_COMMAND);
                CGEventPost(K_CG_HID_EVENT_TAP, key_up);
                CFRelease(key_up as CFTypeRef);
            }
        }
    }

    fn capture_via_cmd_c(pid: i32) -> Option<String> {
        if pid <= 0 {
            return None;
        }
        let previous_clipboard = read_clipboard_text();
        let sentinel = format!(
            "__SCICANVAS_SENTINEL_{}__",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        );
        write_clipboard_text(&sentinel);

        activate_app_by_pid(pid);
        thread::sleep(Duration::from_millis(70));
        send_cmd_c();
        thread::sleep(Duration::from_millis(140));

        let copied = read_clipboard_text();
        if let Some(prev) = previous_clipboard {
            write_clipboard_text(&prev);
        }

        copied
            .filter(|text| text != &sentinel)
            .map(|text| text.trim().to_string())
            .filter(|text| !text.is_empty())
    }

    pub fn capture_selected_text() -> TextCaptureOutcome {
        if !unsafe { AXIsProcessTrusted() } {
            let _ = request_accessibility_permission();
            return TextCaptureOutcome {
                ok: false,
                text: None,
                needs_permission: Some("accessibility".to_string()),
                message: Some(
                    "已向系统请求「辅助功能」权限，请在弹窗或系统设置中允许 SciCanvas 后重试。"
                        .to_string(),
                ),
            };
        }

        let own_pid = std::process::id() as i32;
        let current_front = frontmost_app_pid();
        let target_pid = if current_front > 0 && current_front != own_pid {
            LAST_EXTERNAL_PID.store(current_front, Ordering::Relaxed);
            current_front
        } else {
            LAST_EXTERNAL_PID.load(Ordering::Relaxed)
        };

        if target_pid <= 0 {
            return TextCaptureOutcome {
                ok: false,
                text: None,
                needs_permission: None,
                message: Some("请先在论文窗口中选中公式文本，再点击悬浮球。".to_string()),
            };
        }

        if let Some(text) = read_ax_selected_text(target_pid) {
            return TextCaptureOutcome {
                ok: true,
                text: Some(text),
                needs_permission: None,
                message: None,
            };
        }

        if let Some(text) = capture_via_cmd_c(target_pid) {
            return TextCaptureOutcome {
                ok: true,
                text: Some(text),
                needs_permission: None,
                message: None,
            };
        }

        TextCaptureOutcome {
            ok: false,
            text: None,
            needs_permission: None,
            message: Some(
                "未检测到选中的公式文本；如果是 PDF 图片公式，可使用「框选公式」截图识别。"
                    .to_string(),
            ),
        }
    }

    fn base64_encode(input: &[u8]) -> String {
        const TABLE: &[u8; 64] =
            b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
        for chunk in input.chunks(3) {
            let b0 = chunk[0] as u32;
            let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
            let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
            let triple = (b0 << 16) | (b1 << 8) | b2;
            out.push(TABLE[((triple >> 18) & 0x3f) as usize] as char);
            out.push(TABLE[((triple >> 12) & 0x3f) as usize] as char);
            if chunk.len() > 1 {
                out.push(TABLE[((triple >> 6) & 0x3f) as usize] as char);
            } else {
                out.push('=');
            }
            if chunk.len() > 2 {
                out.push(TABLE[(triple & 0x3f) as usize] as char);
            } else {
                out.push('=');
            }
        }
        out
    }

    pub fn capture_screen_region() -> ImageCaptureOutcome {
        if !unsafe { CGPreflightScreenCaptureAccess() } {
            let _ = request_screen_recording_permission();
            return ImageCaptureOutcome {
                ok: false,
                data_url: None,
                cancelled: false,
                needs_permission: Some("screen_recording".to_string()),
                message: Some(
                    "已向系统请求「屏幕录制」权限，请在系统设置中允许 SciCanvas 后重试。"
                        .to_string(),
                ),
            };
        }

        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let temp_path = std::env::temp_dir().join(format!("scicanvas-formula-{stamp}.png"));

        let status = Command::new("screencapture")
            .args(["-i", "-x"])
            .arg(&temp_path)
            .status();

        match status {
            Ok(s) if s.success() && temp_path.exists() => {
                let bytes = std::fs::read(&temp_path);
                let _ = std::fs::remove_file(&temp_path);
                match bytes {
                    Ok(data) if !data.is_empty() => ImageCaptureOutcome {
                        ok: true,
                        data_url: Some(format!("data:image/png;base64,{}", base64_encode(&data))),
                        cancelled: false,
                        needs_permission: None,
                        message: None,
                    },
                    _ => ImageCaptureOutcome {
                        ok: false,
                        data_url: None,
                        cancelled: true,
                        needs_permission: None,
                        message: Some("未截取到图像，请重新框选公式区域。".to_string()),
                    },
                }
            }
            Ok(_) => {
                let _ = std::fs::remove_file(&temp_path);
                ImageCaptureOutcome {
                    ok: false,
                    data_url: None,
                    cancelled: true,
                    needs_permission: None,
                    message: Some("已取消框选截图。".to_string()),
                }
            }
            Err(err) => {
                let _ = std::fs::remove_file(&temp_path);
                ImageCaptureOutcome {
                    ok: false,
                    data_url: None,
                    cancelled: false,
                    needs_permission: None,
                    message: Some(format!("启动系统截图失败：{err}")),
                }
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    use super::{ImageCaptureOutcome, PermissionStatus, TextCaptureOutcome};

    pub fn ensure_frontmost_tracker() {}

    pub fn check_permissions() -> PermissionStatus {
        PermissionStatus {
            accessibility: false,
            screen_recording: false,
            supported: false,
        }
    }

    pub fn request_accessibility_permission() -> bool {
        false
    }

    pub fn request_screen_recording_permission() -> bool {
        false
    }

    pub fn open_permission_settings(_kind: &str) -> Result<(), String> {
        Err("当前系统暂不支持自动打开权限设置".to_string())
    }

    pub fn capture_selected_text() -> TextCaptureOutcome {
        TextCaptureOutcome {
            ok: false,
            text: None,
            needs_permission: None,
            message: Some("悬浮球跨应用取词目前仅支持 macOS 桌面端。".to_string()),
        }
    }

    pub fn capture_screen_region() -> ImageCaptureOutcome {
        ImageCaptureOutcome {
            ok: false,
            data_url: None,
            cancelled: false,
            needs_permission: None,
            message: Some("悬浮球框选公式截图目前仅支持 macOS 桌面端。".to_string()),
        }
    }
}

pub use imp::{
    capture_screen_region, capture_selected_text, check_permissions, ensure_frontmost_tracker,
    open_permission_settings, request_accessibility_permission,
    request_screen_recording_permission,
};
