import { create } from 'zustand'
import { getExperimentById } from '../experiments'
import { createDefaultParams } from '../runtime/params'
import { toWorkspaceStorageError, workspaceStorage } from '../workspace/db'
import type { WorkspaceStorageError } from '../workspace/db'
import { createModelConfig, validateModelConfig } from '../workspace/modelConfig'
import {
  buildWorkspaceRecord,
  createExperimentGroupId,
  createWorkspaceRecordId,
  resolveRecordGroupId,
  resolveRecordGroupTitle,
  sanitizeRecordTitle,
  sortWorkspaceEntries,
  toWorkspaceRecord,
} from '../workspace/records'
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
  /** 工作台顶部窗口栏中当前打开的绘画窗口 ID 列表（有序）。 */
  openWindowIds: string[]
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
  openWindow: (id: string) => void
  closeWindow: (id: string) => void
  renameRecord: (id: string, title: string) => Promise<void>
  renameGroup: (groupId: string, title: string) => Promise<void>
  moveWindowToGroup: (id: string, groupId: string, groupTitle: string) => Promise<void>
  toggleFavorite: (id: string) => Promise<void>
  deleteRecord: (id: string) => Promise<void>
  deleteGroup: (groupId: string) => Promise<void>
  duplicateWindow: (
    id: string,
    options?: { groupId?: string; groupTitle?: string; title?: string },
  ) => Promise<WorkspaceRecord | null>
  createPresetWindow: (
    experimentId: string,
    options?: { groupId?: string; groupTitle?: string; title?: string },
  ) => Promise<WorkspaceRecord | null>
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
  openWindowIds: [],
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
          groupId: record.groupId ?? existing.groupId,
          groupTitle: existing.groupTitle ?? record.groupTitle,
          sessionId: record.sessionId !== undefined ? record.sessionId : existing.sessionId,
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

  openWindow: (id) =>
    set((state) =>
      state.openWindowIds.includes(id)
        ? state
        : { openWindowIds: [...state.openWindowIds, id] },
    ),

  closeWindow: (id) =>
    set((state) => ({
      openWindowIds: state.openWindowIds.filter((item) => item !== id),
    })),

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

  renameGroup: async (groupId, title) => {
    const members = get().entries.filter(
      (entry) => entry.status !== 'unsupported' && resolveRecordGroupId(entry) === groupId,
    )
    if (members.length === 0) return
    const fallback = resolveRecordGroupTitle(members[0])
    const nextTitle = sanitizeRecordTitle(title, fallback)
    const now = Date.now()
    let allSaved = true
    for (const member of members) {
      const saved = await get().saveRecord({
        ...toWorkspaceRecord(member),
        groupId,
        groupTitle: nextTitle,
        updatedAt: now,
      })
      if (!saved) allSaved = false
    }
    set({
      feedback: {
        tone: allSaved ? 'success' : 'error',
        message: allSaved ? `实验已重命名为「${nextTitle}」` : '部分窗口重命名未能保存',
        at: Date.now(),
      },
    })
  },

  moveWindowToGroup: async (id, groupId, groupTitle) => {
    const record = findRecord(get().entries, id)
    if (!record) return
    const saved = await get().saveRecord({
      ...record,
      groupId,
      groupTitle: sanitizeRecordTitle(groupTitle, record.title),
      updatedAt: Date.now(),
    })
    set({
      feedback: {
        tone: saved ? 'success' : 'error',
        message: saved ? `已移入实验「${groupTitle}」` : '移动失败，请稍后重试',
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
        openWindowIds: state.openWindowIds.filter((item) => item !== id),
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

  deleteGroup: async (groupId) => {
    const members = get().entries.filter((entry) => resolveRecordGroupId(entry) === groupId)
    if (members.length === 0) return
    const deletedIds = new Set<string>()
    try {
      for (const member of members) {
        await workspaceStorage.deleteRecord(member.id)
        deletedIds.add(member.id)
      }
      set((state) => ({
        entries: state.entries.filter((entry) => !deletedIds.has(entry.id)),
        openWindowIds: state.openWindowIds.filter((item) => !deletedIds.has(item)),
        storageError: null,
        feedback: {
          tone: 'success',
          message: `已删除该实验及 ${deletedIds.size} 个绘画窗口`,
          at: Date.now(),
        },
      }))
    } catch (error) {
      set((state) => ({
        entries: state.entries.filter((entry) => !deletedIds.has(entry.id)),
        openWindowIds: state.openWindowIds.filter((item) => !deletedIds.has(item)),
        storageError: toWorkspaceStorageError(error),
        feedback: { tone: 'error', message: '删除实验时发生错误', at: Date.now() },
      }))
    }
  },

  duplicateWindow: async (id, options) => {
    const sourceEntry = get().entries.find((item) => item.id === id)
    if (!sourceEntry || sourceEntry.status === 'unsupported') return null
    const groupId = options?.groupId ?? resolveRecordGroupId(sourceEntry)
    const groupTitle = options?.groupTitle ?? resolveRecordGroupTitle(sourceEntry)
    const siblings = get().entries.filter(
      (item) => item.status !== 'unsupported' && resolveRecordGroupId(item) === groupId,
    )
    const nextTitle = sanitizeRecordTitle(
      options?.title ?? `${sourceEntry.title} #${siblings.length + 1}`,
      sourceEntry.title,
    )
    const newId = createWorkspaceRecordId()
    const record = buildWorkspaceRecord({
      id: newId,
      existing: null,
      groupId,
      groupTitle,
      sessionId: null,
      source: sourceEntry.source,
      experimentId: sourceEntry.experimentId,
      title: nextTitle,
      domain: sourceEntry.domain,
      spec: sourceEntry.spec,
      params: { ...sourceEntry.params },
      speed: sourceEntry.speed,
    })
    const saved = await get().saveRecord(record)
    if (!saved) return null
    get().openWindow(newId)
    set({
      feedback: {
        tone: 'success',
        message: `已新开绘画窗口「${record.title}」`,
        at: Date.now(),
      },
    })
    return record
  },

  createPresetWindow: async (experimentId, options) => {
    const preset = getExperimentById(experimentId)
    if (!preset) return null
    const newId = createWorkspaceRecordId()
    const groupId = options?.groupId ?? createExperimentGroupId()
    const groupTitle = sanitizeRecordTitle(options?.groupTitle ?? preset.title, preset.title)
    const siblings = get().entries.filter(
      (item) => item.status !== 'unsupported' && resolveRecordGroupId(item) === groupId,
    )
    const defaultWindowTitle =
      siblings.length > 0 ? `${preset.title} #${siblings.length + 1}` : preset.title
    const title = sanitizeRecordTitle(options?.title ?? defaultWindowTitle, preset.title)
    const record = buildWorkspaceRecord({
      id: newId,
      existing: null,
      groupId,
      groupTitle,
      sessionId: null,
      source: 'preset',
      experimentId: preset.id,
      title,
      domain: preset.domain,
      spec: null,
      params: createDefaultParams(preset),
      speed: 1,
    })
    const saved = await get().saveRecord(record)
    if (!saved) return null
    get().openWindow(newId)
    set({
      feedback: {
        tone: 'success',
        message: `已新开绘画窗口「${record.title}」`,
        at: Date.now(),
      },
    })
    return record
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
