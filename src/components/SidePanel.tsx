import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { generateExperiment } from '../ai/client'
import { MAX_PROMPT_LENGTH } from '../ai/prompt'
import type { AppRoute } from '../hooks/useAppRoute'
import { useFloatingBallStore } from '../store/useFloatingBallStore'
import { useModelConfigStore } from '../store/useModelConfigStore'
import { useSessionStore } from '../store/useSessionStore'
import { useWorkbenchStore } from '../store/useWorkbenchStore'
import { ModelIcon, SettingsIcon } from './icons'
import { FAST_TRANSITION, SPRING_SNAPPY, TAP_BUTTON } from './motion'
import { PaperImageInput } from './PaperImageInput'
import { WorkspaceDialog } from './WorkspaceDialog'

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
  const isSettings = route === 'settings'
  const isModels = route === 'models'
  const isSubPage = isSettings || isModels
  const activeModelEndpoint = useModelConfigStore(
    (state) => state.endpoints.find((item) => item.isActive) ?? null,
  )
  const source = useWorkbenchStore((state) => state.source)
  const aiSpec = useWorkbenchStore((state) => state.aiSpec)
  const healStatus = useWorkbenchStore((state) => state.heal.status)
  const presentation = useWorkbenchStore((state) => state.presentation)
  const leftPanelOpen = useWorkbenchStore((state) => state.leftPanelOpen)
  const healing = healStatus === 'requesting' || healStatus === 'applied'
  const applyGeneratedExperiment = useWorkbenchStore((state) => state.applyGeneratedExperiment)

  const [workspaceOpen, setWorkspaceOpen] = useState(false)
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

  useEffect(() => {
    let timer: number | null = null
    let rafId: number | null = null
    const unsubscribe = useFloatingBallStore.subscribe((state, prevState) => {
      if (state.promptFlashKey === prevState.promptFlashKey) return
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
      applyGeneratedExperiment(spec, undefined, { newRecord: true })
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
   */
  const handleRefine = async (instruction: string) => {
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
    let sessionId = sessionStore.activeSessionId
    if (!sessionId) {
      sessionId = await sessionStore.startSession({
        title: current.aiSpec.title,
        source: 'text',
        workspaceRecordId: current.workspaceRecordId,
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
      applyGeneratedExperiment(spec)
      setRefineText('')
      if (sessionId) {
        void useSessionStore.getState().recordGeneration(sessionId, {
          mode: 'refine',
          prompt: text,
          spec,
          params: useWorkbenchStore.getState().params,
          assistantSummary: `已微调更新「${spec.title}」`,
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
          className={`relative flex flex-1 items-center justify-center rounded-[7px] px-2 py-1 text-[11px] font-medium transition-colors ${
            workspaceOpen
              ? 'text-ink'
              : 'text-ink-faint hover:bg-surface/60 hover:text-ink-dim'
          }`}
          type="button"
          onClick={() => setWorkspaceOpen(true)}
          title="打开工作区记录、会话与模型配置"
        >
          {workspaceOpen && (
            <motion.span
              layoutId="sidepanel-tab-pill"
              transition={SPRING_SNAPPY}
              className="absolute inset-0 rounded-[7px] bg-surface shadow-[0_1px_2px_rgba(58,51,43,0.08)]"
            />
          )}
          <span className="relative z-[1]">工作区</span>
        </motion.button>
        <button
          className={`relative flex flex-1 items-center justify-center rounded-[7px] px-2 py-1 text-[11px] font-medium transition-colors ${
            !isSubPage && !workspaceOpen
              ? 'text-ink'
              : 'text-ink-faint hover:text-ink-dim'
          }`}
          type="button"
          role="tab"
          aria-selected={!isSubPage && !workspaceOpen}
          onClick={() => {
            if (isSubPage) onNavigate('workbench')
          }}
        >
          {!isSubPage && !workspaceOpen && (
            <motion.span
              layoutId="sidepanel-tab-pill"
              transition={SPRING_SNAPPY}
              className="absolute inset-0 rounded-[7px] bg-surface shadow-[0_1px_2px_rgba(58,51,43,0.08)]"
            />
          )}
          <span className="relative z-[1]">AI 沙盒</span>
        </button>
      </div>

      <div className="workbench-scroll flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 py-3 max-[959px]:hidden">
        <section className="flex flex-col gap-2.5">
          <AnimatePresence>
            {source === 'ai' && aiSpec && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={FAST_TRANSITION}
                className="flex flex-col gap-1 rounded-[9px] border border-[rgba(138,118,168,0.32)] bg-[rgba(138,118,168,0.09)] px-2.5 py-2"
              >
                <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#6d5a7d]">
                  当前为 AI 实验
                </span>
                <span className="truncate text-[11.5px] text-ink" title={aiSpec.title}>
                  {aiSpec.title}
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          <PaperImageInput onImageLoaded={() => onNavigate('workbench')} />

          <form className="flex flex-col gap-2" onSubmit={handleSubmit}>
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
                  <div className="flex items-center gap-2">
                    <motion.button
                      whileTap={refining || loading || healing ? undefined : TAP_BUTTON}
                      className="flex-1 rounded-lg border border-transparent bg-[#6d5a7d] px-3 py-[6px] text-[11px] font-semibold text-[#fbf7ef] transition-colors enabled:hover:bg-[#5d4b6c] disabled:cursor-not-allowed disabled:opacity-45"
                      type="submit"
                      disabled={refining || loading || healing}
                    >
                      {refining ? '应用中…' : '应用修改'}
                    </motion.button>
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

      <AnimatePresence>
        {workspaceOpen && <WorkspaceDialog onClose={() => setWorkspaceOpen(false)} />}
      </AnimatePresence>
    </aside>
  )
}
