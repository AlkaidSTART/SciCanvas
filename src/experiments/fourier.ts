import type {
  ExperimentDefinition,
  LegendItem,
  ParamValues,
  Viewport,
} from '../types/experiment'
import { readBooleanParam, readNumberParam } from '../runtime/params'
import {
  CANVAS,
  drawLegendRow,
  drawPlotFrame,
  drawText,
  paintBackground,
  paintGrid,
  plotTopPadding,
} from './canvasKit'

export interface FourierState {
  t: number
  ticks: number
}

const MAX_HARMONICS = 41
const SAMPLE_COUNT = 480
const OVERSHOOT_SAMPLES = 900

const LEGEND: LegendItem[] = [
  { label: '目标方波', color: CANVAS.textFaint, dashed: true },
  { label: '傅里叶部分和', color: CANVAS.blue },
]

/** 奇数项谐波叠加：S_N(x) = (4/π) Σ sin(kx)/k。 */
export function squareWavePartial(x: number, harmonics: number): number {
  const count = Math.min(MAX_HARMONICS, Math.max(1, Math.round(harmonics)))
  let sum = 0
  for (let k = 1; k <= count; k += 2) {
    sum += Math.sin(k * x) / k
  }
  return (4 / Math.PI) * sum
}

export function squareWaveOvershoot(harmonics: number): { max: number; x: number } {
  let max = Number.NEGATIVE_INFINITY
  let maxX = 0
  for (let index = 0; index <= OVERSHOOT_SAMPLES; index += 1) {
    const x = -Math.PI + (2 * Math.PI * index) / OVERSHOOT_SAMPLES
    const value = squareWavePartial(x, harmonics)
    if (value > max) {
      max = value
      maxX = x
    }
  }
  return { max, x: maxX }
}

function createState(): FourierState {
  return { t: 0, ticks: 0 }
}

function step(state: FourierState, _params: ParamValues, dt: number): FourierState {
  return { t: state.t + dt, ticks: state.ticks + 1 }
}

interface WaveLayout {
  plot: { x: number; y: number; width: number; height: number }
}

const Y_MIN = -1.55
const Y_MAX = 1.55

function layout(width: number, height: number): WaveLayout {
  const top = plotTopPadding(width, height)
  return {
    plot: {
      x: 48,
      y: top,
      width: Math.max(90, width - 48 - 28),
      height: Math.max(80, height - top - 56),
    },
  }
}

