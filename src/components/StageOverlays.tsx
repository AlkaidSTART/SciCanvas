import { useWorkbenchStore } from '../store/useWorkbenchStore'
import type { TelemetryMetric, TelemetrySample } from '../types/experiment'

function formatMetric(metric: TelemetryMetric, value: number): string {
  const text = value.toFixed(metric.precision ?? 2)
  return metric.unit ? `${text} ${metric.unit}` : text
}

/** 轻量折线：固定 viewBox 交给 SVG 拉伸，不涉及 DPR 与额外画布。 */
function Sparkline({ samples, metric }: { samples: TelemetrySample[]; metric: TelemetryMetric }) {
  const values: number[] = []
  for (const sample of samples) {
    const value = sample.values[metric.key]
    if (typeof value === 'number' && Number.isFinite(value)) values.push(value)
  }
  if (values.length < 2) return null

  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const stepX = 100 / (values.length - 1)
  const points = values
    .map((value, index) => `${(index * stepX).toFixed(2)},${(24 - ((value - min) / span) * 20).toFixed(2)}`)
    .join(' ')

  return (
    <svg
      className="block h-6 w-full"
      viewBox="0 0 100 24"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke={metric.color}
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

export function TelemetryMetrics({
  metrics,
  samples,
}: {
  metrics: TelemetryMetric[]
  samples: TelemetrySample[]
}) {
  const latest = samples.length > 0 ? samples[samples.length - 1] : null
  if (!latest) {
    return <p className="m-0 py-1.5 text-[10.5px] text-ink-faint">等待采样…</p>
  }

  return (
    <div className="flex flex-col gap-2">
      {metrics.map((metric) => {
        const value = latest.values[metric.key]
        return (
          <div key={metric.key} className="flex flex-col gap-0.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5 text-[10.5px] text-ink-dim">
                <span
                  className="size-1.5 flex-none rounded-full"
                  style={{ backgroundColor: metric.color }}
                />
                <span className="truncate">{metric.label}</span>
              </span>
              <span className="whitespace-nowrap font-mono text-[10.5px] tabular-nums text-ink">
                {typeof value === 'number' ? formatMetric(metric, value) : '—'}
              </span>
            </div>
            <Sparkline samples={samples} metric={metric} />
          </div>
        )
      })}
    </div>
  )
}

/**
 * 遥测浮层只在实验声明 telemetry 且来自本地预设时出现；
 * 桌面工作台右侧检查器展开时由检查器承接，避免遮挡画布。
 */
export function TelemetryOverlay() {
  const experiment = useWorkbenchStore((state) => state.experiment)
  const source = useWorkbenchStore((state) => state.source)
  const samples = useWorkbenchStore((state) => state.telemetry)
  const presentation = useWorkbenchStore((state) => state.presentation)
  const rightPanelOpen = useWorkbenchStore((state) => state.rightPanelOpen)
  const telemetry = experiment.telemetry
  if (source === 'ai' || !telemetry || telemetry.metrics.length === 0) return null

  const dockedOnDesktop = !presentation && rightPanelOpen

  return (
    <div
      className={`pointer-events-none absolute bottom-[18px] right-[18px] z-[5] w-[196px] rounded-xl border border-line bg-panel/88 px-3 pb-2.5 pt-2 shadow-[0_12px_28px_rgba(58,51,43,0.1)] backdrop-blur-md max-[640px]:hidden ${
        dockedOnDesktop ? 'min-[960px]:hidden' : ''
      }`}
    >
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="font-mono text-[9px] uppercase tracking-[0.13em] text-ink-faint">
          实时遥测
        </span>
        <span className="font-mono text-[9px] tabular-nums text-ink-faint">
          {samples.length} 点
        </span>
      </div>

      <TelemetryMetrics metrics={telemetry.metrics} samples={samples} />

      <p className="m-0 mt-1.5 border-t border-line pt-1.5 text-[9px] leading-none text-ink-faint">
        有界缓存 · 暂停后冻结采样
      </p>
    </div>
  )
}

/**
 * 悬停探针：读数来自实验声明的 read 回调，坐标由运行时换算为 CSS 像素。
 * 未声明 probe 或指针不在有效区域时不显示任何数值。
 */
export function ProbeOverlay() {
  const experiment = useWorkbenchStore((state) => state.experiment)
  const source = useWorkbenchStore((state) => state.source)
  const probe = useWorkbenchStore((state) => state.probe)
  const definition = experiment.probe

  if (source === 'ai' || !definition) return null

  if (!probe) {
    return (
      <div className="pointer-events-none absolute bottom-3 left-[18px] z-[5] rounded-full border border-line bg-panel/80 px-2.5 py-[5px] font-mono text-[9.5px] text-ink-faint backdrop-blur-sm max-[640px]:hidden">
        {definition.hint ?? '悬停画布查看局部值'}
      </div>
    )
  }

  const left = `clamp(8px, ${probe.point.x + 16}px, calc(100% - 218px))`
  const top = `clamp(8px, ${probe.point.y + 16}px, calc(100% - 108px))`

  return (
    <div
      className="pointer-events-none absolute z-[6] w-[202px] rounded-[10px] border border-line bg-panel/94 px-3 py-2 shadow-[0_10px_24px_rgba(58,51,43,0.14)] backdrop-blur-md"
      style={{ left, top }}
      role="status"
    >
      <div className="mb-1 font-mono text-[9.5px] text-ink-faint">{probe.reading.position}</div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-[10.5px] text-ink-dim">{probe.reading.label}</span>
        <span className="whitespace-nowrap font-mono text-[11px] font-semibold tabular-nums text-ink">
          {probe.reading.value}
        </span>
      </div>
      {probe.reading.detail && (
        <div className="mt-1 border-t border-line pt-1 font-mono text-[9.5px] leading-[1.5] text-ink-faint">
          {probe.reading.detail}
        </div>
      )}
    </div>
  )
}
