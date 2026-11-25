import type {
  ExperimentDefinition,
  LegendItem,
  ParamValues,
  Viewport,
} from '../types/experiment'
import { clamp } from './canvasKit'
import { readNumberParam } from '../runtime/params'
import {
  CANVAS,
  drawLegendRow,
  drawPlotFrame,
  drawText,
  paintBackground,
  paintGrid,
  plotTopPadding,
} from './canvasKit'

interface SirSample {
  t: number
  s: number
  i: number
  r: number
}

export interface SirState {
  t: number
  ticks: number
  s: number
  i: number
  r: number
  peakI: number
  peakT: number
  history: SirSample[]
}

/** 1 秒真实时间对应的流行病学天数，让默认疫情在数秒内完整展开。 */
const DAYS_PER_SECOND = 8
const MAX_DAYS = 150
const MAX_HISTORY = 900
const SAMPLE_EVERY = 2

const SERIES: Array<{ key: 's' | 'i' | 'r'; label: string; color: string }> = [
  { key: 's', label: '易感 S', color: CANVAS.blue },
  { key: 'i', label: '感染 I', color: CANVAS.peach },
  { key: 'r', label: '移除 R', color: CANVAS.mint },
]

const LEGEND: LegendItem[] = SERIES.map((series) => ({
  label: series.label,
  color: series.color,
}))

function readRate(params: ParamValues): number {
  return clamp(readNumberParam(params, 'gamma', 0.2), 0.02, 1)
}

function createState(params: ParamValues): SirState {
  const initial = clamp(readNumberParam(params, 'i0', 0.01), 0.0005, 0.2)
  return {
    t: 0,
    ticks: 0,
    s: 1 - initial,
    i: initial,
    r: 0,
    peakI: initial,
    peakT: 0,
    history: [{ t: 0, s: 1 - initial, i: initial, r: 0 }],
  }
}

function step(state: SirState, params: ParamValues, dt: number): SirState {
  if (state.t >= MAX_DAYS) return state

  const r0 = clamp(readNumberParam(params, 'r0', 3), 0, 10)
  const gamma = readRate(params)
  const beta = r0 * gamma
  const dtDays = dt * DAYS_PER_SECOND

  const nextS = Math.max(0, state.s - beta * state.s * state.i * dtDays)
  const nextI = Math.max(0, state.i + (beta * state.s * state.i - gamma * state.i) * dtDays)
  const nextR = Math.max(0, state.r + gamma * state.i * dtDays)
  const total = nextS + nextI + nextR
  const scale = total > 0 ? 1 / total : 1

  const s = nextS * scale
  const i = nextI * scale
  const r = nextR * scale
  const t = state.t + dtDays
  const ticks = state.ticks + 1

  const history = state.history
  if (ticks % SAMPLE_EVERY === 0) {
    history.push({ t, s, i, r })
    if (history.length > MAX_HISTORY) history.shift()
  }

  const infectedPeak = i > state.peakI

  return {
    t,
    ticks,
    s,
    i,
    r,
    peakI: infectedPeak ? i : state.peakI,
    peakT: infectedPeak ? t : state.peakT,
    history,
  }
}

interface ChartLayout {
  plot: { x: number; y: number; width: number; height: number }
  wide: boolean
  panelX: number
  panelWidth: number
  top: number
}

function layout(width: number, height: number): ChartLayout {
  const wide = width >= 680
  const panelWidth = wide ? 178 : 0
  const top = plotTopPadding(width, height)
  return {
    plot: {
      x: 44,
      y: top,
      width: Math.max(80, width - 44 - panelWidth - 24),
      height: Math.max(80, height - top - 46),
    },
    wide,
    panelX: width - panelWidth - 8,
    panelWidth,
    top,
  }
}

