import type {
  ExperimentDefinition,
  ParamValues,
  ProbePoint,
  ProbeReading,
  TelemetrySample,
  Viewport,
} from '../types/experiment'
import { validateExperiment } from '../types/experiment'
import { createDefaultParams, sanitizeParams } from './params'

export type RuntimeStatus = 'running' | 'paused' | 'error'

export type RuntimeErrorScope = 'init' | 'first-frame' | 'step' | 'draw'

export interface RuntimeErrorInfo {
  scope: RuntimeErrorScope
  message: string
}

/** 悬停探针读数与指针位置（CSS 像素，相对画布左上角）。 */
export interface ProbeReadout {
  point: ProbePoint
  reading: ProbeReading
}

export interface RuntimeSnapshot<S> {
  state: S | undefined
  simTime: number
  steps: number
  status: RuntimeStatus
}

export interface CanvasRuntimeOptions<S = unknown> {
  canvas: HTMLCanvasElement
  experiment: ExperimentDefinition<S>
  params?: ParamValues
  speed?: number
  fixedStep?: number
  autoResize?: boolean
  requestFrame?: (callback: FrameRequestCallback) => number
  cancelFrame?: (handle: number) => void
  onStatusChange?: (status: RuntimeStatus) => void
  onError?: (error: RuntimeErrorInfo) => void
  /** 有界遥测缓存快照；仅在实验声明 telemetry 时触发。 */
  onTelemetry?: (samples: TelemetrySample[]) => void
  /** 指针离开画布、探针读数失效时传 null。 */
  onProbe?: (readout: ProbeReadout | null) => void
}

/** 单帧最多消化的真实时间，避免切后台回来 dt 过大导致状态爆炸。 */
const MAX_FRAME_DELTA = 0.1
/** 单帧最多推进的仿真步数，与 2 倍速对齐。 */
const MAX_STEPS_PER_FRAME = 24
const DEFAULT_FIXED_STEP = 1 / 120
const MIN_SPEED = 0.25
const MAX_SPEED = 4

/** 遥测缓存与采样间隔的硬上限，防止声明异常时无限增长。 */
const MIN_TELEMETRY_CAPACITY = 2
const MAX_TELEMETRY_CAPACITY = 600
const DEFAULT_TELEMETRY_CAPACITY = 180
const DEFAULT_TELEMETRY_INTERVAL = 0.1
/** 浮层刷新节流：高频动画下避免每个仿真步都触发 React 更新。 */
const TELEMETRY_EMIT_INTERVAL = 90
const PROBE_EMIT_INTERVAL = 60

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function defaultRequestFrame(callback: FrameRequestCallback): number {
  if (typeof requestAnimationFrame === 'function') {
    return requestAnimationFrame(callback)
  }
  return setTimeout(() => callback(performance.now()), 16) as unknown as number
}

function defaultCancelFrame(handle: number): void {
  if (typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(handle)
  } else {
    clearTimeout(handle)
  }
}

function normalizeSpeed(speed: number): number {
  if (!Number.isFinite(speed)) return 1
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed))
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Canvas 2D 仿真运行时：负责固定时间步推进、DPR/尺寸适配、
 * 页面可见性处理，以及模型异常的隔离上报。
 *
 * 每个画布实例只允许存在一个运行时；销毁后不再调度任何帧。
 */
export class CanvasRuntime<S = unknown> {
  private readonly canvas: HTMLCanvasElement
  private readonly experiment: ExperimentDefinition<S>
  private readonly requestFrame: (callback: FrameRequestCallback) => number
  private readonly cancelFrame: (handle: number) => void
  private readonly onStatusChange?: (status: RuntimeStatus) => void
  private readonly onError?: (error: RuntimeErrorInfo) => void
  private readonly onTelemetry?: (samples: TelemetrySample[]) => void
  private readonly onProbe?: (readout: ProbeReadout | null) => void
  private readonly fixedStep: number

  private ctx: CanvasRenderingContext2D | null = null
  private state: S | undefined
  private params: ParamValues
  private speed: number
  private viewport: Viewport = { width: 0, height: 0 }

