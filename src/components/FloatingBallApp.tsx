import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import {
  captureFormulaScreenshot,
  captureSelectedFormula,
  closeFloatingBall,
  focusMainWindow,
  getCapturePermissions,
  openPermissionSettings,
  requestCapturePermission,
  resizeCurrentWindow,
  startCurrentWindowDragging,
} from '../floatingBall/bridge'
import type { PermissionStatus } from '../floatingBall/bridge'
import { BoltIcon } from './icons'

const COLLAPSED_SIZE = { width: 72, height: 72 }
const EXPANDED_SIZE = { width: 292, height: 268 }
const DRAG_THRESHOLD_PX = 4

type FeedbackState = {
  tone: 'success' | 'warning' | 'error'
  message: string
  needsPermission?: 'accessibility' | 'screen_recording'
} | null

export function FloatingBallApp() {
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState<'text' | 'image' | null>(null)
  const [flashSuccess, setFlashSuccess] = useState(false)
  const [feedback, setFeedback] = useState<FeedbackState>(null)
  const [permissions, setPermissions] = useState<PermissionStatus>({
    accessibility: false,
    screenRecording: false,
    supported: true,
  })

  const dragOriginRef = useRef<{ x: number; y: number; dragged: boolean } | null>(null)
  const flashTimerRef = useRef<number | null>(null)

  const refreshPermissions = useCallback(async () => {
    try {
      const status = await getCapturePermissions()
      setPermissions(status)
    } catch {
      // 忽略权限轮询异常，保持当前状态。
    }
  }, [])

  useEffect(() => {
    let disposed = false
    const syncPermissions = () => {
      void getCapturePermissions()
        .then((status) => {
          if (!disposed) setPermissions(status)
        })
        .catch(() => {})
    }
    syncPermissions()
    const interval = window.setInterval(syncPermissions, 2500)
    return () => {
      disposed = true
      window.clearInterval(interval)
      if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current)
    }
  }, [])

  useEffect(() => {
    const target = expanded ? EXPANDED_SIZE : COLLAPSED_SIZE
    void resizeCurrentWindow(target.width, target.height)
  }, [expanded])

  const triggerSuccessFlash = () => {
    setFlashSuccess(true)
    if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current)
    flashTimerRef.current = window.setTimeout(() => {
      setFlashSuccess(false)
      flashTimerRef.current = null
    }, 1600)
  }

  const handleCaptureText = async () => {
    if (busy) return
    setBusy('text')
    setFeedback(null)
    try {
      const outcome = await captureSelectedFormula()
      await refreshPermissions()
      if (outcome.ok && outcome.text) {
        triggerSuccessFlash()
        const preview =
          outcome.text.length > 36 ? `${outcome.text.slice(0, 36)}…` : outcome.text
        setFeedback({
          tone: 'success',
          message: `已加入对话框：${preview}`,
        })
      } else if (outcome.needsPermission === 'accessibility') {
        setExpanded(true)
        setFeedback({
          tone: 'warning',
          message:
            outcome.message ??
            '需要「辅助功能」权限以读取论文中选中的公式，请在系统弹窗中允许。',
          needsPermission: 'accessibility',
        })
      } else {
        setExpanded(true)
        setFeedback({
          tone: 'warning',
          message: outcome.message ?? '未检测到选中的公式文本。',
        })
      }
    } catch (error) {
      setExpanded(true)
      setFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : '读取选中公式失败',
      })
    } finally {
      setBusy(null)
    }
  }

  const handleCaptureScreenshot = async () => {
    if (busy) return
    setBusy('image')
    setFeedback(null)
    try {
      const outcome = await captureFormulaScreenshot()
      await refreshPermissions()
      if (outcome.ok) {
        triggerSuccessFlash()
        setFeedback({
          tone: 'success',
          message: '已将公式截图载入 SciCanvas 识别区。',
        })
      } else if (outcome.needsPermission === 'screen_recording') {
        setExpanded(true)
        setFeedback({
          tone: 'warning',
          message:
            outcome.message ??
            '需要「屏幕录制」权限以框选论文公式截图，请在系统设置中允许。',
          needsPermission: 'screen_recording',
        })
      } else if (!outcome.cancelled) {
        setFeedback({
          tone: 'error',
          message: outcome.message ?? '框选公式截图失败',
        })
      }
    } catch (error) {
      setFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : '框选公式截图失败',
      })
    } finally {
      setBusy(null)
    }
  }

  const handleRequestPermission = async (kind: 'accessibility' | 'screen_recording') => {
    try {
      const next = await requestCapturePermission(kind)
      setPermissions(next)
      const granted = kind === 'accessibility' ? next.accessibility : next.screenRecording
      if (granted) {
        setFeedback({
          tone: 'success',
          message: kind === 'accessibility' ? '辅助功能权限已就绪' : '屏幕录制权限已就绪',
        })
      } else {
        setFeedback({
          tone: 'warning',
          message:
            kind === 'accessibility'
              ? '已弹出系统授权提示；若未生效请点击「打开系统设置」勾选 SciCanvas。'
              : '已请求屏幕录制权限；若未生效请点击「打开系统设置」勾选 SciCanvas。',
          needsPermission: kind,
        })
      }
    } catch {
      setFeedback({
        tone: 'error',
        message: '请求权限失败，请手动打开系统设置授权。',
        needsPermission: kind,
      })
    }
  }

  const handleBallPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    dragOriginRef.current = { x: event.clientX, y: event.clientY, dragged: false }
  }

  const handleBallPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const origin = dragOriginRef.current
    if (!origin || origin.dragged) return
    const dx = event.clientX - origin.x
    const dy = event.clientY - origin.y
    if (Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) {
      origin.dragged = true
      void startCurrentWindowDragging()
    }
  }

  const handleBallPointerUp = () => {
    const origin = dragOriginRef.current
    dragOriginRef.current = null
    if (!origin || origin.dragged) return
    void handleCaptureText()
  }

  if (!expanded) {
    return (
      <div
        className="flex h-screen w-screen select-none items-center justify-center bg-transparent p-1.5"
        onContextMenu={(event) => {
          event.preventDefault()
          setExpanded(true)
        }}
      >
        <div className="relative">
          <button
            type="button"
            className={`group relative grid size-[54px] place-items-center rounded-full border shadow-[0_8px_22px_rgba(58,51,43,0.22)] transition-transform active:scale-95 ${
              flashSuccess
                ? 'border-mint bg-[radial-gradient(circle_at_30%_25%,#e5f5ec,#cfead9)] text-[#2f6b4b]'
                : 'border-[rgba(124,157,187,0.55)] bg-[radial-gradient(circle_at_30%_22%,#fffdf8,#f3eadc)] text-accent-strong hover:border-accent-strong'
            }`}
            onPointerDown={handleBallPointerDown}
            onPointerMove={handleBallPointerMove}
            onPointerUp={handleBallPointerUp}
            title="单击：将选中的论文公式加入对话框；拖动：移动悬浮球；右键或点右下角：展开菜单"
            aria-label="将选中的论文公式加入对话框"
          >
            {busy ? (
              <span className="size-5 animate-spin rounded-full border-2 border-accent-line border-t-accent-strong" />
            ) : flashSuccess ? (
              <span className="text-lg font-bold leading-none">✓</span>
            ) : (
              <BoltIcon className="size-6 transition-transform group-hover:scale-105" />
            )}

            <span
              className={`pointer-events-none absolute right-1 top-1 size-2 rounded-full ring-2 ring-[#fcf9f2] ${
                permissions.accessibility ? 'bg-mint' : 'bg-amber'
              }`}
              title={
                permissions.accessibility
                  ? '辅助功能权限已授权'
                  : '尚未授予辅助功能权限，点击将向系统请求'
              }
            />
          </button>

          <button
            type="button"
            className="absolute -bottom-0.5 -right-0.5 grid size-5 place-items-center rounded-full border border-line-strong bg-panel text-[10px] font-bold leading-none text-ink-dim shadow-sm transition-colors hover:border-accent-strong hover:text-accent-strong"
            onClick={(event) => {
              event.stopPropagation()
              setExpanded(true)
            }}
            title="展开悬浮球菜单与权限设置"
            aria-label="展开悬浮球菜单"
          >
            ⋯
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen w-screen select-none flex-col bg-transparent p-1.5">
      <div className="flex min-h-0 flex-1 flex-col gap-2 rounded-[16px] border border-line-strong bg-panel/96 p-3 shadow-[0_14px_34px_rgba(58,51,43,0.22)] backdrop-blur-md">
        <div
          className="flex cursor-grab items-center justify-between gap-2 active:cursor-grabbing"
          onPointerDown={(event) => {
            if ((event.target as HTMLElement).closest('button')) return
            void startCurrentWindowDragging()
          }}
        >
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="grid size-6 flex-none place-items-center rounded-[7px] border border-accent-line bg-accent-soft text-accent-strong">
              <BoltIcon className="size-3.5" />
            </span>
            <span className="truncate text-xs font-semibold text-ink">论文公式悬浮球</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="rounded-md border border-line bg-surface px-1.5 py-0.5 text-[10px] text-ink-dim transition-colors hover:border-line-strong hover:text-ink"
              onClick={() => setExpanded(false)}
              title="收起为悬浮球"
            >
              收起
            </button>
            <button
              type="button"
              className="rounded-md border border-line bg-surface px-1.5 py-0.5 text-[10px] text-ink-faint transition-colors hover:border-rose/40 hover:text-[#a9605f]"
              onClick={() => void closeFloatingBall()}
              title="关闭悬浮球"
            >
              关闭
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void handleCaptureText()}
            className="flex flex-col items-start gap-0.5 rounded-[10px] border border-transparent bg-accent-strong px-2.5 py-2 text-left text-[#fbf7ef] transition-colors enabled:hover:bg-accent disabled:cursor-not-allowed disabled:opacity-55"
          >
            <span className="text-[11.5px] font-semibold">
              {busy === 'text' ? '读取中…' : '加入选中公式'}
            </span>
            <span className="text-[9.5px] text-[#fbf7ef]/80">读取论文选中文本</span>
          </button>

          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void handleCaptureScreenshot()}
            className="flex flex-col items-start gap-0.5 rounded-[10px] border border-[rgba(138,118,168,0.35)] bg-[rgba(138,118,168,0.1)] px-2.5 py-2 text-left text-[#5d4b6c] transition-colors enabled:hover:bg-[rgba(138,118,168,0.18)] disabled:cursor-not-allowed disabled:opacity-55"
          >
            <span className="text-[11.5px] font-semibold">
              {busy === 'image' ? '框选中…' : '框选公式截图'}
            </span>
            <span className="text-[9.5px] text-[#6d5a7d]/85">送入多模态识别</span>
          </button>
        </div>

        {feedback && (
          <div
            className={`flex flex-col gap-1.5 rounded-[9px] border px-2.5 py-1.5 text-[10px] leading-[1.45] ${
              feedback.tone === 'success'
                ? 'border-mint/40 bg-mint/12 text-[#2f6b4b]'
                : feedback.tone === 'warning'
                  ? 'border-amber/40 bg-amber/12 text-[#82611f]'
                  : 'border-rose/40 bg-rose/12 text-[#a9605f]'
            }`}
            role="status"
          >
            <span>{feedback.message}</span>
            {feedback.needsPermission && (
              <div className="flex gap-1.5">
                <button
                  type="button"
                  className="rounded-md border border-current/25 bg-surface/80 px-2 py-0.5 text-[9.5px] font-medium hover:bg-surface"
                  onClick={() => void handleRequestPermission(feedback.needsPermission!)}
                >
                  请求权限
                </button>
                <button
                  type="button"
                  className="rounded-md border border-current/25 bg-surface/80 px-2 py-0.5 text-[9.5px] font-medium hover:bg-surface"
                  onClick={() => void openPermissionSettings(feedback.needsPermission!)}
                >
                  打开系统设置
                </button>
              </div>
            )}
          </div>
        )}

        <div className="mt-auto flex flex-col gap-1.5 border-t border-line pt-2">
          <div className="flex items-center justify-between gap-1.5 text-[10px]">
            <span className="text-ink-faint">系统权限</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() =>
                  permissions.accessibility
                    ? void openPermissionSettings('accessibility')
                    : void handleRequestPermission('accessibility')
                }
                className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9.5px] transition-colors ${
                  permissions.accessibility
                    ? 'border-mint/40 bg-mint/12 text-[#2f6b4b]'
                    : 'border-amber/45 bg-amber/12 text-[#82611f] hover:bg-amber/20'
                }`}
                title="辅助功能权限用于直接读取论文中选中的公式文本"
              >
                <span
                  className={`size-1.5 rounded-full ${
                    permissions.accessibility ? 'bg-mint' : 'bg-amber'
                  }`}
                />
                辅助功能{permissions.accessibility ? '已开' : '点击授权'}
              </button>
              <button
                type="button"
                onClick={() =>
                  permissions.screenRecording
                    ? void openPermissionSettings('screen_recording')
                    : void handleRequestPermission('screen_recording')
                }
                className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9.5px] transition-colors ${
                  permissions.screenRecording
                    ? 'border-mint/40 bg-mint/12 text-[#2f6b4b]'
                    : 'border-line-strong bg-surface text-ink-dim hover:border-accent-line'
                }`}
                title="屏幕录制权限用于框选 PDF 图片公式截图"
              >
                <span
                  className={`size-1.5 rounded-full ${
                    permissions.screenRecording ? 'bg-mint' : 'bg-ink-faint'
                  }`}
                />
                录屏{permissions.screenRecording ? '已开' : '授权'}
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void focusMainWindow()}
            className="w-full rounded-lg border border-line bg-surface px-2.5 py-1 text-[10.5px] text-ink-dim transition-colors hover:border-line-strong hover:bg-surface-soft hover:text-ink"
          >
            打开 SciCanvas 主窗口
          </button>
        </div>
      </div>
    </div>
  )
}
