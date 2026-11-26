import { useMemo, useState } from 'react'
import katex from 'katex'
import { AnimatePresence, motion } from 'motion/react'
import { isCornerCaseActive } from '../runtime/params'
import { useWorkbenchStore } from '../store/useWorkbenchStore'
import { ControlField } from './ControlBar'
import {
  COLLAPSE_VARIANTS,
  FAST_TRANSITION,
  MEDIUM_TRANSITION,
  TAP_BUTTON,
} from './motion'
import { TelemetryMetrics } from './StageOverlays'

/**
 * 桌面工作台右侧检查器：承接公式与机理、边界快捷态、参数滑块与实时遥测，
 * 让画布获得最大纵深，避免任何浮层遮挡或垂直溢出。
 */
export function InspectorPanel() {
  const experiment = useWorkbenchStore((state) => state.experiment)
  const params = useWorkbenchStore((state) => state.params)
  const status = useWorkbenchStore((state) => state.status)
  const source = useWorkbenchStore((state) => state.source)
  const telemetrySamples = useWorkbenchStore((state) => state.telemetry)
  const presentation = useWorkbenchStore((state) => state.presentation)
  const rightPanelOpen = useWorkbenchStore((state) => state.rightPanelOpen)
  const setParam = useWorkbenchStore((state) => state.setParam)
  const resetParams = useWorkbenchStore((state) => state.resetParams)
  const applyCornerCase = useWorkbenchStore((state) => state.applyCornerCase)

  const [insightExpanded, setInsightExpanded] = useState(true)

  const formulaHtml = useMemo(
    () =>
      katex.renderToString(experiment.formulaLatex, {
        throwOnError: false,
        displayMode: true,
        strict: false,
      }),
    [experiment.formulaLatex],
  )

  if (presentation || !rightPanelOpen) return null

  const disabled = status === 'error'
  const cornerCases = experiment.cornerCases ?? []
  const telemetry = source !== 'ai' && experiment.telemetry && experiment.telemetry.metrics.length > 0
    ? experiment.telemetry
    : null

  return (
    <motion.aside
      initial={{ opacity: 0, x: 14 }}
      animate={{ opacity: 1, x: 0 }}
      transition={MEDIUM_TRANSITION}
      className="hidden min-h-0 flex-col overflow-hidden border-l border-line bg-[linear-gradient(180deg,#fcf9f2,#f7f1e7)] min-[960px]:flex"
      aria-label="实验参数检查器"
    >
      <div className="flex h-[36px] flex-none items-center justify-between gap-2 border-b border-line px-3.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.13em] text-ink-faint">
            检查器
          </span>
          {source === 'ai' && (
            <span className="rounded-[4px] border border-[rgba(138,118,168,0.36)] bg-[rgba(138,118,168,0.1)] px-1 py-px font-mono text-[8.5px] text-[#6d5a7d]">
              AI
            </span>
          )}
        </div>
        <motion.button
          whileTap={disabled ? undefined : TAP_BUTTON}
          className="rounded-md border border-line bg-surface px-2 py-[2px] text-[10px] text-ink-dim transition-colors enabled:hover:border-line-strong enabled:hover:bg-surface-soft enabled:hover:text-ink disabled:cursor-not-allowed disabled:opacity-45"
          type="button"
          disabled={disabled}
          onClick={resetParams}
          title="将当前实验的所有参数恢复为默认值"
        >
          默认参数
        </motion.button>
      </div>

      <div className="workbench-scroll min-h-0 flex-1 divide-y divide-line overflow-y-auto">
        <section className="flex flex-col gap-2 px-3.5 py-3">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-mono text-[9.5px] uppercase tracking-[0.12em] text-accent-strong">
              {experiment.domain}
            </span>
            <button
              className="flex-none text-[10px] text-ink-faint transition-colors hover:text-ink-dim"
              type="button"
              onClick={() => setInsightExpanded((prev) => !prev)}
            >
              {insightExpanded ? '收起说明' : '展开说明'}
            </button>
          </div>

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={experiment.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={FAST_TRANSITION}
              className="workbench-scroll overflow-x-auto overflow-y-hidden rounded-[9px] border border-line bg-surface px-2.5 py-2 text-ink [&_.katex-display]:m-0 [&_.katex]:text-[0.95em]"
              // KaTeX 输出的 HTML 由本地库生成，不包含外部输入脚本
              dangerouslySetInnerHTML={{ __html: formulaHtml }}
            />
          </AnimatePresence>

          <AnimatePresence initial={false}>
            {insightExpanded && (
              <motion.p
                key="inspector-insight"
                variants={COLLAPSE_VARIANTS}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="m-0 text-[11px] leading-[1.6] text-ink-dim"
              >
                {experiment.insight}
              </motion.p>
            )}
          </AnimatePresence>
        </section>

        {cornerCases.length > 0 && (
          <section className="flex flex-col gap-2 px-3.5 py-3" aria-label="边界快捷态">
            <div className="flex items-center justify-between gap-2">
              <h2 className="m-0 font-mono text-[9.5px] font-semibold uppercase tracking-[0.13em] text-ink-faint">
                边界快捷态
              </h2>
              <span className="font-mono text-[9px] text-ink-faint">{cornerCases.length} 组</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {cornerCases.map((cornerCase) => {
                const active = isCornerCaseActive(cornerCase, params)
                return (
                  <motion.button
                    key={cornerCase.id}
                    whileTap={disabled ? undefined : TAP_BUTTON}
                    className={`rounded-full border px-2.5 py-[4px] text-[10.5px] leading-none transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                      active
                        ? 'border-accent-line bg-accent-soft text-accent-strong'
                        : 'border-line bg-surface text-ink-dim enabled:hover:border-line-strong enabled:hover:bg-surface-soft enabled:hover:text-ink'
                    }`}
                    type="button"
                    disabled={disabled}
                    aria-pressed={active}
                    title={cornerCase.description ?? '一键切换参数并重置仿真'}
                    onClick={() => applyCornerCase(cornerCase.id)}
                  >
                    {cornerCase.label}
                  </motion.button>
                )
              })}
            </div>
          </section>
        )}

        <section className="flex flex-col gap-3 px-3.5 py-3" aria-label="参数调节">
          <div className="flex items-center justify-between gap-2">
            <h2 className="m-0 font-mono text-[9.5px] font-semibold uppercase tracking-[0.13em] text-ink-faint">
              参数调节
            </h2>
            <span className="font-mono text-[9px] tabular-nums text-ink-faint">
              {experiment.controls.length} 项
            </span>
          </div>

          <motion.div
            key={`controls-${experiment.id}`}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={FAST_TRANSITION}
            className="flex flex-col gap-3"
          >
            {experiment.controls.map((control) => (
              <ControlField
                key={control.key}
                control={control}
                value={params[control.key]}
                disabled={disabled}
                onChange={setParam}
                idPrefix="inspector"
              />
            ))}
          </motion.div>
        </section>

        {telemetry && (
          <section className="flex flex-col gap-2 px-3.5 py-3" aria-label="实时遥测">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="m-0 font-mono text-[9.5px] font-semibold uppercase tracking-[0.13em] text-ink-faint">
                实时遥测
              </h2>
              <span className="font-mono text-[9px] tabular-nums text-ink-faint">
                {telemetrySamples.length} 点
              </span>
            </div>
            <TelemetryMetrics metrics={telemetry.metrics} samples={telemetrySamples} />
            <p className="m-0 text-[9.5px] text-ink-faint">有界缓存 · 暂停后冻结采样</p>
          </section>
        )}
      </div>
    </motion.aside>
  )
}
