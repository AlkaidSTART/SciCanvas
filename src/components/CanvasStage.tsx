import { useMemo } from 'react'
import type { RefObject } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { AnimatePresence, motion } from 'motion/react'
import type { RuntimeErrorInfo, RuntimeStatus } from '../runtime/CanvasRuntime'
import { SANDBOX_HTML } from '../runtime/sandboxBootstrap'
import { useWorkbenchStore } from '../store/useWorkbenchStore'
import { AlertIcon } from './icons'
import {
  BACKDROP_VARIANTS,
  DIALOG_VARIANTS,
  FAST_TRANSITION,
  FLOAT_UP_VARIANTS,
  MEDIUM_TRANSITION,
  TAP_BUTTON,
} from './motion'
import { ProbeOverlay, TelemetryOverlay } from './StageOverlays'

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
  'first-frame': '首帧绘制阶段',
  step: '推演阶段',
  draw: '绘制阶段',
}

export function CanvasStage({ canvasRef, iframeRef, onRetry }: CanvasStageProps) {
  const experiment = useWorkbenchStore((state) => state.experiment)
  const source = useWorkbenchStore((state) => state.source)
  const aiSpec = useWorkbenchStore((state) => state.aiSpec)
  const usesSandbox = source === 'ai' && aiSpec?.renderType === 'canvas2d'
  const status = useWorkbenchStore((state) => state.status)
  const error = useWorkbenchStore((state) => state.error)
  const heal = useWorkbenchStore((state) => state.heal)
  const presentation = useWorkbenchStore((state) => state.presentation)
  const rightPanelOpen = useWorkbenchStore((state) => state.rightPanelOpen)
  const resetToDefault = useWorkbenchStore((state) => state.resetToDefault)
  const restoreLastGoodAi = useWorkbenchStore((state) => state.restoreLastGoodAi)
  const resetHeal = useWorkbenchStore((state) => state.resetHeal)
  const retryFailedHeal = useWorkbenchStore((state) => state.retryFailedHeal)
  const showError = Boolean(error) && heal.status === 'idle'
  const formulaDockedOnDesktop = !presentation && rightPanelOpen

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
      {usesSandbox ? (
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

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={`formula-${experiment.id}`}
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={MEDIUM_TRANSITION}
          className={`formula-overlay pointer-events-none absolute left-[18px] top-[18px] w-[min(430px,calc(100%_-_150px))] rounded-xl border border-line bg-panel/85 px-4 pb-3.5 pt-[13px] shadow-[0_16px_36px_rgba(58,51,43,0.1)] backdrop-blur-md max-[959px]:w-[min(380px,calc(100%_-_36px))] max-[640px]:inset-x-3 max-[640px]:top-3 max-[640px]:w-auto max-[640px]:px-[13px] max-[640px]:py-[11px] ${
            formulaDockedOnDesktop ? 'min-[960px]:hidden' : ''
          }`}
        >
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
        </motion.div>
      </AnimatePresence>

      <div className="absolute right-[18px] top-[18px] flex items-center gap-[7px] rounded-full border border-line bg-panel/85 px-2.5 py-[5px] font-mono text-[10.5px] text-ink-dim backdrop-blur-sm max-[640px]:bottom-3 max-[640px]:right-3 max-[640px]:top-auto">
        <span className={`size-1.5 rounded-full transition-colors ${STATUS_DOT_STYLE[status]}`} />
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={status}
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -3 }}
            transition={FAST_TRANSITION}
          >
            {STATUS_LABEL[status]}
          </motion.span>
        </AnimatePresence>
      </div>

      <TelemetryOverlay />
      <ProbeOverlay />

      <AnimatePresence>
        {source === 'ai' && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={FAST_TRANSITION}
            className="pointer-events-none absolute bottom-3 left-[18px] rounded-full border border-line bg-panel/80 px-2.5 py-[5px] font-mono text-[9.5px] text-ink-faint backdrop-blur-sm max-[640px]:hidden"
          >
            {usesSandbox ? '隔离沙盒运行 · 无主应用与网络权限' : '声明式点线渲染 · 零代码沙盒'}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showError && error && (
          <motion.div
            variants={BACKDROP_VARIANTS}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="absolute inset-0 z-[6] grid place-items-center bg-[#f6f1e7]/85 p-6 backdrop-blur-sm"
            role="alert"
          >
            <motion.div
              variants={DIALOG_VARIANTS}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="grid w-[min(470px,100%)] grid-cols-[40px_minmax(0,1fr)] gap-x-3.5 gap-y-1.5 rounded-[14px] border border-rose/35 bg-[linear-gradient(160deg,#fdfaf3,#fbf0ea)] p-5 shadow-[0_16px_36px_rgba(58,51,43,0.12)]"
            >
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
                <motion.button
                  whileTap={TAP_BUTTON}
                  className="rounded-lg border border-transparent bg-accent-strong px-3.5 py-[7px] text-xs font-semibold text-[#fbf7ef] transition-colors enabled:hover:bg-accent disabled:cursor-not-allowed disabled:opacity-45"
                  type="button"
                  onClick={onRetry}
                >
                  {usesSandbox ? '重新初始化沙盒' : '重新初始化'}
                </motion.button>
                <motion.button
                  whileTap={TAP_BUTTON}
                  className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-ink-dim transition-colors enabled:hover:border-line-strong enabled:hover:bg-surface-soft enabled:hover:text-ink disabled:cursor-not-allowed disabled:opacity-45"
                  type="button"
                  onClick={resetToDefault}
                >
                  回到默认实验
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {heal.status !== 'idle' && (
          <motion.div
            variants={FLOAT_UP_VARIANTS}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="pointer-events-none absolute inset-x-0 bottom-16 z-[7] flex justify-center px-4 max-[640px]:bottom-14"
          >
            <div
              className={`pointer-events-auto flex w-[min(540px,100%)] flex-col gap-2 rounded-[12px] border bg-panel/95 px-4 py-3 shadow-[0_16px_36px_rgba(58,51,43,0.14)] backdrop-blur-md ${
                heal.status === 'failed' ? 'border-rose/40' : 'border-line'
              }`}
              role="status"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`size-1.5 flex-none rounded-full ${
                    heal.status === 'failed'
                      ? 'bg-danger'
                      : heal.status === 'succeeded'
                        ? 'bg-mint'
                        : 'animate-pulse-soft bg-amber'
                  }`}
                />
                <strong className="text-[12px] font-semibold text-ink">
                  {heal.status === 'failed'
                    ? '自动修复失败'
                    : heal.status === 'succeeded'
                      ? '自动修复完成'
                      : '自动修复中'}
                </strong>
                <span className="ml-auto font-mono text-[10px] tabular-nums text-ink-faint">
                  {Math.max(heal.attempt, 1)}/{heal.maxAttempts}
                </span>
              </div>
              <p className="m-0 text-[11px] leading-[1.55] text-ink-dim">
                {heal.status === 'requesting' && '正在请求模型修复当前错误…'}
                {heal.status === 'applied' && '修复结果已应用，正在验证初始化…'}
                {heal.status === 'succeeded' && (heal.message || '修复结果已通过初始化')}
                {heal.status === 'failed' &&
                  `${heal.message}；已恢复可用实验，可继续操作。`}
              </p>
              {heal.status === 'failed' && (
                <div className="flex flex-wrap gap-2">
                  <motion.button
                    whileTap={heal.failed ? TAP_BUTTON : undefined}
                    className="rounded-lg border border-transparent bg-accent-strong px-3 py-[6px] text-[11px] font-semibold text-[#fbf7ef] transition-colors enabled:hover:bg-accent disabled:cursor-not-allowed disabled:opacity-45"
                    type="button"
                    disabled={!heal.failed}
                    onClick={retryFailedHeal}
                  >
                    再试一次
                  </motion.button>
                  <motion.button
                    whileTap={TAP_BUTTON}
                    className="rounded-lg border border-line bg-surface px-3 py-[6px] text-[11px] text-ink-dim transition-colors enabled:hover:border-line-strong enabled:hover:bg-surface-soft enabled:hover:text-ink"
                    type="button"
                    onClick={() => {
                      restoreLastGoodAi()
                    }}
                  >
                    恢复上一版本
                  </motion.button>
                  <motion.button
                    whileTap={TAP_BUTTON}
                    className="rounded-lg border border-line bg-surface px-3 py-[6px] text-[11px] text-ink-dim transition-colors enabled:hover:border-line-strong enabled:hover:bg-surface-soft enabled:hover:text-ink"
                    type="button"
                    onClick={resetHeal}
                  >
                    关闭
                  </motion.button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}
