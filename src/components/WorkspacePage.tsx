import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { DEFAULT_EXPERIMENT, EXPERIMENTS } from '../experiments'
import { sanitizeExportFileName } from '../export/html'
import { useWorkbenchStore } from '../store/useWorkbenchStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import {
  createExperimentGroupId,
  groupWorkspaceEntries,
  resolveRecordGroupId,
} from '../workspace/records'
import type { ExperimentGroupSummary, WorkspaceEntry } from '../workspace/types'
import { openDrawingWindow } from '../workspace/windowActions'
import { DuplicateIcon, PlusIcon, WorkspaceIcon } from './icons'
import { FAST_TRANSITION, SPRING_SNAPPY, TAP_BUTTON } from './motion'
import { SessionHistoryTab } from './SessionHistoryTab'

interface WorkspacePageProps {
  onBack: () => void
}

const SMALL_BUTTON =
  'rounded-md border border-line bg-surface px-2.5 py-[4px] text-[10.5px] text-ink-dim transition-colors enabled:hover:border-line-strong enabled:hover:bg-surface-soft enabled:hover:text-ink disabled:cursor-not-allowed disabled:opacity-45'
const PRIMARY_BUTTON =
  'rounded-lg border border-transparent bg-accent-strong px-3 py-1.5 text-[11.5px] font-semibold text-[#fbf7ef] transition-colors enabled:hover:bg-accent disabled:cursor-not-allowed disabled:opacity-45'
const DANGER_BUTTON =
  'rounded-md border border-rose/40 bg-rose/[0.08] px-2.5 py-[4px] text-[10.5px] text-[#a9605f] transition-colors hover:bg-rose/[0.16]'
const INPUT_CLASS =
  'w-full rounded-[8px] border border-line bg-surface-soft px-2.5 py-[6px] text-[11.5px] text-ink placeholder:text-ink-faint focus:border-accent-line focus:outline-none'

function formatTimestamp(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '—'
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(timestamp)
  } catch {
    return new Date(timestamp).toLocaleString()
  }
}

