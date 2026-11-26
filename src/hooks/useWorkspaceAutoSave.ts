import { useEffect } from 'react'
import { useSessionStore } from '../store/useSessionStore'
import { useWorkbenchStore } from '../store/useWorkbenchStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { createWorkspaceAutoSaver } from '../workspace/autoSave'
import {
  buildWorkspaceRecord,
  createWorkspaceRecordId,
  resolveRecordGroupId,
  resolveRecordGroupTitle,
} from '../workspace/records'

/**
 * 把工作台的变化同步为本地记录（绘画窗口）：
 * 只订阅实验、来源、代码与参数，不接触遥测/探针，因此动画帧不会触发写库。
 */
export function useWorkspaceAutoSave(): void {
  const hydrated = useWorkspaceStore((state) => state.hydrated)

  useEffect(() => {
    if (!hydrated) return undefined

    // 首次水合完成后，确保当前画布对应的绘画窗口已登记并出现在窗口栏中。
    const initialWorkbench = useWorkbenchStore.getState()
    if (!initialWorkbench.workspaceRecordId && initialWorkbench.source === 'preset') {
      const existing = useWorkspaceStore
        .getState()
        .entries.find(
          (entry) =>
            entry.status !== 'unsupported' &&
            entry.source === 'preset' &&
            entry.experimentId === initialWorkbench.experiment.id,
        )
      if (existing) {
        initialWorkbench.setWorkspaceRecordId(existing.id)
        initialWorkbench.setActiveGroup(
          resolveRecordGroupId(existing),
          resolveRecordGroupTitle(existing),
        )
        useWorkspaceStore.getState().openWindow(existing.id)
      }
    } else if (initialWorkbench.workspaceRecordId) {
      useWorkspaceStore.getState().openWindow(initialWorkbench.workspaceRecordId)
    }

    const saver = createWorkspaceAutoSaver({
      save: async (record) => {
        const workspace = useWorkspaceStore.getState()
        const workbench = useWorkbenchStore.getState()
        const exists = workspace.entries.some((entry) => entry.id === record.id)
        // 记录已被删除且不再是当前实验时，跳过错过的延迟写入，避免“复活”。
        if (!exists && workbench.workspaceRecordId !== record.id) return
        const saved = await workspace.saveRecord(record, { keepEdits: true })
        if (saved && workbench.workspaceRecordId === record.id) {
          workspace.openWindow(record.id)
        }
      },
    })

    const unsubscribe = useWorkbenchStore.subscribe((state, previous) => {
      const changed =
        state.experiment !== previous.experiment ||
        state.source !== previous.source ||
        state.aiSpec !== previous.aiSpec ||
        state.params !== previous.params ||
        state.speed !== previous.speed
      if (!changed) return
      if (state.source === 'ai' && !state.aiSpec) return

      let recordId = state.workspaceRecordId
      if (!recordId) {
        if (state.source === 'preset' && !state.activeGroupId) {
          const existing = useWorkspaceStore
            .getState()
            .entries.find(
              (entry) =>
                entry.status !== 'unsupported' &&
                entry.source === 'preset' &&
                entry.experimentId === state.experiment.id,
            )
          recordId = existing?.id ?? createWorkspaceRecordId()
        } else {
          recordId = createWorkspaceRecordId()
        }
        // 先写回记录 ID，后续参数变化沿用同一条记录。
        useWorkbenchStore.getState().setWorkspaceRecordId(recordId)
      }

      const existing = useWorkspaceStore
        .getState()
        .entries.find((entry) => entry.id === recordId)

      const sessionId =
        state.source === 'ai'
          ? useSessionStore.getState().activeSessionId
          : (existing?.sessionId ?? null)

      const record = buildWorkspaceRecord({
        id: recordId,
        existing: existing ?? null,
        groupId: state.activeGroupId ?? existing?.groupId ?? null,
        groupTitle: state.activeGroupTitle ?? existing?.groupTitle ?? null,
        sessionId,
        source: state.source,
        experimentId: state.experiment.id,
        title: state.source === 'ai' ? (state.aiSpec?.title ?? state.experiment.title) : state.experiment.title,
        domain: state.experiment.domain,
        spec: state.aiSpec,
        params: state.params,
        speed: state.speed,
      })

      if (!state.activeGroupId && record.groupId) {
        useWorkbenchStore
          .getState()
          .setActiveGroup(record.groupId, record.groupTitle ?? record.title)
      }
      useWorkspaceStore.getState().openWindow(recordId)

      // 首次创建立即写入；参数拖动等后续变化合并后延迟写入。
      saver.schedule(record, !existing)
    })

    const flush = () => {
      void saver.flush()
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush()
    }

    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      unsubscribe()
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      void saver.flush()
      saver.dispose()
    }
  }, [hydrated])
}
