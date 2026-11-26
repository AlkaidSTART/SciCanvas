import type { WorkspaceRecord } from './types'

export const DEFAULT_AUTOSAVE_DELAY_MS = 600

export interface WorkspaceAutoSaverOptions {
  save: (record: WorkspaceRecord) => Promise<void>
  onError?: (error: unknown) => void
  delayMs?: number
}

export interface WorkspaceAutoSaver {
  /** immediate 用于首次创建记录，避免用户立刻切换后丢失快照。 */
  schedule: (record: WorkspaceRecord, immediate?: boolean) => void
  flush: () => Promise<void>
  dispose: () => void
}

/**
 * 按记录 ID 合并待写入快照并延迟落库：
 * 参数拖动只在停止后写一次，快速切换记录也不会丢掉较早的快照。
 */
export function createWorkspaceAutoSaver(
  options: WorkspaceAutoSaverOptions,
): WorkspaceAutoSaver {
  const delay = options.delayMs ?? DEFAULT_AUTOSAVE_DELAY_MS
  const pending = new Map<string, WorkspaceRecord>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let disposed = false
  let chain: Promise<void> = Promise.resolve()

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  const flush = (): Promise<void> => {
    clearTimer()
    if (disposed || pending.size === 0) return chain

    const batch = [...pending.values()]
    pending.clear()
    chain = chain.then(async () => {
      for (const record of batch) {
        try {
          await options.save(record)
        } catch (error) {
          options.onError?.(error)
        }
      }
    })
    return chain
  }

  return {
    schedule: (record, immediate = false) => {
      if (disposed) return
      pending.set(record.id, record)
      clearTimer()
      if (immediate) {
        void flush()
        return
      }
      timer = setTimeout(() => {
        timer = null
        void flush()
      }, delay)
    },
    flush,
    dispose: () => {
      disposed = true
      clearTimer()
      pending.clear()
    },
  }
}
