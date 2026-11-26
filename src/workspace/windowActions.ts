import { getExperimentById } from '../experiments'
import { useSessionStore } from '../store/useSessionStore'
import { useWorkbenchStore } from '../store/useWorkbenchStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { resolveRecordGroupId, resolveRecordGroupTitle } from './records'
import type { WorkspaceEntry, WorkspaceRecord } from './types'

export type OpenWindowResult = { ok: true } | { ok: false; message: string }

/**
 * 将工作区中的任意绘画窗口记录激活到画布，并同步窗口栏与关联的 SQLite 会话。
 */
export function openDrawingWindow(entry: WorkspaceEntry | WorkspaceRecord): OpenWindowResult {
  if ('status' in entry && entry.status === 'unsupported') {
    return { ok: false, message: entry.issue ?? '该记录不受支持，无法打开。' }
  }

  const workbench = useWorkbenchStore.getState()
  const workspace = useWorkspaceStore.getState()
  const groupId = resolveRecordGroupId(entry)
  const groupTitle = resolveRecordGroupTitle(entry)

  if (entry.source === 'ai') {
    if (!entry.spec) {
      return { ok: false, message: '该记录缺少代码版本，无法恢复运行；可导出备份后删除。' }
    }
    workbench.applyGeneratedExperiment(entry.spec, entry.params, {
      recordId: entry.id,
      groupId,
      groupTitle,
    })
    workbench.setSpeed(entry.speed)
  } else {
    if (!getExperimentById(entry.experimentId)) {
      return { ok: false, message: '对应的预设实验已不存在；可导出备份后删除该记录。' }
    }
    workbench.selectExperiment(entry.experimentId, {
      recordId: entry.id,
      groupId,
      groupTitle,
    })
    workbench.setParams(entry.params)
    workbench.setSpeed(entry.speed)
  }

  useSessionStore.getState().setActiveSessionId(entry.sessionId ?? null)
  workspace.openWindow(entry.id)
  return { ok: true }
}

/**
 * 从窗口栏关闭一个绘画窗口（不删除本地记录）；若关闭的是当前激活窗口，自动切到相邻窗口。
 */
export function closeDrawingWindowTab(recordId: string): void {
  const workspace = useWorkspaceStore.getState()
  const workbench = useWorkbenchStore.getState()
  const openIds = workspace.openWindowIds
  const index = openIds.indexOf(recordId)
  workspace.closeWindow(recordId)

  if (workbench.workspaceRecordId !== recordId) return

  const remaining = openIds.filter((id) => id !== recordId)
  if (remaining.length === 0) return

  const nextId = remaining[Math.min(Math.max(index, 0), remaining.length - 1)]
  const nextEntry = workspace.entries.find((item) => item.id === nextId)
  if (nextEntry) {
    openDrawingWindow(nextEntry)
  }
}
