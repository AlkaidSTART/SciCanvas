import { describe, expect, it, vi } from 'vitest'
import { CanvasRuntime } from './CanvasRuntime'
import type { RuntimeErrorInfo, RuntimeStatus } from './CanvasRuntime'
import { createDefaultParams } from './params'
import type { ExperimentDefinition, ParamValues } from '../types/experiment'

interface CounterState {
  value: number
}

function makeCounterExperiment(draw: () => void = () => {}): ExperimentDefinition<CounterState> {
  return {
    id: 'counter',
    title: '计数器实验',
    domain: 'Test / Runtime',
    formulaLatex: 'x_{n+1} = x_n + g \\cdot dt',
    insight: '每步按增益累加，用于验证时间控制。',
    renderType: 'canvas2d',
    controls: [
      { type: 'slider', key: 'gain', label: '增益', min: 1, max: 10, step: 1, default: 1 },
    ],
    model: {
      createState: () => ({ value: 0 }),
      step: (state, params, dt) => ({
        value: state.value + (typeof params.gain === 'number' ? params.gain : 1) * dt,
      }),
      draw,
    },
  }
}

function createContext(): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => {} }
  const target: Record<string, unknown> = {}
  return new Proxy(target, {
    get(object, property) {
      if (property === 'createLinearGradient' || property === 'createRadialGradient') {
        return () => gradient
      }
      if (property === 'measureText') {
        return () => ({ width: 10 })
      }
      if (!(property in object)) {
        object[String(property)] = () => {}
      }
      return object[String(property)]
    },
    set(object, property, value) {
      object[String(property)] = value
      return true
    },
  }) as unknown as CanvasRenderingContext2D
}

