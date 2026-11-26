import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWorkspaceAutoSaver } from './autoSave'
import type { WorkspaceRecord } from './types'

function record(id: string, updatedAt: number): WorkspaceRecord {
  return {
    id,
    title: `记录 ${id}`,
    domain: 'Physics',
    source: 'preset',
    experimentId: 'damped-oscillator',
    schemaVersion: 1,
    codeVersion: 0,
    spec: null,
    params: { damping: 0.2 },
    speed: 1,
    favorite: false,
    createdAt: 1,
    updatedAt,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('M7 自动保存', () => {
  it('同一记录连续变化只写一次最新快照', async () => {
    const save = vi.fn(async (record: WorkspaceRecord) => {
      void record
    })
    const saver = createWorkspaceAutoSaver({ save, delayMs: 500 })

    saver.schedule(record('a', 1))
    saver.schedule(record('a', 2))
    await vi.advanceTimersByTimeAsync(499)
    expect(save).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0][0].updatedAt).toBe(2)
    saver.dispose()
  })

  it('快速切换记录时分别保存各自快照', async () => {
    const save = vi.fn(async (record: WorkspaceRecord) => {
      void record
    })
    const saver = createWorkspaceAutoSaver({ save, delayMs: 300 })

    saver.schedule(record('a', 1))
    saver.schedule(record('b', 2))
    await vi.advanceTimersByTimeAsync(300)

    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls.map((call) => call[0].id)).toEqual(['a', 'b'])
    saver.dispose()
  })

  it('首次创建记录可立即写入', async () => {
    const save = vi.fn(async (record: WorkspaceRecord) => {
      void record
    })
    const saver = createWorkspaceAutoSaver({ save, delayMs: 600 })

    saver.schedule(record('new', 1), true)
    await saver.flush()

    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0][0].id).toBe('new')
    saver.dispose()
  })

  it('写入失败通过回调暴露，且后续记录仍会保存', async () => {
    const onError = vi.fn()
    const save = vi.fn(async (record: WorkspaceRecord) => {
      void record
    })
    save.mockRejectedValueOnce(new Error('quota'))
    const saver = createWorkspaceAutoSaver({ save, onError, delayMs: 100 })

    saver.schedule(record('a', 1))
    await vi.advanceTimersByTimeAsync(100)
    expect(onError).toHaveBeenCalledTimes(1)

    saver.schedule(record('b', 2))
    await vi.advanceTimersByTimeAsync(100)
    expect(save).toHaveBeenCalledTimes(2)
    saver.dispose()
  })

  it('dispose 后不再接受新的写入', async () => {
    const save = vi.fn(async (record: WorkspaceRecord) => {
      void record
    })
    const saver = createWorkspaceAutoSaver({ save, delayMs: 100 })
    saver.dispose()
    saver.schedule(record('a', 1))
    await vi.advanceTimersByTimeAsync(200)
    expect(save).not.toHaveBeenCalled()
  })
})
