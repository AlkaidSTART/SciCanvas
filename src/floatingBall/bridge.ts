import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { LogicalSize, getCurrentWindow } from '@tauri-apps/api/window'

export interface PermissionStatus {
  accessibility: boolean
  screenRecording: boolean
  supported: boolean
}

export interface TextCaptureOutcome {
  ok: boolean
  text: string | null
  needsPermission: string | null
  message: string | null
}

export interface ImageCaptureOutcome {
  ok: boolean
  dataUrl: string | null
  cancelled: boolean
  needsPermission: string | null
  message: string | null
}

export interface CapturedFormulaPayload {
  kind: 'text' | 'image'
  content?: string | null
  dataUrl?: string | null
  name?: string | null
}

export const FORMULA_CAPTURED_EVENT = 'floating-ball:formula-captured'
export const FLOATING_BALL_VISIBILITY_EVENT = 'floating-ball:visibility-changed'

const UNSUPPORTED_PERMISSIONS: PermissionStatus = {
  accessibility: false,
  screenRecording: false,
  supported: false,
}

export function isDesktopApp(): boolean {
  try {
    return isTauri()
  } catch {
    return false
  }
}

export async function openFloatingBall(): Promise<PermissionStatus> {
  if (!isDesktopApp()) return UNSUPPORTED_PERMISSIONS
  return invoke<PermissionStatus>('floating_ball_open')
}

export async function closeFloatingBall(): Promise<void> {
  if (!isDesktopApp()) return
  await invoke('floating_ball_close')
}

export async function isFloatingBallOpen(): Promise<boolean> {
  if (!isDesktopApp()) return false
  return invoke<boolean>('floating_ball_is_open')
}

export async function getCapturePermissions(): Promise<PermissionStatus> {
  if (!isDesktopApp()) return UNSUPPORTED_PERMISSIONS
  return invoke<PermissionStatus>('get_capture_permissions')
}

export async function requestCapturePermission(
  kind: 'accessibility' | 'screen_recording' | 'all',
): Promise<PermissionStatus> {
  if (!isDesktopApp()) return UNSUPPORTED_PERMISSIONS
  return invoke<PermissionStatus>('request_capture_permission', { kind })
}

export async function openPermissionSettings(
  kind: 'accessibility' | 'screen_recording',
): Promise<void> {
  if (!isDesktopApp()) return
  await invoke('open_permission_settings', { kind })
}

export async function focusMainWindow(): Promise<void> {
  if (!isDesktopApp()) return
  await invoke('focus_main_window')
}

export async function captureSelectedFormula(): Promise<TextCaptureOutcome> {
  if (!isDesktopApp()) {
    return {
      ok: false,
      text: null,
      needsPermission: null,
      message: '悬浮球取词功能需要在 SciCanvas 桌面端中使用。',
    }
  }
  return invoke<TextCaptureOutcome>('capture_selected_formula')
}

export async function captureFormulaScreenshot(): Promise<ImageCaptureOutcome> {
  if (!isDesktopApp()) {
    return {
      ok: false,
      dataUrl: null,
      cancelled: false,
      needsPermission: null,
      message: '悬浮球框选公式截图需要在 SciCanvas 桌面端中使用。',
    }
  }
  return invoke<ImageCaptureOutcome>('capture_formula_screenshot')
}

export async function resizeCurrentWindow(width: number, height: number): Promise<void> {
  if (!isDesktopApp()) return
  await getCurrentWindow().setSize(new LogicalSize(width, height))
}

export async function startCurrentWindowDragging(): Promise<void> {
  if (!isDesktopApp()) return
  await getCurrentWindow().startDragging()
}

export async function listenFormulaCaptured(
  handler: (payload: CapturedFormulaPayload) => void,
): Promise<UnlistenFn> {
  if (!isDesktopApp()) return () => {}
  return listen<CapturedFormulaPayload>(FORMULA_CAPTURED_EVENT, (event) => {
    handler(event.payload)
  })
}

export async function listenFloatingBallVisibility(
  handler: (visible: boolean) => void,
): Promise<UnlistenFn> {
  if (!isDesktopApp()) return () => {}
  return listen<boolean>(FLOATING_BALL_VISIBILITY_EVENT, (event) => {
    handler(Boolean(event.payload))
  })
}

/**
 * 将从论文中捕获的公式文本合并进现有对话框输入，保持整洁换行并不超过最大字数限制。
 */
export function formatCapturedFormulaAppend(
  existingPrompt: string,
  rawFormula: string,
  maxLength: number,
): { nextPrompt: string; appended: boolean; truncated: boolean } {
  const formula = rawFormula.trim()
  if (!formula) {
    return { nextPrompt: existingPrompt, appended: false, truncated: false }
  }
  const base = existingPrompt.trimEnd()
  const combined = base ? `${base}\n${formula}` : formula
  if (combined.length <= maxLength) {
    return { nextPrompt: combined, appended: true, truncated: false }
  }
  return {
    nextPrompt: combined.slice(0, maxLength),
    appended: combined.slice(0, maxLength).length > base.length,
    truncated: true,
  }
}