function draw(
  ctx: CanvasRenderingContext2D,
  state: FourierState,
  params: ParamValues,
  viewport: Viewport,
): void {
  const { width, height } = viewport
  if (width < 40 || height < 40) return

  paintBackground(ctx, width, height)
  paintGrid(ctx, width, height)

  const layoutInfo = layout(width, height)
  const { plot } = layoutInfo
  const harmonics = Math.round(readNumberParam(params, 'n', 9))
  const showTarget = readBooleanParam(params, 'showTarget', true)

  const mapX = (x: number): number => plot.x + ((x + Math.PI) / (2 * Math.PI)) * plot.width
  const mapY = (value: number): number =>
    plot.y + ((Y_MAX - value) / (Y_MAX - Y_MIN)) * plot.height

  drawPlotFrame(ctx, plot)

  // 网格与刻度
  ctx.save()
  ctx.strokeStyle = CANVAS.gridStrong
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let index = 0; index <= 4; index += 1) {
    const screenY = plot.y + (plot.height * index) / 4
    ctx.moveTo(plot.x, screenY)
    ctx.lineTo(plot.x + plot.width, screenY)
  }
  for (let index = 0; index <= 4; index += 1) {
    const screenX = plot.x + (plot.width * index) / 4
    ctx.moveTo(screenX, plot.y)
    ctx.lineTo(screenX, plot.y + plot.height)
  }
  ctx.stroke()
  ctx.restore()

  const yTicks = [1, 0, -1]
  for (const value of yTicks) {
    drawText(ctx, value.toFixed(1), plot.x - 8, mapY(value) + 3, {
      align: 'right',
      size: 9,
      color: CANVAS.textFaint,
    })
  }
  const xTicks: Array<[number, string]> = [
    [-Math.PI, '-π'],
    [-Math.PI / 2, '-π/2'],
    [0, '0'],
    [Math.PI / 2, 'π/2'],
    [Math.PI, 'π'],
  ]
  for (const [value, label] of xTicks) {
    drawText(ctx, label, mapX(value), plot.y + plot.height + 16, {
      align: 'center',
      size: 9,
      color: CANVAS.textFaint,
    })
  }

  ctx.save()
  ctx.beginPath()
  ctx.rect(plot.x, plot.y, plot.width, plot.height)
  ctx.clip()

  // 目标方波：[-π, 0) 为 -1，[0, π] 为 +1
  if (showTarget) {
    ctx.strokeStyle = CANVAS.textFaint
    ctx.lineWidth = 1.2
    ctx.setLineDash([5, 5])
    ctx.beginPath()
    ctx.moveTo(mapX(-Math.PI), mapY(-1))
    ctx.lineTo(mapX(0), mapY(-1))
    ctx.moveTo(mapX(0), mapY(1))
    ctx.lineTo(mapX(Math.PI), mapY(1))
    ctx.moveTo(mapX(0), mapY(-1))
    ctx.lineTo(mapX(0), mapY(1))
    ctx.stroke()
    ctx.setLineDash([])
  }

  // 部分和曲线
  ctx.beginPath()
  for (let index = 0; index <= SAMPLE_COUNT; index += 1) {
    const x = -Math.PI + (2 * Math.PI * index) / SAMPLE_COUNT
    const value = squareWavePartial(x, harmonics)
    const screenX = mapX(x)
    const screenY = mapY(value)
    if (index === 0) ctx.moveTo(screenX, screenY)
    else ctx.lineTo(screenX, screenY)
  }
  ctx.strokeStyle = CANVAS.blue
  ctx.lineWidth = 1.8
  ctx.stroke()

  // 吉布斯过冲标记
  const overshoot = squareWaveOvershoot(harmonics)
  if (overshoot.max > 1.001) {
    const markerX = mapX(overshoot.x)
    const markerY = mapY(overshoot.max)
    ctx.strokeStyle = CANVAS.peach
    ctx.lineWidth = 1
    ctx.setLineDash([3, 4])
    ctx.beginPath()
    ctx.moveTo(markerX, markerY)
    ctx.lineTo(markerX, mapY(1))
    ctx.stroke()
    ctx.setLineDash([])
    ctx.beginPath()
    ctx.arc(markerX, markerY, 3.4, 0, Math.PI * 2)
    ctx.fillStyle = CANVAS.peach
    ctx.fill()
  }

  // 扫描游标：时间控制驱动横向相位
  const phase = (state.t * 0.24) % (2 * Math.PI)
  const cursorX = -Math.PI + phase
  const cursorValue = squareWavePartial(cursorX, harmonics)
  const cursorScreenX = mapX(cursorX)
  const cursorScreenY = mapY(cursorValue)
  ctx.strokeStyle = CANVAS.axis
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(cursorScreenX, plot.y)
  ctx.lineTo(cursorScreenX, plot.y + plot.height)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(cursorScreenX, cursorScreenY, 4, 0, Math.PI * 2)
  ctx.fillStyle = CANVAS.blue
  ctx.fill()

  ctx.restore()

  drawText(
    ctx,
    `S(${cursorX.toFixed(2)}) = ${cursorValue.toFixed(3)}`,
    Math.min(cursorScreenX + 8, plot.x + plot.width - 8),
    Math.max(plot.y + 14, cursorScreenY - 8),
    {
      size: 9,
      color: CANVAS.blue,
      align: cursorScreenX > plot.x + plot.width - 120 ? 'right' : 'left',
    },
  )

  const overshootPercent = (overshoot.max - 1) * 100
  drawText(
    ctx,
    `N = ${harmonics} · 过冲 +${overshootPercent.toFixed(1)}%`,
    plot.x + plot.width,
    plot.y - 10,
    { align: 'right', size: 10, weight: 600, color: CANVAS.peach },
  )

  drawLegendRow(ctx, LEGEND, plot.x, plot.y + plot.height + 32)
}

export const fourierSquareWave: ExperimentDefinition<FourierState> = {
  id: 'fourier-square-wave',
  title: '傅里叶级数与吉布斯现象',
  domain: '信号处理 / 数学',
  formulaLatex: String.raw`S_N(x)=\frac{4}{\pi}\sum_{k=1,3,5,\dots}^{N}\frac{\sin(kx)}{k}`,
  insight:
    '用奇数项正弦谐波逼近方波：随着谐波项数 N 增大，波形边缘越来越陡，但跳变处始终保留约 18% 的峰值过冲（约为跳变幅度的 9%），这就是吉布斯现象。它是用有限项光滑函数逼近不连续信号时无法消除的固有误差。',
  renderType: 'canvas2d',
  controls: [
    {
      type: 'slider',
      key: 'n',
      label: '谐波项数 N',
      min: 1,
      max: MAX_HARMONICS,
      step: 2,
      default: 9,
    },
    {
      type: 'toggle',
      key: 'showTarget',
      label: '显示目标方波',
      default: true,
    },
  ],
  legend: LEGEND,
  model: {
    createState,
    step,
    draw,
  },
}