function downloadBackup(entry: WorkspaceEntry): void {
  const payload = entry.raw ?? {
    id: entry.id,
    groupId: entry.groupId,
    groupTitle: entry.groupTitle,
    title: entry.title,
    domain: entry.domain,
    source: entry.source,
    experimentId: entry.experimentId,
    schemaVersion: entry.schemaVersion,
    codeVersion: entry.codeVersion,
    spec: entry.spec,
    params: entry.params,
    speed: entry.speed,
    favorite: entry.favorite,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${sanitizeExportFileName(entry.title).replace(/\.html?$/i, '')}.json`
  anchor.rel = 'noopener'
  anchor.style.display = 'none'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function WorkspacePage({ onBack }: WorkspacePageProps) {
  const entries = useWorkspaceStore((state) => state.entries)
  const openWindowIds = useWorkspaceStore((state) => state.openWindowIds)
  const hydrated = useWorkspaceStore((state) => state.hydrated)
  const hydrating = useWorkspaceStore((state) => state.hydrating)
  const storageError = useWorkspaceStore((state) => state.storageError)
  const saving = useWorkspaceStore((state) => state.saving)
  const lastSavedAt = useWorkspaceStore((state) => state.lastSavedAt)
  const feedback = useWorkspaceStore((state) => state.feedback)
  const renameRecord = useWorkspaceStore((state) => state.renameRecord)
  const renameGroup = useWorkspaceStore((state) => state.renameGroup)
  const moveWindowToGroup = useWorkspaceStore((state) => state.moveWindowToGroup)
  const toggleFavorite = useWorkspaceStore((state) => state.toggleFavorite)
  const deleteRecord = useWorkspaceStore((state) => state.deleteRecord)
  const deleteGroup = useWorkspaceStore((state) => state.deleteGroup)
  const duplicateWindow = useWorkspaceStore((state) => state.duplicateWindow)
  const createPresetWindow = useWorkspaceStore((state) => state.createPresetWindow)
  const clearFeedback = useWorkspaceStore((state) => state.clearFeedback)

  const currentRecordId = useWorkbenchStore((state) => state.workspaceRecordId)
  const activeGroupId = useWorkbenchStore((state) => state.activeGroupId)

  const [section, setSection] = useState<'windows' | 'sessions'>('windows')
  const [filter, setFilter] = useState<'all' | 'favorites' | 'ai' | 'preset'>('all')
  const [query, setQuery] = useState('')
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(activeGroupId)
  const [renamingWindowId, setRenamingWindowId] = useState<string | null>(null)
  const [renameWindowValue, setRenameWindowValue] = useState('')
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null)
  const [renameGroupValue, setRenameGroupValue] = useState('')
  const [confirmDeleteWindowId, setConfirmDeleteWindowId] = useState<string | null>(null)
  const [confirmDeleteGroupId, setConfirmDeleteGroupId] = useState<string | null>(null)
  const [creatingExperiment, setCreatingExperiment] = useState(false)
  const [newExperimentTitle, setNewExperimentTitle] = useState('')
  const [newExperimentPresetId, setNewExperimentPresetId] = useState(DEFAULT_EXPERIMENT.id)
  const [addingInGroup, setAddingInGroup] = useState(false)
  const [addInGroupPresetId, setAddInGroupPresetId] = useState(DEFAULT_EXPERIMENT.id)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (!feedback) return undefined
    const timer = window.setTimeout(() => clearFeedback(), 4000)
    return () => window.clearTimeout(timer)
  }, [feedback, clearFeedback])

  const filteredEntries = useMemo(() => {
    const trimmed = query.trim().toLowerCase()
    return entries.filter((entry) => {
      if (filter === 'favorites' && !entry.favorite) return false
      if (filter === 'ai' && entry.source !== 'ai') return false
      if (filter === 'preset' && entry.source !== 'preset') return false
      if (!trimmed) return true
      return (
        entry.title.toLowerCase().includes(trimmed) ||
        (entry.groupTitle?.toLowerCase().includes(trimmed) ?? false) ||
        entry.domain.toLowerCase().includes(trimmed)
      )
    })
  }, [entries, filter, query])

  const allGroups = useMemo(() => groupWorkspaceEntries(entries), [entries])
  const visibleGroups = useMemo(() => groupWorkspaceEntries(filteredEntries), [filteredEntries])

  const effectiveGroupId = useMemo(() => {
    if (selectedGroupId && visibleGroups.some((g) => g.groupId === selectedGroupId)) {
      return selectedGroupId
    }
    if (activeGroupId && visibleGroups.some((g) => g.groupId === activeGroupId)) {
      return activeGroupId
    }
    return visibleGroups[0]?.groupId ?? null
  }, [selectedGroupId, activeGroupId, visibleGroups])

  const selectedGroup: ExperimentGroupSummary | null = useMemo(
    () => visibleGroups.find((g) => g.groupId === effectiveGroupId) ?? null,
    [visibleGroups, effectiveGroupId],
  )

  const handleOpenWindow = (entry: WorkspaceEntry) => {
    const result = openDrawingWindow(entry)
    if (!result.ok) {
      setLoadError(result.message)
      return
    }
    setLoadError(null)
    onBack()
  }

  const handleCreateStandaloneExperiment = async () => {
    const groupId = createExperimentGroupId()
    const trimmed = newExperimentTitle.trim()
    const created = await createPresetWindow(newExperimentPresetId, {
      groupId,
      ...(trimmed ? { groupTitle: trimmed, title: `${trimmed} · 窗口 1` } : {}),
    })
    if (!created) return
    setCreatingExperiment(false)
    setNewExperimentTitle('')
    setSelectedGroupId(groupId)
    openDrawingWindow(created)
    onBack()
  }

  const handleQuickNewStandalone = async () => {
    const groupId = createExperimentGroupId()
    const created = await createPresetWindow(DEFAULT_EXPERIMENT.id, { groupId })
    if (!created) return
    setSelectedGroupId(groupId)
    openDrawingWindow(created)
    onBack()
  }

  const handleAddWindowInGroup = async (group: ExperimentGroupSummary, presetId: string) => {
    const created = await createPresetWindow(presetId, {
      groupId: group.groupId,
      groupTitle: group.title,
    })
    if (!created) return
    setAddingInGroup(false)
    setSelectedGroupId(group.groupId)
    openDrawingWindow(created)
    onBack()
  }

  const handleDuplicateWindow = async (entry: WorkspaceEntry) => {
    const created = await duplicateWindow(entry.id)
    if (!created) return
    openDrawingWindow(created)
    onBack()
  }

  const handleDeleteWindow = async (entry: WorkspaceEntry) => {
    if (confirmDeleteWindowId !== entry.id) {
      setConfirmDeleteWindowId(entry.id)
      return
    }
    await deleteRecord(entry.id)
    setConfirmDeleteWindowId(null)
    if (useWorkbenchStore.getState().workspaceRecordId === entry.id) {
      useWorkbenchStore.getState().setWorkspaceRecordId(null)
    }
  }

  const handleDeleteGroup = async (group: ExperimentGroupSummary) => {
    if (confirmDeleteGroupId !== group.groupId) {
      setConfirmDeleteGroupId(group.groupId)
      return
    }
    const containsCurrent = group.windows.some((item) => item.id === currentRecordId)
    await deleteGroup(group.groupId)
    setConfirmDeleteGroupId(null)
    if (containsCurrent) {
      useWorkbenchStore.getState().setWorkspaceRecordId(null)
      useWorkbenchStore.getState().setActiveGroup(null, null)
    }
  }

  const totalWindows = entries.length
  const totalGroups = allGroups.length

  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={FAST_TRANSITION}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-canvas/40"
      aria-label="科研工作区"
    >
      <header className="flex flex-none flex-wrap items-center justify-between gap-3 border-b border-line bg-panel/75 px-5 py-3.5 backdrop-blur-sm">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 flex-none place-items-center rounded-[10px] border border-accent-line bg-accent-soft text-accent-strong">
            <WorkspaceIcon className="size-4" />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <h1 className="m-0 text-[15px] font-[650] text-ink">科研工作区</h1>
              <span className="rounded-[5px] border border-line bg-surface-soft px-1.5 py-px font-mono text-[9.5px] text-ink-faint">
                {totalGroups} 个实验 · {totalWindows} 个绘画窗口
              </span>
            </div>
            <p className="m-0 text-[11px] text-ink-faint">
              每次绘图独立成窗统一管理；同一实验内可并行创建多个绘画窗口进行对比探索
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-[9px] border border-line bg-surface-soft/75 p-0.5">
            {(['windows', 'sessions'] as const).map((item) => (
              <button
                key={item}
                className={`relative rounded-[7px] px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  section === item ? 'text-ink' : 'text-ink-faint hover:text-ink-dim'
                }`}
                type="button"
                onClick={() => setSection(item)}
              >
                {section === item && (
                  <motion.span
                    layoutId="workspace-page-section-pill"
                    transition={SPRING_SNAPPY}
                    className="absolute inset-0 rounded-[7px] bg-surface shadow-[0_1px_2px_rgba(58,51,43,0.08)]"
                  />
                )}
                <span className="relative z-[1]">
                  {item === 'windows' ? '实验与绘画窗口' : 'SQLite 会话历史'}
                </span>
              </button>
            ))}
          </div>

          <motion.button
            whileTap={TAP_BUTTON}
            className="flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[11.5px] text-ink-dim transition-colors hover:border-line-strong hover:bg-surface-soft hover:text-ink"
            type="button"
            onClick={() => setCreatingExperiment((current) => !current)}
          >
            <PlusIcon className="size-3.5" />
            新建实验组
          </motion.button>

          <motion.button
            whileTap={TAP_BUTTON}
            className={`${PRIMARY_BUTTON} flex items-center gap-1.5`}
            type="button"
            onClick={() => void handleQuickNewStandalone()}
          >
            <PlusIcon className="size-3.5" />
            新开绘画窗口
          </motion.button>

          <motion.button
            whileTap={TAP_BUTTON}
            className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[11.5px] text-ink-dim transition-colors hover:border-line-strong hover:bg-surface-soft hover:text-ink"
            type="button"
            onClick={onBack}
          >
            返回画布
          </motion.button>
        </div>
      </header>

      {storageError && (
        <div className="flex flex-none items-start gap-2 border-b border-rose/25 bg-rose/[0.08] px-5 py-2">
          <span className="mt-1 size-1.5 flex-none rounded-full bg-danger" />
          <p className="m-0 text-[11px] text-[#a9605f]" role="alert">
            {storageError.message}
          </p>
        </div>
      )}

      <AnimatePresence>
        {creatingExperiment && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={FAST_TRANSITION}
            className="flex-none overflow-hidden border-b border-line bg-surface/85"
          >
            <div className="flex flex-wrap items-end gap-3 px-5 py-3">
              <label className="flex min-w-[200px] flex-1 flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
                  实验组名称
                </span>
                <input
                  className={INPUT_CLASS}
                  value={newExperimentTitle}
                  maxLength={80}
                  autoFocus
                  placeholder="例如：阻尼振动参数对比实验"
                  onChange={(event) => setNewExperimentTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void handleCreateStandaloneExperiment()
                    } else if (event.key === 'Escape') {
                      setCreatingExperiment(false)
                    }
                  }}
                />
              </label>

              <label className="flex min-w-[200px] flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
                  首个绘画窗口起点
                </span>
                <select
                  className={INPUT_CLASS}
                  value={newExperimentPresetId}
                  onChange={(event) => setNewExperimentPresetId(event.target.value)}
                >
                  {EXPERIMENTS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}（{item.domain}）
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex items-center gap-2">
                <motion.button
                  whileTap={TAP_BUTTON}
                  className={PRIMARY_BUTTON}
                  type="button"
                  onClick={() => void handleCreateStandaloneExperiment()}
                >
                  创建并打开
                </motion.button>
                <button
                  className={SMALL_BUTTON}
                  type="button"
                  onClick={() => setCreatingExperiment(false)}
                >
                  取消
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {section === 'sessions' ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-1 py-1">
          <SessionHistoryTab onClose={onBack} />
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[290px_minmax(0,1fr)] lg:grid-cols-[320px_minmax(0,1fr)]">
          {/* 左侧：实验组列表（Codex Workspaces / Claude Projects 风格） */}
          <div className="flex min-h-0 flex-col border-b border-line bg-panel/55 md:border-b-0 md:border-r">
            <div className="flex flex-none flex-col gap-2 border-b border-line px-3.5 py-3">
              <input
                className={INPUT_CLASS}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索实验或绘画窗口…"
                aria-label="搜索实验或绘画窗口"
              />
              <div className="flex flex-wrap gap-1">
                {(
                  [
                    ['all', '全部'],
                    ['favorites', '收藏'],
                    ['ai', 'AI 绘画'],
                    ['preset', '预设'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={`relative rounded-md px-2 py-[3px] text-[10.5px] transition-colors ${
                      filter === key ? 'text-accent-strong' : 'text-ink-faint hover:text-ink-dim'
                    }`}
                    onClick={() => setFilter(key)}
                    aria-pressed={filter === key}
                  >
                    {filter === key && (
                      <motion.span
                        layoutId="workspace-page-filter-pill"
                        transition={SPRING_SNAPPY}
                        className="absolute inset-0 rounded-md bg-accent-soft"
                      />
                    )}
                    <span className="relative z-[1]">{label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="preset-scroll flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-3">
              {hydrating ? (
                <div className="py-10 text-center text-[11px] text-ink-faint">
                  正在读取本地工作区…
                </div>
              ) : visibleGroups.length === 0 ? (
                <div className="flex flex-col items-center gap-1.5 rounded-[10px] border border-dashed border-line-strong/60 bg-surface/40 px-3 py-8 text-center">
                  <span className="text-[11.5px] text-ink-dim">没有匹配的实验</span>
                  <span className="text-[10px] leading-[1.55] text-ink-faint">
                    点击右上角「新开绘画窗口」或在左侧 AI 沙盒直接绘图，会自动创建新窗口。
                  </span>
                </div>
              ) : (
                visibleGroups.map((group) => {
                  const selected = group.groupId === effectiveGroupId
                  const hasActiveWindow = group.windows.some((w) => w.id === currentRecordId)
                  const openCount = group.windows.filter((w) => openWindowIds.includes(w.id)).length
                  return (
                    <button
                      key={group.groupId}
                      type="button"
                      onClick={() => {
                        setSelectedGroupId(group.groupId)
                        setAddingInGroup(false)
                        setConfirmDeleteGroupId(null)
                      }}
                      className={`flex flex-col gap-1 rounded-[10px] border px-3 py-2.5 text-left transition-colors ${
                        selected
                          ? 'border-accent-line bg-accent-soft/55 shadow-[0_1px_3px_rgba(58,51,43,0.06)]'
                          : 'border-line bg-surface/70 hover:border-line-strong hover:bg-surface'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-[12px] font-[600] text-ink">
                          {group.title}
                        </span>
                        <span className="flex-none rounded-[5px] border border-line bg-surface-soft px-1.5 py-px font-mono text-[9px] text-ink-dim">
                          {group.windows.length} 窗
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-[9.5px] text-ink-faint">
                        <span className="truncate">{group.domain}</span>
                        <span>·</span>
                        <span>{formatTimestamp(group.updatedAt)}</span>
                      </div>
                      {(hasActiveWindow || openCount > 0 || group.favoriteCount > 0) && (
                        <div className="mt-0.5 flex flex-wrap items-center gap-1">
                          {hasActiveWindow && (
                            <span className="rounded-[4px] border border-accent-line bg-accent-soft px-1.5 py-px font-mono text-[8.5px] text-accent-strong">
                              当前画布
                            </span>
                          )}
                          {openCount > 0 && (
                            <span className="rounded-[4px] border border-mint/40 bg-mint/[0.12] px-1.5 py-px font-mono text-[8.5px] text-[#4f7a63]">
                              {openCount} 个已打开
                            </span>
                          )}
                          {group.favoriteCount > 0 && (
                            <span className="rounded-[4px] border border-[rgba(217,162,74,0.4)] bg-butter/20 px-1.5 py-px font-mono text-[8.5px] text-[#8a6a2f]">
                              {group.favoriteCount} 收藏
                            </span>
                          )}
                        </div>
                      )}
                    </button>
                  )
                })
              )}
            </div>
          </div>

          {/* 右侧：选中实验组内的全部绘画窗口 */}
          <div className="flex min-h-0 flex-col overflow-hidden">
            {!selectedGroup ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
                <span className="text-[13px] font-medium text-ink-dim">
                  选择一个实验查看其中的绘画窗口
                </span>
                <span className="max-w-[40ch] text-[11px] leading-[1.6] text-ink-faint">
                  默认每次绘图都会新开一个绘画窗口；你也可以在同一个实验里并行创建多个绘画窗口，方便对比不同参数、机理或微调分支。
                </span>
              </div>
            ) : (
              <>
                <div className="flex flex-none flex-wrap items-center justify-between gap-2 border-b border-line bg-surface/50 px-5 py-3">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    {renamingGroupId === selectedGroup.groupId ? (
                      <div className="flex max-w-[380px] items-center gap-1.5">
                        <input
                          className={INPUT_CLASS}
                          value={renameGroupValue}
                          maxLength={80}
                          autoFocus
                          aria-label="实验名称"
                          onChange={(event) => setRenameGroupValue(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              void renameGroup(selectedGroup.groupId, renameGroupValue)
                              setRenamingGroupId(null)
                            } else if (event.key === 'Escape') {
                              setRenamingGroupId(null)
                            }
                          }}
                        />
                        <button
                          className={SMALL_BUTTON}
                          type="button"
                          onClick={() => {
                            void renameGroup(selectedGroup.groupId, renameGroupValue)
                            setRenamingGroupId(null)
                          }}
                        >
                          保存
                        </button>
                        <button
                          className={SMALL_BUTTON}
                          type="button"
                          onClick={() => setRenamingGroupId(null)}
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <h2 className="m-0 truncate text-[14px] font-[650] text-ink">
                          {selectedGroup.title}
                        </h2>
                        <span className="rounded-[5px] border border-line bg-surface px-1.5 py-px font-mono text-[9.5px] text-ink-faint">
                          {selectedGroup.windows.length} 个绘画窗口
                        </span>
                      </div>
                    )}
                    <span className="text-[10.5px] text-ink-faint">
                      {selectedGroup.domain} · 最近更新 {formatTimestamp(selectedGroup.updatedAt)}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <motion.button
                      whileTap={TAP_BUTTON}
                      className={`${PRIMARY_BUTTON} flex items-center gap-1`}
                      type="button"
                      onClick={() => setAddingInGroup((current) => !current)}
                    >
                      <PlusIcon className="size-3" />
                      在本实验新增绘画
                    </motion.button>
                    <button
                      className={SMALL_BUTTON}
                      type="button"
                      onClick={() => {
                        setRenamingGroupId(selectedGroup.groupId)
                        setRenameGroupValue(selectedGroup.title)
                      }}
                    >
                      重命名实验
                    </button>
                    <button
                      className={DANGER_BUTTON}
                      type="button"
                      onClick={() => void handleDeleteGroup(selectedGroup)}
                    >
                      {confirmDeleteGroupId === selectedGroup.groupId ? '确认删除实验' : '删除实验'}
                    </button>
                  </div>
                </div>

                <AnimatePresence>
                  {addingInGroup && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={FAST_TRANSITION}
                      className="flex-none overflow-hidden border-b border-line bg-accent-soft/25"
                    >
                      <div className="flex flex-wrap items-center gap-2.5 px-5 py-2.5">
                        <span className="text-[11px] font-medium text-ink-dim">
                          选择新绘画窗口的起始画布：
                        </span>
                        <select
                          className="rounded-[8px] border border-line bg-surface px-2.5 py-1.5 text-[11px] text-ink focus:border-accent-line focus:outline-none"
                          value={addInGroupPresetId}
                          onChange={(event) => setAddInGroupPresetId(event.target.value)}
                        >
                          {EXPERIMENTS.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.title}
                            </option>
                          ))}
                        </select>
                        <motion.button
                          whileTap={TAP_BUTTON}
                          className={PRIMARY_BUTTON}
                          type="button"
                          onClick={() =>
                            void handleAddWindowInGroup(selectedGroup, addInGroupPresetId)
                          }
                        >
                          添加并打开窗口
                        </motion.button>
                        <button
                          className={SMALL_BUTTON}
                          type="button"
                          onClick={() => setAddingInGroup(false)}
                        >
                          取消
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <AnimatePresence>
                  {loadError && (
                    <motion.p
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={FAST_TRANSITION}
                      className="mx-5 mb-0 mt-3 flex-none rounded-[8px] border border-rose/30 bg-rose/[0.08] px-3 py-2 text-[11px] text-[#a9605f]"
                      role="alert"
                    >
                      {loadError}
                    </motion.p>
                  )}
                </AnimatePresence>

                <div className="preset-scroll grid min-h-0 flex-1 auto-rows-max grid-cols-1 gap-3 overflow-y-auto p-5 xl:grid-cols-2">
                  {selectedGroup.windows.map((entry) => {
                    const current = entry.id === currentRecordId
                    const isOpenTab = openWindowIds.includes(entry.id)
                    const unsupported = entry.status === 'unsupported'
                    const renaming = renamingWindowId === entry.id
                    const entryGroupId = resolveRecordGroupId(entry)

                    return (
                      <motion.article
                        key={entry.id}
                        layout="position"
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={FAST_TRANSITION}
                        className={`flex flex-col gap-2.5 rounded-[12px] border p-3.5 transition-colors ${
                          current
                            ? 'border-accent-line bg-accent-soft/45 shadow-[0_4px_14px_rgba(58,51,43,0.06)]'
                            : 'border-line bg-surface/85 hover:border-line-strong'
                        }`}
                      >
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={`rounded-[5px] border px-1.5 py-px font-mono text-[9px] ${
                              entry.source === 'ai'
                                ? 'border-[rgba(138,118,168,0.32)] bg-[rgba(138,118,168,0.09)] text-[#6d5a7d]'
                                : 'border-line bg-surface-soft text-ink-faint'
                            }`}
                          >
                            {entry.source === 'ai' ? 'AI 绘画' : '预设画布'}
                          </span>
                          {current && (
                            <span className="rounded-[5px] border border-accent-line bg-accent-soft px-1.5 py-px font-mono text-[9px] text-accent-strong">
                              当前激活
                            </span>
                          )}
                          {!current && isOpenTab && (
                            <span className="rounded-[5px] border border-mint/40 bg-mint/[0.12] px-1.5 py-px font-mono text-[9px] text-[#4f7a63]">
                              窗口已打开
                            </span>
                          )}
                          {entry.favorite && (
                            <span className="rounded-[5px] border border-[rgba(217,162,74,0.4)] bg-butter/20 px-1.5 py-px font-mono text-[9px] text-[#8a6a2f]">
                              收藏
                            </span>
                          )}
                          {unsupported && (
                            <span className="rounded-[5px] border border-rose/40 bg-rose/[0.1] px-1.5 py-px font-mono text-[9px] text-[#a9605f]">
                              不可用
                            </span>
                          )}
                        </div>

                        {renaming ? (
                          <div className="flex items-center gap-1.5">
                            <input
                              className={INPUT_CLASS}
                              value={renameWindowValue}
                              maxLength={80}
                              autoFocus
                              aria-label="绘画窗口名称"
                              onChange={(event) => setRenameWindowValue(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault()
                                  void renameRecord(entry.id, renameWindowValue)
                                  setRenamingWindowId(null)
                                } else if (event.key === 'Escape') {
                                  setRenamingWindowId(null)
                                }
                              }}
                            />
                            <button
                              className={SMALL_BUTTON}
                              type="button"
                              onClick={() => {
                                void renameRecord(entry.id, renameWindowValue)
                                setRenamingWindowId(null)
                              }}
                            >
                              保存
                            </button>
                            <button
                              className={SMALL_BUTTON}
                              type="button"
                              onClick={() => setRenamingWindowId(null)}
                            >
                              取消
                            </button>
                          </div>
                        ) : (
                          <button
                            className="w-fit max-w-full truncate text-left text-[13px] font-[600] leading-[1.4] text-ink enabled:hover:text-accent-strong disabled:cursor-default"
                            type="button"
                            disabled={unsupported}
                            onClick={() => handleOpenWindow(entry)}
                            title={unsupported ? entry.issue : '在画布中打开该绘画窗口'}
                          >
                            {entry.title}
                          </button>
                        )}

                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[10px] text-ink-faint">
                          <span>{entry.domain}</span>
                          <span>·</span>
                          <span>{formatTimestamp(entry.updatedAt)}</span>
                          {entry.source === 'ai' && (
                            <>
                              <span>·</span>
                              <span className="font-mono">代码 v{entry.codeVersion || 1}</span>
                            </>
                          )}
                          <span>·</span>
                          <span className="font-mono">倍速 {entry.speed}x</span>
                        </div>

                        {entry.issue && (
                          <p className="m-0 rounded-[7px] border border-rose/25 bg-rose/[0.06] px-2.5 py-1.5 text-[10px] leading-[1.55] text-[#a9605f]">
                            {entry.issue}
                          </p>
                        )}

                        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
                          {unsupported ? (
                            <>
                              <button
                                className={SMALL_BUTTON}
                                type="button"
                                onClick={() => downloadBackup(entry)}
                              >
                                导出备份
                              </button>
                              <button
                                className={DANGER_BUTTON}
                                type="button"
                                onClick={() => void handleDeleteWindow(entry)}
                              >
                                {confirmDeleteWindowId === entry.id ? '确认删除' : '删除'}
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                className="rounded-md border border-transparent bg-accent-strong px-2.5 py-[4px] text-[10.5px] font-semibold text-[#fbf7ef] transition-colors hover:bg-accent"
                                type="button"
                                onClick={() => handleOpenWindow(entry)}
                              >
                                {current ? '回到窗口' : '打开窗口'}
                              </button>
                              <button
                                className={`${SMALL_BUTTON} flex items-center gap-1`}
                                type="button"
                                title="在同一实验内复制一个新的绘画窗口"
                                onClick={() => void handleDuplicateWindow(entry)}
                              >
                                <DuplicateIcon className="size-3" />
                                复制新窗
                              </button>
                              <button
                                className={SMALL_BUTTON}
                                type="button"
                                onClick={() => void toggleFavorite(entry.id)}
                              >
                                {entry.favorite ? '取消收藏' : '收藏'}
                              </button>
                              <button
                                className={SMALL_BUTTON}
                                type="button"
                                onClick={() => {
                                  setRenamingWindowId(entry.id)
                                  setRenameWindowValue(entry.title)
                                  setConfirmDeleteWindowId(null)
                                }}
                              >
                                重命名
                              </button>
                              {allGroups.length > 1 && (
                                <select
                                  aria-label="移动到其他实验"
                                  className="rounded-md border border-line bg-surface px-1.5 py-[3.5px] text-[10px] text-ink-dim focus:border-accent-line focus:outline-none"
                                  value={entryGroupId}
                                  onChange={(event) => {
                                    const targetGroup = allGroups.find(
                                      (g) => g.groupId === event.target.value,
                                    )
                                    if (!targetGroup) return
                                    void moveWindowToGroup(
                                      entry.id,
                                      targetGroup.groupId,
                                      targetGroup.title,
                                    )
                                  }}
                                >
                                  {allGroups.map((group) => (
                                    <option key={group.groupId} value={group.groupId}>
                                      移至：{group.title}
                                    </option>
                                  ))}
                                </select>
                              )}
                              <button
                                className={DANGER_BUTTON}
                                type="button"
                                onClick={() => void handleDeleteWindow(entry)}
                              >
                                {confirmDeleteWindowId === entry.id ? '确认删除' : '删除'}
                              </button>
                            </>
                          )}
                        </div>
                      </motion.article>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <footer className="flex flex-none flex-wrap items-center justify-between gap-2 border-t border-line bg-panel/75 px-5 py-2 text-[10px] text-ink-faint">
        <span>
          {storageError
            ? '本地保存不可用'
            : saving
              ? '保存中…'
              : lastSavedAt
                ? `最近保存 ${formatTimestamp(lastSavedAt)}`
                : hydrated
                  ? 'IndexedDB 自动保存已启用 · SQLite 会话持久化已就绪'
                  : '本地工作区加载中…'}
        </span>
        <AnimatePresence mode="wait" initial={false}>
          {feedback ? (
            <motion.span
              key={`feedback-${feedback.at}`}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={FAST_TRANSITION}
              className={feedback.tone === 'error' ? 'text-[#a9605f]' : 'text-[#4f7a63]'}
              role="status"
            >
              {feedback.message}
            </motion.span>
          ) : (
            <motion.span
              key="feedback-default"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={FAST_TRANSITION}
            >
              关闭窗口标签不会删除工作区记录，随时可重新打开
            </motion.span>
          )}
        </AnimatePresence>
      </footer>
    </motion.section>
  )
}
