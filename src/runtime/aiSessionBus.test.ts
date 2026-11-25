import { afterEach, describe, expect, it, vi } from 'vitest'
import { notifySessionOutcome, waitForSessionOutcome } from './aiSessionBus'

afterEach(() => {
  notifySessionOutcome({ ok: false })
  vi.useRealTimers()
})

describe('aiSessionBus', () => {
  it('沙盒成功时结束等待', async () => {
    const pending = waitForSessionOutcome(1_000)
    notifySessionOutcome({ ok: true })
    await expect(pending).resolves.toEqual({ ok: true })
  })

  it('沙盒报错时携带最小诊断结束等待', async () => {
    const pending = waitForSessionOutcome(1_000)
    const error = { scope: 'first-frame' as const, message: '首帧绘制失败' }
    notifySessionOutcome({ ok: false, error })
    await expect(pending).resolves.toEqual({ ok: false, error })
  })

  it('超时按初始化失败返回', async () => {
    vi.useFakeTimers()
    const pending = waitForSessionOutcome(50)
    await vi.advanceTimersByTimeAsync(50)
    const outcome = await pending
    expect(outcome.ok).toBe(false)
    expect(outcome.error?.scope).toBe('init')
  })

  it('新的等待会终止旧等待，避免会话错配', async () => {
    const first = waitForSessionOutcome(1_000)
    const second = waitForSessionOutcome(1_000)
    await expect(first).resolves.toMatchObject({ ok: false })
    notifySessionOutcome({ ok: true })
    await expect(second).resolves.toEqual({ ok: true })
  })
})
