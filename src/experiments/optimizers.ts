import type {
  ExperimentDefinition,
  LegendItem,
  ParamValues,
  Viewport,
} from '../types/experiment'
import { readBooleanParam, readNumberParam, readStringParam } from '../runtime/params'
import {
  CANVAS,
  clamp,
  drawLegendRow,
  drawPlotFrame,
  drawText,
  paintBackground,
  paintGrid,
  plotTopPadding,
} from './canvasKit'

type OptimizerKey = 'sgd' | 'momentum' | 'adam'
type TerrainId = 'saddle' | 'ravine'

interface Vec {
  x: number
  y: number
}

interface ViewBox {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

interface TerrainDefinition {
  id: TerrainId
  label: string
  view: ViewBox
  levels: number[]
  start: Vec
  loss: (x: number, y: number) => number
  grad: (x: number, y: number) => Vec
}

const TERRAINS: Record<TerrainId, TerrainDefinition> = {
  saddle: {
    id: 'saddle',
    label: '鞍点地形',
    // f = x² - y² + 0.3y⁴，原点为鞍点，两侧谷底在 y = ±1.29
    view: { minX: -2.1, maxX: 2.1, minY: -2.1, maxY: 2.1 },
    levels: [-0.7, -0.45, -0.2, 0.05, 0.35, 0.75, 1.25, 1.9, 2.7, 3.6],
    start: { x: 1.35, y: 0.09 },
    loss: (x, y) => x * x - y * y + 0.3 * y * y * y * y,
    grad: (x, y) => ({ x: 2 * x, y: -2 * y + 1.2 * y * y * y }),
  },
  ravine: {
    id: 'ravine',
    label: '狭长峡谷',
    // f = 0.5(x² + 12y²)，y 方向陡峭、x 方向平缓，用于观察震荡与加速
    view: { minX: -2.2, maxX: 2.2, minY: -1.6, maxY: 1.6 },
    levels: [0.05, 0.15, 0.35, 0.7, 1.3, 2.2, 3.6, 5.6, 8.2],
    start: { x: 1.75, y: 0.95 },
    loss: (x, y) => 0.5 * (x * x + 12 * y * y),
    grad: (x, y) => ({ x, y: 12 * y }),
  },
}

interface OptimizerAgent {
  pos: Vec
  velocity: Vec
  moment: Vec
  second: Vec
  steps: number
  converged: boolean
  trail: Vec[]
}

export interface OptimizerState {
  t: number
  ticks: number
  terrain: TerrainId
  sgd: OptimizerAgent
  momentum: OptimizerAgent
  adam: OptimizerAgent
}

const MAX_TRAIL = 900
const CONVERGED_GRADIENT = 1e-3
const ADAM_BETA2 = 0.999

const AGENT_META: Array<{ key: OptimizerKey; label: string; color: string }> = [
  { key: 'sgd', label: 'SGD', color: CANVAS.blue },
  { key: 'momentum', label: 'Momentum', color: CANVAS.peach },
  { key: 'adam', label: 'Adam', color: CANVAS.mint },
]

const LEGEND: LegendItem[] = AGENT_META.map((agent) => ({
  label: agent.label,
  color: agent.color,
}))

function terrainOf(params: ParamValues): TerrainDefinition {
  const id = readStringParam(params, 'terrain', 'saddle')
  return TERRAINS[id as TerrainId] ?? TERRAINS.saddle
}

function createAgent(start: Vec): OptimizerAgent {
  return {
    pos: { x: start.x, y: start.y },
    velocity: { x: 0, y: 0 },
    moment: { x: 0, y: 0 },
    second: { x: 0, y: 0 },
    steps: 0,
    converged: false,
    trail: [{ x: start.x, y: start.y }],
  }
}

function createState(params: ParamValues): OptimizerState {
  const terrain = terrainOf(params)
  return {
    t: 0,
    ticks: 0,
    terrain: terrain.id,
    sgd: createAgent(terrain.start),
    momentum: createAgent(terrain.start),
    adam: createAgent(terrain.start),
  }
}

function advanceAgent(
  agent: OptimizerAgent,
  kind: OptimizerKey,
  terrain: TerrainDefinition,
  learningRate: number,
  momentum: number,
  record: boolean,
): OptimizerAgent {
  if (agent.converged) return agent
  const gradient = terrain.grad(agent.pos.x, agent.pos.y)
  if (Math.hypot(gradient.x, gradient.y) < CONVERGED_GRADIENT) {
    return { ...agent, converged: true }
  }

  let position: Vec
  let velocity = agent.velocity
  let moment = agent.moment
  let second = agent.second

  if (kind === 'sgd') {
    position = {
      x: agent.pos.x - learningRate * gradient.x,
      y: agent.pos.y - learningRate * gradient.y,
    }
  } else if (kind === 'momentum') {
    velocity = {
      x: momentum * agent.velocity.x - learningRate * gradient.x,
      y: momentum * agent.velocity.y - learningRate * gradient.y,
    }
    position = { x: agent.pos.x + velocity.x, y: agent.pos.y + velocity.y }
  } else {
    const steps = agent.steps + 1
    moment = {
      x: momentum * agent.moment.x + (1 - momentum) * gradient.x,
      y: momentum * agent.moment.y + (1 - momentum) * gradient.y,
    }
    second = {
      x: ADAM_BETA2 * agent.second.x + (1 - ADAM_BETA2) * gradient.x * gradient.x + 1e-12,
      y: ADAM_BETA2 * agent.second.y + (1 - ADAM_BETA2) * gradient.y * gradient.y + 1e-12,
    }
    const firstScale = 1 - Math.pow(momentum, steps)
    const secondScale = 1 - Math.pow(ADAM_BETA2, steps)
    position = {
      x: agent.pos.x - (learningRate * (moment.x / firstScale)) / (Math.sqrt(second.x / secondScale) + 1e-8),
      y: agent.pos.y - (learningRate * (moment.y / firstScale)) / (Math.sqrt(second.y / secondScale) + 1e-8),
    }
  }

  const bounded: Vec = {
    x: clamp(position.x, terrain.view.minX + 0.01, terrain.view.maxX - 0.01),
    y: clamp(position.y, terrain.view.minY + 0.01, terrain.view.maxY - 0.01),
  }

  const trail = agent.trail
  if (record) {
    trail.push(bounded)
    if (trail.length > MAX_TRAIL) trail.shift()
  }

  return {
    pos: bounded,
    velocity,
    moment,
    second,
    steps: agent.steps + 1,
    converged: false,
    trail,
  }
}

function step(state: OptimizerState, params: ParamValues, dt: number): OptimizerState {
  const terrain = terrainOf(params)
  if (terrain.id !== state.terrain) {
    return createState(params)
  }
  const learningRate = readNumberParam(params, 'learningRate', 0.006)
  const momentum = readNumberParam(params, 'momentum', 0.9)
  const record = state.ticks % 2 === 0

  return {
    t: state.t + dt,
    ticks: state.ticks + 1,
    terrain: state.terrain,
    sgd: advanceAgent(state.sgd, 'sgd', terrain, learningRate, momentum, record),
    momentum: advanceAgent(state.momentum, 'momentum', terrain, learningRate, momentum, record),
    adam: advanceAgent(state.adam, 'adam', terrain, learningRate, momentum, record),
  }
}

interface PlotLayout {
  plot: { x: number; y: number; width: number; height: number }
  wide: boolean
  panelX: number
  panelWidth: number
}

function layout(width: number, height: number): PlotLayout {
  const wide = width >= 680
  const panelWidth = wide ? 176 : 0
  const gap = 26
  const top = plotTopPadding(width, height)
  const left = 28
  const right = width - 20
  const bottom = height - 34
  const availableWidth = Math.max(80, right - left)
  const side = Math.max(
    80,
    Math.min(availableWidth - (wide ? panelWidth + gap : 0), bottom - top),
  )
  const groupWidth = side + (wide ? gap + panelWidth : 0)
  const plotX = left + Math.max(0, (availableWidth - groupWidth) / 2)
  const plotY = top + Math.max(0, (bottom - top - side) / 2)
  return {
    plot: { x: plotX, y: plotY, width: side, height: side },
    wide,
    panelX: plotX + side + gap,
    panelWidth,
  }
}

function drawContours(
  ctx: CanvasRenderingContext2D,
  terrain: TerrainDefinition,
  plot: PlotLayout['plot'],
): void {
  const cols = 60
  const rows = 44
  const { minX, maxX, minY, maxY } = terrain.view
  const values: number[][] = []
  for (let row = 0; row <= rows; row += 1) {
    const worldY = maxY - ((maxY - minY) * row) / rows
    const line: number[] = []
    for (let col = 0; col <= cols; col += 1) {
      const worldX = minX + ((maxX - minX) * col) / cols
      line.push(terrain.loss(worldX, worldY))
    }
    values.push(line)
  }

  const mapX = (worldX: number): number =>
    plot.x + ((worldX - minX) / (maxX - minX)) * plot.width
  const mapY = (worldY: number): number =>
    plot.y + ((maxY - worldY) / (maxY - minY)) * plot.height

  interface EdgePoint {
    x: number
    y: number
  }
  const crossing = (
    ax: number,
    ay: number,
    av: number,
    bx: number,
    by: number,
    bv: number,
    level: number,
  ): EdgePoint => {
    const ratio = (level - av) / (bv - av)
    return { x: ax + (bx - ax) * ratio, y: ay + (by - ay) * ratio }
  }

  ctx.save()
  ctx.beginPath()
  ctx.rect(plot.x, plot.y, plot.width, plot.height)
  ctx.clip()
  ctx.beginPath()

  for (let row = 0; row < rows; row += 1) {
    const yTop = maxY - ((maxY - minY) * row) / rows
    const yBottom = maxY - ((maxY - minY) * (row + 1)) / rows
    for (let col = 0; col < cols; col += 1) {
      const xLeft = minX + ((maxX - minX) * col) / cols
      const xRight = minX + ((maxX - minX) * (col + 1)) / cols
      const topLeft = values[row][col]
      const topRight = values[row][col + 1]
      const bottomRight = values[row + 1][col + 1]
      const bottomLeft = values[row + 1][col]

      for (const level of terrain.levels) {
        const points: EdgePoint[] = []
        if ((topLeft - level) * (topRight - level) < 0) {
          points.push(crossing(xLeft, yTop, topLeft, xRight, yTop, topRight, level))
        }
        if ((topRight - level) * (bottomRight - level) < 0) {
          points.push(crossing(xRight, yTop, topRight, xRight, yBottom, bottomRight, level))
        }
        if ((bottomRight - level) * (bottomLeft - level) < 0) {
          points.push(crossing(xRight, yBottom, bottomRight, xLeft, yBottom, bottomLeft, level))
        }
        if ((bottomLeft - level) * (topLeft - level) < 0) {
          points.push(crossing(xLeft, yBottom, bottomLeft, xLeft, yTop, topLeft, level))
        }
        if (points.length === 2) {
          ctx.moveTo(mapX(points[0].x), mapY(points[0].y))
          ctx.lineTo(mapX(points[1].x), mapY(points[1].y))
        } else if (points.length === 4) {
          // 鞍点处的四交点按相邻边配对，保证等值线不断裂。
          ctx.moveTo(mapX(points[0].x), mapY(points[0].y))
          ctx.lineTo(mapX(points[1].x), mapY(points[1].y))
          ctx.moveTo(mapX(points[2].x), mapY(points[2].y))
          ctx.lineTo(mapX(points[3].x), mapY(points[3].y))
        }
      }
    }
  }

  ctx.strokeStyle = CANVAS.faint
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.restore()
}

function drawTrajectories(
  ctx: CanvasRenderingContext2D,
  state: OptimizerState,
  terrain: TerrainDefinition,
  plot: PlotLayout['plot'],
): void {
  const { minX, maxX, minY, maxY } = terrain.view
  const mapX = (worldX: number): number =>
    plot.x + ((worldX - minX) / (maxX - minX)) * plot.width
  const mapY = (worldY: number): number =>
    plot.y + ((maxY - worldY) / (maxY - minY)) * plot.height

  ctx.save()
  ctx.beginPath()
  ctx.rect(plot.x, plot.y, plot.width, plot.height)
  ctx.clip()

  // 零轴参考线
  ctx.strokeStyle = CANVAS.axis
  ctx.lineWidth = 1
  ctx.setLineDash([3, 5])
  ctx.beginPath()
  ctx.moveTo(mapX(0), plot.y)
  ctx.lineTo(mapX(0), plot.y + plot.height)
  ctx.moveTo(plot.x, mapY(0))
  ctx.lineTo(plot.x + plot.width, mapY(0))
  ctx.stroke()
  ctx.setLineDash([])

  // 起点
  const start = terrain.start
  ctx.beginPath()
  ctx.arc(mapX(start.x), mapY(start.y), 4.5, 0, Math.PI * 2)
  ctx.fillStyle = CANVAS.background
  ctx.fill()
  ctx.strokeStyle = CANVAS.textFaint
  ctx.lineWidth = 1.4
  ctx.stroke()

  for (const meta of AGENT_META) {
    const agent = state[meta.key]
    if (agent.trail.length > 1) {
      ctx.beginPath()
      agent.trail.forEach((point, index) => {
        const screenX = mapX(point.x)
        const screenY = mapY(point.y)
        if (index === 0) ctx.moveTo(screenX, screenY)
        else ctx.lineTo(screenX, screenY)
      })
      ctx.strokeStyle = meta.color
      ctx.lineWidth = 1.6
      ctx.globalAlpha = 0.85
      ctx.stroke()
      ctx.globalAlpha = 1
    }

    const screenX = mapX(agent.pos.x)
    const screenY = mapY(agent.pos.y)
    ctx.beginPath()
    ctx.arc(screenX, screenY, 7, 0, Math.PI * 2)
    ctx.fillStyle = CANVAS.halo
    ctx.fill()
    ctx.beginPath()
    ctx.arc(screenX, screenY, 3.4, 0, Math.PI * 2)
    ctx.fillStyle = meta.color
    ctx.fill()
  }

  ctx.restore()
}

function drawPanel(
  ctx: CanvasRenderingContext2D,
  state: OptimizerState,
  params: ParamValues,
  terrain: TerrainDefinition,
  layoutInfo: PlotLayout,
): void {
  const { panelX, plot } = layoutInfo
  const top = Math.max(plot.y, 64)
  const rowGap = clamp((plot.height - 90) / AGENT_META.length, 26, 46)
  drawText(ctx, '优化轨迹', panelX, top, {
    size: 10,
    weight: 600,
    color: CANVAS.textStrong,
  })

  AGENT_META.forEach((meta, index) => {
    const agent = state[meta.key]
    const rowY = top + 24 + index * rowGap
    ctx.save()
    ctx.beginPath()
    ctx.arc(panelX + 4, rowY - 3.5, 3.4, 0, Math.PI * 2)
    ctx.fillStyle = meta.color
    ctx.fill()
    ctx.restore()
    drawText(ctx, meta.label, panelX + 14, rowY, { size: 10.5, color: CANVAS.textStrong })
    drawText(
      ctx,
      `L ${terrain.loss(agent.pos.x, agent.pos.y).toFixed(3)}`,
      panelX,
      rowY + 15,
      { size: 9.5, color: CANVAS.text },
    )
    drawText(ctx, `${agent.steps} 步`, panelX + 96, rowY + 15, {
      size: 9.5,
      color: CANVAS.textFaint,
      align: 'right',
    })
  })

  const infoY = top + 24 + AGENT_META.length * rowGap + 10
  if (infoY + 34 > plot.y + plot.height) return

  ctx.save()
  ctx.strokeStyle = CANVAS.frame
  ctx.beginPath()
  ctx.moveTo(panelX, infoY - 14)
  ctx.lineTo(panelX + layoutInfo.panelWidth, infoY - 14)
  ctx.stroke()
  ctx.restore()
  drawText(ctx, `地形 · ${terrain.label}`, panelX, infoY, { size: 9.5, color: CANVAS.text })
  drawText(
    ctx,
    `η ${readNumberParam(params, 'learningRate', 0.006).toFixed(3)}`,
    panelX,
    infoY + 17,
    { size: 9.5, color: CANVAS.text },
  )
  drawText(
    ctx,
    `μ ${readNumberParam(params, 'momentum', 0.9).toFixed(2)}`,
    panelX,
    infoY + 34,
    { size: 9.5, color: CANVAS.text },
  )
}

function draw(
  ctx: CanvasRenderingContext2D,
  state: OptimizerState,
  params: ParamValues,
  viewport: Viewport,
): void {
  const { width, height } = viewport
  if (width < 40 || height < 40) return

  paintBackground(ctx, width, height)
  paintGrid(ctx, width, height)

  const terrain = terrainOf(params)
  const layoutInfo = layout(width, height)
  const { plot } = layoutInfo

  drawPlotFrame(ctx, plot)
  if (readBooleanParam(params, 'showContours', true)) {
    drawContours(ctx, terrain, plot)
  }
  drawTrajectories(ctx, state, terrain, plot)

  if (layoutInfo.wide) {
    drawPanel(ctx, state, params, terrain, layoutInfo)
    drawText(
      ctx,
      `收敛判据 |∇L| < 1e-3 · ${state.ticks} 帧`,
      plot.x,
      height - 12,
      { size: 9.5, color: CANVAS.textFaint },
    )
  } else {
    drawLegendRow(ctx, LEGEND, plot.x, height - 12)
  }
}

export const optimizerLandscape: ExperimentDefinition<OptimizerState> = {
  id: 'optimizer-landscape',
  title: '多优化器地形逃逸对比',
  domain: 'AI / 优化理论',
  formulaLatex: String.raw`\theta_{t+1} = \theta_t - \eta\,\nabla_\theta L(\theta_t)`,
  insight:
    '三条轨迹从同一初始点出发：SGD 沿梯度缓慢滑落，Momentum 借助速度累积更快冲出鞍点并可能越过谷底振荡，Adam 则按二阶矩自适应缩放步长。切换地形或调整学习率、动量可观察它们的差异。',
  renderType: 'canvas2d',
  controls: [
    {
      type: 'slider',
      key: 'learningRate',
      label: '学习率 η',
      min: 0.001,
      max: 0.02,
      step: 0.001,
      default: 0.006,
    },
    {
      type: 'slider',
      key: 'momentum',
      label: '动量 / Adam β₁',
      min: 0,
      max: 0.99,
      step: 0.01,
      default: 0.9,
    },
    {
      type: 'select',
      key: 'terrain',
      label: '损失地形',
      options: [
        { value: 'saddle', label: '鞍点地形' },
        { value: 'ravine', label: '狭长峡谷' },
      ],
      default: 'saddle',
    },
    {
      type: 'toggle',
      key: 'showContours',
      label: '显示损失等值线',
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
