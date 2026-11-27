import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useWorkbenchStore } from '../store/useWorkbenchStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import {
  createExperimentGroupId,
  resolveRecordGroupId,
  resolveRecordGroupTitle,
} from '../workspace/records'
import type { WorkspaceEntry } from '../workspace/types'
import { closeDrawingWindowTab, openDrawingWindow } from '../workspace/windowActions'
import { CloseIcon, DuplicateIcon, PlusIcon, WorkspaceIcon } from './icons'
import { FAST_TRANSITION, TAP_BUTTON } from './motion'

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
  const currentRecordId = useWorkbenchStore((state) => state.workspaceRecordId)
  const currentTitle = useWorkbenchStore((state) => state.experiment.title)
  const currentSource = useWorkbenchStore((state) => state.source)
  const currentExperimentId = useWorkbenchStore((state) => state.experiment.id)
  const activeGroupId = useWorkbenchStore((state) => state.activeGroupId)
  const activeGroupTitle = useWorkbenchStore((state) => state.activeGroupTitle)
  const openComposer = useWorkbenchStore((state) => state.openComposer)

  const entries = useWorkspaceStore((state) => state.entries)
  const openWindowIds = useWorkspaceStore((state) => state.openWindowIds)
  const duplicateWindow = useWorkspaceStore((state) => state.duplicateWindow)

  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return undefined
    const handlePointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [menuOpen])

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

    if (currentRecordId && !seen.has(currentRecordId)) {
      const entry = entryMap.get(currentRecordId) ?? null
      list.push({
        id: currentRecordId,
        title: entry?.title ?? currentTitle,
        groupId: entry ? resolveRecordGroupId(entry) : (activeGroupId ?? `exp:${currentRecordId}`),
        groupTitle: entry ? resolveRecordGroupTitle(entry) : (activeGroupTitle ?? currentTitle),
        source: entry?.source ?? currentSource,
        entry,
      })
    } else if (!currentRecordId && list.length === 0) {
      list.push({
        id: '__active__',
        title: currentTitle,
        groupId: activeGroupId ?? `preset:${currentExperimentId}`,
        groupTitle: activeGroupTitle ?? currentTitle,
        source: currentSource,
        entry: null,
      })
    }

    return list
  }, [
    entries,
    openWindowIds,
    currentRecordId,
    currentTitle,
    currentSource,
    currentExperimentId,
    activeGroupId,
    activeGroupTitle,
  ])

  const hasMultipleGroups = useMemo(() => {
    const uniqueGroups = new Set(tabs.map((tab) => tab.groupId))
    return uniqueGroups.size > 1
  }, [tabs])

  if (presentation) return null

  const activeId = currentRecordId ?? '__active__'
  const resolvedGroupId = activeGroupId ?? tabs.find((t) => t.id === activeId)?.groupId ?? null
  const resolvedGroupTitle =
    activeGroupTitle ?? tabs.find((t) => t.id === activeId)?.groupTitle ?? currentTitle

  const handleDuplicateInGroup = async () => {
    setMenuOpen(false)
    if (!currentRecordId) return
    const created = await duplicateWindow(currentRecordId, {
      ...(resolvedGroupId ? { groupId: resolvedGroupId } : {}),
      groupTitle: resolvedGroupTitle,
    })
    if (created) openDrawingWindow(created)
  }

  const handleNewInGroup = () => {
    setMenuOpen(false)
    const groupId = resolvedGroupId ?? createExperimentGroupId()
    openComposer({
      groupId,
      groupTitle: resolvedGroupTitle,
    })
  }

  const handleNewStandalone = () => {
    setMenuOpen(false)
    openComposer()
  }

  return (
    <div
      className="z-[5] flex h-[36px] flex-none items-center gap-1 border-b border-line bg-panel/85 px-2 backdrop-blur-sm"
      role="tablist"
      aria-label="绘画窗口标签栏"
    >
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((tab) => {
          const isActive = tab.id === activeId
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

              {tabs.length > 1 && tab.entry && (
                <button
                  type="button"
                  className="grid size-4 flex-none place-items-center rounded-[4px] text-ink-faint opacity-60 transition-colors hover:bg-surface-soft hover:text-ink group-hover:opacity-100"
                  aria-label={`关闭窗口 ${tab.title}`}
                  title="关闭窗口标签（工作区记录仍保留）"
                  onClick={(event) => {
                    event.stopPropagation()
                    closeDrawingWindowTab(tab.id)
                  }}
                >
                  <CloseIcon className="size-2.5" />
                </button>
              )}
            </div>
          )
        })}
      </div>

      <div className="relative flex flex-none items-center gap-1 border-l border-line pl-1.5" ref={menuRef}>
        <motion.button
          whileTap={TAP_BUTTON}
          type="button"
          className="flex h-[26px] items-center gap-1 rounded-[7px] border border-line bg-surface px-2 text-[10.5px] font-medium text-ink-dim transition-colors hover:border-line-strong hover:bg-surface-soft hover:text-ink"
          onClick={() => setMenuOpen((current) => !current)}
          aria-expanded={menuOpen}
          title="新开绘画窗口"
        >
          <PlusIcon className="size-3" />
          <span className="hidden sm:inline">新窗口</span>
        </motion.button>

        <AnimatePresence>
          {menuOpen && (
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.98 }}
              transition={FAST_TRANSITION}
              className="absolute right-0 top-[33px] z-30 flex w-[236px] flex-col gap-0.5 rounded-[10px] border border-line bg-panel p-1.5 shadow-[0_14px_34px_rgba(58,51,43,0.18)]"
            >
              {currentRecordId && (
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-[7px] px-2.5 py-2 text-left text-[11px] text-ink transition-colors hover:bg-surface-soft"
                  onClick={() => void handleDuplicateInGroup()}
                >
                  <DuplicateIcon className="size-3.5 flex-none text-accent-strong" />
                  <span className="flex flex-col">
                    <span className="font-medium">同实验复制当前窗口</span>
                    <span className="text-[9.5px] text-ink-faint">
                      归入「{resolvedGroupTitle}」进行对比
                    </span>
                  </span>
                </button>
              )}
              <button
                type="button"
                className="flex items-center gap-2 rounded-[7px] px-2.5 py-2 text-left text-[11px] text-ink transition-colors hover:bg-surface-soft"
                onClick={handleNewInGroup}
              >
                <PlusIcon className="size-3.5 flex-none text-[#6d5a7d]" />
                <span className="flex flex-col">
                  <span className="font-medium">在当前实验新建公式实验</span>
                  <span className="text-[9.5px] text-ink-faint">
                    输入公式生成绘图并归入「{resolvedGroupTitle}」
                  </span>
                </span>
              </button>
              <div className="my-0.5 border-t border-line" />
              <button
                type="button"
                className="flex items-center gap-2 rounded-[7px] px-2.5 py-2 text-left text-[11px] text-ink transition-colors hover:bg-surface-soft"
                onClick={handleNewStandalone}
              >
                <WorkspaceIcon className="size-3.5 flex-none text-ink-dim" />
                <span className="flex flex-col">
                  <span className="font-medium">新建独立公式实验</span>
                  <span className="text-[9.5px] text-ink-faint">
                    输入公式生成绘图并自动新建文件夹归档
                  </span>
                </span>
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
