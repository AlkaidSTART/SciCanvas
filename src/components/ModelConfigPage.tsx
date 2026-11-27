import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { validateLlmEndpointInput } from '../models/presets'
import { LLM_API_FORMAT_OPTIONS } from '../models/types'
import type { LlmApiFormat, LlmEndpointConfig } from '../models/types'
import { useModelConfigStore } from '../store/useModelConfigStore'
import { ModelIcon } from './icons'
import { FAST_TRANSITION, TAP_BUTTON } from './motion'

interface ModelConfigPageProps {
  onBack: () => void
}

interface EndpointDraft {
  id?: string
  name: string
  providerId: string
  isPreset: boolean
  isActive: boolean
  baseUrl: string
  apiKey: string
  model: string
  visionModel: string
  apiFormat: LlmApiFormat
}

interface FeedbackBanner {
  tone: 'success' | 'error'
  text: string
}

const INPUT_CLASS =
  'w-full rounded-[9px] border border-line bg-surface-soft px-3 py-2 text-[12.5px] text-ink placeholder:text-ink-faint focus:border-accent-line focus:outline-none'

function createDraftFromEndpoint(endpoint: LlmEndpointConfig): EndpointDraft {
  return {
    id: endpoint.id,
    name: endpoint.name,
    providerId: endpoint.providerId,
    isPreset: false,
    isActive: endpoint.isActive,
    baseUrl: endpoint.baseUrl,
    apiKey: endpoint.apiKey,
    model: endpoint.model,
    visionModel: endpoint.visionModel,
    apiFormat: endpoint.apiFormat,
  }
}

function createEmptyCustomDraft(): EndpointDraft {
  return {
    id: undefined,
    name: '',
    providerId: 'custom',
    isPreset: false,
    isActive: false,
    baseUrl: '',
    apiKey: '',
    model: '',
    visionModel: '',
    apiFormat: 'chat',
  }
}

