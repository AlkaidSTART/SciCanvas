import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { getExperimentById } from '../experiments'
import { sanitizeExportFileName } from '../export/html'
import { useWorkbenchStore } from '../store/useWorkbenchStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { maskApiKey } from '../workspace/modelConfig'
import type { ModelConfigDraft, WorkspaceEntry } from '../workspace/types'

interface WorkspaceDialogProps {
  onClose: () => void
}

const SMALL_BUTTON =
  'rounded-md border border-line bg-surface px-2 py-[3px] text-[10px] text-ink-dim transition-colors enabled:hover:border-line-strong enabled:hover:bg-surface-soft enabled:hover:text-ink disabled:cursor-not-allowed disabled:opacity-45'
const DANGER_BUTTON =
  'rounded-md border border-rose/40 bg-rose/[0.08] px-2 py-[3px] text-[10px] text-[#a9605f] transition-colors hover:bg-rose/[0.16]'
const INPUT_CLASS =
  'w-full rounded-[8px] border border-line bg-surface-soft px-2.5 py-[7px] text-[11.5px] text-ink placeholder:text-ink-faint focus:border-accent-line focus:outline-none'

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

/** 不可读记录导出一份原始 JSON，方便用户留档后再删除。 */
function downloadBackup(entry: WorkspaceEntry): void {
  const payload = entry.raw ?? {
    id: entry.id,
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

export function WorkspaceDialog({ onClose }: WorkspaceDialogProps) {
  const entries = useWorkspaceStore((state) => state.entries)
  const hydrated = useWorkspaceStore((state) => state.hydrated)
  const hydrating = useWorkspaceStore((state) => state.hydrating)
  const modelConfig = useWorkspaceStore((state) => state.modelConfig)
  const storageError = useWorkspaceStore((state) => state.storageError)
  const saving = useWorkspaceStore((state) => state.saving)
  const lastSavedAt = useWorkspaceStore((state) => state.lastSavedAt)
  const feedback = useWorkspaceStore((state) => state.feedback)
  const renameRecord = useWorkspaceStore((state) => state.renameRecord)
  const toggleFavorite = useWorkspaceStore((state) => state.toggleFavorite)
  const deleteRecord = useWorkspaceStore((state) => state.deleteRecord)
  const saveModelConfig = useWorkspaceStore((state) => state.saveModelConfig)
  const clearModelConfig = useWorkspaceStore((state) => state.clearModelConfig)
  const clearFeedback = useWorkspaceStore((state) => state.clearFeedback)
  const currentRecordId = useWorkbenchStore((state) => state.workspaceRecordId)

  const [tab, setTab] = useState<'records' | 'settings'>('records')
  const [filter, setFilter] = useState<'all' | 'favorites'>('all')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showKey, setShowKey] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [draft, setDraft] = useState<ModelConfigDraft>(() => {
    const config = useWorkspaceStore.getState().modelConfig
    return {
      apiKey: config?.apiKey ?? '',
      baseUrl: config?.baseUrl ?? '',
      model: config?.model ?? '',
    }
  })

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  useEffect(() => {
    if (!feedback) return undefined
    const timer = window.setTimeout(() => clearFeedback(), 4000)
    return () => window.clearTimeout(timer)
  }, [feedback, clearFeedback])

  if (!open) return null

  const visibleEntries =
    filter === 'favorites' ? entries.filter((entry) => entry.favorite) : entries
  const favoriteCount = entries.filter((entry) => entry.favorite).length

  const handleOpenEntry = (entry: WorkspaceEntry) => {
    if (entry.status === 'unsupported') return
    setLoadError(null)
    const workbench = useWorkbenchStore.getState()

    if (entry.source === 'ai') {
      if (!entry.spec) {
        setLoadError('该记录缺少代码版本，无法恢复运行；可导出备份后删除。')
        return
      }
      workbench.applyGeneratedExperiment(entry.spec, entry.params, { recordId: entry.id })
      workbench.setSpeed(entry.speed)
    } else {
      if (!getExperimentById(entry.experimentId)) {
        setLoadError('对应的预设实验已不存在；可导出备份后删除该记录。')
        return
      }
      workbench.selectExperiment(entry.experimentId, { recordId: entry.id })
      workbench.setParams(entry.params)
      workbench.setSpeed(entry.speed)
    }
    onClose()
  }

  const beginRename = (entry: WorkspaceEntry) => {
    setRenamingId(entry.id)
    setRenameValue(entry.title)
    setConfirmDeleteId(null)
  }

  const commitRename = async (entry: WorkspaceEntry) => {
    await renameRecord(entry.id, renameValue)
    setRenamingId(null)
  }

  const handleDelete = async (entry: WorkspaceEntry) => {
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

  const handleSaveConfig = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setConfirmClear(false)
    await saveModelConfig(draft)
  }

  const handleClearConfig = async () => {
    if (!confirmClear) {
      setConfirmClear(true)
      return
    }
    await clearModelConfig()
    setConfirmClear(false)
    if (useWorkspaceStore.getState().modelConfig === null) {
      setDraft({ apiKey: '', baseUrl: '', model: '' })
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(58,51,43,0.34)] p-4 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className="flex max-h-[min(760px,92vh)] w-[min(820px,100%)] flex-col overflow-hidden rounded-[16px] border border-line bg-panel shadow-[0_30px_80px_rgba(58,51,43,0.28)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-title"
      >
        <header className="flex flex-none flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h2 id="workspace-title" className="m-0 text-[14px] font-[650] text-ink">
              本地科研工作区
            </h2>
            <p className="m-0 text-[10px] text-ink-faint">
              仅保存在当前浏览器 IndexedDB · 无需账号
            </p>
          </div>

          <div className="flex items-center gap-1 rounded-[9px] border border-line bg-surface-soft/70 p-0.5">
            <button
              className={`rounded-[7px] px-2.5 py-1 text-[11px] transition-colors ${
                tab === 'records'
                  ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(58,51,43,0.08)]'
                  : 'text-ink-faint hover:text-ink-dim'
              }`}
              type="button"
              onClick={() => setTab('records')}
            >
              实验记录
            </button>
            <button
              className={`rounded-[7px] px-2.5 py-1 text-[11px] transition-colors ${
                tab === 'settings'
                  ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(58,51,43,0.08)]'
                  : 'text-ink-faint hover:text-ink-dim'
              }`}
              type="button"
              onClick={() => setTab('settings')}
            >
              模型配置
            </button>
          </div>

          <button
            className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[11px] text-ink-dim transition-colors hover:border-line-strong hover:bg-surface-soft hover:text-ink"
            type="button"
            onClick={onClose}
            aria-label="关闭本地工作区"
          >
            关闭
          </button>
        </header>

        {storageError && (
          <div className="flex flex-none items-start gap-2 border-b border-rose/25 bg-rose/[0.08] px-4 py-2.5">
            <span className="mt-1 size-1.5 flex-none rounded-full bg-danger" />
            <p className="m-0 text-[10.5px] leading-[1.6] text-[#a9605f]" role="alert">
              {storageError.message}
            </p>
          </div>
        )}

        {tab === 'records' ? (
          <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden px-4 py-3">
            <div className="flex flex-none items-center justify-between gap-2">
              <span className="text-[10px] text-ink-faint">
                {hydrating
                  ? '正在读取本地记录…'
                  : `${entries.length} 条记录 · ${favoriteCount} 条收藏`}
              </span>
              <div className="flex gap-1">
                <button
                  className={`rounded-md px-2 py-[3px] text-[10px] transition-colors ${
                    filter === 'all'
                      ? 'bg-accent-soft text-accent-strong'
                      : 'text-ink-faint hover:text-ink-dim'
                  }`}
                  type="button"
                  onClick={() => setFilter('all')}
                  aria-pressed={filter === 'all'}
                >
                  全部
                </button>
                <button
                  className={`rounded-md px-2 py-[3px] text-[10px] transition-colors ${
                    filter === 'favorites'
                      ? 'bg-accent-soft text-accent-strong'
                      : 'text-ink-faint hover:text-ink-dim'
                  }`}
                  type="button"
                  onClick={() => setFilter('favorites')}
                  aria-pressed={filter === 'favorites'}
                >
                  收藏
                </button>
              </div>
            </div>

            {loadError && (
              <p
                className="m-0 flex-none rounded-[8px] border border-rose/30 bg-rose/[0.08] px-2.5 py-2 text-[10.5px] leading-[1.55] text-[#a9605f]"
                role="alert"
              >
                {loadError}
              </p>
            )}

            <div className="preset-scroll flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
              {visibleEntries.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-1.5 rounded-[11px] border border-dashed border-line-strong/60 bg-surface/40 px-4 py-10 text-center">
                  <span className="text-[12px] text-ink-dim">
                    {filter === 'favorites' ? '还没有收藏记录' : '还没有本地记录'}
                  </span>
                  <span className="max-w-[36ch] text-[10px] leading-[1.6] text-ink-faint">
                    切换预设或生成 AI 实验后会自动保存；拖动参数停止后也会写入最近状态。
                  </span>
                </div>
              ) : (
                visibleEntries.map((entry) => {
                  const current = entry.id === currentRecordId
                  const unsupported = entry.status === 'unsupported'
                  const renaming = renamingId === entry.id
                  return (
                    <article
                      key={entry.id}
                      className={`flex flex-col gap-2 rounded-[11px] border px-3 py-2.5 ${
                        current
                          ? 'border-accent-line bg-accent-soft/45'
                          : 'border-line bg-surface/70'
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
                          {entry.source === 'ai' ? 'AI 生成' : '预设'}
                        </span>
                        {entry.favorite && (
                          <span className="rounded-[5px] border border-[rgba(217,162,74,0.4)] bg-butter/20 px-1.5 py-px font-mono text-[9px] text-[#8a6a2f]">
                            收藏
                          </span>
                        )}
                        {current && (
                          <span className="rounded-[5px] border border-accent-line bg-accent-soft px-1.5 py-px font-mono text-[9px] text-accent-strong">
                            当前
                          </span>
                        )}
                        {entry.status === 'migrated' && (
                          <span className="rounded-[5px] border border-mint/40 bg-mint/[0.12] px-1.5 py-px font-mono text-[9px] text-[#4f7a63]">
                            已升级
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
                            value={renameValue}
                            maxLength={80}
                            autoFocus
                            aria-label="记录名称"
                            onChange={(event) => setRenameValue(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault()
                                void commitRename(entry)
                              } else if (event.key === 'Escape') {
                                setRenamingId(null)
                              }
                            }}
                          />
                          <button
                            className={SMALL_BUTTON}
                            type="button"
                            onClick={() => void commitRename(entry)}
                          >
                            保存
                          </button>
                          <button
                            className={SMALL_BUTTON}
                            type="button"
                            onClick={() => setRenamingId(null)}
                          >
                            取消
                          </button>
                        </div>
                      ) : (
                        <button
                          className="w-fit max-w-full truncate text-left text-[12.5px] font-[550] leading-[1.4] text-ink enabled:hover:text-accent-strong disabled:cursor-default"
                          type="button"
                          disabled={unsupported}
                          onClick={() => handleOpenEntry(entry)}
                          title={unsupported ? entry.issue : '打开该记录'}
                        >
                          {entry.title}
                        </button>
                      )}

                      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[9.5px] text-ink-faint">
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
                        <span className="font-mono">结构 v{entry.schemaVersion}</span>
                      </div>

                      {entry.issue && (
                        <p className="m-0 rounded-[7px] border border-rose/25 bg-rose/[0.06] px-2 py-1.5 text-[10px] leading-[1.55] text-[#a9605f]">
                          {entry.issue}
                        </p>
                      )}

                      <div className="flex flex-wrap items-center gap-1.5">
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
                              onClick={() => void handleDelete(entry)}
                            >
                              {confirmDeleteId === entry.id ? '确认删除' : '删除'}
                            </button>
                          </>
                        ) : (
                          <>
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
                              onClick={() => handleOpenEntry(entry)}
                            >
                              打开
                            </button>
                            <button
                              className={SMALL_BUTTON}
                              type="button"
                              onClick={() => beginRename(entry)}
                            >
                              重命名
                            </button>
                            <button
                              className={DANGER_BUTTON}
                              type="button"
                              onClick={() => void handleDelete(entry)}
                            >
                              {confirmDeleteId === entry.id ? '确认删除' : '删除'}
                            </button>
                          </>
                        )}
                      </div>
                    </article>
                  )
                })
              )}
            </div>
          </div>
        ) : (
          <div className="preset-scroll min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <div className="rounded-[10px] border border-[rgba(217,162,74,0.35)] bg-butter/15 px-3 py-2.5 text-[10.5px] leading-[1.6] text-[#8a6a2f]">
              配置只写入当前浏览器的 IndexedDB，不写入 localStorage、Cookie，也不会保存到服务端。清除浏览器站点数据会一并删除。
            </div>

            <form className="mt-3 flex flex-col gap-3" onSubmit={handleSaveConfig}>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-faint">
                  模型 API Key
                </span>
                <div className="flex gap-1.5">
                  <input
                    className={INPUT_CLASS}
                    type={showKey ? 'text' : 'password'}
                    value={draft.apiKey}
                    maxLength={512}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="sk-..."
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, apiKey: event.target.value }))
                    }
                  />
                  <button
                    className={SMALL_BUTTON}
                    type="button"
                    onClick={() => setShowKey((current) => !current)}
                  >
                    {showKey ? '隐藏' : '显示'}
                  </button>
                </div>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-faint">
                  第三方 API 端点
                </span>
                <input
                  className={INPUT_CLASS}
                  type="url"
                  value={draft.baseUrl}
                  maxLength={500}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="https://api.example.com/v1"
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, baseUrl: event.target.value }))
                  }
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-faint">
                  默认模型
                </span>
                <input
                  className={INPUT_CLASS}
                  type="text"
                  value={draft.model}
                  maxLength={120}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="留空则使用部署方默认模型"
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, model: event.target.value }))
                  }
                />
              </label>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  className="rounded-lg border border-transparent bg-accent-strong px-3.5 py-[7px] text-xs font-semibold text-[#fbf7ef] transition-colors hover:bg-accent"
                  type="submit"
                >
                  保存配置
                </button>
                <button
                  className={confirmClear ? DANGER_BUTTON : SMALL_BUTTON}
                  type="button"
                  disabled={!modelConfig && !draft.apiKey && !draft.baseUrl && !draft.model}
                  onClick={() => void handleClearConfig()}
                >
                  {confirmClear ? '确认清除' : '清除配置'}
                </button>
                {confirmClear && (
                  <button className={SMALL_BUTTON} type="button" onClick={() => setConfirmClear(false)}>
                    取消
                  </button>
                )}
              </div>
            </form>

            {modelConfig && (
              <p className="m-0 mt-3 rounded-[8px] border border-line bg-surface/60 px-2.5 py-2 text-[10px] leading-[1.6] text-ink-faint">
                当前已保存：密钥 {maskApiKey(modelConfig.apiKey) || '为空'} · 端点{' '}
                {modelConfig.baseUrl || '默认'} · 模型 {modelConfig.model || '默认'}
              </p>
            )}
          </div>
        )}

        <footer className="flex flex-none flex-wrap items-center justify-between gap-2 border-t border-line bg-surface-soft/50 px-4 py-2.5 text-[10px] text-ink-faint">
          <span>
            {storageError
              ? '本地保存不可用'
              : saving
                ? '保存中…'
                : lastSavedAt
                  ? `最近保存 ${formatTimestamp(lastSavedAt)}`
                  : hydrated
                    ? '自动保存已启用'
                    : '本地工作区加载中…'}
          </span>
          {feedback ? (
            <span
              className={
                feedback.tone === 'error' ? 'text-[#a9605f]' : 'text-[#4f7a63]'
              }
              role="status"
            >
              {feedback.message}
            </span>
          ) : (
            <span>刷新页面后记录仍会保留</span>
          )}
        </footer>
      </div>
    </div>
  )
}
