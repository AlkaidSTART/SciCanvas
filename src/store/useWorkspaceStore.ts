import { create } from 'zustand'
import { toWorkspaceStorageError, workspaceStorage } from '../workspace/db'
import type { WorkspaceStorageError } from '../workspace/db'
import { createModelConfig, validateModelConfig } from '../workspace/modelConfig'
import { sanitizeRecordTitle, sortWorkspaceEntries, toWorkspaceRecord } from '../workspace/records'
import type {
  ModelConfig,
  ModelConfigDraft,
  WorkspaceEntry,
  WorkspaceRecord,
} from '../workspace/types'

export interface WorkspaceFeedback {
  tone: 'success' | 'error'
  message: string
  at: number
}

interface WorkspaceState {
  hydrated: boolean
  hydrating: boolean
  entries: WorkspaceEntry[]
  modelConfig: ModelConfig | null
  storageError: WorkspaceStorageError | null
  saving: boolean
  lastSavedAt: number | null
  feedback: WorkspaceFeedback | null
  hydrate: () => Promise<void>
  /** 返回是否成功写入，供自动保存与操作反馈判断。 */
  saveRecord: (
    record: WorkspaceRecord,
    options?: { keepEdits?: boolean },
  ) => Promise<boolean>
  renameRecord: (id: string, title: string) => Promise<void>
  toggleFavorite: (id: string) => Promise<void>
  deleteRecord: (id: string) => Promise<void>
  saveModelConfig: (draft: ModelConfigDraft) => Promise<boolean>
  clearModelConfig: () => Promise<void>
  clearFeedback: () => void
}

function upsertEntry(entries: WorkspaceEntry[], record: WorkspaceRecord): WorkspaceEntry[] {
  const next: WorkspaceEntry = { ...record, status: 'ok' }
  const index = entries.findIndex((entry) => entry.id === record.id)
  const list =
    index >= 0
      ? entries.map((entry, current) => (current === index ? next : entry))
      : [...entries, next]
  return sortWorkspaceEntries(list)
}

function findRecord(entries: WorkspaceEntry[], id: string): WorkspaceRecord | null {
  const entry = entries.find((item) => item.id === id)
  return entry ? toWorkspaceRecord(entry) : null
}

/**
 * 本地工作区状态：记录列表、模型配置与存储健康度。
 * 写入失败不会阻断当前实验，只把清晰原因暴露给界面。
 */
export const useWorkspaceStore = create<WorkspaceState>()((set, get) => ({
  hydrated: false,
  hydrating: false,
  entries: [],
  modelConfig: null,
  storageError: null,
  saving: false,
  lastSavedAt: null,
  feedback: null,

  hydrate: async () => {
    if (get().hydrating || get().hydrated) return
    set({ hydrating: true })

    let entries: WorkspaceEntry[] = []
    let storageError: WorkspaceStorageError | null = null

    try {
      entries = await workspaceStorage.listRecords()
      set({ entries: sortWorkspaceEntries(entries) })
    } catch (error) {
      storageError = toWorkspaceStorageError(error)
    }

    // 旧版本记录已成功迁移，立即回写，避免每次加载重复迁移。
    for (const entry of entries) {
      if (entry.status !== 'migrated') continue
      try {
        await workspaceStorage.saveRecord(toWorkspaceRecord(entry))
      } catch (error) {
        storageError = toWorkspaceStorageError(error)
        break
      }
    }

    let modelConfig: ModelConfig | null = null
    try {
      modelConfig = await workspaceStorage.getModelConfig()
    } catch (error) {
      storageError = storageError ?? toWorkspaceStorageError(error)
    }

    set({
      hydrated: true,
      hydrating: false,
      modelConfig,
      storageError,
    })
  },

  saveRecord: async (record, options) => {
    const existing = options?.keepEdits ? findRecord(get().entries, record.id) : null
    // 自动保存的延迟快照可能早于重命名/收藏，落库时保留用户的最新整理状态。
    const merged: WorkspaceRecord = existing
      ? {
          ...record,
          title: existing.title,
          favorite: existing.favorite,
          createdAt: existing.createdAt,
        }
      : record

    set({ saving: true })
    try {
      await workspaceStorage.saveRecord(merged)
      set((state) => ({
        saving: false,
        lastSavedAt: merged.updatedAt,
        storageError: null,
        entries: upsertEntry(state.entries, merged),
      }))
      return true
    } catch (error) {
      set({
        saving: false,
        storageError: toWorkspaceStorageError(error),
      })
      return false
    }
  },

  renameRecord: async (id, title) => {
    const record = findRecord(get().entries, id)
    if (!record) return
    const nextTitle = sanitizeRecordTitle(title, record.title)
    if (nextTitle === record.title) return

    const saved = await get().saveRecord({
      ...record,
      title: nextTitle,
      updatedAt: Date.now(),
    })
    set({
      feedback: {
        tone: saved ? 'success' : 'error',
        message: saved ? `已重命名为「${nextTitle}」` : '重命名未能保存，请稍后重试',
        at: Date.now(),
      },
    })
  },

  toggleFavorite: async (id) => {
    const record = findRecord(get().entries, id)
    if (!record) return
    const favorite = !record.favorite

    const saved = await get().saveRecord({
      ...record,
      favorite,
      updatedAt: Date.now(),
    })
    set({
      feedback: {
        tone: saved ? 'success' : 'error',
        message: saved
          ? favorite
            ? '已收藏该记录'
            : '已取消收藏'
          : '收藏状态未能保存，请稍后重试',
        at: Date.now(),
      },
    })
  },

  deleteRecord: async (id) => {
    try {
      await workspaceStorage.deleteRecord(id)
      set((state) => ({
        entries: state.entries.filter((entry) => entry.id !== id),
        storageError: null,
        feedback: { tone: 'success', message: '已删除该记录', at: Date.now() },
      }))
    } catch (error) {
      set({
        storageError: toWorkspaceStorageError(error),
        feedback: { tone: 'error', message: '删除失败，记录仍保留', at: Date.now() },
      })
    }
  },

  saveModelConfig: async (draft) => {
    const validation = validateModelConfig(draft)
    if (!validation.ok) {
      set({
        feedback: { tone: 'error', message: validation.message, at: Date.now() },
      })
      return false
    }

    const config = createModelConfig(validation.value)
    try {
      await workspaceStorage.saveModelConfig(config)
      set({
        modelConfig: config,
        storageError: null,
        feedback: { tone: 'success', message: '模型配置已保存到本机', at: Date.now() },
      })
      return true
    } catch (error) {
      set({
        storageError: toWorkspaceStorageError(error),
        feedback: { tone: 'error', message: '模型配置保存失败，请稍后重试', at: Date.now() },
      })
      return false
    }
  },

  clearModelConfig: async () => {
    try {
      await workspaceStorage.clearModelConfig()
      set({
        modelConfig: null,
        storageError: null,
        feedback: { tone: 'success', message: '模型配置已从本机清除', at: Date.now() },
      })
    } catch (error) {
      set({
        storageError: toWorkspaceStorageError(error),
        feedback: { tone: 'error', message: '清除失败，配置仍保留', at: Date.now() },
      })
    }
  },

  clearFeedback: () => set({ feedback: null }),
}))
