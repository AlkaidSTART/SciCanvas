import type {
  ExperimentDefinition,
  ParamValues,
  Viewport,
} from '../types/experiment'
import { CANVAS } from './canvasKit'

export interface OscillatorPoint {
  x: number
  v: number
}

export interface DampedOscillatorState {
  t: number
  x: number
  v: number
  ticks: number
  trail: OscillatorPoint[]
}

const MASS = 1
const STIFFNESS = 4
const INITIAL_DISPLACEMENT = 0.5
const MAX_TRAIL = 600
const TRAIL_SAMPLE_INTERVAL = 2

const COLORS = {
  get background() {
    return CANVAS.background
  },
  get grid() {
    return CANVAS.grid
  },
  get axis() {
    return CANVAS.axis
  },
  get text() {
    return CANVAS.text
  },
  get textStrong() {
    return CANVAS.textStrong
  },
  get accent() {
    return CANVAS.blue
  },
  get accentSoft() {
    return CANVAS.blueSoft
  },
  get accentFill() {
    return CANVAS.halo
  },
  get spring() {
    return CANVAS.mint
  },
  get amber() {
    return CANVAS.peach
  },
  get amberText() {
    return CANVAS.peach
  },
  get wall() {
    return CANVAS.axis
  },
  get guide() {
    return CANVAS.axis
  },
  get faint() {
    return CANVAS.faint
  },
  get halo() {
    return CANVAS.halo
  },
}

