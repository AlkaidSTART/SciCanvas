import { useMemo } from 'react'
import type { RefObject } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import type { RuntimeErrorInfo, RuntimeStatus } from '../runtime/CanvasRuntime'
import { SANDBOX_HTML } from '../runtime/sandboxBootstrap'
import { useWorkbenchStore } from '../store/useWorkbenchStore'
import { AlertIcon } from './icons'

interface CanvasStageProps {
  canvasRef: RefObject<HTMLCanvasElement | null>
  iframeRef: RefObject<HTMLIFrameElement | null>
  onRetry: () => void
}

const STATUS_LABEL: Record<RuntimeStatus, string> = {
  running: '运行中',
  paused: '已暂停',
  error: '模型异常',
}

const STATUS_DOT_STYLE: Record<RuntimeStatus, string> = {
  running: 'bg-mint shadow-[0_0_0_3px_rgba(103,184,154,0.2)]',
  paused: 'bg-amber',
  error: 'bg-danger',
}

const SCOPE_LABEL: Record<RuntimeErrorInfo['scope'], string> = {
  init: '初始化阶段',
  step: '推演阶段',
  draw: '绘制阶段',
}

export function CanvasStage({ canvasRef, iframeRef, onRetry }: CanvasStageProps) {
  const experiment = useWorkbenchStore((state) => state.experiment)
  const source = useWorkbenchStore((state) => state.source)
  const status = useWorkbenchStore((state) => state.status)
  const error = useWorkbenchStore((state) => state.error)
  const resetToDefault = useWorkbenchStore((state) => state.resetToDefault)

  const formulaHtml = useMemo(
    () =>
      katex.renderToString(experiment.formulaLatex, {
        throwOnError: false,
        displayMode: true,
        strict: false,
      }),
    [experiment.formulaLatex],
  )

  return (
    <section className="canvas-stage relative min-h-0 flex-1 overflow-hidden bg-surface" aria-label="实验画布">
      {source === 'ai' ? (
        <iframe
          ref={iframeRef}
          className="block h-full w-full border-0"
          title="AI 实验隔离沙盒"
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          srcDoc={SANDBOX_HTML}
        />
      ) : (
        <canvas ref={canvasRef} className="block h-full w-full" />
      )}

      <div className="formula-overlay pointer-events-none absolute left-[18px] top-[18px] w-[min(430px,calc(100%_-_150px))] rounded-xl border border-line bg-panel/85 px-4 pb-3.5 pt-[13px] shadow-[0_16px_36px_rgba(58,51,43,0.1)] backdrop-blur-md max-[980px]:w-[min(380px,calc(100%_-_36px))] max-[640px]:inset-x-3 max-[640px]:top-3 max-[640px]:w-auto max-[640px]:px-[13px] max-[640px]:py-[11px]">
        <div className="mb-2 flex flex-col gap-[3px]">
          <span className="flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-accent-strong">
            {experiment.domain}
            {source === 'ai' && (
              <span className="rounded-[4px] border border-[rgba(138,118,168,0.4)] bg-[rgba(138,118,168,0.12)] px-1 py-px text-[8.5px] tracking-[0.08em] text-[#6d5a7d] normal-case">
                AI 生成
              </span>
            )}
          </span>
          <span className="text-[13px] font-semibold text-ink">{experiment.title}</span>
        </div>
        <div
          className="overflow-y-hidden overflow-x-auto pb-1.5 pt-0.5 text-ink [&_.katex]:text-[1.02em] [&_.katex-display]:m-0 max-[640px]:pb-0"
          // KaTeX 输出的 HTML 由本地库生成，不包含外部输入脚本
          dangerouslySetInnerHTML={{ __html: formulaHtml }}
        />
        <p className="m-0 border-t border-line pt-[9px] text-[11.5px] leading-[1.65] text-ink-dim max-[640px]:hidden [@media(max-height:900px)]:hidden">
          {experiment.insight}
        </p>
      </div>

      <div className="absolute right-[18px] top-[18px] flex items-center gap-[7px] rounded-full border border-line bg-panel/85 px-2.5 py-[5px] font-mono text-[10.5px] text-ink-dim backdrop-blur-sm max-[640px]:bottom-3 max-[640px]:right-3 max-[640px]:top-auto">
        <span className={`size-1.5 rounded-full ${STATUS_DOT_STYLE[status]}`} />
        {STATUS_LABEL[status]}
      </div>

      {source === 'ai' && (
        <div className="pointer-events-none absolute bottom-3 left-[18px] rounded-full border border-line bg-panel/80 px-2.5 py-[5px] font-mono text-[9.5px] text-ink-faint backdrop-blur-sm max-[640px]:hidden">
          隔离沙盒运行 · 无主应用与网络权限
        </div>
      )}

      {error && (
        <div
          className="absolute inset-0 z-[6] grid place-items-center bg-[#f6f1e7]/85 p-6 backdrop-blur-sm"
          role="alert"
        >
          <div className="grid w-[min(470px,100%)] grid-cols-[40px_minmax(0,1fr)] gap-x-3.5 gap-y-1.5 rounded-[14px] border border-rose/35 bg-[linear-gradient(160deg,#fdfaf3,#fbf0ea)] p-5 shadow-[0_16px_36px_rgba(58,51,43,0.12)]">
            <div className="grid size-10 place-items-center rounded-[11px] border border-rose/30 bg-rose/[0.14] text-danger">
              <AlertIcon className="size-[22px]" />
            </div>
            <div>
              <h2 className="mb-[3px] mt-0 text-sm text-ink">模型运行异常</h2>
              <p className="m-0 text-[11px] leading-normal text-ink-dim">
                {SCOPE_LABEL[error.scope]} · 已隔离，不影响工作台其他区域
              </p>
            </div>
            <pre className="col-span-full my-0.5 mt-2.5 max-h-[140px] overflow-auto whitespace-pre-wrap break-words rounded-[9px] border border-line bg-[#fbeeea] px-3 py-2.5 font-mono text-[11px] leading-[1.55] text-[#a9605f]">
              {error.message}
            </pre>
            <div className="col-span-full mt-2 flex flex-wrap gap-2.5">
              <button
                className="rounded-lg border border-transparent bg-accent-strong px-3.5 py-[7px] text-xs font-semibold text-[#fbf7ef] transition-colors enabled:hover:bg-accent disabled:cursor-not-allowed disabled:opacity-45"
                type="button"
                onClick={onRetry}
              >
                {source === 'ai' ? '重新初始化沙盒' : '重新初始化'}
              </button>
              <button
                className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-ink-dim transition-colors enabled:hover:border-line-strong enabled:hover:bg-surface-soft enabled:hover:text-ink disabled:cursor-not-allowed disabled:opacity-45"
                type="button"
                onClick={resetToDefault}
              >
                回到默认实验
              </button>
            </div>
            <p className="col-span-full mb-0 mt-1.5 text-[10.5px] text-ink-faint">
              M4 将在此基础上接入自动修复。
            </p>
          </div>
        </div>
      )}
    </section>
  )
}
