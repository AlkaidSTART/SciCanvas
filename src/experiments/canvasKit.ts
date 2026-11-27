import type { CanvasThemePalette } from '../theme/presets'
import type { LegendItem } from '../types/experiment'

/**
 * 预设案例共用的画布配色与绘制原语，会随主题预设实时更新。
 * 图例文案直接取自 ExperimentDefinition.legend，保证说明与画面同源。
 */
export const CANVAS: CanvasThemePalette = {
  background: '#FBF7EF',
  badge: 'rgba(252, 249, 242, 0.92)',
  grid: 'rgba(120, 100, 78, 0.055)',
  gridStrong: 'rgba(120, 100, 78, 0.11)',
  axis: 'rgba(120, 100, 78, 0.28)',
  frame: 'rgba(120, 100, 78, 0.14)',
  text: '#7D7062',
  textStrong: '#3A332B',
  textFaint: '#9B8F81',
  faint: 'rgba(120, 100, 78, 0.3)',
  blue: '#4F7292',
  blueSoft: 'rgba(79, 114, 146, 0.5)',
  peach: '#C97A45',
  mint: '#5F9377',
  rose: '#C06F6F',
  lilac: '#8A76A8',
  amber: '#C08A3A',
  halo: 'rgba(124, 157, 187, 0.18)',
}

export function applyCanvasTheme(palette: CanvasThemePalette): void {
  Object.assign(CANVAS, palette)
}

export const MONO_FONT = '"JetBrains Mono", ui-monospace, monospace'

export const SANS_FONT =
  '"Inter", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'

export interface TextOptions {
  align?: CanvasTextAlign
  baseline?: CanvasTextBaseline
  color?: string
  size?: number
  weight?: number
  mono?: boolean
}

export function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  options: TextOptions = {},
): void {
  ctx.save()
  ctx.fillStyle = options.color ?? CANVAS.text
  ctx.font = `${options.weight ?? 400} ${options.size ?? 11}px ${
    options.mono === false ? SANS_FONT : MONO_FONT
  }`
  ctx.textAlign = options.align ?? 'left'
  ctx.textBaseline = options.baseline ?? 'alphabetic'
  ctx.fillText(text, x, y)
  ctx.restore()
}

export function paintBackground(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.fillStyle = CANVAS.background
  ctx.fillRect(0, 0, width, height)
}

export function paintGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  step = 40,
): void {
  ctx.save()
  ctx.strokeStyle = CANVAS.grid
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let x = 0.5; x < width; x += step) {
    ctx.moveTo(x, 0)
    ctx.lineTo(x, height)
  }
  for (let y = 0.5; y < height; y += step) {
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
  }
  ctx.stroke()
  ctx.restore()
}

export function drawPlotFrame(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; width: number; height: number },
): void {
  ctx.save()
  ctx.strokeStyle = CANVAS.frame
  ctx.lineWidth = 1
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width, rect.height)
  ctx.restore()
}

/** 垂直图例：短线段 + 文案，dashed 与画面中的虚线样式一致。 */
export function drawLegend(
  ctx: CanvasRenderingContext2D,
  items: LegendItem[],
  x: number,
  y: number,
  options: { gap?: number; size?: number } = {},
): number {
  const gap = options.gap ?? 19
  const size = options.size ?? 10
  items.forEach((item, index) => {
    const rowY = y + index * gap
    ctx.save()
    ctx.strokeStyle = item.color
    ctx.lineWidth = 2
    ctx.setLineDash(item.dashed ? [4, 4] : [])
    ctx.beginPath()
    ctx.moveTo(x, rowY - 3.5)
    ctx.lineTo(x + 16, rowY - 3.5)
    ctx.stroke()
    ctx.restore()
    drawText(ctx, item.label, x + 24, rowY, { size, color: CANVAS.text })
  })
  return items.length * gap
}

/** 横向图例：窄屏下放在图表下方，避免挤占绘图区。 */
export function drawLegendRow(
  ctx: CanvasRenderingContext2D,
  items: LegendItem[],
  x: number,
  y: number,
  options: { gap?: number; size?: number } = {},
): void {
  const gap = options.gap ?? 16
  const size = options.size ?? 9.5
  let cursor = x
  const font = `400 ${size}px ${MONO_FONT}`
  for (const item of items) {
    ctx.save()
    ctx.font = font
    const labelWidth = ctx.measureText(item.label).width
    ctx.strokeStyle = item.color
    ctx.lineWidth = 2
    ctx.setLineDash(item.dashed ? [4, 4] : [])
    ctx.beginPath()
    ctx.moveTo(cursor, y - 3.5)
    ctx.lineTo(cursor + 14, y - 3.5)
    ctx.stroke()
    ctx.restore()
    drawText(ctx, item.label, cursor + 20, y, { size, color: CANVAS.text })
    cursor += 20 + labelWidth + gap
  }
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * 图表顶部留白：宽屏时给左上角公式浮窗让位，窄屏时用固定高度避开浮窗。
 */
export function plotTopPadding(width: number, height: number): number {
  // 画布高度 < 600 时公式浮窗由容器查询隐藏，图表可以贴着顶部开始。
  if (height < 600) return 28
  if (width >= 680) {
    // 200/250 是为含 insight 的公式浮窗留出的空间。
    if (height >= 780) return 250
    return 200
  }
  return 118
}