function readNumber(params: ParamValues, key: string, fallback: number): number {
  const value = params[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function envelopeOf(trail: OscillatorPoint[], key: 'x' | 'v'): number {
  let max = 0
  for (const point of trail) {
    const magnitude = Math.abs(point[key])
    if (magnitude > max) max = magnitude
  }
  return max
}

function createState(): DampedOscillatorState {
  return {
    t: 0,
    x: INITIAL_DISPLACEMENT,
    v: 0,
    ticks: 0,
    trail: [{ x: INITIAL_DISPLACEMENT, v: 0 }],
  }
}

function step(state: DampedOscillatorState, params: ParamValues, dt: number): DampedOscillatorState {
  const damping = readNumber(params, 'damping', 0.24)
  const omega = readNumber(params, 'omega', 1.5)
  const force = readNumber(params, 'force', 0.6)

  const acceleration = (-damping * state.v - STIFFNESS * state.x + force * Math.cos(omega * state.t)) / MASS
  // 半隐式欧拉：小步长下对受迫振动足够稳定，也更符合“逐步推演”的直觉。
  const velocity = state.v + acceleration * dt
  const position = state.x + velocity * dt
  const ticks = state.ticks + 1

  const trail = state.trail
  if (ticks % TRAIL_SAMPLE_INTERVAL === 0) {
    trail.push({ x: position, v: velocity })
    if (trail.length > MAX_TRAIL) trail.shift()
  }

  return {
    t: state.t + dt,
    x: position,
    v: velocity,
    ticks,
    trail,
  }
}

function drawBackground(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.fillStyle = COLORS.background
  ctx.fillRect(0, 0, width, height)

  ctx.strokeStyle = COLORS.grid
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let x = 0.5; x < width; x += 40) {
    ctx.moveTo(x, 0)
    ctx.lineTo(x, height)
  }
  for (let y = 0.5; y < height; y += 40) {
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
  }
  ctx.stroke()
}

function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  options: { align?: CanvasTextAlign; color?: string; size?: number; weight?: number } = {},
): void {
  ctx.save()
  ctx.fillStyle = options.color ?? COLORS.text
  ctx.font = `${options.weight ?? 400} ${options.size ?? 11}px "JetBrains Mono", ui-monospace, monospace`
  ctx.textAlign = options.align ?? 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(text, x, y)
  ctx.restore()
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  color: string,
): void {
  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(fromX, fromY)
  ctx.lineTo(toX, toY)
  ctx.stroke()

  const distance = Math.hypot(toX - fromX, toY - fromY)
  if (distance > 4) {
    const angle = Math.atan2(toY - fromY, toX - fromX)
    const size = 6
    ctx.beginPath()
    ctx.moveTo(toX, toY)
    ctx.lineTo(toX - size * Math.cos(angle - 0.45), toY - size * Math.sin(angle - 0.45))
    ctx.lineTo(toX - size * Math.cos(angle + 0.45), toY - size * Math.sin(angle + 0.45))
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
}

function drawSpring(
  ctx: CanvasRenderingContext2D,
  startX: number,
  endX: number,
  centerY: number,
): void {
  const span = endX - startX
  if (span < 16) return
  const coils = 16
  const amplitude = Math.min(14, span * 0.18)
  ctx.save()
  ctx.strokeStyle = COLORS.spring
  ctx.lineWidth = 1.4
  ctx.beginPath()
  ctx.moveTo(startX, centerY)
  for (let index = 0; index <= coils; index += 1) {
    const ratio = index / coils
    const x = startX + span * ratio
    const y = index === 0 || index === coils
      ? centerY
      : centerY + (index % 2 === 0 ? -amplitude : amplitude)
    ctx.lineTo(x, y)
  }
  ctx.stroke()
  ctx.restore()
}

function drawOscillator(
  ctx: CanvasRenderingContext2D,
  state: DampedOscillatorState,
  params: ParamValues,
  width: number,
  height: number,
): void {
  const centerY = height * 0.62
  const wallX = Math.max(28, width * 0.07)
  const padRight = 44
  const available = Math.max(120, width - wallX - padRight)
  const equilibriumX = wallX + available * 0.56
  const travel = Math.min(available * 0.42, 180)
  const amplitude = Math.max(1, envelopeOf(state.trail, 'x')) * 1.15
  const positionScale = travel / amplitude
  const massSize = 54
  const massX = equilibriumX + state.x * positionScale
  const massLeft = massX - massSize / 2
  const massTop = centerY - massSize / 2

  // 墙面
  ctx.save()
  ctx.strokeStyle = COLORS.wall
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(wallX, centerY - 76)
  ctx.lineTo(wallX, centerY + 76)
  ctx.stroke()
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let y = centerY - 72; y <= centerY + 72; y += 12) {
    ctx.moveTo(wallX, y)
    ctx.lineTo(wallX - 9, y + 9)
  }
  ctx.stroke()
  ctx.restore()

  // 平衡位置参考线
  ctx.save()
  ctx.strokeStyle = COLORS.guide
  ctx.setLineDash([4, 7])
  ctx.beginPath()
  ctx.moveTo(equilibriumX, centerY - 100)
  ctx.lineTo(equilibriumX, centerY + 100)
  ctx.stroke()
  ctx.restore()

  drawSpring(ctx, wallX, massLeft, centerY)

  // 振子质量块
  ctx.save()
  ctx.fillStyle = COLORS.accentFill
  ctx.strokeStyle = COLORS.accent
  ctx.lineWidth = 1.5
  ctx.shadowColor = 'rgba(58, 51, 43, 0.12)'
  ctx.shadowBlur = 14
  ctx.shadowOffsetY = 4
  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(massLeft, massTop, massSize, massSize, 11)
  } else {
    ctx.rect(massLeft, massTop, massSize, massSize)
  }
  ctx.fill()
  ctx.stroke()
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.shadowOffsetY = 0
  ctx.beginPath()
  ctx.arc(massX, centerY, 4, 0, Math.PI * 2)
  ctx.fillStyle = COLORS.accent
  ctx.fill()
  ctx.restore()

  drawText(ctx, `x = ${state.x >= 0 ? '+' : ''}${state.x.toFixed(2)} m`, massX, massTop - 12, {
    align: 'center',
    color: COLORS.textStrong,
    size: 12,
    weight: 600,
  })

  // 驱动力箭头
  const force = readNumber(params, 'force', 0.6)
  const omega = readNumber(params, 'omega', 1.5)
  const drive = force * Math.cos(omega * state.t)
  const arrowY = centerY + massSize / 2 + 30
  const arrowLength = drive * 54
  drawArrow(ctx, massX, arrowY, massX + arrowLength, arrowY, COLORS.amber)
  drawText(ctx, `F(t) = ${drive.toFixed(2)} N`, massX, arrowY + 20, {
    align: 'center',
    color: COLORS.amberText,
    size: 10,
  })

  if (height > 360) {
    drawText(ctx, `受迫阻尼振子 · c = ${readNumber(params, 'damping', 0.24).toFixed(2)} · t = ${state.t.toFixed(1)} s`, wallX, height - 22, {
      size: 10,
    })
    if (width >= 560) {
      const omega = readNumber(params, 'omega', 1.5)
      const ratio = omega / 2
      const nearResonance = Math.abs(ratio - 1) < 0.1
      drawText(
        ctx,
        `ω/ω₀ = ${ratio.toFixed(2)}${nearResonance ? ' · 共振区' : ''}`,
        width - padRight,
        height - 22,
        { align: 'right', size: 10, color: nearResonance ? COLORS.amberText : COLORS.text },
      )
    }
  }
}

