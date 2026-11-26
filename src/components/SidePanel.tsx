import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { generateExperiment } from '../ai/client'
import { MAX_PROMPT_LENGTH } from '../ai/prompt'
import { DEFAULT_EXPERIMENT } from '../experiments'
import type { AppRoute } from '../hooks/useAppRoute'
import { useFloatingBallStore } from '../store/useFloatingBallStore'
import { useModelConfigStore } from '../store/useModelConfigStore'
import { useSessionStore } from '../store/useSessionStore'
import { useWorkbenchStore } from '../store/useWorkbenchStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { createExperimentGroupId, resolveRecordGroupId } from '../workspace/records'
import { openDrawingWindow } from '../workspace/windowActions'
import { ModelIcon, PlusIcon, SettingsIcon } from './icons'
import { FAST_TRANSITION, SPRING_SNAPPY, TAP_BUTTON } from './motion'
import { PaperImageInput } from './PaperImageInput'
import { WorkspaceSidebarTree } from './WorkspaceSidebarTree'

interface SidePanelProps {
  route: AppRoute
  onNavigate: (route: AppRoute) => void
}

const EXAMPLE_PROMPTS = [
  '模拟一个阻尼单摆，让用户调节阻尼系数与摆长，观察能量如何衰减。',
  '用 LaTeX 描述洛伦兹吸引子：$\\dot{x}=\\sigma(y-x)$，展示参数变化下的混沌轨迹。',
]

const INSPIRATION_TAGS = [
  {
    label: '加入随机噪声',
    instruction:
      '在当前仿真中加入可调的随机噪声：新增一个 0–1 的噪声强度滑块（key 使用 noise，默认 0.1），在状态更新时对动态量叠加与噪声强度成正比的扰动，并用固定种子保证可重复；在图例中说明观测值。',
  },
  {
    label: '对比基准模型',
    instruction:
      '新增一个布尔开关（key 使用 showReference，默认 true）用于对比基准模型：保留现有仿真作为观测值，同时叠加一条无阻尼/无扰动的理想基准轨迹，用虚线绘制，并在图例中标注两条曲线。',
  },
  {
    label: '高亮梯度向量',
    instruction:
      '新增一个布尔开关（key 使用 showGradient，默认 true），在画布上用箭头高亮显示当前状态的梯度或受力方向，箭头长度随梯度大小变化，颜色与图例一致。',
  },
]

