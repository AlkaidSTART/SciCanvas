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

export function SidePanel() {
  const experiment = useWorkbenchStore((state) => state.experiment)
  const status = useWorkbenchStore((state) => state.status)
  const source = useWorkbenchStore((state) => state.source)
  const aiSpec = useWorkbenchStore((state) => state.aiSpec)
  const selectExperiment = useWorkbenchStore((state) => state.selectExperiment)
  const applyGeneratedExperiment = useWorkbenchStore((state) => state.applyGeneratedExperiment)
  const resetToDefault = useWorkbenchStore((state) => state.resetToDefault)

  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const controllerRef = useRef<AbortController | null>(null)

  useEffect(() => () => controllerRef.current?.abort(), [])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (loading) return
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
            M3
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
              disabled={loading}
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
      </section>

      <div className="mt-auto flex items-center gap-2 border-t border-line pt-3.5 text-[10.5px] text-ink-faint max-[980px]:hidden">
        <span className="size-1.5 flex-none rounded-full bg-mint shadow-[0_0_0_3px_rgba(103,184,154,0.18)]" />
        本地内置实验 · 无需登录 / API
      </div>
    </aside>
  )
}