function drawPhasePortrait(
  ctx: CanvasRenderingContext2D,
  state: DampedOscillatorState,
  panelX: number,
  panelWidth: number,
  height: number,
): void {
  const centerX = panelX + panelWidth / 2
  const centerY = height * 0.62
  const paddingX = Math.min(46, panelWidth * 0.18)
  const paddingY = Math.min(72, height * 0.16)
  const xRange = Math.max(1, envelopeOf(state.trail, 'x')) * 1.1
  const vRange = Math.max(2, envelopeOf(state.trail, 'v')) * 1.1
  const halfW = Math.max(20, (panelWidth - paddingX * 2) / 2)
  const halfH = Math.max(20, (height - paddingY * 2) / 2)

  const mapX = (value: number): number => centerX + (value / xRange) * halfW
  const mapV = (value: number): number => centerY - (value / vRange) * halfH

  ctx.save()
  ctx.strokeStyle = COLORS.axis
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(panelX + 0.5, 0)
  ctx.lineTo(panelX + 0.5, height)
  ctx.stroke()

  // 坐标轴
  ctx.strokeStyle = COLORS.faint
  ctx.beginPath()
  ctx.moveTo(centerX - halfW - 8, centerY)
  ctx.lineTo(centerX + halfW + 8, centerY)
  ctx.moveTo(centerX, centerY - halfH - 8)
  ctx.lineTo(centerX, centerY + halfH + 8)
  ctx.stroke()
  ctx.restore()

  // 相轨迹
  if (state.trail.length > 1) {
    ctx.save()
    ctx.strokeStyle = COLORS.accentSoft
    ctx.lineWidth = 1.2
    ctx.beginPath()
    state.trail.forEach((point, index) => {
      const pointX = mapX(point.x)
      const pointY = mapV(point.v)
      if (index === 0) {
        ctx.moveTo(pointX, pointY)
      } else {
        ctx.lineTo(pointX, pointY)
      }
    })
    ctx.stroke()
    ctx.restore()
  }

  // 当前状态
  const currentX = mapX(state.x)
  const currentY = mapV(state.v)
  ctx.save()
  ctx.beginPath()
  ctx.arc(currentX, currentY, 7, 0, Math.PI * 2)
  ctx.fillStyle = COLORS.halo
  ctx.fill()
  ctx.beginPath()
  ctx.arc(currentX, currentY, 3, 0, Math.PI * 2)
  ctx.fillStyle = COLORS.accent
  ctx.fill()
  ctx.restore()

  drawText(ctx, '相空间 (x, v)', panelX + 14, 28, { size: 10, weight: 600 })
  drawText(ctx, 'x', centerX + halfW + 14, centerY + 4, { size: 10 })
  drawText(ctx, 'v', centerX + 6, centerY - halfH - 12, { size: 10 })
  drawText(ctx, `x ±${xRange.toFixed(1)}`, panelX + panelWidth - 14, height - 22, {
    align: 'right',
    size: 9,
  })
}

