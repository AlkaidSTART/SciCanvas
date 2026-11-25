import type { ExperimentDefinition, ParamValues, Viewport } from '../types/experiment'
import { validateExperiment } from '../types/experiment'
import { createDefaultParams, sanitizeParams } from './params'

export type RuntimeStatus = 'running' | 'paused' | 'error'

export type RuntimeErrorScope = 'init' | 'step' | 'draw'

export interface RuntimeErrorInfo {
  scope: RuntimeErrorScope
  message: string
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
}

/** 单帧最多消化的真实时间，避免切后台回来 dt 过大导致状态爆炸。 */
const MAX_FRAME_DELTA = 0.1
/** 单帧最多推进的仿真步数，与 2 倍速对齐。 */
const MAX_STEPS_PER_FRAME = 24
const DEFAULT_FIXED_STEP = 1 / 120
const MIN_SPEED = 0.25
const MAX_SPEED = 4

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

    if (options.autoResize !== false) {
      this.attachResizeObserver()
    }
    this.render()
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
    try {
      this.state = this.experiment.model.createState(this.params)
    } catch (error) {
      this.fail('init', error)
      return
    }
    this.setStatus('paused')
    this.render()
  }

  setParams(params: ParamValues): void {
    if (this.destroyed) return
    this.params = sanitizeParams(this.experiment, params)
    if (!this.running && this.status !== 'error') {
      this.render()
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
    }
  }

  private render(): void {
    if (!this.ctx || this.state === undefined || this.status === 'error' || this.destroyed) return
    try {
      const { width, height } = this.viewport
      this.ctx.clearRect(0, 0, width, height)
      this.experiment.model.draw(this.ctx, this.state, this.params, this.viewport)
    } catch (error) {
      this.fail('draw', error)
    }
  }

  private measure(): void {
    if (!this.ctx) return
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