  private status: RuntimeStatus = 'paused'
  private running = false
  private destroyed = false
  private frameHandle: number | null = null
  private lastTimestamp: number | null = null
  private accumulator = 0
  private simTime = 0
  private steps = 0

  private telemetrySamples: TelemetrySample[] = []
  private lastTelemetrySampleAt = Number.NEGATIVE_INFINITY
  private lastTelemetryEmitAt = Number.NEGATIVE_INFINITY
  private telemetryBroken = false

  private pointer: ProbePoint | null = null
  private probeVisible = false
  private lastProbeEmitAt = Number.NEGATIVE_INFINITY
  private probeAttached = false

  private resizeObserver: ResizeObserver | null = null
  private readonly handleVisibility = (): void => {
    // 无论进入还是离开后台，都把时间基准置空，恢复后的第一帧 dt 记 0。
    this.lastTimestamp = null
    this.accumulator = 0
  }

  constructor(options: CanvasRuntimeOptions<S>) {
    this.canvas = options.canvas
    this.experiment = options.experiment
    this.requestFrame = options.requestFrame ?? defaultRequestFrame
    this.cancelFrame = options.cancelFrame ?? defaultCancelFrame
    this.onStatusChange = options.onStatusChange
    this.onError = options.onError
    this.onTelemetry = options.onTelemetry
    this.onProbe = options.onProbe
    this.fixedStep = options.fixedStep ?? DEFAULT_FIXED_STEP
    this.speed = normalizeSpeed(options.speed ?? 1)
    this.params = sanitizeParams(
      options.experiment,
      options.params ?? createDefaultParams(options.experiment),
    )

    const validation = validateExperiment(options.experiment)
    if (!validation.ok) {
      this.fail('init', new Error(`实验定义不合法：${validation.issues.join('；')}`))
      return
    }

    const ctx = this.canvas.getContext('2d')
    if (!ctx) {
      this.fail('init', new Error('当前环境无法获取 Canvas 2D 上下文'))
      return
    }
    this.ctx = ctx

    this.attachVisibilityListener()
    try {
      this.measure()
      this.state = this.experiment.model.createState(this.params)
    } catch (error) {
      this.fail('init', error)
      return
    }

    this.sampleTelemetry(true)
    this.attachProbe()

    if (options.autoResize !== false) {
      this.attachResizeObserver()
    }
    this.render()
    this.emitTelemetry(true)
  }

  start(): void {
    if (this.destroyed || this.status === 'error' || this.running) return
    this.running = true
    this.lastTimestamp = null
    this.accumulator = 0
    this.setStatus('running')
    this.schedule()
  }

  pause(): void {
    if (this.destroyed) return
    this.running = false
    this.cancelScheduled()
    if (this.status === 'running') {
      this.setStatus('paused')
    }
  }

  toggle(): void {
    if (this.status === 'running') {
      this.pause()
    } else {
      this.start()
    }
  }

  /** 暂停并精确推进一个固定步长，用于逐步观察仿真。 */
  stepOnce(): void {
    if (this.destroyed || this.status === 'error') return
    this.pause()
    this.tick()
    if (this.getStatus() === 'error') return
    this.setStatus('paused')
    this.render()
    this.updateProbe(true)
    this.emitTelemetry(true)
  }

  /** 回到初始状态（保留当前参数），并停在暂停态。 */
  reset(): void {
    if (this.destroyed) return
    this.running = false
    this.cancelScheduled()
    this.lastTimestamp = null
    this.accumulator = 0
    this.simTime = 0
    this.steps = 0
    this.telemetrySamples = []
    this.lastTelemetrySampleAt = Number.NEGATIVE_INFINITY
    this.telemetryBroken = false
    try {
      this.state = this.experiment.model.createState(this.params)
    } catch (error) {
      this.fail('init', error)
      return
    }
    this.sampleTelemetry(true)
    this.setStatus('paused')
    this.render()
    this.updateProbe(true)
    this.emitTelemetry(true)
  }