function draw(
  ctx: CanvasRenderingContext2D,
  state: DampedOscillatorState,
  params: ParamValues,
  viewport: Viewport,
): void {
  const { width, height } = viewport
  if (width < 40 || height < 40) return

  drawBackground(ctx, width, height)

  const showPhase = params.showPhase !== false && width >= 560
  const oscillatorWidth = showPhase ? width * 0.56 : width

  drawOscillator(ctx, state, params, oscillatorWidth, height)
  if (showPhase) {
    drawPhasePortrait(ctx, state, oscillatorWidth, width - oscillatorWidth, height)
  }
}

export const dampedOscillator: ExperimentDefinition<DampedOscillatorState> = {
  id: 'damped-driven-oscillator',
  title: '阻尼受迫振动与共振相空间',
  domain: '物理 / 力学',
  formulaLatex: String.raw`m\ddot{x} + c\dot{x} + kx = F_0\cos(\omega t)`,
  insight:
    '当驱动频率 ω 接近系统固有频率 ω₀ = √(k/m) = 2.0 rad/s，且阻尼较小时，振幅会急剧放大，相空间轨迹向外扩张形成共振螺旋。',
  renderType: 'canvas2d',
  controls: [
    {
      type: 'slider',
      key: 'damping',
      label: '阻尼系数 c',
      min: 0.08,
      max: 2,
      step: 0.02,
      default: 0.24,
      unit: 'N·s/m',
    },
    {
      type: 'slider',
      key: 'omega',
      label: '驱动频率 ω',
      min: 0.5,
      max: 5,
      step: 0.05,
      default: 1.5,
      unit: 'rad/s',
    },
    {
      type: 'slider',
      key: 'force',
      label: '驱动力幅值 F₀',
      min: 0,
      max: 1.2,
      step: 0.05,
      default: 0.6,
      unit: 'N',
    },
    {
      type: 'toggle',
      key: 'showPhase',
      label: '显示相空间轨迹',
      default: true,
    },
  ],
  legend: [
    { label: '振子位移 x', color: COLORS.accent },
    { label: '相空间轨迹', color: COLORS.accentSoft },
    { label: '驱动力 F(t)', color: COLORS.amber },
  ],
  cornerCases: [
    {
      id: 'resonance',
      label: '低阻尼共振',
      description: '驱动频率接近固有频率 ω₀ = 2.0 rad/s，振幅持续放大。',
      params: { damping: 0.08, omega: 2, force: 0.6 },
    },
    {
      id: 'overdamped',
      label: '过阻尼收敛',
      description: '阻尼远大于临界值，振子缓慢回到平衡位置。',
      params: { damping: 2, omega: 1, force: 0.2 },
    },
    {
      id: 'free-decay',
      label: '自由衰减',
      description: '移除周期驱动力，观察机械能随阻尼衰减。',
      params: { damping: 0.3, omega: 1.5, force: 0 },
    },
  ],
  telemetry: {
    metrics: [
      { key: 'energy', label: '机械能 E', unit: 'J', color: COLORS.accent, precision: 3 },
      { key: 'displacement', label: '位移 x', unit: 'm', color: COLORS.amber, precision: 2 },
      { key: 'drive', label: '驱动力 F', unit: 'N', color: COLORS.spring, precision: 2 },
    ],
    interval: 0.08,
    sample: (state, params) => ({
      energy: 0.5 * MASS * state.v * state.v + 0.5 * STIFFNESS * state.x * state.x,
      displacement: state.x,
      drive: readNumber(params, 'force', 0.6) * Math.cos(readNumber(params, 'omega', 1.5) * state.t),
    }),
  },
  model: {
    createState,
    step,
    draw,
  },
}