function drawChart(
  ctx: CanvasRenderingContext2D,
  state: SirState,
  params: ParamValues,
  chart: ChartLayout,
): { yMax: number; tMax: number } {
  const { plot } = chart
  const yMax = clamp(Math.max(0.12, state.peakI * 1.2, state.i * 1.2), 0.1, 1)
  const tMax = Math.max(30, Math.min(MAX_DAYS, Math.ceil((state.t * 1.08) / 10) * 10))
  const mapX = (t: number): number => plot.x + (t / tMax) * plot.width
  const mapY = (value: number): number => plot.y + plot.height - (value / yMax) * plot.height

  drawPlotFrame(ctx, plot)

  // 网格与刻度
  ctx.save()
  ctx.strokeStyle = CANVAS.gridStrong
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let index = 0; index <= 4; index += 1) {
    const value = (yMax * index) / 4
    const screenY = mapY(value)
    ctx.moveTo(plot.x, screenY)
    ctx.lineTo(plot.x + plot.width, screenY)
  }
  for (let index = 0; index <= 5; index += 1) {
    const screenX = plot.x + (plot.width * index) / 5
    ctx.moveTo(screenX, plot.y)
    ctx.lineTo(screenX, plot.y + plot.height)
  }
  ctx.stroke()
  ctx.restore()

  for (let index = 0; index <= 4; index += 1) {
    const value = (yMax * index) / 4
    drawText(ctx, `${(value * 100).toFixed(0)}%`, plot.x - 8, mapY(value) + 3, {
      align: 'right',
      size: 9,
      color: CANVAS.textFaint,
    })
  }
  for (let index = 0; index <= 5; index += 1) {
    const t = (tMax * index) / 5
    drawText(ctx, `${Math.round(t)} 天`, plot.x + (plot.width * index) / 5, plot.y + plot.height + 16, {
      align: index === 0 ? 'left' : index === 5 ? 'right' : 'center',
      size: 9,
      color: CANVAS.textFaint,
    })
  }

  ctx.save()
  ctx.beginPath()
  ctx.rect(plot.x, plot.y, plot.width, plot.height)
  ctx.clip()

  // 群体免疫阈值：S = 1 - 1/R0
  const r0 = readNumberParam(params, 'r0', 3)
  if (r0 > 1) {
    const threshold = 1 - 1 / r0
    const screenY = mapY(threshold)
    ctx.strokeStyle = CANVAS.amber
    ctx.lineWidth = 1
    ctx.setLineDash([5, 5])
    ctx.beginPath()
    ctx.moveTo(plot.x, screenY)
    ctx.lineTo(plot.x + plot.width, screenY)
    ctx.stroke()
    ctx.setLineDash([])
    drawText(ctx, `免疫阈值 ${(threshold * 100).toFixed(0)}%`, plot.x + 8, screenY - 6, {
      size: 9,
      color: CANVAS.amber,
    })
  }

  for (const series of SERIES) {
    if (state.history.length < 2) continue
    ctx.beginPath()
    state.history.forEach((sample, index) => {
      const screenX = mapX(sample.t)
      const screenY = mapY(sample[series.key])
      if (index === 0) ctx.moveTo(screenX, screenY)
      else ctx.lineTo(screenX, screenY)
    })
    ctx.strokeStyle = series.color
    ctx.lineWidth = 1.8
    ctx.stroke()
  }

  // 峰值标注
  if (state.peakT > 0 && state.peakI > 0.02) {
    const peakX = mapX(state.peakT)
    const peakY = mapY(state.peakI)
    ctx.strokeStyle = CANVAS.peach
    ctx.setLineDash([3, 4])
    ctx.beginPath()
    ctx.moveTo(peakX, plot.y)
    ctx.lineTo(peakX, plot.y + plot.height)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.beginPath()
    ctx.arc(peakX, peakY, 3.6, 0, Math.PI * 2)
    ctx.fillStyle = CANVAS.peach
    ctx.fill()
    drawText(
      ctx,
      `峰值 ${(state.peakI * 100).toFixed(1)}% @ ${state.peakT.toFixed(0)} 天`,
      Math.min(peakX + 8, plot.x + plot.width - 8),
      peakY - 8,
      { size: 9, color: CANVAS.peach, align: peakX > plot.x + plot.width - 140 ? 'right' : 'left' },
    )
  }

  // 当前状态端点
  for (const series of SERIES) {
    const screenX = mapX(state.t)
    const screenY = mapY(state[series.key])
    ctx.beginPath()
    ctx.arc(screenX, screenY, 3, 0, Math.PI * 2)
    ctx.fillStyle = series.color
    ctx.fill()
  }

  ctx.restore()

  drawText(ctx, '人群占比', plot.x - 38, plot.y - 10, { size: 9, color: CANVAS.textFaint })
  drawText(ctx, '时间', plot.x + plot.width - 16, plot.y + plot.height + 30, {
    size: 9,
    color: CANVAS.textFaint,
  })

  return { yMax, tMax }
}

