import type { RuntimeErrorInfo } from './CanvasRuntime'

export interface SessionOutcome {
  ok: boolean
  error?: RuntimeErrorInfo
}

let pending: ((outcome: SessionOutcome) => void) | null = null
let timer: ReturnType<typeof setTimeout> | null = null

function clearTimer(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
}

function settle(outcome: SessionOutcome): void {
  if (!pending) return
  const resolve = pending
  pending = null
  clearTimer()
  resolve(outcome)
}

/**
 * 等待隔离沙盒的一次初始化结果。修复流程在应用候选前注册，
 * 沙盒首帧成功或报错时由 useAISandbox 通知。
 */
export function waitForSessionOutcome(timeoutMs = 8_000): Promise<SessionOutcome> {
  settle({ ok: false, error: { scope: 'init', message: '修复会话已被新的请求替换' } })
  return new Promise((resolve) => {
    pending = resolve
    timer = setTimeout(() => {
      pending = null
      timer = null
      resolve({ ok: false, error: { scope: 'init', message: '修复结果初始化超时' } })
    }, Math.max(0, timeoutMs))
  })
}

export function notifySessionOutcome(outcome: SessionOutcome): void {
  settle(outcome)
}