export function SidePanel({ route, onNavigate }: SidePanelProps) {
  const isWorkspace = route === 'workspace'
  const isSettings = route === 'settings'
  const isModels = route === 'models'
  const isSubPage = isWorkspace || isSettings || isModels
  const activeModelEndpoint = useModelConfigStore(
    (state) => state.endpoints.find((item) => item.isActive) ?? null,
  )
  const source = useWorkbenchStore((state) => state.source)
  const experimentId = useWorkbenchStore((state) => state.experiment.id)
  const experimentTitle = useWorkbenchStore((state) => state.experiment.title)
  const aiSpec = useWorkbenchStore((state) => state.aiSpec)
  const workspaceRecordId = useWorkbenchStore((state) => state.workspaceRecordId)
  const activeGroupId = useWorkbenchStore((state) => state.activeGroupId)
  const activeGroupTitle = useWorkbenchStore((state) => state.activeGroupTitle)
  const healStatus = useWorkbenchStore((state) => state.heal.status)
  const presentation = useWorkbenchStore((state) => state.presentation)
  const leftPanelOpen = useWorkbenchStore((state) => state.leftPanelOpen)
  const healing = healStatus === 'requesting' || healStatus === 'applied'
  const applyGeneratedExperiment = useWorkbenchStore((state) => state.applyGeneratedExperiment)

  const entries = useWorkspaceStore((state) => state.entries)
  const createPresetWindow = useWorkspaceStore((state) => state.createPresetWindow)

  /** 左侧栏当前面板：'workspace' 显示 Codex 风格实验/窗口树，'sandbox' 显示 AI 沙盒。 */
  const [sidebarTab, setSidebarTab] = useState<'workspace' | 'sandbox'>('workspace')
  /** 默认情况下每次绘图新开独立实验窗口；也可切换为归入当前实验组新开窗口。 */
  const [spawnMode, setSpawnMode] = useState<'new-experiment' | 'same-experiment'>('new-experiment')
  const prompt = useFloatingBallStore((state) => state.promptDraft)
  const setPrompt = useFloatingBallStore((state) => state.setPromptDraft)
  const [loading, setLoading] = useState(false)
  const [refineText, setRefineText] = useState('')
  const [refining, setRefining] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [promptHighlighted, setPromptHighlighted] = useState(false)
  const promptInputRef = useRef<HTMLTextAreaElement>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const refineControllerRef = useRef<AbortController | null>(null)

  const resolvedGroupId = activeGroupId ?? `preset:${experimentId}`
  const resolvedGroupTitle = activeGroupTitle ?? experimentTitle

  const siblingWindows = useMemo(
    () =>
      entries.filter(
        (entry) =>
          entry.status !== 'unsupported' && resolveRecordGroupId(entry) === resolvedGroupId,
      ),
    [entries, resolvedGroupId],
  )

  useEffect(() => {
    let timer: number | null = null
    let rafId: number | null = null
    const unsubscribe = useFloatingBallStore.subscribe((state, prevState) => {
      if (state.promptFlashKey === prevState.promptFlashKey) return
      setSidebarTab('sandbox')
      onNavigate('workbench')
      setPromptHighlighted(true)
      if (rafId !== null) window.cancelAnimationFrame(rafId)
      rafId = window.requestAnimationFrame(() => {
        rafId = null
        const input = promptInputRef.current
        if (!input) return
        input.focus()
        const end = input.value.length
        input.setSelectionRange(end, end)
        input.scrollTop = input.scrollHeight
      })
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        setPromptHighlighted(false)
        timer = null
      }, 1400)
    })
    return () => {
      unsubscribe()
      if (rafId !== null) window.cancelAnimationFrame(rafId)
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [onNavigate])

  useEffect(
    () => () => {
      controllerRef.current?.abort()
      refineControllerRef.current?.abort()
    },
    [],
  )

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (loading || healing) return
    const text = prompt.trim()
    if (!text) {
      setAiError('请先描述想探索的科学问题')
      return
    }

    const controller = new AbortController()
    controllerRef.current = controller
    setLoading(true)
    setAiError(null)
    const sessionStore = useSessionStore.getState()
    const sessionId = await sessionStore.startSession({
      title: text.slice(0, 48),
      source: 'text',
      initialPrompt: text,
      initialMode: 'create',
    })
    try {
      const spec = await generateExperiment(text, { signal: controller.signal })
      const current = useWorkbenchStore.getState()
      const targetGroupId =
        spawnMode === 'same-experiment'
          ? (current.activeGroupId ?? createExperimentGroupId())
          : createExperimentGroupId()
      const targetGroupTitle =
        spawnMode === 'same-experiment'
          ? (current.activeGroupTitle ?? current.experiment.title)
          : spec.title
      applyGeneratedExperiment(spec, undefined, {
        newRecord: true,
        groupId: targetGroupId,
        groupTitle: targetGroupTitle,
      })
      onNavigate('workbench')
      if (sessionId) {
        void useSessionStore.getState().recordGeneration(sessionId, {
          mode: 'create',
          prompt: text,
          spec,
          params: useWorkbenchStore.getState().params,
          assistantSummary: `已生成实验「${spec.title}」（${spec.domain}）`,
        })
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = error instanceof Error ? error.message : '生成失败，请稍后重试'
        setAiError(message)
        if (sessionId) {
          void useSessionStore.getState().recordMessage(sessionId, {
            role: 'assistant',
            mode: 'create',
            content: message,
            status: 'error',
          })
        }
      }
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null
      setLoading(false)
    }
  }

  const handleCancel = () => {
    controllerRef.current?.abort()
    controllerRef.current = null
    setLoading(false)
  }

  /**
   * 增量修改：只发送当前 Schema、当前参数与本次指令。失败时不替换当前实验。
   * 支持「更新当前窗口」或「同实验新开窗口微调」（保留原窗口便于对比）。
   */
  const handleRefine = async (instruction: string, options?: { openInNewWindow?: boolean }) => {
    const current = useWorkbenchStore.getState()
    if (refining || loading || healing || current.source !== 'ai' || !current.aiSpec) return
    const text = instruction.trim()
    if (!text) {
      setAiError('请先描述想如何修改当前实验')
      return
    }

    const controller = new AbortController()
    refineControllerRef.current = controller
    setRefining(true)
    setAiError(null)
    const sessionStore = useSessionStore.getState()
    let sessionId = options?.openInNewWindow ? null : sessionStore.activeSessionId
    if (!sessionId) {
      sessionId = await sessionStore.startSession({
        title: current.aiSpec.title,
        source: 'text',
        workspaceRecordId: options?.openInNewWindow ? null : current.workspaceRecordId,
        initialPrompt: text,
        initialMode: 'refine',
      })
    } else {
      await sessionStore.recordMessage(sessionId, {
        role: 'user',
        mode: 'refine',
        content: text,
        status: 'ok',
      })
    }
    try {
      const spec = await generateExperiment(
        {
          prompt: text,
          mode: 'refine',
          currentSpec: current.aiSpec,
          currentParams: current.params,
        },
        { signal: controller.signal },
      )
      if (options?.openInNewWindow) {
        const targetGroupId = current.activeGroupId ?? createExperimentGroupId()
        const targetGroupTitle = current.activeGroupTitle ?? current.aiSpec.title
        applyGeneratedExperiment(spec, undefined, {
          newRecord: true,
          groupId: targetGroupId,
          groupTitle: targetGroupTitle,
        })
      } else {
        applyGeneratedExperiment(spec)
      }
      setRefineText('')
      if (sessionId) {
        void useSessionStore.getState().recordGeneration(sessionId, {
          mode: 'refine',
          prompt: text,
          spec,
          params: useWorkbenchStore.getState().params,
          assistantSummary: options?.openInNewWindow
            ? `已在新窗口微调生成「${spec.title}」`
            : `已微调更新「${spec.title}」`,
        })
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = error instanceof Error ? error.message : '修改失败，已保留当前实验'
        setAiError(message)
        if (sessionId) {
          void useSessionStore.getState().recordMessage(sessionId, {
            role: 'assistant',
            mode: 'refine',
            content: message,
            status: 'error',
          })
        }
      }
    } finally {
      if (refineControllerRef.current === controller) refineControllerRef.current = null
      setRefining(false)
    }
  }

  const handleRefineSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void handleRefine(refineText)
  }

  const handleAddWindowInCurrentExperiment = async () => {
    const created = await createPresetWindow(
      source === 'preset' ? experimentId : DEFAULT_EXPERIMENT.id,
      {
        groupId: resolvedGroupId,
        groupTitle: resolvedGroupTitle,
      },
    )
    if (!created) return
    openDrawingWindow(created)
    onNavigate('workbench')
  }

  return (
    <aside
      className={`preset-scroll ${
        presentation
          ? 'hidden'
          : leftPanelOpen
            ? 'flex'
            : 'flex min-[960px]:hidden'
      } min-h-0 flex-col overflow-hidden border-r border-line bg-[linear-gradient(180deg,#fcf9f2,#f7f1e7)] max-[959px]:flex-row max-[959px]:items-stretch max-[959px]:gap-3.5 max-[959px]:overflow-x-auto max-[959px]:overflow-y-hidden max-[959px]:border-b max-[959px]:border-r-0 max-[959px]:px-3 max-[959px]:py-2.5`}
      aria-hidden={presentation || undefined}
      aria-label="工作区与 AI 沙盒"
    >
      <div
        className="flex h-[36px] flex-none items-center gap-1 border-b border-line px-2"
        role="tablist"
        aria-label="左侧栏切换"
      >
        <motion.button
          whileTap={TAP_BUTTON}
          className={`relative flex flex-1 items-center justify-center gap-1 rounded-[7px] px-2 py-1 text-[11px] font-medium transition-colors ${
            sidebarTab === 'workspace' && !isSettings && !isModels
              ? 'text-ink'
              : 'text-ink-faint hover:bg-surface/60 hover:text-ink-dim'
          }`}
          type="button"
          role="tab"
          aria-selected={sidebarTab === 'workspace' && !isSettings && !isModels}
          onClick={() => {
            setSidebarTab('workspace')
            if (isSettings || isModels) onNavigate('workbench')
          }}
          title="查看实验列表与绘画窗口"
        >
          {sidebarTab === 'workspace' && !isSettings && !isModels && (
            <motion.span
              layoutId="sidepanel-tab-pill"
              transition={SPRING_SNAPPY}
              className="absolute inset-0 rounded-[7px] bg-surface shadow-[0_1px_2px_rgba(58,51,43,0.08)]"
            />
          )}
          <span className="relative z-[1]">工作区</span>
          {entries.length > 0 && (
            <span className="relative z-[1] rounded-[4px] border border-line bg-surface-soft px-1 py-px font-mono text-[8.5px] text-ink-faint">
              {entries.length}
            </span>
          )}
        </motion.button>
        <button
          className={`relative flex flex-1 items-center justify-center rounded-[7px] px-2 py-1 text-[11px] font-medium transition-colors ${
            sidebarTab === 'sandbox' && !isSubPage
              ? 'text-ink'
              : 'text-ink-faint hover:text-ink-dim'
          }`}
          type="button"
          role="tab"
          aria-selected={sidebarTab === 'sandbox' && !isSubPage}
          onClick={() => {
            setSidebarTab('sandbox')
            if (isSubPage) onNavigate('workbench')
          }}
        >
          {sidebarTab === 'sandbox' && !isSubPage && (
            <motion.span
              layoutId="sidepanel-tab-pill"
              transition={SPRING_SNAPPY}
              className="absolute inset-0 rounded-[7px] bg-surface shadow-[0_1px_2px_rgba(58,51,43,0.08)]"
            />
          )}
          <span className="relative z-[1]">AI 沙盒</span>
        </button>
      </div>

      {sidebarTab === 'workspace' ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden max-[959px]:hidden">
          <WorkspaceSidebarTree
            onSelectWindow={() => {
              if (isSubPage) onNavigate('workbench')
            }}
            onOpenFullManager={() => onNavigate(isWorkspace ? 'workbench' : 'workspace')}
          />
        </div>
      ) : (
      <div className="workbench-scroll flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 py-3 max-[959px]:hidden">
        <section className="flex flex-col gap-2.5">
          {/* 当前实验与同实验绘画窗口列表（Codex / Claude 风格） */}
          <div className="flex flex-col gap-1.5 rounded-[10px] border border-line bg-surface/75 p-2.5">
            <div className="flex items-center justify-between gap-1.5">
              <div className="flex min-w-0 flex-col">
                <span className="font-mono text-[8.5px] uppercase tracking-[0.12em] text-ink-faint">
                  当前实验 · {Math.max(siblingWindows.length, 1)} 窗口
                </span>
                <span className="truncate text-[11.5px] font-[600] text-ink" title={resolvedGroupTitle}>
                  {resolvedGroupTitle}
                </span>
              </div>
              <motion.button
                whileTap={TAP_BUTTON}
                type="button"
                className="flex flex-none items-center gap-0.5 rounded-[6px] border border-line bg-surface-soft px-1.5 py-1 text-[9.5px] font-medium text-ink-dim transition-colors hover:border-line-strong hover:bg-surface hover:text-ink"
                title="在当前实验内新增一个绘画窗口"
                onClick={() => void handleAddWindowInCurrentExperiment()}
              >
                <PlusIcon className="size-2.5" />
                <span>新窗</span>
              </motion.button>
            </div>

            {siblingWindows.length > 0 && (
              <div className="flex max-h-[116px] flex-col gap-1 overflow-y-auto pr-0.5">
                {siblingWindows.map((win) => {
                  const active = win.id === workspaceRecordId
                  return (
                    <button
                      key={win.id}
                      type="button"
                      onClick={() => {
                        openDrawingWindow(win)
                        onNavigate('workbench')
                      }}
                      className={`flex items-center gap-1.5 rounded-[6px] border px-2 py-1 text-left text-[10.5px] transition-colors ${
                        active
                          ? 'border-accent-line bg-accent-soft/65 font-medium text-ink'
                          : 'border-transparent bg-transparent text-ink-dim hover:border-line hover:bg-surface-soft/80 hover:text-ink'
                      }`}
                    >
                      <span
                        className={`size-1.5 flex-none rounded-full ${
                          win.source === 'ai'
                            ? 'bg-[#8a76a8]'
                            : active
                              ? 'bg-accent-strong'
                              : 'bg-ink-faint/60'
                        }`}
                      />
                      <span className="min-w-0 flex-1 truncate">{win.title}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <PaperImageInput
            spawnMode={spawnMode}
            onImageLoaded={() => onNavigate('workbench')}
          />

          <form className="flex flex-col gap-2" onSubmit={handleSubmit}>
            <div className="flex items-center justify-between gap-1.5">
              <span className="text-[9.5px] text-ink-faint">新绘图方式</span>
              <div className="flex items-center gap-0.5 rounded-[7px] border border-line bg-surface-soft/80 p-0.5">
                {(
                  [
                    ['new-experiment', '新开独立窗口'],
                    ['same-experiment', '当前实验内新开'],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setSpawnMode(mode)}
                    className={`rounded-[5px] px-1.5 py-[2px] text-[9px] transition-colors ${
                      spawnMode === mode
                        ? 'bg-surface font-medium text-ink shadow-[0_1px_2px_rgba(58,51,43,0.08)]'
                        : 'text-ink-faint hover:text-ink-dim'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <textarea
              ref={promptInputRef}
              className={`resize-none rounded-[9px] border bg-surface-soft px-2.5 py-2 text-[11.5px] leading-[1.55] text-ink placeholder:text-ink-faint transition-shadow focus:border-accent-line focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 ${
                promptHighlighted
                  ? 'border-mint shadow-[0_0_0_3px_rgba(127,175,148,0.28)]'
                  : 'border-line'
              }`}
              rows={3}
              value={prompt}
              maxLength={MAX_PROMPT_LENGTH}
              disabled={loading}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="描述想探索的科学机理，或粘贴论文公式…"
              aria-label="实验描述"
            />

            <div className="flex items-center justify-between gap-2 text-[9.5px] text-ink-faint">
              <div className="flex min-w-0 gap-1.5">
                {EXAMPLE_PROMPTS.map((example, index) => (
                  <motion.button
                    key={example}
                    whileTap={loading ? undefined : TAP_BUTTON}
                    className="truncate rounded-[5px] border border-line bg-surface px-1.5 py-0.5 text-[9.5px] text-ink-faint transition-colors enabled:hover:border-line-strong enabled:hover:text-ink-dim disabled:cursor-not-allowed disabled:opacity-50"
                    type="button"
                    disabled={loading}
                    title={example}
                    onClick={() => setPrompt(example)}
                  >
                    示例 {index + 1}
                  </motion.button>
                ))}
              </div>
              <span className="whitespace-nowrap font-mono tabular-nums">
                {prompt.length}/{MAX_PROMPT_LENGTH}
              </span>
            </div>

            <div className="flex gap-2">
              <motion.button
                whileTap={loading || refining || healing ? undefined : TAP_BUTTON}
                className="flex-1 rounded-lg border border-transparent bg-accent-strong px-3 py-[6px] text-xs font-semibold text-[#fbf7ef] transition-colors enabled:hover:bg-accent disabled:cursor-not-allowed disabled:opacity-45"
                type="submit"
                disabled={loading || refining || healing}
              >
                {loading ? '生成中…' : '生成实验'}
              </motion.button>
              {loading && (
                <motion.button
                  whileTap={TAP_BUTTON}
                  className="rounded-lg border border-line bg-surface px-2.5 py-[6px] text-xs text-ink-dim transition-colors enabled:hover:border-line-strong enabled:hover:bg-surface-soft enabled:hover:text-ink"
                  type="button"
                  onClick={handleCancel}
                >
                  取消
                </motion.button>
              )}
            </div>
          </form>

          <AnimatePresence>
            {aiError && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={FAST_TRANSITION}
                className="m-0 rounded-[9px] border border-rose/30 bg-rose/[0.1] px-2.5 py-2 text-[10.5px] leading-[1.55] text-[#a9605f]"
                role="alert"
              >
                {aiError}
              </motion.p>
            )}
          </AnimatePresence>

          <p className="m-0 text-[9.5px] leading-[1.55] text-ink-faint">
            生成失败不会替换当前实验；未配置凭证时预设案例始终可用。
          </p>

          <AnimatePresence>
            {source === 'ai' && aiSpec && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={FAST_TRANSITION}
                className="flex flex-col gap-2 rounded-[10px] border border-[rgba(138,118,168,0.32)] bg-[rgba(138,118,168,0.06)] p-2.5"
              >
                <h3 className="m-0 flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#6d5a7d]">
                  基于当前实验修改
                  <span className="font-mono text-[9px] normal-case tracking-normal text-ink-faint">
                    增量
                  </span>
                </h3>

                <div className="flex flex-wrap gap-1.5">
                  {INSPIRATION_TAGS.map((tag) => (
                    <motion.button
                      key={tag.label}
                      whileTap={refining || loading || healing ? undefined : TAP_BUTTON}
                      className="rounded-full border border-[rgba(138,118,168,0.32)] bg-surface px-2 py-[3px] text-[9.5px] text-[#6d5a7d] transition-colors enabled:hover:border-[rgba(138,118,168,0.55)] enabled:hover:bg-[rgba(138,118,168,0.1)] disabled:cursor-not-allowed disabled:opacity-50"
                      type="button"
                      disabled={refining || loading || healing}
                      title={tag.instruction}
                      onClick={() => void handleRefine(tag.instruction)}
                    >
                      {tag.label}
                    </motion.button>
                  ))}
                </div>

                <form className="flex flex-col gap-1.5" onSubmit={handleRefineSubmit}>
                  <textarea
                    className="resize-none rounded-[8px] border border-line bg-surface-soft px-2.5 py-[7px] text-[11px] leading-[1.55] text-ink placeholder:text-ink-faint focus:border-accent-line focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                    rows={2}
                    value={refineText}
                    maxLength={MAX_PROMPT_LENGTH}
                    disabled={refining}
                    onChange={(event) => setRefineText(event.target.value)}
                    placeholder="例如：把噪声强度做成可调滑块；用虚线对比理想轨迹…"
                    aria-label="实验修改指令"
                  />
                  <div className="flex items-center gap-1.5">
                    <motion.button
                      whileTap={refining || loading || healing ? undefined : TAP_BUTTON}
                      className="flex-1 rounded-lg border border-transparent bg-[#6d5a7d] px-2.5 py-[6px] text-[10.5px] font-semibold text-[#fbf7ef] transition-colors enabled:hover:bg-[#5d4b6c] disabled:cursor-not-allowed disabled:opacity-45"
                      type="submit"
                      disabled={refining || loading || healing}
                    >
                      {refining ? '应用中…' : '更新当前窗'}
                    </motion.button>
                    {!refining && (
                      <motion.button
                        whileTap={loading || healing ? undefined : TAP_BUTTON}
                        className="rounded-lg border border-[rgba(138,118,168,0.4)] bg-surface px-2 py-[6px] text-[10.5px] font-medium text-[#6d5a7d] transition-colors enabled:hover:bg-[rgba(138,118,168,0.1)] disabled:cursor-not-allowed disabled:opacity-45"
                        type="button"
                        disabled={loading || healing}
                        title="在当前实验内新开一个绘画窗口并应用修改，原窗口保持不变"
                        onClick={() => void handleRefine(refineText, { openInNewWindow: true })}
                      >
                        新窗微调
                      </motion.button>
                    )}
                    {refining && (
                      <motion.button
                        whileTap={TAP_BUTTON}
                        className="rounded-lg border border-line bg-surface px-2.5 py-[6px] text-[11px] text-ink-dim transition-colors enabled:hover:border-line-strong enabled:hover:bg-surface-soft enabled:hover:text-ink"
                        type="button"
                        onClick={() => {
                          refineControllerRef.current?.abort()
                          refineControllerRef.current = null
                          setRefining(false)
                        }}
                      >
                        取消
                      </motion.button>
                    )}
                  </div>
                </form>
                <p className="m-0 text-[9.5px] leading-[1.55] text-ink-faint">
                  只发送当前 Schema、当前参数与本次指令；校验失败不会替换当前实验。
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </div>
      )}

      <div className="flex flex-none flex-col gap-1 border-t border-line px-2 py-2 max-[959px]:flex-row max-[959px]:items-center max-[959px]:border-l max-[959px]:border-t-0 max-[959px]:py-0 max-[959px]:pl-2.5">
        <motion.button
          whileTap={TAP_BUTTON}
          type="button"
          onClick={() => onNavigate(isModels ? 'workbench' : 'models')}
          aria-current={isModels ? 'page' : undefined}
          title={isModels ? '返回工作台' : '打开大模型配置 (/models)'}
          className={`flex w-full items-center justify-between gap-2 rounded-[8px] border px-2.5 py-1.5 text-[11.5px] font-medium transition-colors max-[959px]:w-auto max-[959px]:whitespace-nowrap ${
            isModels
              ? 'border-accent-line bg-accent-soft text-accent-strong shadow-[0_1px_2px_rgba(58,51,43,0.05)]'
              : 'border-transparent bg-transparent text-ink-dim hover:border-line hover:bg-surface/80 hover:text-ink'
          }`}
        >
          <span className="flex items-center gap-2">
            <ModelIcon className="size-3.5 flex-none" />
            <span>模型配置</span>
          </span>
          <span className="flex items-center gap-1.5">
            {activeModelEndpoint && activeModelEndpoint.apiKey.trim().length > 0 && (
              <span
                className="size-1.5 rounded-full bg-mint shadow-[0_0_0_2px_rgba(127,175,148,0.28)]"
                title={`当前模型：${activeModelEndpoint.name}`}
              />
            )}
            <span className="hidden font-mono text-[9px] text-ink-faint min-[960px]:inline">
              /models
            </span>
          </span>
        </motion.button>
        <motion.button
          whileTap={TAP_BUTTON}
          type="button"
          onClick={() => onNavigate(isSettings ? 'workbench' : 'settings')}
          aria-current={isSettings ? 'page' : undefined}
          title={isSettings ? '返回工作台' : '打开设置 (/settings)'}
          className={`flex w-full items-center justify-between gap-2 rounded-[8px] border px-2.5 py-1.5 text-[11.5px] font-medium transition-colors max-[959px]:w-auto max-[959px]:whitespace-nowrap ${
            isSettings
              ? 'border-accent-line bg-accent-soft text-accent-strong shadow-[0_1px_2px_rgba(58,51,43,0.05)]'
              : 'border-transparent bg-transparent text-ink-dim hover:border-line hover:bg-surface/80 hover:text-ink'
          }`}
        >
          <span className="flex items-center gap-2">
            <SettingsIcon className="size-3.5 flex-none" />
            <span>设置</span>
          </span>
          <span className="hidden font-mono text-[9px] text-ink-faint min-[960px]:inline">
            /settings
          </span>
        </motion.button>
      </div>
    </aside>
  )
}
