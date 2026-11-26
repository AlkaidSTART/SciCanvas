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
    /// 捕获来源："ax"（AXUIElement 0 延迟直读，不碰剪贴板）或 "clipboard"（Cmd+C 降级，已恢复剪贴板）。
    pub source: Option<String>,
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

/// 清洗从论文/PDF（尤其是双栏排版）中划词或复制得到的公式文本：
/// 1. 去除零宽字符与软连字符、统一换行符；
/// 2. 合并 PDF 行尾断词连字符（如 `oscil-\nlator` -> `oscillator`），同时保留数学减号（如 `a -\nb` -> `a - b`）；
/// 3. 将硬回车 `\n+` 规整为单空格，方便直接喂给大模型或检索框。
pub(crate) fn normalize_captured_text(raw: &str) -> Option<String> {
    let cleaned = raw
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .replace('\u{00A0}', " ")
        .replace(['\u{00AD}', '\u{200B}', '\u{200C}', '\u{200D}', '\u{FEFF}'], "");

    // 合并紧贴字母/汉字的断词连字符 `-\n`（避免误删数学表达式中的二元减号 ` - \n`）
    let mut dehyphenated = String::with_capacity(cleaned.len());
    let chars: Vec<char> = cleaned.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '-'
            && i > 0
            && chars[i - 1].is_alphabetic()
            && i + 1 < chars.len()
            && chars[i + 1] == '\n'
        {
            i += 2;
            while i < chars.len() && (chars[i] == ' ' || chars[i] == '\t') {
                i += 1;
            }
            continue;
        }
        dehyphenated.push(chars[i]);
        i += 1;
    }

    // 将 PDF 硬回车替换为单空格，并收敛多余空白
    let mut collapsed = String::with_capacity(dehyphenated.len());
    let mut prev_was_space = false;
    for ch in dehyphenated.chars() {
        if ch == '\n' || ch == '\t' || ch == ' ' {
            if !prev_was_space && !collapsed.is_empty() {
                collapsed.push(' ');
                prev_was_space = true;
            }
        } else {
            collapsed.push(ch);
            prev_was_space = false;
        }
    }

    let final_text = collapsed.trim();
    if final_text.is_empty() {
        None
    } else {
        Some(final_text.to_string())
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use super::{
        normalize_captured_text, ImageCaptureOutcome, PermissionStatus, TextCaptureOutcome,
    };
    use std::ffi::{c_char, c_void, CStr, CString};
    use std::process::Command;
    use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
    use std::thread;
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

    type CFTypeRef = *const c_void;
    type CFStringRef = *const c_void;
    type CFDictionaryRef = *const c_void;
    type AXUIElementRef = *const c_void;

    const K_CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;
    const K_CG_EVENT_FLAG_MASK_COMMAND: u64 = 0x0010_0000;
    const K_CG_EVENT_SOURCE_STATE_HID_SYSTEM_STATE: i32 = 1;
    const K_CG_HID_EVENT_TAP: u32 = 0;
    const K_VK_ANSI_C: u16 = 8;

    // NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorFullScreenAuxiliary
    const NS_WINDOW_COLLECTION_BEHAVIOR_FLOATING: usize = (1 << 0) | (1 << 8);

    const AX_MESSAGING_TIMEOUT_SECS: f32 = 0.4;
    const TRACKER_POLL_INTERVAL_MS: u64 = 80;
    const ACTIVATE_WAIT_TIMEOUT_MS: u64 = 200;
    const ACTIVATE_SETTLE_MS: u64 = 15;
    const CLIPBOARD_POLL_TIMEOUT_MS: u64 = 300;
    const CLIPBOARD_POLL_INTERVAL_MS: u64 = 15;

    static LAST_EXTERNAL_PID: AtomicI32 = AtomicI32::new(0);
    static TRACKER_STARTED: AtomicBool = AtomicBool::new(false);

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        static kAXTrustedCheckOptionPrompt: CFStringRef;
        fn AXIsProcessTrusted() -> bool;
        fn AXIsProcessTrustedWithOptions(options: CFDictionaryRef) -> bool;
        fn AXUIElementCreateSystemWide() -> AXUIElementRef;
        fn AXUIElementCreateApplication(pid: i32) -> AXUIElementRef;
        fn AXUIElementSetMessagingTimeout(element: AXUIElementRef, timeout_in_seconds: f32) -> i32;
        fn AXUIElementSetAttributeValue(
            element: AXUIElementRef,
            attribute: CFStringRef,
            value: CFTypeRef,
        ) -> i32;
        fn AXUIElementCopyAttributeValue(
            element: AXUIElementRef,
            attribute: CFStringRef,
            value: *mut CFTypeRef,
        ) -> i32;
        fn AXUIElementCopyParameterizedAttributeValue(
            element: AXUIElementRef,
            parameterized_attribute: CFStringRef,
            parameter: CFTypeRef,
            result: *mut CFTypeRef,
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
        fn CFArrayGetTypeID() -> usize;
        fn CFArrayGetCount(the_array: CFTypeRef) -> isize;
        fn CFArrayGetValueAtIndex(the_array: CFTypeRef, idx: isize) -> CFTypeRef;
        fn CFGetTypeID(cf: CFTypeRef) -> usize;
        fn CFStringGetTypeID() -> usize;
        fn CFRelease(cf: CFTypeRef);
    }

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGPreflightScreenCaptureAccess() -> bool;
        fn CGRequestScreenCaptureAccess() -> bool;
        fn CGEventSourceCreate(state_id: i32) -> *mut c_void;
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

    unsafe fn msg_send_0_isize(obj: *mut c_void, sel: *mut c_void) -> isize {
        let f: extern "C" fn(*mut c_void, *mut c_void) -> isize =
            std::mem::transmute(objc_msgSend as *const c_void);
        f(obj, sel)
    }

    unsafe fn msg_send_0_usize(obj: *mut c_void, sel: *mut c_void) -> usize {
        let f: extern "C" fn(*mut c_void, *mut c_void) -> usize =
            std::mem::transmute(objc_msgSend as *const c_void);
        f(obj, sel)
    }

    unsafe fn msg_send_0_cstr(obj: *mut c_void, sel: *mut c_void) -> *const c_char {
        let f: extern "C" fn(*mut c_void, *mut c_void) -> *const c_char =
            std::mem::transmute(objc_msgSend as *const c_void);
        f(obj, sel)
    }

    unsafe fn msg_send_0_bytes(obj: *mut c_void, sel: *mut c_void) -> *const u8 {
        let f: extern "C" fn(*mut c_void, *mut c_void) -> *const u8 =
            std::mem::transmute(objc_msgSend as *const c_void);
        f(obj, sel)
    }

    unsafe fn msg_send_1_i32_ptr(obj: *mut c_void, sel: *mut c_void, arg: i32) -> *mut c_void {
        let f: extern "C" fn(*mut c_void, *mut c_void, i32) -> *mut c_void =
            std::mem::transmute(objc_msgSend as *const c_void);
        f(obj, sel, arg)
    }

    unsafe fn msg_send_1_usize_ptr(obj: *mut c_void, sel: *mut c_void, arg: usize) -> *mut c_void {
        let f: extern "C" fn(*mut c_void, *mut c_void, usize) -> *mut c_void =
            std::mem::transmute(objc_msgSend as *const c_void);
        f(obj, sel, arg)
    }

    unsafe fn msg_send_1_usize_bool(obj: *mut c_void, sel: *mut c_void, arg: usize) -> bool {
        let f: extern "C" fn(*mut c_void, *mut c_void, usize) -> bool =
            std::mem::transmute(objc_msgSend as *const c_void);
        f(obj, sel, arg)
    }

    unsafe fn msg_send_1_usize_void(obj: *mut c_void, sel: *mut c_void, arg: usize) {
        let f: extern "C" fn(*mut c_void, *mut c_void, usize) =
            std::mem::transmute(objc_msgSend as *const c_void);
        f(obj, sel, arg)
    }

    unsafe fn msg_send_1_ptr_ptr(
        obj: *mut c_void,
        sel: *mut c_void,
        arg: *mut c_void,
    ) -> *mut c_void {
        let f: extern "C" fn(*mut c_void, *mut c_void, *mut c_void) -> *mut c_void =
            std::mem::transmute(objc_msgSend as *const c_void);
        f(obj, sel, arg)
    }

    unsafe fn msg_send_1_ptr_bool(obj: *mut c_void, sel: *mut c_void, arg: *mut c_void) -> bool {
        let f: extern "C" fn(*mut c_void, *mut c_void, *mut c_void) -> bool =
            std::mem::transmute(objc_msgSend as *const c_void);
        f(obj, sel, arg)
    }

    unsafe fn msg_send_1_ptr_void(obj: *mut c_void, sel: *mut c_void, arg: *mut c_void) {
        let f: extern "C" fn(*mut c_void, *mut c_void, *mut c_void) =
            std::mem::transmute(objc_msgSend as *const c_void);
        f(obj, sel, arg)
    }

    unsafe fn msg_send_1_cstr_ptr(
        obj: *mut c_void,
        sel: *mut c_void,
        arg: *const c_char,
    ) -> *mut c_void {
        let f: extern "C" fn(*mut c_void, *mut c_void, *const c_char) -> *mut c_void =
            std::mem::transmute(objc_msgSend as *const c_void);
        f(obj, sel, arg)
    }

    unsafe fn msg_send_2_ptr_ptr_bool(
        obj: *mut c_void,
        sel: *mut c_void,
        arg1: *mut c_void,
        arg2: *mut c_void,
    ) -> bool {
        let f: extern "C" fn(*mut c_void, *mut c_void, *mut c_void, *mut c_void) -> bool =
            std::mem::transmute(objc_msgSend as *const c_void);
        f(obj, sel, arg1, arg2)
    }

    unsafe fn msg_send_2_bytes_usize_ptr(
        obj: *mut c_void,
        sel: *mut c_void,
        bytes: *const u8,
        len: usize,
    ) -> *mut c_void {
        let f: extern "C" fn(*mut c_void, *mut c_void, *const u8, usize) -> *mut c_void =
            std::mem::transmute(objc_msgSend as *const c_void);
        f(obj, sel, bytes, len)
    }

    /// 让悬浮球窗口在全屏论文阅读器 / 所有桌面空间上方保持可见。
    pub fn configure_floating_ball_window(ns_window: *mut c_void) {
        if ns_window.is_null() {
            return;
        }
        unsafe {
            let pool = objc_autoreleasePoolPush();
            let sel = sel_registerName(c"setCollectionBehavior:".as_ptr());
            msg_send_1_usize_void(ns_window, sel, NS_WINDOW_COLLECTION_BEHAVIOR_FLOATING);
            objc_autoreleasePoolPop(pool);
        }
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
            thread::sleep(Duration::from_millis(TRACKER_POLL_INTERVAL_MS));
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

    unsafe fn ax_copy_attr(element: AXUIElementRef, attr_name: &str) -> Option<CFTypeRef> {
        if element.is_null() {
            return None;
        }
        let attr = cf_string_from_str(attr_name);
        let mut value: CFTypeRef = std::ptr::null();
        let err = AXUIElementCopyAttributeValue(element, attr, &mut value);
        CFRelease(attr);
        if err != 0 || value.is_null() {
            None
        } else {
            Some(value)
        }
    }

    unsafe fn ax_copy_param_attr(
        element: AXUIElementRef,
        attr_name: &str,
        param: CFTypeRef,
    ) -> Option<CFTypeRef> {
        if element.is_null() || param.is_null() {
            return None;
        }
        let attr = cf_string_from_str(attr_name);
        let mut value: CFTypeRef = std::ptr::null();
        let err = AXUIElementCopyParameterizedAttributeValue(element, attr, param, &mut value);
        CFRelease(attr);
        if err != 0 || value.is_null() {
            None
        } else {
            Some(value)
        }
    }

    /// 尝试从单个 AXUIElement 上读取选中文本：
    /// 1) kAXSelectedTextAttribute
    /// 2) kAXSelectedTextRangeAttribute + kAXStringForRangeParameterizedAttribute
    /// 3) kAXSelectedTextRangesAttribute + kAXStringForRangeParameterizedAttribute（常见于 PDFKit/Preview）
    unsafe fn extract_selected_text_from_element(elem: AXUIElementRef) -> Option<String> {
        if elem.is_null() {
            return None;
        }
        let _ = AXUIElementSetMessagingTimeout(elem, AX_MESSAGING_TIMEOUT_SECS);

        // 1. 直接读取 kAXSelectedTextAttribute
        if let Some(selected_val) = ax_copy_attr(elem, "AXSelectedText") {
            let text = cf_string_to_rust(selected_val);
            CFRelease(selected_val);
            if let Some(norm) = text.as_deref().and_then(normalize_captured_text) {
                return Some(norm);
            }
        }

        // 2. 通过 AXSelectedTextRange + AXStringForRange 读取
        if let Some(range_val) = ax_copy_attr(elem, "AXSelectedTextRange") {
            let str_val = ax_copy_param_attr(elem, "AXStringForRange", range_val);
            CFRelease(range_val);
            if let Some(str_ref) = str_val {
                let text = cf_string_to_rust(str_ref);
                CFRelease(str_ref);
                if let Some(norm) = text.as_deref().and_then(normalize_captured_text) {
                    return Some(norm);
                }
            }
        }

        // 3. 通过 AXSelectedTextRanges（多选区/PDF 分行选区）+ AXStringForRange 读取
        if let Some(ranges_val) = ax_copy_attr(elem, "AXSelectedTextRanges") {
            let mut collected = Vec::new();
            if CFGetTypeID(ranges_val) == CFArrayGetTypeID() {
                let count = CFArrayGetCount(ranges_val).min(64);
                for idx in 0..count {
                    let range_item = CFArrayGetValueAtIndex(ranges_val, idx);
                    if let Some(str_ref) = ax_copy_param_attr(elem, "AXStringForRange", range_item)
                    {
                        if let Some(part) = cf_string_to_rust(str_ref) {
                            if !part.is_empty() {
                                collected.push(part);
                            }
                        }
                        CFRelease(str_ref);
                    }
                }
            }
            CFRelease(ranges_val);
            if !collected.is_empty() {
                let joined = collected.join("\n");
                if let Some(norm) = normalize_captured_text(&joined) {
                    return Some(norm);
                }
            }
        }

        None
    }

    /// 在给定元素及其至多 2 层父元素上尝试读取选中文本。
    unsafe fn extract_from_element_or_ancestors(start_elem: AXUIElementRef) -> Option<String> {
        if let Some(text) = extract_selected_text_from_element(start_elem) {
            return Some(text);
        }

        let mut current = ax_copy_attr(start_elem, "AXParent");
        for _ in 0..2 {
            let Some(parent) = current else { break };
            if let Some(text) = extract_selected_text_from_element(parent) {
                CFRelease(parent);
                return Some(text);
            }
            let next = ax_copy_attr(parent, "AXParent");
            CFRelease(parent);
            current = next;
        }
        if let Some(leftover) = current {
            CFRelease(leftover);
        }
        None
    }

    /// 针对 Chrome / Arc / Edge / Zotero / Electron 等按需开启无障碍树的应用激活 AX 支持。
    unsafe fn enable_manual_accessibility(app_elem: AXUIElementRef) {
        for attr_name in ["AXEnhancedUserInterface", "AXManualAccessibility"] {
            let attr = cf_string_from_str(attr_name);
            let _ = AXUIElementSetAttributeValue(app_elem, attr, kCFBooleanTrue);
            CFRelease(attr);
        }
    }

    /// 第 1 阶段：0 延迟、不碰剪贴板，调用 AXUIElement 读取 kAXSelectedTextAttribute。
    fn read_ax_selected_text(pid: i32, is_frontmost: bool) -> Option<String> {
        if pid <= 0 {
            return None;
        }
        unsafe {
            let app_elem = AXUIElementCreateApplication(pid);
            if !app_elem.is_null() {
                let _ = AXUIElementSetMessagingTimeout(app_elem, AX_MESSAGING_TIMEOUT_SECS);
                enable_manual_accessibility(app_elem);

                // 1a. 目标应用的 AXFocusedUIElement
                if let Some(focused_elem) = ax_copy_attr(app_elem, "AXFocusedUIElement") {
                    let result = extract_from_element_or_ancestors(focused_elem);
                    CFRelease(focused_elem);
                    if result.is_some() {
                        CFRelease(app_elem);
                        return result;
                    }
                }

                // 1b. 若目标应用刚失焦，尝试 AXFocusedWindow / AXMainWindow -> AXFocusedUIElement
                for win_attr in ["AXFocusedWindow", "AXMainWindow"] {
                    if let Some(win_elem) = ax_copy_attr(app_elem, win_attr) {
                        let focused = ax_copy_attr(win_elem, "AXFocusedUIElement");
                        let result = if let Some(f_elem) = focused {
                            let text = extract_from_element_or_ancestors(f_elem);
                            CFRelease(f_elem);
                            text
                        } else {
                            extract_selected_text_from_element(win_elem)
                        };
                        CFRelease(win_elem);
                        if result.is_some() {
                            CFRelease(app_elem);
                            return result;
                        }
                    }
                }

                CFRelease(app_elem);
            }

            // 1c. 若目标应用仍是前台应用，兜底查询 SystemWide 的 AXFocusedUIElement
            if is_frontmost {
                let sys_elem = AXUIElementCreateSystemWide();
                if !sys_elem.is_null() {
                    let _ = AXUIElementSetMessagingTimeout(sys_elem, AX_MESSAGING_TIMEOUT_SECS);
                    let result = ax_copy_attr(sys_elem, "AXFocusedUIElement").and_then(|f_elem| {
                        let text = extract_from_element_or_ancestors(f_elem);
                        CFRelease(f_elem);
                        text
                    });
                    CFRelease(sys_elem);
                    if result.is_some() {
                        return result;
                    }
                }
            }

            None
        }
    }

    // =========================================================================
    // 第 2 阶段：基于原生 NSPasteboard 的无损剪贴板备份 / 读取 / 恢复 + Cmd+C 降级
    // =========================================================================

    type PasteboardSnapshot = Vec<Vec<(String, Vec<u8>)>>;

    unsafe fn ns_string_from_str(s: &str) -> *mut c_void {
        let Ok(cstr) = CString::new(s) else {
            return std::ptr::null_mut();
        };
        let cls = objc_getClass(c"NSString".as_ptr());
        if cls.is_null() {
            return std::ptr::null_mut();
        }
        let sel = sel_registerName(c"stringWithUTF8String:".as_ptr());
        msg_send_1_cstr_ptr(cls, sel, cstr.as_ptr())
    }

    unsafe fn ns_string_to_rust(ns_str: *mut c_void) -> Option<String> {
        if ns_str.is_null() {
            return None;
        }
        let sel = sel_registerName(c"UTF8String".as_ptr());
        let ptr = msg_send_0_cstr(ns_str, sel);
        if ptr.is_null() {
            return None;
        }
        CStr::from_ptr(ptr).to_str().ok().map(|s| s.to_string())
    }

    unsafe fn general_pasteboard() -> *mut c_void {
        let cls = objc_getClass(c"NSPasteboard".as_ptr());
        if cls.is_null() {
            return std::ptr::null_mut();
        }
        let sel = sel_registerName(c"generalPasteboard".as_ptr());
        msg_send_0_ptr(cls, sel)
    }

    fn pasteboard_change_count() -> isize {
        unsafe {
            let pool = objc_autoreleasePoolPush();
            let pb = general_pasteboard();
            let count = if pb.is_null() {
                0
            } else {
                let sel = sel_registerName(c"changeCount".as_ptr());
                msg_send_0_isize(pb, sel)
            };
            objc_autoreleasePoolPop(pool);
            count
        }
    }

    /// 无损备份系统剪贴板中的全部条目与所有数据类型（文本、图片、富文本、文件 URL 等）。
    pub(crate) fn backup_pasteboard() -> PasteboardSnapshot {
        let mut snapshot = Vec::new();
        unsafe {
            let pool = objc_autoreleasePoolPush();
            let pb = general_pasteboard();
            if pb.is_null() {
                objc_autoreleasePoolPop(pool);
                return snapshot;
            }

            let items_sel = sel_registerName(c"pasteboardItems".as_ptr());
            let items = msg_send_0_ptr(pb, items_sel);
            if !items.is_null() {
                let count_sel = sel_registerName(c"count".as_ptr());
                let obj_at_sel = sel_registerName(c"objectAtIndex:".as_ptr());
                let types_sel = sel_registerName(c"types".as_ptr());
                let data_for_type_sel = sel_registerName(c"dataForType:".as_ptr());
                let length_sel = sel_registerName(c"length".as_ptr());
                let bytes_sel = sel_registerName(c"bytes".as_ptr());

                let item_count = msg_send_0_usize(items, count_sel);
                for i in 0..item_count {
                    let item = msg_send_1_usize_ptr(items, obj_at_sel, i);
                    if item.is_null() {
                        continue;
                    }
                    let types = msg_send_0_ptr(item, types_sel);
                    if types.is_null() {
                        continue;
                    }
                    let type_count = msg_send_0_usize(types, count_sel);
                    let mut entry = Vec::new();
                    for t in 0..type_count {
                        let uti_obj = msg_send_1_usize_ptr(types, obj_at_sel, t);
                        let Some(uti_name) = ns_string_to_rust(uti_obj) else {
                            continue;
                        };
                        let ns_data = msg_send_1_ptr_ptr(item, data_for_type_sel, uti_obj);
                        if ns_data.is_null() {
                            continue;
                        }
                        let len = msg_send_0_usize(ns_data, length_sel);
                        let bytes = if len == 0 {
                            Vec::new()
                        } else {
                            let ptr = msg_send_0_bytes(ns_data, bytes_sel);
                            if ptr.is_null() {
                                continue;
                            }
                            std::slice::from_raw_parts(ptr, len).to_vec()
                        };
                        entry.push((uti_name, bytes));
                    }
                    if !entry.is_empty() {
                        snapshot.push(entry);
                    }
                }
            }

            objc_autoreleasePoolPop(pool);
        }
        snapshot
    }

    /// 原样恢复剪贴板快照（若原剪贴板为空，则清空避免残留公式）。
    pub(crate) fn restore_pasteboard(snapshot: &PasteboardSnapshot) {
        unsafe {
            let pool = objc_autoreleasePoolPush();
            let pb = general_pasteboard();
            if pb.is_null() {
                objc_autoreleasePoolPop(pool);
                return;
            }

            let clear_sel = sel_registerName(c"clearContents".as_ptr());
            let _ = msg_send_0_isize(pb, clear_sel);

            if !snapshot.is_empty() {
                let array_cls = objc_getClass(c"NSMutableArray".as_ptr());
                let item_cls = objc_getClass(c"NSPasteboardItem".as_ptr());
                let data_cls = objc_getClass(c"NSData".as_ptr());

                if !array_cls.is_null() && !item_cls.is_null() && !data_cls.is_null() {
                    let array_with_cap_sel = sel_registerName(c"arrayWithCapacity:".as_ptr());
                    let add_obj_sel = sel_registerName(c"addObject:".as_ptr());
                    let alloc_sel = sel_registerName(c"alloc".as_ptr());
                    let init_sel = sel_registerName(c"init".as_ptr());
                    let autorelease_sel = sel_registerName(c"autorelease".as_ptr());
                    let data_with_bytes_sel = sel_registerName(c"dataWithBytes:length:".as_ptr());
                    let set_data_sel = sel_registerName(c"setData:forType:".as_ptr());
                    let write_objs_sel = sel_registerName(c"writeObjects:".as_ptr());

                    let objects = msg_send_1_usize_ptr(array_cls, array_with_cap_sel, snapshot.len());
                    if !objects.is_null() {
                        for entry in snapshot {
                            let raw_item = msg_send_0_ptr(item_cls, alloc_sel);
                            if raw_item.is_null() {
                                continue;
                            }
                            let item = msg_send_0_ptr(raw_item, init_sel);
                            if item.is_null() {
                                continue;
                            }
                            let item = msg_send_0_ptr(item, autorelease_sel);
                            let mut has_data = false;
                            for (uti_name, bytes) in entry {
                                let uti_ns = ns_string_from_str(uti_name);
                                if uti_ns.is_null() {
                                    continue;
                                }
                                let ns_data = msg_send_2_bytes_usize_ptr(
                                    data_cls,
                                    data_with_bytes_sel,
                                    bytes.as_ptr(),
                                    bytes.len(),
                                );
                                if !ns_data.is_null()
                                    && msg_send_2_ptr_ptr_bool(item, set_data_sel, ns_data, uti_ns)
                                {
                                    has_data = true;
                                }
                            }
                            if has_data {
                                msg_send_1_ptr_void(objects, add_obj_sel, item);
                            }
                        }
                        let _ = msg_send_1_ptr_bool(pb, write_objs_sel, objects);
                    }
                }
            }

            objc_autoreleasePoolPop(pool);
        }
    }

    pub(crate) fn read_pasteboard_string() -> Option<String> {
        unsafe {
            let pool = objc_autoreleasePoolPush();
            let pb = general_pasteboard();
            let mut result = None;
            if !pb.is_null() {
                let str_for_type_sel = sel_registerName(c"stringForType:".as_ptr());
                for uti in ["public.utf8-plain-text", "NSStringPboardType"] {
                    let type_ns = ns_string_from_str(uti);
                    if type_ns.is_null() {
                        continue;
                    }
                    let ns_str = msg_send_1_ptr_ptr(pb, str_for_type_sel, type_ns);
                    if let Some(s) = ns_string_to_rust(ns_str) {
                        result = Some(s);
                        break;
                    }
                }
            }
            objc_autoreleasePoolPop(pool);
            result
        }
    }

    struct PasteboardRestoreGuard {
        snapshot: PasteboardSnapshot,
        dirty: bool,
    }

    impl PasteboardRestoreGuard {
        fn capture() -> Self {
            Self {
                snapshot: backup_pasteboard(),
                dirty: false,
            }
        }

        fn mark_dirty(&mut self) {
            self.dirty = true;
        }
    }

    impl Drop for PasteboardRestoreGuard {
        fn drop(&mut self) {
            if self.dirty {
                restore_pasteboard(&self.snapshot);
            }
        }
    }

    fn wait_for_frontmost_pid(pid: i32, timeout_ms: u64) {
        let deadline = Instant::now() + Duration::from_millis(timeout_ms);
        while Instant::now() < deadline {
            if frontmost_app_pid() == pid {
                thread::sleep(Duration::from_millis(ACTIVATE_SETTLE_MS));
                return;
            }
            thread::sleep(Duration::from_millis(10));
        }
    }

    fn send_cmd_c() {
        unsafe {
            let source = CGEventSourceCreate(K_CG_EVENT_SOURCE_STATE_HID_SYSTEM_STATE);
            let src_ptr = if source.is_null() {
                std::ptr::null()
            } else {
                source as *const c_void
            };

            let key_down = CGEventCreateKeyboardEvent(src_ptr, K_VK_ANSI_C, true);
            if !key_down.is_null() {
                CGEventSetFlags(key_down, K_CG_EVENT_FLAG_MASK_COMMAND);
                CGEventPost(K_CG_HID_EVENT_TAP, key_down);
                CFRelease(key_down as CFTypeRef);
            }
            thread::sleep(Duration::from_millis(10));
            let key_up = CGEventCreateKeyboardEvent(src_ptr, K_VK_ANSI_C, false);
            if !key_up.is_null() {
                CGEventSetFlags(key_up, K_CG_EVENT_FLAG_MASK_COMMAND);
                CGEventPost(K_CG_HID_EVENT_TAP, key_up);
                CFRelease(key_up as CFTypeRef);
            }
            if !source.is_null() {
                CFRelease(source as CFTypeRef);
            }
        }
    }

    /// 第 2 阶段：备份剪贴板 -> 激活目标应用并发送 Cmd+C -> 轮询 changeCount 读取文本 -> 原样恢复剪贴板。
    fn capture_via_cmd_c(pid: i32) -> Option<String> {
        if pid <= 0 {
            return None;
        }

        let mut guard = PasteboardRestoreGuard::capture();
        let before_count = pasteboard_change_count();

        if frontmost_app_pid() != pid {
            if activate_app_by_pid(pid) {
                wait_for_frontmost_pid(pid, ACTIVATE_WAIT_TIMEOUT_MS);
            } else {
                thread::sleep(Duration::from_millis(40));
            }
        }

        send_cmd_c();

        let deadline = Instant::now() + Duration::from_millis(CLIPBOARD_POLL_TIMEOUT_MS);
        let mut changed = false;
        while Instant::now() < deadline {
            if pasteboard_change_count() != before_count {
                changed = true;
                break;
            }
            thread::sleep(Duration::from_millis(CLIPBOARD_POLL_INTERVAL_MS));
        }

        if !changed {
            // Cmd+C 未产生任何复制内容，剪贴板未被修改，无需恢复。
            return None;
        }

        guard.mark_dirty();
        let copied = read_pasteboard_string();
        drop(guard);

        copied.as_deref().and_then(normalize_captured_text)
    }

    pub fn capture_selected_text() -> TextCaptureOutcome {
        if !unsafe { AXIsProcessTrusted() } {
            let _ = request_accessibility_permission();
            return TextCaptureOutcome {
                ok: false,
                text: None,
                source: None,
                needs_permission: Some("accessibility".to_string()),
                message: Some(
                    "已向系统请求「辅助功能」权限，请在弹窗或系统设置中允许 SciCanvas 后重试。"
                        .to_string(),
                ),
            };
        }

        let own_pid = std::process::id() as i32;
        let current_front = frontmost_app_pid();
        let (target_pid, is_frontmost) = if current_front > 0 && current_front != own_pid {
            LAST_EXTERNAL_PID.store(current_front, Ordering::Relaxed);
            (current_front, true)
        } else {
            (LAST_EXTERNAL_PID.load(Ordering::Relaxed), false)
        };

        if target_pid <= 0 {
            return TextCaptureOutcome {
                ok: false,
                text: None,
                source: None,
                needs_permission: None,
                message: Some("请先在论文窗口中选中公式文本，再点击悬浮球。".to_string()),
            };
        }

        // 1. 优先尝试 AXUIElement 读取 kAXSelectedTextAttribute（0 延迟、不碰剪贴板）
        if let Some(text) = read_ax_selected_text(target_pid, is_frontmost) {
            return TextCaptureOutcome {
                ok: true,
                text: Some(text),
                source: Some("ax".to_string()),
                needs_permission: None,
                message: None,
            };
        }

        // 2. 失败或返回空（如部分 PDF 渲染引擎），降级触发：备份剪贴板 -> Cmd+C -> 读取 -> 恢复剪贴板
        if let Some(text) = capture_via_cmd_c(target_pid) {
            return TextCaptureOutcome {
                ok: true,
                text: Some(text),
                source: Some("clipboard".to_string()),
                needs_permission: None,
                message: None,
            };
        }

        TextCaptureOutcome {
            ok: false,
            text: None,
            source: None,
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

    pub fn configure_floating_ball_window(_ns_window: *mut std::ffi::c_void) {}

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
            source: None,
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
    capture_screen_region, capture_selected_text, check_permissions,
    configure_floating_ball_window, ensure_frontmost_tracker, open_permission_settings,
    request_accessibility_permission, request_screen_recording_permission,
};

#[cfg(test)]
mod tests {
    use super::normalize_captured_text;

    #[test]
    fn normalizes_pdf_whitespace_and_zero_width_chars() {
        let raw = "  \u{FEFF}\\ddot{x}\u{00A0}+ 2\\zeta\\omega_0\\dot{x}\u{200B} = 0\r\n\r\n\r\n  x(0) = 1\u{00AD}  ";
        assert_eq!(
            normalize_captured_text(raw).as_deref(),
            Some("\\ddot{x} + 2\\zeta\\omega_0\\dot{x} = 0 x(0) = 1")
        );
    }

    #[test]
    fn joins_pdf_hyphenation_while_preserving_math_minus() {
        let raw = "damped oscil-\nlator with a -\nb = 0";
        assert_eq!(
            normalize_captured_text(raw).as_deref(),
            Some("damped oscillator with a - b = 0")
        );
    }

    #[test]
    fn rejects_blank_or_invisible_only_text() {
        assert_eq!(normalize_captured_text("   \u{200B}\u{FEFF}\r\n\t  "), None);
    }
}
