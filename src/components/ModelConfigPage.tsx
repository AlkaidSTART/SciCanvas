import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  getPresetTemplateById,
  validateLlmEndpointInput,
} from '../models/presets'
import { LLM_API_FORMAT_OPTIONS } from '../models/types'
import type { LlmApiFormat, LlmEndpointConfig } from '../models/types'
import { useModelConfigStore } from '../store/useModelConfigStore'
import { maskApiKey } from '../workspace/modelConfig'
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

const FORMAT_BADGE_LABEL: Record<LlmApiFormat, string> = {
  chat: 'Chat',
  response: 'Response',
  anthropic: 'Anthropic',
}

const INPUT_CLASS =
  'w-full rounded-[9px] border border-line bg-surface-soft px-3 py-2 text-[12px] text-ink placeholder:text-ink-faint focus:border-accent-line focus:outline-none'

function createDraftFromEndpoint(endpoint: LlmEndpointConfig): EndpointDraft {
  return {
    id: endpoint.id,
    name: endpoint.name,
    providerId: endpoint.providerId,
    isPreset: endpoint.isPreset,
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

function previewResolvedUrl(baseUrl: string, apiFormat: LlmApiFormat): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (!trimmed) return '—'
  if (apiFormat === 'response') {
    return trimmed.endsWith('/responses') ? trimmed : `${trimmed}/responses`
  }
  if (apiFormat === 'anthropic') {
    return trimmed.endsWith('/messages') ? trimmed : `${trimmed}/messages`
  }
  return trimmed.endsWith('/chat/completions') ? trimmed : `${trimmed}/chat/completions`
}

export function ModelConfigPage({ onBack }: ModelConfigPageProps) {
  const endpoints = useModelConfigStore((state) => state.endpoints)
  const dbPath = useModelConfigStore((state) => state.dbPath)
  const loading = useModelConfigStore((state) => state.loading)
  const saving = useModelConfigStore((state) => state.saving)
  const loaded = useModelConfigStore((state) => state.loaded)
  const storeError = useModelConfigStore((state) => state.error)
  const loadEndpoints = useModelConfigStore((state) => state.loadEndpoints)
  const saveEndpoint = useModelConfigStore((state) => state.saveEndpoint)
  const activateEndpoint = useModelConfigStore((state) => state.activateEndpoint)
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

  const presetEndpoints = useMemo(
    () => endpoints.filter((item) => item.isPreset),
    [endpoints],
  )
  const customEndpoints = useMemo(
    () => endpoints.filter((item) => !item.isPreset),
    [endpoints],
  )
  const activeEndpoint = useMemo(
    () => endpoints.find((item) => item.isActive) ?? null,
    [endpoints],
  )

  const effectiveSelectedId: string | 'new' | null =
    selectedId ?? activeEndpoint?.id ?? endpoints[0]?.id ?? null

  const selectedEndpoint = useMemo(
    () =>
      effectiveSelectedId && effectiveSelectedId !== 'new'
        ? endpoints.find((item) => item.id === effectiveSelectedId) ?? null
        : null,
    [endpoints, effectiveSelectedId],
  )

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

  const selectedTemplate = useMemo(
    () => (selectedEndpoint?.isPreset ? getPresetTemplateById(selectedEndpoint.id) ?? null : null),
    [selectedEndpoint],
  )

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
        text: useModelConfigStore.getState().error ?? '保存失败，请检查 SQLite 服务状态',
      })
      return
    }

    setSelectedId(saved.id)
    setEditedDraft(createDraftFromEndpoint(saved))
    setFeedback({
      tone: 'success',
      text: activateAfterSave
        ? `已将「${saved.name}」写入 SQLite 并设为当前默认模型端点。`
        : `已将「${saved.name}」配置与 API Key 保存至本地 SQLite。`,
    })
  }

  const handleFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void submitSave(false)
  }

  const handleActivateSelected = async () => {
    if (!selectedEndpoint) return
    setFeedback(null)
    clearError()
    const activated = await activateEndpoint(selectedEndpoint.id)
    if (!activated) {
      setFeedback({
        tone: 'error',
        text: useModelConfigStore.getState().error ?? '切换当前模型失败',
      })
      return
    }
    setEditedDraft(createDraftFromEndpoint(activated))
    setFeedback({
      tone: 'success',
      text: `当前模型已切换为「${activated.name}」（${FORMAT_BADGE_LABEL[activated.apiFormat]} 格式）。`,
    })
  }

  const handleResetPreset = () => {
    if (!selectedTemplate) return
    updateDraft((current) => ({
      ...current,
      name: selectedTemplate.name,
      baseUrl: selectedTemplate.baseUrl,
      model: selectedTemplate.model,
      visionModel: selectedTemplate.visionModel,
      apiFormat: selectedTemplate.apiFormat,
    }))
    setFeedback({
      tone: 'success',
      text: '已恢复该预设的默认端点地址、模型与协议格式（保留已填写的 API Key），点击「保存配置」生效。',
    })
  }

  const handleDeleteSelected = async () => {
    if (!selectedEndpoint || selectedEndpoint.isPreset) return
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
        text: useModelConfigStore.getState().error ?? '删除端点失败',
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
    setFeedback({
      tone: 'success',
      text: `已从 SQLite 删除自定义端点「${deletedName}」。`,
    })
  }

  const renderEndpointItem = (item: LlmEndpointConfig) => {
    const selected = effectiveSelectedId === item.id
    const hasKey = item.apiKey.trim().length > 0
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => selectEndpoint(item)}
        className={`flex w-full flex-col gap-1.5 rounded-[11px] border px-3 py-2.5 text-left transition-colors ${
          selected
            ? 'border-accent-line bg-accent-soft/65 shadow-[0_2px_8px_rgba(58,51,43,0.06)]'
            : 'border-line bg-surface/75 hover:border-line-strong hover:bg-surface'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5">
            <span
              className={`size-1.5 flex-none rounded-full ${
                item.isActive
                  ? 'bg-mint shadow-[0_0_0_2px_rgba(127,175,148,0.28)]'
                  : hasKey
                    ? 'bg-accent-strong/75'
                    : 'bg-ink-faint/40'
              }`}
            />
            <strong className="truncate text-[12.5px] font-semibold text-ink">
              {item.name}
            </strong>
          </span>
          <span className="flex flex-none items-center gap-1">
            {item.isActive && (
              <span className="rounded-full border border-mint/45 bg-mint/14 px-1.5 py-px text-[9.5px] font-medium text-[#2f6b4b]">
                当前
              </span>
            )}
            <span className="rounded-[5px] border border-line bg-surface-soft px-1.5 py-px font-mono text-[9px] text-ink-dim">
              {FORMAT_BADGE_LABEL[item.apiFormat]}
            </span>
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 text-[10.5px] text-ink-faint">
          <span className="truncate font-mono">{item.model || '未填模型'}</span>
          <span className="flex-none font-mono text-[9.5px]">
            {hasKey ? maskApiKey(item.apiKey) : '未填 Key'}
          </span>
        </div>
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
      <div className="mx-auto flex w-full max-w-[980px] flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-[10px] border border-accent-line bg-accent-soft text-accent-strong">
              <ModelIcon className="size-[18px]" />
            </span>
            <div className="flex flex-col gap-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="m-0 text-[16px] font-semibold tracking-[0.01em] text-ink">
                  大模型配置
                </h1>
                <span className="rounded-[5px] border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px] text-ink-faint">
                  /models
                </span>
                {activeEndpoint && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-mint/45 bg-mint/14 px-2 py-0.5 text-[10px] font-medium text-[#2f6b4b]">
                    <span className="size-1.5 rounded-full bg-mint" />
                    当前：{activeEndpoint.name} · {FORMAT_BADGE_LABEL[activeEndpoint.apiFormat]}
                  </span>
                )}
              </div>
              <p className="m-0 text-[11.5px] text-ink-faint">
                内置 DeepSeek、豆包、通义千问等预设端点，支持自定义接入与 Chat / Response / Anthropic 三种回复格式，全部数据与 API Key 存储在本地 SQLite
              </p>
            </div>
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

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[11px] border border-line bg-surface/75 px-3.5 py-2 text-[11px] text-ink-dim">
          <span className="flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-mint" />
            <span>
              存储引擎：<strong className="font-semibold text-ink">SQLite (llm_endpoints)</strong>
            </span>
          </span>
          {dbPath && (
            <span className="truncate font-mono text-[10px] text-ink-faint" title={dbPath}>
              {dbPath}
            </span>
          )}
        </div>

        {storeError && !feedback && (
          <div
            role="alert"
            className="rounded-[10px] border border-rose/40 bg-rose/12 px-3.5 py-2.5 text-[11.5px] text-[#a9605f]"
          >
            {storeError}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 min-[840px]:grid-cols-[276px_minmax(0,1fr)]">
          {/* 左侧端点列表 */}
          <aside className="flex flex-col gap-3 rounded-[14px] border border-line bg-panel/92 p-3.5 shadow-[0_8px_24px_rgba(58,51,43,0.05)]">
            <motion.button
              whileTap={TAP_BUTTON}
              type="button"
              onClick={startCreateCustom}
              className={`flex w-full items-center justify-center gap-1.5 rounded-[9px] border px-3 py-2 text-[12px] font-semibold transition-colors ${
                selectedId === 'new'
                  ? 'border-accent-strong bg-accent-strong text-[#fbf7ef]'
                  : 'border-accent-line bg-accent-soft text-accent-strong hover:bg-accent-soft/80'
              }`}
            >
              <span>+</span>
              <span>添加自定义端点</span>
            </motion.button>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between px-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
                  预设大模型端点
                </span>
                <span className="font-mono text-[9.5px] text-ink-faint">
                  {presetEndpoints.length}
                </span>
              </div>
              {loading && endpoints.length === 0 ? (
                <p className="m-0 px-1 py-3 text-[11px] text-ink-faint">正在读取 SQLite 配置…</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {presetEndpoints.map(renderEndpointItem)}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2 border-t border-line pt-3">
              <div className="flex items-center justify-between px-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
                  自定义端点
                </span>
                <span className="font-mono text-[9.5px] text-ink-faint">
                  {customEndpoints.length}
                </span>
              </div>
              {customEndpoints.length === 0 ? (
                <p className="m-0 rounded-[9px] border border-dashed border-line-strong/60 bg-surface/45 px-3 py-3 text-center text-[11px] leading-[1.55] text-ink-faint">
                  还没有自定义端点，可点击上方按钮接入任意兼容网关或本地模型。
                </p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {customEndpoints.map(renderEndpointItem)}
                </div>
              )}
            </div>
          </aside>

          {/* 右侧编辑表单 */}
          <section className="flex flex-col gap-4 rounded-[14px] border border-line bg-panel/92 p-5 shadow-[0_8px_24px_rgba(58,51,43,0.06)]">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-3.5">
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="m-0 text-[15px] font-semibold text-ink">
                    {selectedId === 'new' ? '新建自定义大模型端点' : draft.name || '编辑端点'}
                  </h2>
                  {selectedTemplate && (
                    <span className="rounded-[5px] border border-line bg-surface px-1.5 py-0.5 text-[10px] text-ink-dim">
                      {selectedTemplate.badge}
                    </span>
                  )}
                  {selectedId !== 'new' && !draft.isPreset && (
                    <span className="rounded-[5px] border border-accent-line bg-accent-soft px-1.5 py-0.5 text-[10px] text-accent-strong">
                      自定义
                    </span>
                  )}
                </div>
                <p className="m-0 text-[11.5px] leading-[1.55] text-ink-dim">
                  {selectedTemplate
                    ? selectedTemplate.description
                    : '填写自定义 Base URL、API Key 与回复格式，即可接入 OneAPI、NewAPI、vLLM、Ollama 或私有代理端点。'}
                </p>
              </div>

              {selectedEndpoint && (
                <div className="flex flex-none items-center gap-2">
                  {selectedEndpoint.isActive ? (
                    <span className="inline-flex items-center gap-1.5 rounded-lg border border-mint/45 bg-mint/14 px-2.5 py-1.5 text-[11px] font-medium text-[#2f6b4b]">
                      <span className="size-1.5 rounded-full bg-mint" />
                      当前正在使用
                    </span>
                  ) : (
                    <motion.button
                      whileTap={TAP_BUTTON}
                      type="button"
                      disabled={saving}
                      onClick={() => void handleActivateSelected()}
                      className="rounded-lg border border-accent-line bg-accent-soft px-2.5 py-1.5 text-[11px] font-medium text-accent-strong transition-colors hover:bg-accent-soft/80 disabled:opacity-50"
                    >
                      设为当前使用
                    </motion.button>
                  )}
                </div>
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
                  className={`rounded-[10px] border px-3 py-2 text-[11.5px] leading-[1.55] ${
                    feedback.tone === 'success'
                      ? 'border-mint/40 bg-mint/12 text-[#2f6b4b]'
                      : 'border-rose/40 bg-rose/12 text-[#a9605f]'
                  }`}
                >
                  {feedback.text}
                </motion.div>
              )}
            </AnimatePresence>

            <form className="flex flex-col gap-4" onSubmit={handleFormSubmit}>
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
                    端点名称
                  </span>
                  <input
                    className={INPUT_CLASS}
                    type="text"
                    value={draft.name}
                    maxLength={80}
                    placeholder="例如：DeepSeek / 公司内网网关"
                    onChange={(event) =>
                      updateDraft((current) => ({ ...current, name: event.target.value }))
                    }
                  />
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
                    服务商标识
                  </span>
                  <input
                    className={INPUT_CLASS}
                    type="text"
                    value={draft.providerId}
                    disabled={draft.isPreset}
                    maxLength={40}
                    placeholder="custom"
                    onChange={(event) =>
                      updateDraft((current) => ({ ...current, providerId: event.target.value }))
                    }
                  />
                </label>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
                  回复格式协议（支持 Chat / Response / Anthropic）
                </span>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
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
                        className={`flex flex-col gap-1 rounded-[10px] border p-2.5 text-left transition-colors ${
                          checked
                            ? 'border-accent-strong bg-accent-soft/75 shadow-[0_1px_4px_rgba(58,51,43,0.08)]'
                            : 'border-line bg-surface/70 hover:border-line-strong hover:bg-surface'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1.5">
                          <span className="text-[12px] font-semibold text-ink">
                            {option.shortLabel}
                          </span>
                          <span className="font-mono text-[9.5px] text-ink-faint">
                            {option.endpointSuffix}
                          </span>
                        </div>
                        <span className="text-[10.5px] leading-[1.45] text-ink-dim">
                          {option.label}
                        </span>
                      </button>
                    )
                  })}
                </div>
                <p className="m-0 text-[10.5px] leading-[1.5] text-ink-faint">
                  {
                    LLM_API_FORMAT_OPTIONS.find((item) => item.value === draft.apiFormat)
                      ?.description
                  }
                </p>
              </div>

              <label className="flex flex-col gap-1.5">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
                  API 端点地址 (Base URL)
                </span>
                <input
                  className={INPUT_CLASS}
                  type="url"
                  value={draft.baseUrl}
                  maxLength={500}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="https://api.deepseek.com/v1"
                  onChange={(event) =>
                    updateDraft((current) => ({ ...current, baseUrl: event.target.value }))
                  }
                />
                <span className="font-mono text-[10px] text-ink-faint">
                  实际请求地址：{previewResolvedUrl(draft.baseUrl, draft.apiFormat)}
                </span>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
                  API Key（持久化保存在本地 SQLite）
                </span>
                <div className="flex gap-2">
                  <input
                    className={INPUT_CLASS}
                    type={showKey ? 'text' : 'password'}
                    value={draft.apiKey}
                    maxLength={512}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={
                      draft.apiFormat === 'anthropic' ? 'sk-ant-...' : 'sk-...'
                    }
                    onChange={(event) =>
                      updateDraft((current) => ({ ...current, apiKey: event.target.value }))
                    }
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((prev) => !prev)}
                    className="flex-none rounded-[9px] border border-line bg-surface px-3 text-[11.5px] text-ink-dim transition-colors hover:border-line-strong hover:bg-surface-soft hover:text-ink"
                  >
                    {showKey ? '隐藏' : '显示'}
                  </button>
                </div>
              </label>

              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
                    默认生成模型
                  </span>
                  <input
                    className={INPUT_CLASS}
                    type="text"
                    value={draft.model}
                    maxLength={160}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="例如：deepseek-chat / qwen-plus"
                    onChange={(event) =>
                      updateDraft((current) => ({ ...current, model: event.target.value }))
                    }
                  />
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
                    多模态识图模型（可选）
                  </span>
                  <input
                    className={INPUT_CLASS}
                    type="text"
                    value={draft.visionModel}
                    maxLength={160}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="留空则回退至默认模型"
                    onChange={(event) =>
                      updateDraft((current) => ({ ...current, visionModel: event.target.value }))
                    }
                  />
                </label>
              </div>

              {selectedTemplate && selectedTemplate.suggestedModels.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10.5px] text-ink-faint">推荐模型：</span>
                  {selectedTemplate.suggestedModels.map((modelName) => (
                    <button
                      key={modelName}
                      type="button"
                      onClick={() =>
                        updateDraft((current) => ({ ...current, model: modelName }))
                      }
                      className={`rounded-full border px-2 py-0.5 font-mono text-[10px] transition-colors ${
                        draft.model === modelName
                          ? 'border-accent-line bg-accent-soft text-accent-strong'
                          : 'border-line bg-surface text-ink-dim hover:border-line-strong hover:text-ink'
                      }`}
                    >
                      {modelName}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
                <motion.button
                  whileTap={TAP_BUTTON}
                  type="submit"
                  disabled={saving}
                  className="rounded-lg border border-transparent bg-accent-strong px-4 py-2 text-xs font-semibold text-[#fbf7ef] transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? '保存中…' : '保存配置'}
                </motion.button>

                <motion.button
                  whileTap={TAP_BUTTON}
                  type="button"
                  disabled={saving}
                  onClick={() => void submitSave(true)}
                  className="rounded-lg border border-accent-line bg-accent-soft px-3.5 py-2 text-xs font-medium text-accent-strong transition-colors hover:bg-accent-soft/80 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  保存并设为当前模型
                </motion.button>

                {selectedTemplate && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={handleResetPreset}
                    className="rounded-lg border border-line bg-surface px-3 py-2 text-xs text-ink-dim transition-colors hover:border-line-strong hover:bg-surface-soft hover:text-ink disabled:opacity-50"
                  >
                    恢复预设默认值
                  </button>
                )}

                {selectedEndpoint && !selectedEndpoint.isPreset && (
                  <div className="ml-auto flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void handleDeleteSelected()}
                      className="rounded-lg border border-rose/40 bg-rose/[0.08] px-3 py-2 text-xs text-[#a9605f] transition-colors hover:bg-rose/[0.16] disabled:opacity-50"
                    >
                      {confirmDelete ? '确认删除' : '删除端点'}
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
