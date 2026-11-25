import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { generateExperiment } from '../ai/client'
import { MAX_PROMPT_LENGTH } from '../ai/prompt'
import { EXPERIMENTS } from '../experiments'
import type { RuntimeStatus } from '../runtime/CanvasRuntime'
import { useWorkbenchStore } from '../store/useWorkbenchStore'

const STATUS_LABEL: Record<RuntimeStatus, string> = {
  running: '运行中',
  paused: '已暂停',
  error: '待恢复',
}

const DOT_STYLE: Record<RuntimeStatus, string> = {
  running: 'bg-mint shadow-[0_0_0_3px_rgba(103,184,154,0.2)] animate-pulse-soft',
  paused: 'bg-amber',
  error: 'bg-danger',
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

export function SidePanel() {
  const experiment = useWorkbenchStore((state) => state.experiment)
  const status = useWorkbenchStore((state) => state.status)
  const source = useWorkbenchStore((state) => state.source)
  const aiSpec = useWorkbenchStore((state) => state.aiSpec)
  const healStatus = useWorkbenchStore((state) => state.heal.status)
  const healing = healStatus === 'requesting' || healStatus === 'applied'
  const selectExperiment = useWorkbenchStore((state) => state.selectExperiment)
  const applyGeneratedExperiment = useWorkbenchStore((state) => state.applyGeneratedExperiment)
  const resetToDefault = useWorkbenchStore((state) => state.resetToDefault)

  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [refineText, setRefineText] = useState('')
  const [refining, setRefining] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const refineControllerRef = useRef<AbortController | null>(null)

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
    try {
      const spec = await generateExperiment(text, { signal: controller.signal })
      applyGeneratedExperiment(spec)
    } catch (error) {
      if (!controller.signal.aborted) {
        setAiError(error instanceof Error ? error.message : '生成失败，请稍后重试')
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
    } catch (error) {
      if (!controller.signal.aborted) {
        setAiError(error instanceof Error ? error.message : '修改失败，已保留当前实验')
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
    <aside className="preset-scroll flex flex-col gap-6 overflow-y-auto border-r border-line bg-[linear-gradient(180deg,#fcf9f2,#f7f1e7)] px-4 py-[18px] max-[980px]:flex-row max-[980px]:items-stretch max-[980px]:gap-3.5 max-[980px]:overflow-x-auto max-[980px]:overflow-y-hidden max-[980px]:border-b max-[980px]:border-r-0 max-[980px]:px-3 max-[980px]:py-2.5">
      <section className="flex flex-col gap-2.5 max-[980px]:min-w-[230px] max-[980px]:flex-none">
        <h2 className="m-0 flex items-center justify-between gap-2 text-[10.5px] font-semibold uppercase tracking-[0.13em] text-ink-faint">
          预设实验
          <span className="rounded-[5px] border border-line bg-ink-dim/10 px-1.5 py-0.5 font-mono text-[9px] normal-case tracking-normal text-ink-dim">
            {EXPERIMENTS.length} 例
          </span>
        </h2>
        <div className="flex flex-col gap-1.5 max-[980px]:flex-row max-[980px]:gap-2">
          {EXPERIMENTS.map((preset) => {
            const active = source === 'preset' && preset.id === experiment.id
            return (
              <button
                key={preset.id}
                className={`flex w-full items-center gap-2.5 rounded-[10px] border px-[11px] py-2.5 text-left transition-colors max-[980px]:w-auto max-[980px]:min-w-[182px] max-[980px]:flex-none ${
                  active
                    ? 'border-[rgba(224,162,121,0.42)] bg-[linear-gradient(135deg,rgba(240,205,178,0.42),rgba(240,205,178,0.12))] shadow-[0_1px_2px_rgba(58,51,43,0.05)]'
                    : 'border-line bg-surface/55 hover:border-line-strong hover:bg-surface-soft'
                }`}
                type="button"
                onClick={() => selectExperiment(preset.id)}
                aria-current={active ? 'true' : undefined}
                title={preset.insight}
              >
                <span
                  className={`size-[7px] flex-none rounded-full ${
                    active ? DOT_STYLE[status] : 'bg-[rgba(120,100,78,0.25)]'
                  }`}
                />
                <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                  <strong className="text-[12.5px] font-[550] leading-[1.35] text-ink">
                    {preset.title}
                  </strong>
                  <small className="text-[10px] text-ink-faint">{preset.domain}</small>
                </span>
                {active && (
                  <span className="whitespace-nowrap font-mono text-[9px] text-accent-strong">
                    {STATUS_LABEL[status]}
                  </span>
                )}
              </button>
            )
          })}
        </div>
        <p className="m-0 text-[10.5px] leading-[1.55] text-ink-faint">
          全部案例本地运行，切换时按默认参数重新初始化
        </p>
      </section>

      <section className="flex flex-col gap-2.5 max-[980px]:hidden">
        <h2 className="m-0 flex items-center justify-between gap-2 text-[10.5px] font-semibold uppercase tracking-[0.13em] text-ink-faint">
          AI 实验生成
          <span className="rounded-[5px] border border-line bg-ink-dim/10 px-1.5 py-0.5 font-mono text-[9px] normal-case tracking-normal text-ink-dim">
            M4
          </span>
        </h2>

        {source === 'ai' && aiSpec && (
          <div className="flex flex-col gap-1 rounded-[9px] border border-[rgba(138,118,168,0.32)] bg-[rgba(138,118,168,0.09)] px-2.5 py-2">
            <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#6d5a7d]">
              当前为 AI 实验
            </span>
            <span className="truncate text-[11.5px] text-ink" title={aiSpec.title}>
              {aiSpec.title}
            </span>
          </div>
        )}

        <form className="flex flex-col gap-2" onSubmit={handleSubmit}>
          <textarea
            className="resize-none rounded-[9px] border border-line bg-surface-soft px-2.5 py-[9px] text-[11.5px] leading-[1.55] text-ink placeholder:text-ink-faint focus:border-accent-line focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
            rows={4}
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
                <button
                  key={example}
                  className="truncate rounded-[5px] border border-line bg-surface px-1.5 py-0.5 text-[9.5px] text-ink-faint transition-colors enabled:hover:border-line-strong enabled:hover:text-ink-dim disabled:cursor-not-allowed disabled:opacity-50"
                  type="button"
                  disabled={loading}
                  title={example}
                  onClick={() => setPrompt(example)}
                >
                  示例 {index + 1}
                </button>
              ))}
            </div>
            <span className="whitespace-nowrap font-mono tabular-nums">
              {prompt.length}/{MAX_PROMPT_LENGTH}
            </span>
          </div>

          <div className="flex gap-2">
            <button
              className="flex-1 rounded-lg border border-transparent bg-accent-strong px-3.5 py-[7px] text-xs font-semibold text-[#fbf7ef] transition-colors enabled:hover:bg-accent disabled:cursor-not-allowed disabled:opacity-45"
              type="submit"
              disabled={loading || refining || healing}
            >
              {loading ? '生成中…' : '生成实验'}
            </button>
            {loading ? (
              <button
                className="rounded-lg border border-line bg-surface px-3 py-[7px] text-xs text-ink-dim transition-colors enabled:hover:border-line-strong enabled:hover:bg-surface-soft enabled:hover:text-ink"
                type="button"
                onClick={handleCancel}
              >
                取消
              </button>
            ) : (
              source === 'ai' && (
                <button
                  className="whitespace-nowrap rounded-lg border border-line bg-surface px-3 py-[7px] text-xs text-ink-dim transition-colors enabled:hover:border-line-strong enabled:hover:bg-surface-soft enabled:hover:text-ink"
                  type="button"
                  onClick={resetToDefault}
                >
                  回到预设
                </button>
              )
            )}
          </div>
        </form>

        {aiError && (
          <p
            className="m-0 rounded-[9px] border border-rose/30 bg-rose/[0.1] px-2.5 py-2 text-[10.5px] leading-[1.55] text-[#a9605f]"
            role="alert"
          >
            {aiError}
          </p>
        )}

        <p className="m-0 text-[9.5px] leading-[1.55] text-ink-faint">
          生成失败不会替换当前实验；服务端未配置凭证时会给出明确提示，预设案例始终可用。
        </p>

        {source === 'ai' && aiSpec && (
          <div className="flex flex-col gap-2 rounded-[10px] border border-[rgba(138,118,168,0.32)] bg-[rgba(138,118,168,0.06)] p-2.5">
            <h3 className="m-0 flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#6d5a7d]">
              基于当前实验修改
              <span className="font-mono text-[9px] normal-case tracking-normal text-ink-faint">
                增量
              </span>
            </h3>

            <div className="flex flex-wrap gap-1.5">
              {INSPIRATION_TAGS.map((tag) => (
                <button
                  key={tag.label}
                  className="rounded-full border border-[rgba(138,118,168,0.32)] bg-surface px-2 py-[3px] text-[9.5px] text-[#6d5a7d] transition-colors enabled:hover:border-[rgba(138,118,168,0.55)] enabled:hover:bg-[rgba(138,118,168,0.1)] disabled:cursor-not-allowed disabled:opacity-50"
                  type="button"
                  disabled={refining || loading || healing}
                  title={tag.instruction}
                  onClick={() => void handleRefine(tag.instruction)}
                >
                  {tag.label}
                </button>
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
                <button
                  className="flex-1 rounded-lg border border-transparent bg-[#6d5a7d] px-3 py-[6px] text-[11px] font-semibold text-[#fbf7ef] transition-colors enabled:hover:bg-[#5d4b6c] disabled:cursor-not-allowed disabled:opacity-45"
                  type="submit"
                  disabled={refining || loading || healing}
                >
                  {refining ? '应用中…' : '应用修改'}
                </button>
                {refining && (
                  <button
                    className="rounded-lg border border-line bg-surface px-2.5 py-[6px] text-[11px] text-ink-dim transition-colors enabled:hover:border-line-strong enabled:hover:bg-surface-soft enabled:hover:text-ink"
                    type="button"
                    onClick={() => {
                      refineControllerRef.current?.abort()
                      refineControllerRef.current = null
                      setRefining(false)
                    }}
                  >
                    取消
                  </button>
                )}
              </div>
            </form>
            <p className="m-0 text-[9.5px] leading-[1.55] text-ink-faint">
              只发送当前 Schema、当前参数与本次指令；校验失败不会替换当前实验。
            </p>
          </div>
        )}
      </section>

      <div className="mt-auto flex items-center gap-2 border-t border-line pt-3.5 text-[10.5px] text-ink-faint max-[980px]:hidden">
        <span className="size-1.5 flex-none rounded-full bg-mint shadow-[0_0_0_3px_rgba(103,184,154,0.18)]" />
        本地内置实验 · 无需登录 / API
      </div>
    </aside>
  )
}