export function ModelConfigPage({ onBack }: ModelConfigPageProps) {
  const endpoints = useModelConfigStore((state) => state.endpoints)
  const loading = useModelConfigStore((state) => state.loading)
  const saving = useModelConfigStore((state) => state.saving)
  const loaded = useModelConfigStore((state) => state.loaded)
  const storeError = useModelConfigStore((state) => state.error)
  const loadEndpoints = useModelConfigStore((state) => state.loadEndpoints)
  const saveEndpoint = useModelConfigStore((state) => state.saveEndpoint)
  const deleteEndpoint = useModelConfigStore((state) => state.deleteEndpoint)
  const clearError = useModelConfigStore((state) => state.clearError)

  const [selectedId, setSelectedId] = useState<string | 'new' | null>(null)
  const [editedDraft, setEditedDraft] = useState<EndpointDraft | null>(null)
  const [showKey, setShowKey] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [feedback, setFeedback] = useState<FeedbackBanner | null>(null)

  useEffect(() => {
    if (!loaded && !loading) {
      void loadEndpoints()
    }
  }, [loaded, loading, loadEndpoints])

  const activeEndpoint = useMemo(
    () => endpoints.find((item) => item.isActive) ?? null,
    [endpoints],
  )

  const effectiveSelectedId: string | 'new' =
    selectedId ?? activeEndpoint?.id ?? endpoints[0]?.id ?? 'new'

  const selectedEndpoint = useMemo(
    () =>
      effectiveSelectedId !== 'new'
        ? endpoints.find((item) => item.id === effectiveSelectedId) ?? null
        : null,
    [endpoints, effectiveSelectedId],
  )

  const isCreating = effectiveSelectedId === 'new' || !selectedEndpoint

  const draft: EndpointDraft = useMemo(() => {
    if (editedDraft) return editedDraft
    if (selectedEndpoint) return createDraftFromEndpoint(selectedEndpoint)
    return createEmptyCustomDraft()
  }, [editedDraft, selectedEndpoint])

  const updateDraft = (updater: (current: EndpointDraft) => EndpointDraft) => {
    setEditedDraft((prev) => {
      const base =
        prev ?? (selectedEndpoint ? createDraftFromEndpoint(selectedEndpoint) : createEmptyCustomDraft())
      return updater(base)
    })
  }

  const isAlreadyActive = Boolean(selectedEndpoint?.isActive)

  const selectEndpoint = (endpoint: LlmEndpointConfig) => {
    setSelectedId(endpoint.id)
    setEditedDraft(createDraftFromEndpoint(endpoint))
    setShowKey(false)
    setConfirmDelete(false)
    setFeedback(null)
    clearError()
  }

  const startCreateCustom = () => {
    setSelectedId('new')
    setEditedDraft(createEmptyCustomDraft())
    setShowKey(false)
    setConfirmDelete(false)
    setFeedback(null)
    clearError()
  }

  const submitSave = async (activateAfterSave: boolean) => {
    setFeedback(null)
    setConfirmDelete(false)
    clearError()

    const validation = validateLlmEndpointInput({
      ...draft,
      isPreset: false,
      isActive: activateAfterSave ? true : draft.isActive,
    })
    if (!validation.ok) {
      setFeedback({ tone: 'error', text: validation.message })
      return
    }

    const saved = await saveEndpoint(validation.value)
    if (!saved) {
      setFeedback({
        tone: 'error',
        text: useModelConfigStore.getState().error ?? '保存失败，请重试',
      })
      return
    }

    setSelectedId(saved.id)
    setEditedDraft(createDraftFromEndpoint(saved))
    setFeedback({
      tone: 'success',
      text: activateAfterSave ? `已保存并启用「${saved.name}」` : `已保存「${saved.name}」`,
    })
  }

  const handleFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void submitSave(!isAlreadyActive)
  }

  const handleDeleteSelected = async () => {
    if (!selectedEndpoint) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setFeedback(null)
    const deletedName = selectedEndpoint.name
    const ok = await deleteEndpoint(selectedEndpoint.id)
    setConfirmDelete(false)
    if (!ok) {
      setFeedback({
        tone: 'error',
        text: useModelConfigStore.getState().error ?? '删除失败',
      })
      return
    }
    const remaining = useModelConfigStore.getState().endpoints
    if (remaining.length > 0) {
      const next = remaining.find((item) => item.isActive) ?? remaining[0]
      setSelectedId(next.id)
      setEditedDraft(createDraftFromEndpoint(next))
    } else {
      startCreateCustom()
    }
    setFeedback({ tone: 'success', text: `已删除「${deletedName}」` })
  }

  const renderEndpointItem = (item: LlmEndpointConfig) => {
    const selected = effectiveSelectedId === item.id
    const hasKey = item.apiKey.trim().length > 0
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => selectEndpoint(item)}
        className={`flex w-full items-center justify-between gap-2 rounded-[10px] border px-3 py-2 text-left transition-colors ${
          selected
            ? 'border-accent-line bg-accent-soft/70 text-ink'
            : 'border-transparent bg-transparent text-ink-dim hover:border-line hover:bg-surface/80 hover:text-ink'
        }`}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`size-1.5 flex-none rounded-full ${
              item.isActive
                ? 'bg-mint shadow-[0_0_0_2px_rgba(127,175,148,0.28)]'
                : hasKey
                  ? 'bg-accent-strong/70'
                  : 'bg-ink-faint/35'
            }`}
          />
          <div className="min-w-0">
            <div className="truncate text-[12.5px] font-medium text-ink">{item.name}</div>
            <div className="truncate font-mono text-[10px] text-ink-faint">
              {item.model || '未填模型'}
            </div>
          </div>
        </div>
        {item.isActive && (
          <span className="flex-none rounded-full bg-mint/15 px-1.5 py-0.5 text-[9.5px] font-medium text-[#2f6b4b]">
            使用中
          </span>
        )}
      </button>
    )
  }

  return (
    <motion.div
      key="models-page"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={FAST_TRANSITION}
      className="workbench-scroll flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-6 max-[640px]:px-3.5 max-[640px]:py-4"
    >
      <div className="mx-auto flex w-full max-w-[820px] flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-[9px] border border-accent-line bg-accent-soft text-accent-strong">
              <ModelIcon className="size-4" />
            </span>
            <h1 className="m-0 text-[15.5px] font-semibold text-ink">大模型配置</h1>
            {activeEndpoint && (
              <span className="inline-flex items-center gap-1 rounded-full border border-mint/40 bg-mint/12 px-2 py-0.5 text-[10.5px] font-medium text-[#2f6b4b]">
                <span className="size-1.5 rounded-full bg-mint" />
                {activeEndpoint.name}
              </span>
            )}
          </div>

          <motion.button
            whileTap={TAP_BUTTON}
            type="button"
            onClick={onBack}
            className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink-dim transition-colors hover:border-line-strong hover:bg-surface-soft hover:text-ink"
          >
            ← 返回工作台
          </motion.button>
        </div>

        {storeError && !feedback && (
          <div
            role="alert"
            className="rounded-[10px] border border-rose/40 bg-rose/12 px-3 py-2 text-[11.5px] text-[#a9605f]"
          >
            {storeError}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 min-[760px]:grid-cols-[232px_minmax(0,1fr)]">
          {/* 左侧端点列表 */}
          <aside className="flex flex-col gap-2 rounded-[14px] border border-line bg-panel/92 p-3 shadow-[0_6px_20px_rgba(58,51,43,0.05)]">
            <motion.button
              whileTap={TAP_BUTTON}
              type="button"
              onClick={startCreateCustom}
              className={`flex w-full items-center justify-center gap-1 rounded-[9px] border px-3 py-1.5 text-[12px] font-medium transition-colors ${
                isCreating
                  ? 'border-accent-strong bg-accent-strong text-[#fbf7ef]'
                  : 'border-accent-line bg-accent-soft text-accent-strong hover:bg-accent-soft/80'
              }`}
            >
              <span>+</span>
              <span>新建配置</span>
            </motion.button>

            {loading && endpoints.length === 0 ? (
              <p className="m-0 px-2 py-4 text-center text-[11px] text-ink-faint">加载中…</p>
            ) : endpoints.length === 0 ? (
              <p className="m-0 px-2 py-4 text-center text-[11px] leading-[1.6] text-ink-faint">
                暂无模型配置
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                {endpoints.map(renderEndpointItem)}
              </div>
            )}
          </aside>

          {/* 右侧编辑表单 */}
          <section className="flex flex-col gap-4 rounded-[14px] border border-line bg-panel/92 p-5 shadow-[0_6px_20px_rgba(58,51,43,0.06)]">
            <div className="flex items-center justify-between gap-2 border-b border-line pb-3">
              <div className="flex min-w-0 items-center gap-2">
                <h2 className="m-0 truncate text-[14.5px] font-semibold text-ink">
                  {isCreating ? '新建模型配置' : draft.name || '编辑模型配置'}
                </h2>
              </div>
              {isAlreadyActive && (
                <span className="flex-none text-[11px] font-medium text-[#2f6b4b]">
                  当前使用中
                </span>
              )}
            </div>

            <AnimatePresence>
              {feedback && (
                <motion.div
                  key={`${feedback.tone}-${feedback.text}`}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={FAST_TRANSITION}
                  role={feedback.tone === 'error' ? 'alert' : 'status'}
                  className={`rounded-[9px] border px-3 py-2 text-[11.5px] ${
                    feedback.tone === 'success'
                      ? 'border-mint/40 bg-mint/12 text-[#2f6b4b]'
                      : 'border-rose/40 bg-rose/12 text-[#a9605f]'
                  }`}
                >
                  {feedback.text}
                </motion.div>
              )}
            </AnimatePresence>

            <form className="flex flex-col gap-3.5" onSubmit={handleFormSubmit}>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-ink-dim">名称</span>
                <input
                  className={INPUT_CLASS}
                  type="text"
                  value={draft.name}
                  maxLength={80}
                  placeholder="例如：公司网关 / DeepSeek / Ollama"
                  onChange={(event) =>
                    updateDraft((current) => ({ ...current, name: event.target.value }))
                  }
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-ink-dim">Base URL</span>
                <input
                  className={INPUT_CLASS}
                  type="url"
                  value={draft.baseUrl}
                  maxLength={500}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="https://api.example.com/v1"
                  onChange={(event) =>
                    updateDraft((current) => ({ ...current, baseUrl: event.target.value }))
                  }
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-ink-dim">API Key</span>
                <div className="flex gap-2">
                  <input
                    className={INPUT_CLASS}
                    type={showKey ? 'text' : 'password'}
                    value={draft.apiKey}
                    maxLength={512}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={draft.apiFormat === 'anthropic' ? 'sk-ant-...' : 'sk-...'}
                    onChange={(event) =>
                      updateDraft((current) => ({ ...current, apiKey: event.target.value }))
                    }
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((prev) => !prev)}
                    className="flex-none rounded-[9px] border border-line bg-surface px-3 text-[11.5px] text-ink-dim transition-colors hover:border-line-strong hover:text-ink"
                  >
                    {showKey ? '隐藏' : '显示'}
                  </button>
                </div>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-ink-dim">模型名称</span>
                <input
                  className={INPUT_CLASS}
                  type="text"
                  value={draft.model}
                  maxLength={160}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="例如：deepseek-chat / gpt-4o-mini"
                  onChange={(event) =>
                    updateDraft((current) => ({ ...current, model: event.target.value }))
                  }
                />
              </label>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-ink-dim">协议格式</span>
                  <div className="grid grid-cols-3 gap-1 rounded-[9px] border border-line bg-surface-soft p-1">
                    {LLM_API_FORMAT_OPTIONS.map((option) => {
                      const checked = draft.apiFormat === option.value
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() =>
                            updateDraft((current) => ({ ...current, apiFormat: option.value }))
                          }
                          aria-pressed={checked}
                          className={`rounded-[6px] py-1 text-[11px] font-medium transition-colors ${
                            checked
                              ? 'bg-panel text-accent-strong shadow-xs'
                              : 'text-ink-dim hover:text-ink'
                          }`}
                        >
                          {option.shortLabel}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-ink-dim">识图模型（可选）</span>
                  <input
                    className={INPUT_CLASS}
                    type="text"
                    value={draft.visionModel}
                    maxLength={160}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="留空则复用上方模型"
                    onChange={(event) =>
                      updateDraft((current) => ({ ...current, visionModel: event.target.value }))
                    }
                  />
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3.5">
                <motion.button
                  whileTap={TAP_BUTTON}
                  type="submit"
                  disabled={saving}
                  className="rounded-lg border border-transparent bg-accent-strong px-4 py-2 text-xs font-semibold text-[#fbf7ef] transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? '保存中…' : isAlreadyActive ? '保存配置' : '保存并启用'}
                </motion.button>

                {!isAlreadyActive && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void submitSave(false)}
                    className="rounded-lg border border-line bg-surface px-3 py-2 text-xs text-ink-dim transition-colors hover:border-line-strong hover:text-ink disabled:opacity-50"
                  >
                    仅保存
                  </button>
                )}

                {selectedEndpoint && (
                  <div className="ml-auto flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void handleDeleteSelected()}
                      className="rounded-lg border border-rose/40 bg-rose/[0.08] px-3 py-2 text-xs text-[#a9605f] transition-colors hover:bg-rose/[0.16] disabled:opacity-50"
                    >
                      {confirmDelete ? '确认删除' : '删除'}
                    </button>
                    {confirmDelete && (
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(false)}
                        className="rounded-lg border border-line bg-surface px-2.5 py-2 text-xs text-ink-dim"
                      >
                        取消
                      </button>
                    )}
                  </div>
                )}
              </div>
            </form>
          </section>
        </div>
      </div>
    </motion.div>
  )
}
