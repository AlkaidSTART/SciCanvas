import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useWorkbenchStore } from '../store/useWorkbenchStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { createExperimentGroupId, groupWorkspaceEntries } from '../workspace/records'
import type { ExperimentGroupSummary, WorkspaceEntry } from '../workspace/types'
import { openDrawingWindow } from '../workspace/windowActions'
import {
  ChevronDownIcon,
  DuplicateIcon,
  FilterLinesIcon,
  FolderIcon,
  FolderPlusIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from './icons'
import { FAST_TRANSITION, TAP_BUTTON } from './motion'

interface WorkspaceSidebarTreeProps {
  onSelectWindow: () => void
}

const DEFAULT_VISIBLE_WINDOWS = 6

function formatRelativeTime(timestamp: number, now: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return ''
  const diffSec = Math.max(0, Math.floor((now - timestamp) / 1000))
  if (diffSec < 60) return 'now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}分钟前`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour}小时前`
  const diffDay = Math.floor(diffHour / 24)
  if (diffDay < 30) return `${diffDay}天前`
  const diffMonth = Math.floor(diffDay / 30)
  return `${diffMonth}个月前`
}

export function WorkspaceSidebarTree({
  onSelectWindow,
}: WorkspaceSidebarTreeProps) {
  const entries = useWorkspaceStore((state) => state.entries)
  const hydrating = useWorkspaceStore((state) => state.hydrating)
  const duplicateWindow = useWorkspaceStore((state) => state.duplicateWindow)
  const deleteRecord = useWorkspaceStore((state) => state.deleteRecord)
  const renameRecord = useWorkspaceStore((state) => state.renameRecord)
  const renameGroup = useWorkspaceStore((state) => state.renameGroup)

  const currentRecordId = useWorkbenchStore((state) => state.workspaceRecordId)
  const activeGroupId = useWorkbenchStore((state) => state.activeGroupId)
  const viewMode = useWorkbenchStore((state) => state.viewMode)
  const composerTarget = useWorkbenchStore((state) => state.composerTarget)
  const openComposer = useWorkbenchStore((state) => state.openComposer)

  const [filterOpen, setFilterOpen] = useState(false)
  const [filterKind, setFilterKind] = useState<'all' | 'favorites' | 'ai' | 'preset'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortMenuOpen, setSortMenuOpen] = useState(false)
  const [sortBy, setSortBy] = useState<'recent' | 'name'>('recent')

  // 手动切换过展开/折叠状态的实验组；默认自动展开当前激活的实验组。
  const [toggledGroups, setToggledGroups] = useState<Record<string, boolean>>({})
  const [showAllGroups, setShowAllGroups] = useState<Record<string, boolean>>({})

  const [creatingGroup, setCreatingGroup] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null)
  const [renameGroupValue, setRenameGroupValue] = useState('')
  const [renamingWindowId, setRenamingWindowId] = useState<string | null>(null)
  const [renameWindowValue, setRenameWindowValue] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return entries.filter((entry) => {
      if (entry.status === 'unsupported') return false
      if (filterKind === 'favorites' && !entry.favorite) return false
      if (filterKind === 'ai' && entry.source !== 'ai') return false
      if (filterKind === 'preset' && entry.source !== 'preset') return false
      if (!q) return true
      return (
        entry.title.toLowerCase().includes(q) ||
        (entry.groupTitle?.toLowerCase().includes(q) ?? false) ||
        entry.domain.toLowerCase().includes(q)
      )
    })
  }, [entries, filterKind, searchQuery])

  const groups = useMemo(() => {
    const grouped = groupWorkspaceEntries(filteredEntries)
    if (sortBy === 'name') {
      return [...grouped].sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))
    }
    return grouped
  }, [filteredEntries, sortBy])

  const defaultExpandedId = activeGroupId ?? groups[0]?.groupId ?? null

  const isGroupExpanded = (groupId: string): boolean => {
    if (groupId in toggledGroups) return toggledGroups[groupId]
    if (searchQuery.trim().length > 0) return true
    return groupId === defaultExpandedId
  }

  const toggleGroup = (groupId: string) => {
    setToggledGroups((prev) => ({
      ...prev,
      [groupId]: !isGroupExpanded(groupId),
    }))
  }

  const handleOpenWindow = (entry: WorkspaceEntry) => {
    const result = openDrawingWindow(entry)
    if (result.ok) {
      onSelectWindow()
    }
  }

  const handleCreateGroup = () => {
    const trimmed = newGroupName.trim()
    const groupId = createExperimentGroupId()
    setCreatingGroup(false)
    setNewGroupName('')
    setToggledGroups((prev) => ({ ...prev, [groupId]: true }))
    openComposer({
      groupId,
      groupTitle: trimmed || null,
    })
    onSelectWindow()
  }

  const handleAddWindowInGroup = (group: ExperimentGroupSummary) => {
    setToggledGroups((prev) => ({ ...prev, [group.groupId]: true }))
    openComposer({
      groupId: group.groupId,
      groupTitle: group.title,
    })
    onSelectWindow()
  }

  const handleDuplicate = async (entry: WorkspaceEntry) => {
    const created = await duplicateWindow(entry.id)
    if (!created) return
    openDrawingWindow(created)
    onSelectWindow()
  }

  const handleDeleteWindow = async (entry: WorkspaceEntry) => {
    if (confirmDeleteId !== entry.id) {
      setConfirmDeleteId(entry.id)
      return
    }
    await deleteRecord(entry.id)
    setConfirmDeleteId(null)
    if (useWorkbenchStore.getState().workspaceRecordId === entry.id) {
      useWorkbenchStore.getState().setWorkspaceRecordId(null)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* 顶部栏：模仿 Codex 侧边栏「项目列表 v   [筛选] [新建文件夹]」 */}
      <div className="relative flex flex-none items-center justify-between gap-1 px-3 pb-1.5 pt-2.5">
        <div className="relative">
          <button
            type="button"
            onClick={() => setSortMenuOpen((current) => !current)}
            className="flex items-center gap-1 rounded-[6px] px-1 py-0.5 text-[11.5px] font-medium text-ink-faint transition-colors hover:bg-surface/70 hover:text-ink-dim"
          >
            <span>实验列表</span>
            <ChevronDownIcon className="size-3" />
          </button>

          <AnimatePresence>
            {sortMenuOpen && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={FAST_TRANSITION}
                className="absolute left-0 top-[26px] z-20 flex w-[136px] flex-col gap-0.5 rounded-[8px] border border-line bg-panel p-1 shadow-[0_10px_24px_rgba(58,51,43,0.14)]"
              >
                <button
                  type="button"
                  onClick={() => {
                    setSortBy('recent')
                    setSortMenuOpen(false)
                  }}
                  className={`rounded-[6px] px-2 py-1 text-left text-[11px] transition-colors ${
                    sortBy === 'recent'
                      ? 'bg-accent-soft font-medium text-accent-strong'
                      : 'text-ink-dim hover:bg-surface-soft'
                  }`}
                >
                  按最近更新排序
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSortBy('name')
                    setSortMenuOpen(false)
                  }}
                  className={`rounded-[6px] px-2 py-1 text-left text-[11px] transition-colors ${
                    sortBy === 'name'
                      ? 'bg-accent-soft font-medium text-accent-strong'
                      : 'text-ink-dim hover:bg-surface-soft'
                  }`}
                >
                  按实验名称排序
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex items-center gap-0.5">
          <motion.button
            whileTap={TAP_BUTTON}
            type="button"
            onClick={() => setFilterOpen((current) => !current)}
            aria-pressed={filterOpen}
            title="筛选或搜索实验与绘画窗口"
            className={`grid size-[26px] place-items-center rounded-[6px] transition-colors ${
              filterOpen || filterKind !== 'all' || searchQuery
                ? 'bg-accent-soft text-accent-strong'
                : 'text-ink-faint hover:bg-surface/80 hover:text-ink-dim'
            }`}
          >
            <FilterLinesIcon className="size-3.5" />
          </motion.button>
          <motion.button
            whileTap={TAP_BUTTON}
            type="button"
            onClick={() => {
              setCreatingGroup((current) => !current)
              setNewGroupName('')
            }}
            title="新建实验项目"
            className={`grid size-[26px] place-items-center rounded-[6px] transition-colors ${
              creatingGroup
                ? 'bg-accent-soft text-accent-strong'
                : 'text-ink-faint hover:bg-surface/80 hover:text-ink-dim'
            }`}
          >
            <FolderPlusIcon className="size-3.5" />
          </motion.button>
        </div>
      </div>

      {/* 折叠式筛选栏 */}
      <AnimatePresence>
        {filterOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={FAST_TRANSITION}
            className="flex-none overflow-hidden px-3"
          >
            <div className="mb-2 flex flex-col gap-1.5 rounded-[9px] border border-line bg-surface/80 p-2">
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="搜索实验或绘画窗口…"
                className="w-full rounded-[6px] border border-line bg-surface-soft px-2 py-1 text-[11px] text-ink placeholder:text-ink-faint focus:border-accent-line focus:outline-none"
              />
              <div className="flex flex-wrap gap-1">
                {(
                  [
                    ['all', '全部'],
                    ['favorites', '收藏'],
                    ['ai', 'AI'],
                    ['preset', '预设'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setFilterKind(key)}
                    className={`rounded-[5px] px-1.5 py-[2px] text-[10px] transition-colors ${
                      filterKind === key
                        ? 'bg-accent-soft font-medium text-accent-strong'
                        : 'text-ink-faint hover:bg-surface-soft hover:text-ink-dim'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 新建实验输入框 */}
      <AnimatePresence>
        {creatingGroup && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={FAST_TRANSITION}
            className="flex-none overflow-hidden px-3"
          >
            <div className="mb-2 flex flex-col gap-1.5 rounded-[9px] border border-accent-line/60 bg-surface p-2">
              <input
                type="text"
                autoFocus
                maxLength={80}
                value={newGroupName}
                onChange={(event) => setNewGroupName(event.target.value)}
                placeholder="输入新实验名称（回车创建）"
                className="w-full rounded-[6px] border border-line bg-surface-soft px-2 py-1 text-[11px] text-ink placeholder:text-ink-faint focus:border-accent-line focus:outline-none"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void handleCreateGroup()
                  } else if (event.key === 'Escape') {
                    setCreatingGroup(false)
                  }
                }}
              />
              <div className="flex items-center justify-end gap-1">
                <button
                  type="button"
                  onClick={() => setCreatingGroup(false)}
                  className="rounded-[5px] px-2 py-0.5 text-[10px] text-ink-faint hover:bg-surface-soft hover:text-ink-dim"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => void handleCreateGroup()}
                  className="rounded-[5px] bg-accent-strong px-2 py-0.5 text-[10px] font-medium text-[#fbf7ef] hover:bg-accent"
                >
                  创建
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 折叠式实验文件夹树 */}
      <div className="workbench-scroll flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
        {hydrating ? (
          <div className="px-2 py-6 text-center text-[11px] text-ink-faint">正在加载实验…</div>
        ) : groups.length === 0 ? (
          <div className="mx-1 my-3 flex flex-col items-center gap-1 rounded-[10px] border border-dashed border-line-strong/60 bg-surface/40 px-3 py-6 text-center">
            <span className="text-[11.5px] text-ink-dim">暂无匹配的实验</span>
            <span className="text-[10px] leading-[1.5] text-ink-faint">
              点击上方「新建实验」输入公式，生成绘图后将自动建文件夹归档
            </span>
          </div>
        ) : (
          groups.map((group) => {
            const expanded = isGroupExpanded(group.groupId)
            const showAll = showAllGroups[group.groupId] === true
            const visibleWindows = showAll
              ? group.windows
              : group.windows.slice(0, DEFAULT_VISIBLE_WINDOWS)
            const hasMore = group.windows.length > DEFAULT_VISIBLE_WINDOWS && !showAll
            const renaming = renamingGroupId === group.groupId

            return (
              <div key={group.groupId} className="flex flex-col">
                {/* 实验文件夹行 */}
                {renaming ? (
                  <div className="flex items-center gap-1 px-1.5 py-1">
                    <input
                      type="text"
                      autoFocus
                      maxLength={80}
                      value={renameGroupValue}
                      onChange={(event) => setRenameGroupValue(event.target.value)}
                      className="min-w-0 flex-1 rounded-[6px] border border-accent-line bg-surface px-2 py-0.5 text-[11.5px] text-ink focus:outline-none"
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          void renameGroup(group.groupId, renameGroupValue)
                          setRenamingGroupId(null)
                        } else if (event.key === 'Escape') {
                          setRenamingGroupId(null)
                        }
                      }}
                      onBlur={() => {
                        if (renameGroupValue.trim()) {
                          void renameGroup(group.groupId, renameGroupValue)
                        }
                        setRenamingGroupId(null)
                      }}
                    />
                  </div>
                ) : (
                  <div
                    className={`group/folder flex items-center gap-0.5 rounded-[8px] px-2 py-[6px] transition-colors ${
                      viewMode === 'composer' && composerTarget.groupId === group.groupId
                        ? 'bg-accent-soft/65'
                        : 'hover:bg-surface/75'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.groupId)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      title={`${group.title}（${group.windows.length} 个绘画窗口）`}
                    >
                      <FolderIcon
                        className={`size-[14px] flex-none transition-colors ${
                          expanded ? 'text-ink-dim' : 'text-ink-faint'
                        }`}
                      />
                      <span
                        className={`min-w-0 flex-1 truncate text-[12px] leading-snug transition-colors ${
                          expanded ? 'font-[550] text-ink' : 'font-normal text-ink-dim'
                        }`}
                      >
                        {group.title}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        setRenamingGroupId(group.groupId)
                        setRenameGroupValue(group.title)
                      }}
                      title={`重命名实验「${group.title}」`}
                      className="grid size-5 flex-none place-items-center rounded-[5px] text-ink-faint opacity-0 transition-all hover:bg-surface-soft hover:text-ink group-hover/folder:opacity-100 focus:opacity-100"
                    >
                      <PencilIcon className="size-3" />
                    </button>

                    <button
                      type="button"
                      onClick={() => handleAddWindowInGroup(group)}
                      title={`在「${group.title}」内新建公式实验`}
                      className="grid size-5 flex-none place-items-center rounded-[5px] text-ink-faint opacity-0 transition-all hover:bg-surface-soft hover:text-ink group-hover/folder:opacity-100 focus:opacity-100"
                    >
                      <PlusIcon className="size-3" />
                    </button>
                  </div>
                )}

                {/* 展开后的绘画窗口子列表 */}
                {expanded && (
                  <div className="mb-1 flex flex-col gap-0.5 pl-4">
                    {visibleWindows.map((win) => {
                      const active = viewMode === 'canvas' && win.id === currentRecordId
                      const confirming = confirmDeleteId === win.id
                      const renamingWin = renamingWindowId === win.id
                      if (renamingWin) {
                        return (
                          <div key={win.id} className="flex items-center gap-1 px-1.5 py-0.5">
                            <input
                              type="text"
                              autoFocus
                              maxLength={80}
                              value={renameWindowValue}
                              onChange={(event) => setRenameWindowValue(event.target.value)}
                              className="min-w-0 flex-1 rounded-[6px] border border-accent-line bg-surface px-2 py-0.5 text-[11.5px] text-ink focus:outline-none"
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault()
                                  void renameRecord(win.id, renameWindowValue)
                                  setRenamingWindowId(null)
                                } else if (event.key === 'Escape') {
                                  setRenamingWindowId(null)
                                }
                              }}
                              onBlur={() => {
                                if (renameWindowValue.trim()) {
                                  void renameRecord(win.id, renameWindowValue)
                                }
                                setRenamingWindowId(null)
                              }}
                            />
                          </div>
                        )
                      }
                      return (
                        <div
                          key={win.id}
                          className={`group/win relative flex items-center gap-1.5 rounded-[8px] px-2.5 py-[6px] transition-colors ${
                            active
                              ? 'bg-[rgba(58,51,43,0.08)] text-ink'
                              : 'text-ink-dim hover:bg-surface/75 hover:text-ink'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => handleOpenWindow(win)}
                            className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left"
                            title={win.title}
                          >
                            <span
                              className={`min-w-0 flex-1 truncate text-[12px] leading-snug ${
                                active ? 'font-[550] text-ink' : 'font-normal'
                              }`}
                            >
                              {win.title}
                            </span>
                            <span
                              className={`flex-none text-[10px] tabular-nums text-ink-faint transition-opacity ${
                                confirming
                                  ? 'hidden'
                                  : 'group-hover/win:hidden'
                              }`}
                            >
                              {formatRelativeTime(win.updatedAt, now)}
                            </span>
                          </button>

                          {/* 悬停时显示轻量操作：重命名 / 同实验复制新窗 / 删除 */}
                          <div
                            className={`flex flex-none items-center gap-0.5 ${
                              confirming ? 'flex' : 'hidden group-hover/win:flex'
                            }`}
                          >
                            {!confirming && (
                              <>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    setRenamingWindowId(win.id)
                                    setRenameWindowValue(win.title)
                                  }}
                                  title="重命名该绘画窗口"
                                  className="grid size-5 place-items-center rounded-[5px] text-ink-faint transition-colors hover:bg-surface hover:text-ink"
                                >
                                  <PencilIcon className="size-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    void handleDuplicate(win)
                                  }}
                                  title="在同实验内复制为新绘画窗口"
                                  className="grid size-5 place-items-center rounded-[5px] text-ink-faint transition-colors hover:bg-surface hover:text-ink"
                                >
                                  <DuplicateIcon className="size-3" />
                                </button>
                              </>
                            )}
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation()
                                void handleDeleteWindow(win)
                              }}
                              onMouseLeave={() => {
                                if (confirmDeleteId === win.id) setConfirmDeleteId(null)
                              }}
                              title={confirming ? '再次点击确认删除' : '删除该绘画窗口'}
                              className={`rounded-[5px] transition-colors ${
                                confirming
                                  ? 'bg-rose/[0.15] px-1.5 py-0.5 text-[9.5px] font-medium text-[#a9605f]'
                                  : 'grid size-5 place-items-center text-ink-faint hover:bg-rose/[0.12] hover:text-[#a9605f]'
                              }`}
                            >
                              {confirming ? '确认' : <TrashIcon className="size-3" />}
                            </button>
                          </div>
                        </div>
                      )
                    })}

                    {hasMore && (
                      <button
                        type="button"
                        onClick={() =>
                          setShowAllGroups((prev) => ({ ...prev, [group.groupId]: true }))
                        }
                        className="w-fit rounded-[6px] px-2.5 py-1 text-left text-[11px] text-ink-faint transition-colors hover:text-ink-dim"
                      >
                        显示全部 ({group.windows.length})
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* 底部统计 */}
      <div className="flex flex-none items-center justify-between border-t border-line/70 px-3 py-1.5 text-[10px] text-ink-faint">
        <span>{groups.length} 个实验 · {filteredEntries.length} 窗口</span>
      </div>
    </div>
  )
}