function drawPanel(
  ctx: CanvasRenderingContext2D,
  state: SirState,
  params: ParamValues,
  chart: ChartLayout,
): void {
  const x = chart.panelX
  const top = chart.top
  const width = chart.panelWidth - 10
  const r0 = readNumberParam(params, 'r0', 3)
  const gamma = readRate(params)
  const threshold = r0 > 1 ? 1 - 1 / r0 : 0

  drawText(ctx, '传播指标', x, top, { size: 10, weight: 600, color: CANVAS.textStrong })

  // 当前占比放在最上方，避免窗口较矮时被裁剪。
  const barTop = top + 14
  const barHeight = 8
  let cursor = x
  const segments: Array<{ value: number; color: string }> = [
    { value: state.s, color: CANVAS.blue },
    { value: state.i, color: CANVAS.peach },
    { value: state.r, color: CANVAS.mint },
  ]
  for (const segment of segments) {
    const segmentWidth = width * segment.value
    ctx.fillStyle = segment.color
    ctx.fillRect(cursor, barTop, Math.max(0, segmentWidth), barHeight)
    cursor += segmentWidth
  }
  ctx.save()
  ctx.strokeStyle = CANVAS.frame
  ctx.strokeRect(x + 0.5, barTop + 0.5, width, barHeight)
  ctx.restore()

  SERIES.forEach((series, index) => {
    drawText(
      ctx,
      `${series.key.toUpperCase()} ${(state[series.key] * 100).toFixed(1)}%`,
      x + index * 56,
      barTop + 24,
      { size: 8.5, color: series.color },
    )
  })

  const dividerY = barTop + 38
  ctx.save()
  ctx.strokeStyle = CANVAS.frame
  ctx.beginPath()
  ctx.moveTo(x, dividerY)
  ctx.lineTo(x + width, dividerY)
  ctx.stroke()
  ctx.restore()

  const rows: Array<[string, string]> = [
    ['R₀', r0.toFixed(1)],
    ['β = R₀γ', `${(r0 * gamma).toFixed(2)} /天`],
    ['γ 恢复率', `${gamma.toFixed(2)} /天`],
    ['免疫阈值', r0 > 1 ? `${(threshold * 100).toFixed(1)}%` : '不适用'],
    ['感染峰值', `${(state.peakI * 100).toFixed(1)}%`],
    ['峰值时刻', `${state.peakT.toFixed(0)} 天`],
    ['当前时间', `${state.t.toFixed(0)} 天`],
  ]
  rows.forEach(([label, value], index) => {
    const rowY = dividerY + 18 + index * 17
    drawText(ctx, label, x, rowY, { size: 9.5, color: CANVAS.text })
    drawText(ctx, value, x + width, rowY, {
      size: 9.5,
      color: CANVAS.textStrong,
      align: 'right',
    })
  })
}

function draw(
  ctx: CanvasRenderingContext2D,
  state: SirState,
  params: ParamValues,
  viewport: Viewport,
): void {
  const { width, height } = viewport
  if (width < 40 || height < 40) return

  paintBackground(ctx, width, height)
  paintGrid(ctx, width, height)

  const chart = layout(width, height)
  drawChart(ctx, state, params, chart)

  if (chart.wide) {
    drawPanel(ctx, state, params, chart)
    drawText(
      ctx,
      `t = ${state.t.toFixed(1)} 天 · 1 秒 ≈ ${DAYS_PER_SECOND} 天 · ${state.ticks} 帧`,
      chart.plot.x,
      height - 12,
      { size: 9.5, color: CANVAS.textFaint },
    )
  } else {
    drawLegendRow(ctx, LEGEND, chart.plot.x, chart.plot.y + chart.plot.height + 30)
  }
}

export const sirEpidemic: ExperimentDefinition<SirState> = {
  id: 'sir-epidemic',
  title: 'SIR 传播与群体免疫阈值',
  domain: '生物 / 复杂系统',
  formulaLatex: String.raw`\frac{dS}{dt}=-\beta SI,\quad \frac{dI}{dt}=\beta SI-\gamma I,\quad \frac{dR}{dt}=\gamma I`,
  insight:
    '有效传播数 R₀ = β/γ 决定疫情规模：R₀ > 1 时感染曲线出现峰值，易感比例跌破 1 - 1/R₀ 的群体免疫阈值后开始回落；R₀ ≤ 1 时感染单调衰减。调节 R₀ 与恢复率 γ 可观察阈值前后的相变。',
  renderType: 'canvas2d',
  controls: [
    {
      type: 'slider',
      key: 'r0',
      label: '基本传播数 R₀',
      min: 0.8,
      max: 6,
      step: 0.1,
      default: 3,
    },
    {
      type: 'slider',
      key: 'gamma',
      label: '恢复率 γ',
      min: 0.05,
      max: 0.5,
      step: 0.01,
      default: 0.2,
      unit: '/天',
    },
    {
      type: 'slider',
      key: 'i0',
      label: '初始感染比例 I₀',
      min: 0.001,
      max: 0.05,
      step: 0.001,
      default: 0.01,
    },
  ],
  legend: LEGEND,
  model: {
    createState,
    step,
    draw,
  },
}