function createHarness() {
  const frames: Array<{ id: number; callback: FrameRequestCallback }> = []
  const cancelled: number[] = []
  let nextFrameId = 1

  const requestFrame = (callback: FrameRequestCallback): number => {
    const id = nextFrameId
    nextFrameId += 1
    frames.push({ id, callback })
    return id
  }

  const cancelFrame = (handle: number): void => {
    cancelled.push(handle)
    const index = frames.findIndex((frame) => frame.id === handle)
    if (index !== -1) frames.splice(index, 1)
  }

  const flush = (timestamp: number): void => {
    const batch = frames.splice(0, frames.length)
    for (const frame of batch) {
      frame.callback(timestamp)
    }
  }

  const ctx = createContext()
  const canvas = {
    width: 0,
    height: 0,
    clientWidth: 800,
    clientHeight: 600,
    getContext: () => ctx,
    getBoundingClientRect: () => ({
      width: 800,
      height: 600,
      top: 0,
      left: 0,
      right: 800,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  } as unknown as HTMLCanvasElement

  return { canvas, frames, cancelled, flush, requestFrame, cancelFrame }
}

type Harness = ReturnType<typeof createHarness>

interface RuntimeOverrides {
  experiment?: ExperimentDefinition<CounterState>
  params?: ParamValues
  onStatusChange?: (status: RuntimeStatus) => void
  onError?: (error: RuntimeErrorInfo) => void
}

function createRuntime(harness: Harness, overrides: RuntimeOverrides = {}): CanvasRuntime<CounterState> {
  const experiment = overrides.experiment ?? makeCounterExperiment()
  return new CanvasRuntime<CounterState>({
    canvas: harness.canvas,
    experiment,
    params: overrides.params ?? createDefaultParams(experiment),
    requestFrame: harness.requestFrame,
    cancelFrame: harness.cancelFrame,
    autoResize: false,
    onStatusChange: overrides.onStatusChange,
    onError: overrides.onError,
  })
}

const FIXED_STEP = 1 / 120

describe('CanvasRuntime 时间控制', () => {
  it('按固定步长推进，并对巨大帧间隔做限幅', () => {
    const harness = createHarness()
    const runtime = createRuntime(harness)
    runtime.start()
    expect(runtime.getStatus()).toBe('running')

    harness.flush(1000)
    expect(runtime.getSnapshot().simTime).toBe(0)

    harness.flush(1016)
    const afterOneFrame = runtime.getSnapshot()
    expect(afterOneFrame.steps).toBe(1)
    expect(afterOneFrame.simTime).toBeCloseTo(FIXED_STEP, 8)

    const beforeGap = afterOneFrame.simTime
    harness.flush(601016)
    const advanced = runtime.getSnapshot().simTime - beforeGap
    expect(advanced).toBeGreaterThan(0)
    expect(advanced).toBeLessThanOrEqual(0.1 + 1e-9)

    runtime.destroy()
  })

  it('暂停后停止推进，单步只推进一个固定步长', () => {
    const harness = createHarness()
    const runtime = createRuntime(harness)
    runtime.start()
    harness.flush(0)
    harness.flush(16)

    const beforePause = runtime.getSnapshot().simTime
    runtime.pause()
    expect(runtime.getStatus()).toBe('paused')
    harness.flush(500)
    expect(runtime.getSnapshot().simTime).toBe(beforePause)

    runtime.stepOnce()
    expect(runtime.getSnapshot().simTime).toBeCloseTo(beforePause + FIXED_STEP, 8)
    expect(runtime.getStatus()).toBe('paused')

    runtime.start()
    expect(runtime.getStatus()).toBe('running')
    runtime.destroy()
  })

  it('重置后回到初始状态并停在暂停态', () => {
    const harness = createHarness()
    const runtime = createRuntime(harness)
    runtime.stepOnce()
    runtime.stepOnce()
    expect(runtime.getSnapshot().steps).toBe(2)

    runtime.reset()
    const snapshot = runtime.getSnapshot()
    expect(snapshot.steps).toBe(0)
    expect(snapshot.simTime).toBe(0)
    expect(snapshot.state?.value).toBe(0)
    expect(snapshot.status).toBe('paused')
    runtime.destroy()
  })

  it('参数更新会立即作用于后续推演', () => {
    const harness = createHarness()
    const runtime = createRuntime(harness)
    runtime.setParams({ gain: 3 })
    runtime.stepOnce()
    expect(runtime.getSnapshot().state?.value).toBeCloseTo(3 * FIXED_STEP, 8)

    runtime.setParams({ gain: 999 })
    runtime.reset()
    runtime.stepOnce()
    expect(runtime.getSnapshot().state?.value).toBeCloseTo(10 * FIXED_STEP, 8)
    runtime.destroy()
  })

  it('销毁后不再调度或绘制，反复进出不会叠加动画循环', () => {
    const harness = createHarness()
    const draw = vi.fn()
    const runtime = createRuntime(harness, { experiment: makeCounterExperiment(draw) })
    runtime.start()
    harness.flush(0)
    expect(harness.frames.length).toBe(1)

    const drawsBeforeDestroy = draw.mock.calls.length
    runtime.destroy()
    expect(harness.frames.length).toBe(0)

    harness.flush(9000)
    expect(draw.mock.calls.length).toBe(drawsBeforeDestroy)
    expect(runtime.getSnapshot().simTime).toBe(0)

    for (let index = 0; index < 3; index += 1) {
      const extra = createRuntime(harness, { experiment: makeCounterExperiment(draw) })
      extra.start()
      extra.destroy()
    }
    expect(harness.frames.length).toBe(0)
  })
})

describe('CanvasRuntime 故障隔离', () => {
  it('捕获绘制异常并进入错误状态', () => {
    const harness = createHarness()
    const errors: RuntimeErrorInfo[] = []
    const statuses: RuntimeStatus[] = []
    const runtime = createRuntime(harness, {
      experiment: makeCounterExperiment(() => {
        throw new Error('draw exploded')
      }),
      onError: (error) => errors.push(error),
      onStatusChange: (status) => statuses.push(status),
    })

    expect(errors).toEqual([{ scope: 'draw', message: 'draw exploded' }])
    expect(runtime.getStatus()).toBe('error')
    expect(statuses).toContain('error')

    runtime.start()
    expect(harness.frames.length).toBe(0)
    runtime.destroy()
  })

  it('捕获初始化异常', () => {
    const harness = createHarness()
    const errors: RuntimeErrorInfo[] = []
    const experiment = makeCounterExperiment()
    experiment.model.createState = () => {
      throw new Error('bad init')
    }

    const runtime = createRuntime(harness, {
      experiment,
      onError: (error) => errors.push(error),
    })
    expect(errors).toEqual([{ scope: 'init', message: 'bad init' }])
    expect(runtime.getStatus()).toBe('error')
    runtime.destroy()
  })

  it('拒绝不合法的实验定义', () => {
    const harness = createHarness()
    const errors: RuntimeErrorInfo[] = []
    const invalidExperiment = { ...makeCounterExperiment(), id: '' }
    const runtime = createRuntime(harness, {
      experiment: invalidExperiment,
      onError: (error) => errors.push(error),
    })
    expect(errors[0]?.scope).toBe('init')
    expect(errors[0]?.message).toContain('实验定义不合法')
    runtime.destroy()
  })
})
