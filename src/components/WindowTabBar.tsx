import { useMemo } from 'react'
import { useWorkbenchStore } from '../store/useWorkbenchStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import {
  resolveRecordGroupId,
  resolveRecordGroupTitle,
} from '../workspace/records'
import type { WorkspaceEntry } from '../workspace/types'
import { closeDrawingWindowTab, openDrawingWindow } from '../workspace/windowActions'
import { CloseIcon } from './icons'

interface TabItem {
  id: string
  title: string
  groupId: string
  groupTitle: string
  source: 'preset' | 'ai'
  entry: WorkspaceEntry | null
}

export function WindowTabBar() {
  const presentation = useWorkbenchStore((state) => state.presentation)
  const viewMode = useWorkbenchStore((state) => state.viewMode)
  const currentRecordId = useWorkbenchStore((state) => state.workspaceRecordId)
  const currentTitle = useWorkbenchStore((state) => state.experiment.title)
  const currentSource = useWorkbenchStore((state) => state.source)
  const activeGroupId = useWorkbenchStore((state) => state.activeGroupId)
  const activeGroupTitle = useWorkbenchStore((state) => state.activeGroupTitle)

  const entries = useWorkspaceStore((state) => state.entries)
  const openWindowIds = useWorkspaceStore((state) => state.openWindowIds)

  const tabs = useMemo<TabItem[]>(() => {
    const entryMap = new Map(entries.map((entry) => [entry.id, entry]))
    const list: TabItem[] = []
    const seen = new Set<string>()

    for (const id of openWindowIds) {
      const entry = entryMap.get(id)
      if (!entry || entry.status === 'unsupported') continue
      seen.add(id)
      list.push({
        id: entry.id,
        title: entry.title,
        groupId: resolveRecordGroupId(entry),
        groupTitle: resolveRecordGroupTitle(entry),
        source: entry.source,
        entry,
      })
    }

    if (viewMode === 'canvas' && currentRecordId && !seen.has(currentRecordId)) {
      const entry = entryMap.get(currentRecordId) ?? null
      list.push({
        id: currentRecordId,
        title: entry?.title ?? currentTitle,
        groupId: entry ? resolveRecordGroupId(entry) : (activeGroupId ?? `exp:${currentRecordId}`),
        groupTitle: entry ? resolveRecordGroupTitle(entry) : (activeGroupTitle ?? currentTitle),
        source: entry?.source ?? currentSource,
        entry,
      })
    }

    return list
  }, [
    entries,
    openWindowIds,
    viewMode,
    currentRecordId,
    currentTitle,
    currentSource,
    activeGroupId,
    activeGroupTitle,
  ])

  const hasMultipleGroups = useMemo(() => {
    const uniqueGroups = new Set(tabs.map((tab) => tab.groupId))
    return uniqueGroups.size > 1
  }, [tabs])

  if (presentation || tabs.length === 0) return null

  return (
    <div
      className="z-[5] flex h-[36px] flex-none items-center gap-1 border-b border-line bg-panel/85 px-2 backdrop-blur-sm"
      role="tablist"
      aria-label="已打开的实验标签栏"
    >
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((tab) => {
          const isActive = viewMode === 'canvas' && tab.id === currentRecordId
          const showGroupPrefix = hasMultipleGroups && tab.groupTitle !== tab.title
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              className={`group flex h-[27px] max-w-[220px] flex-none items-center gap-1.5 rounded-[7px] border pl-2.5 pr-1.5 text-[11px] transition-colors ${
                isActive
                  ? 'border-accent-line bg-surface text-ink shadow-[0_1px_2px_rgba(58,51,43,0.08)]'
                  : 'border-transparent bg-transparent text-ink-dim hover:border-line/80 hover:bg-surface/65 hover:text-ink'
              }`}
              title={
                tab.groupTitle !== tab.title
                  ? `${tab.groupTitle} / ${tab.title}`
                  : tab.title
              }
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                onClick={() => {
                  if (tab.entry && !isActive) {
                    openDrawingWindow(tab.entry)
                  }
                }}
              >
                <span
                  className={`size-1.5 flex-none rounded-full ${
                    tab.source === 'ai'
                      ? 'bg-[#8a76a8]'
                      : isActive
                        ? 'bg-accent-strong'
                        : 'bg-ink-faint/60'
                  }`}
                />
                {showGroupPrefix && (
                  <span className="hidden max-w-[64px] truncate text-[9.5px] text-ink-faint sm:inline">
                    {tab.groupTitle} /
                  </span>
                )}
                <span className="truncate font-medium">{tab.title}</span>
              </button>

              <button
                type="button"
                className="grid size-4 flex-none place-items-center rounded-[4px] text-ink-faint opacity-60 transition-colors hover:bg-surface-soft hover:text-ink group-hover:opacity-100"
                aria-label={`关闭标签 ${tab.title}`}
                title="关闭实验标签（工作区记录仍保留）"
                onClick={(event) => {
                  event.stopPropagation()
                  closeDrawingWindowTab(tab.id)
                }}
              >
                <CloseIcon className="size-2.5" />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