  setParams(params: ParamValues): void {
    if (this.destroyed) return
    this.params = sanitizeParams(this.experiment, params)
    if (!this.running && this.status !== 'error') {
      this.render()
      // 暂停时手动改参数也要刷新探针，否则读数会停在旧状态。
      this.updateProbe(true)
    }
  }

  setSpeed(speed: number): void {
    this.speed = normalizeSpeed(speed)
  }

  getStatus(): RuntimeStatus {
    return this.status
  }

  getSnapshot(): RuntimeSnapshot<S> {
    return {
      state: this.state,
      simTime: this.simTime,
      steps: this.steps,
      status: this.status,
    }
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.running = false
    this.cancelScheduled()
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.detachProbe()
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibility)
    }
  }

  private schedule(): void {
    if (!this.running || this.destroyed || this.frameHandle !== null) return
    this.frameHandle = this.requestFrame(this.handleFrame)
  }

  private cancelScheduled(): void {
    if (this.frameHandle === null) return
    this.cancelFrame(this.frameHandle)
    this.frameHandle = null
  }

  private readonly handleFrame = (timestamp: number): void => {
    this.frameHandle = null
    if (!this.running || this.destroyed) return

    const previous = this.lastTimestamp
    this.lastTimestamp = timestamp
    let delta = previous === null ? 0 : (timestamp - previous) / 1000
    if (!Number.isFinite(delta) || delta < 0) delta = 0
    delta = Math.min(delta, MAX_FRAME_DELTA)

    this.accumulator += delta * this.speed
    let executed = 0
    while (this.accumulator >= this.fixedStep && executed < MAX_STEPS_PER_FRAME) {
      this.tick()
      if (this.status === 'error') return
      this.accumulator -= this.fixedStep
      executed += 1
    }
    if (executed >= MAX_STEPS_PER_FRAME) {
      this.accumulator = 0
    }

    this.render()
    this.emitTelemetry()
    if (this.status !== 'error') {
      this.schedule()
    }
  }

  private tick(): void {
    if (this.state === undefined || this.status === 'error') return
    try {
      this.state = this.experiment.model.step(this.state, this.params, this.fixedStep)
      this.simTime += this.fixedStep
      this.steps += 1
    } catch (error) {
      this.fail('step', error)
      return
    }
    this.sampleTelemetry()
  }

  private render(): void {
    if (!this.ctx || this.state === undefined || this.status === 'error' || this.destroyed) return
    try {
      const { width, height } = this.viewport
      this.ctx.clearRect(0, 0, width, height)
      this.experiment.model.draw(this.ctx, this.state, this.params, this.viewport)
    } catch (error) {
      this.fail('draw', error)
      return
    }
    this.updateProbe(false)
  }

  /**
   * 按仿真时间间隔采样遥测，缓存长度由实验声明并限制在安全范围内。
   * 采样异常只停用遥测，不影响主仿真。
   */
  private sampleTelemetry(force = false): void {
    const telemetry = this.experiment.telemetry
    if (!telemetry || this.state === undefined || this.telemetryBroken) return

    const interval =
      typeof telemetry.interval === 'number' && telemetry.interval > 0
        ? telemetry.interval
        : DEFAULT_TELEMETRY_INTERVAL
    if (!force && this.simTime - this.lastTelemetrySampleAt < interval - 1e-9) return

    try {
      const raw = telemetry.sample(this.state, this.params, this.simTime)
      const values: Record<string, number> = {}
      for (const metric of telemetry.metrics) {
        const value = raw[metric.key]
        if (typeof value === 'number' && Number.isFinite(value)) {
          values[metric.key] = value
        }
      }
      this.telemetrySamples.push({ t: this.simTime, values })
      const capacity = Math.min(
        MAX_TELEMETRY_CAPACITY,
        Math.max(
          MIN_TELEMETRY_CAPACITY,
          Math.floor(telemetry.capacity ?? DEFAULT_TELEMETRY_CAPACITY),
        ),
      )
      while (this.telemetrySamples.length > capacity) this.telemetrySamples.shift()
      this.lastTelemetrySampleAt = this.simTime
    } catch {
      this.telemetryBroken = true
      this.telemetrySamples = []
    }
  }

  private emitTelemetry(force = false): void {
    if (!this.experiment.telemetry || !this.onTelemetry) return
    const now = nowMs()
    if (!force && now - this.lastTelemetryEmitAt < TELEMETRY_EMIT_INTERVAL) return
    this.lastTelemetryEmitAt = now
    this.onTelemetry(this.telemetrySamples.slice())
  }

  private attachProbe(): void {
    if (!this.experiment.probe || this.probeAttached) return
    if (typeof this.canvas.addEventListener !== 'function') return
    this.canvas.addEventListener('pointermove', this.handlePointerMove)
    this.canvas.addEventListener('pointerleave', this.handlePointerLeave)
    this.canvas.addEventListener('pointercancel', this.handlePointerLeave)
    this.probeAttached = true
  }

  private detachProbe(): void {
    if (!this.probeAttached) return
    if (typeof this.canvas.removeEventListener === 'function') {
      this.canvas.removeEventListener('pointermove', this.handlePointerMove)
      this.canvas.removeEventListener('pointerleave', this.handlePointerLeave)
      this.canvas.removeEventListener('pointercancel', this.handlePointerLeave)
    }
    this.probeAttached = false
  }

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (this.destroyed || this.status === 'error') return
    // 触屏没有悬停语义，直接降级为不显示探针。
    if (event.pointerType && event.pointerType !== 'mouse') return
    const rect = this.canvas.getBoundingClientRect()
    this.pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    this.updateProbe(true)
  }

  private readonly handlePointerLeave = (): void => {
    if (this.destroyed) return
    this.pointer = null
    this.probeVisible = false
    this.onProbe?.(null)
  }

  /** point 与 viewport 都是 CSS 像素坐标，DPR 只影响画布位图，不影响读数。 */
  private updateProbe(force: boolean): void {
    const probe = this.experiment.probe
    if (!probe || this.state === undefined || !this.pointer || this.status === 'error') return

    const now = nowMs()
    if (!force && now - this.lastProbeEmitAt < PROBE_EMIT_INTERVAL) return
    this.lastProbeEmitAt = now

    let reading: ProbeReading | null = null
    try {
      reading = probe.read(this.state, this.params, this.pointer, this.viewport)
    } catch {
      reading = null
    }

    if (!reading) {
      if (this.probeVisible) {
        this.probeVisible = false
        this.onProbe?.(null)
      }
      return
    }
    this.probeVisible = true
    this.onProbe?.({ point: { ...this.pointer }, reading })
  }

  private measure(): void {    if (!this.ctx) return
    const rect = this.canvas.getBoundingClientRect()
    const width = Math.max(1, Math.round(rect.width || this.canvas.clientWidth || this.canvas.width || 1))
    const height = Math.max(1, Math.round(rect.height || this.canvas.clientHeight || this.canvas.height || 1))
    const dpr = Math.min(
      3,
      Math.max(1, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1),
    )
    const pixelWidth = Math.round(width * dpr)
    const pixelHeight = Math.round(height * dpr)
    if (this.canvas.width !== pixelWidth) this.canvas.width = pixelWidth
    if (this.canvas.height !== pixelHeight) this.canvas.height = pixelHeight
    this.viewport = { width, height }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  private attachResizeObserver(): void {
    if (typeof ResizeObserver === 'undefined') return
    this.resizeObserver = new ResizeObserver(() => {
      if (this.destroyed) return
      this.measure()
      this.render()
    })
    this.resizeObserver.observe(this.canvas)
  }

  private attachVisibilityListener(): void {
    if (typeof document === 'undefined') return
    document.addEventListener('visibilitychange', this.handleVisibility)
  }

  private setStatus(status: RuntimeStatus): void {
    this.status = status
    this.onStatusChange?.(status)
  }

  private fail(scope: RuntimeErrorScope, error: unknown): void {
    this.status = 'error'
    this.running = false
    this.cancelScheduled()
    this.onError?.({ scope, message: errorMessage(error) })
    this.onStatusChange?.('error')
  }
}
