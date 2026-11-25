import { describe, expect, it } from 'vitest'
import { createDefaultParams } from '../runtime/params'
import type { ExperimentDefinition, ParamValues, Viewport } from '../types/experiment'
import { EXPERIMENTS, DEFAULT_EXPERIMENT_ID, getExperimentById } from './index'
import { dampedOscillator } from './dampedOscillator'
import type { DampedOscillatorState } from './dampedOscillator'
import { fourierSquareWave, squareWaveOvershoot, squareWavePartial } from './fourier'
import { optimizerLandscape } from './optimizers'
import type { OptimizerState } from './optimizers'
import { sirEpidemic } from './sir'
import type { SirState } from './sir'

const FIXED_STEP = 1 / 120
const VIEWPORT: Viewport = { width: 900, height: 640 }

function createContext(): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => {} }
  const target: Record<string, unknown> = {}
  return new Proxy(target, {
    get(object, property) {
      if (property === 'createLinearGradient' || property === 'createRadialGradient') {
        return () => gradient
      }
      if (property === 'measureText') {
        return () => ({ width: 24 })
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

function expectFiniteNumbers(value: unknown, path = 'state'): void {
  if (typeof value === 'number') {
    expect(Number.isFinite(value), `${path} 应为有限数值，实际为 ${value}`).toBe(true)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => expectFiniteNumbers(item, `${path}[${index}]`))
    return
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      expectFiniteNumbers(child, `${path}.${key}`)
    }
  }
}

function runSteps(
  experiment: ExperimentDefinition,
  params: ParamValues,
  steps: number,
): unknown {
  let state = experiment.model.createState(params)
  for (let index = 0; index < steps; index += 1) {
    state = experiment.model.step(state, params, FIXED_STEP)
  }
  return state
}

describe('M2 预设案例库', () => {
  it('注册四个可识别的跨学科案例', () => {
    expect(EXPERIMENTS.map((experiment) => experiment.id)).toEqual([
      'optimizer-landscape',
      'damped-driven-oscillator',
      'sir-epidemic',
      'fourier-square-wave',
    ])
    expect(getExperimentById(DEFAULT_EXPERIMENT_ID)?.id).toBe(DEFAULT_EXPERIMENT_ID)
  })

  for (const experiment of EXPERIMENTS) {
    describe(experiment.title, () => {
      const params = createDefaultParams(experiment)

      it('初始化、连续推进与绘制保持数值稳定', () => {
        const ctx = createContext()
        let state = experiment.model.createState(params)
        for (let index = 0; index < 240; index += 1) {
          state = experiment.model.step(state, params, FIXED_STEP)
        }
        expectFiniteNumbers(state)
        expect(() => experiment.model.draw(ctx, state, params, VIEWPORT)).not.toThrow()
        expect(() => experiment.model.draw(ctx, state, params, { width: 420, height: 520 })).not.toThrow()
      })

      it('重置会回到新初始化的状态', () => {
        const initial = experiment.model.createState(params)
        runSteps(experiment, params, 90)
        expect(experiment.model.createState(params)).toEqual(initial)
      })
    })
  }
})

describe('优化器案例', () => {
  const base = createDefaultParams(optimizerLandscape)

  it('更大的学习率让 SGD 更快离开鞍点', () => {
    const slow = runSteps(optimizerLandscape, { ...base, learningRate: 0.002 }, 300) as OptimizerState
    const fast = runSteps(optimizerLandscape, { ...base, learningRate: 0.018 }, 300) as OptimizerState
    expect(Math.abs(fast.sgd.pos.y)).toBeGreaterThan(Math.abs(slow.sgd.pos.y) + 0.1)
  })

  it('动量加速了狭长方向上的收敛', () => {
    const noMomentum = runSteps(optimizerLandscape, { ...base, momentum: 0 }, 120) as OptimizerState
    const highMomentum = runSteps(optimizerLandscape, { ...base, momentum: 0.95 }, 120) as OptimizerState
    expect(Math.abs(highMomentum.momentum.pos.x)).toBeLessThan(
      Math.abs(noMomentum.momentum.pos.x),
    )
  })

  it('切换地形会按新地形重新初始化轨迹', () => {
    let state = optimizerLandscape.model.createState(base)
    state = optimizerLandscape.model.step(state, { ...base, terrain: 'ravine' }, FIXED_STEP)
    expect(state.terrain).toBe('ravine')
    expect(state.sgd.steps).toBe(0)
    expect(state.sgd.trail).toEqual([{ x: 1.75, y: 0.95 }])
  })
})

describe('SIR 案例', () => {
  const base = createDefaultParams(sirEpidemic)

  function runSir(r0: number): SirState {
    let state = sirEpidemic.model.createState({ ...base, r0 })
    for (let index = 0; index < 900; index += 1) {
      state = sirEpidemic.model.step(state, { ...base, r0 }, FIXED_STEP)
    }
    return state
  }

  it('R₀ 越高，感染峰值与最终移除比例越大', () => {
    const low = runSir(1.2)
    const high = runSir(4)
    expect(high.peakI).toBeGreaterThan(low.peakI)
    expect(high.r).toBeGreaterThan(low.r)
  })

  it('任意时刻 S + I + R 保持归一', () => {
    let state = sirEpidemic.model.createState(base)
    for (let index = 0; index < 600; index += 1) {
      state = sirEpidemic.model.step(state, base, FIXED_STEP)
      expect(state.s + state.i + state.r).toBeCloseTo(1, 8)
    }
  })
})

describe('傅里叶案例', () => {
  it('谐波项数增加会降低方波逼近误差', () => {
    const errorOf = (harmonics: number): number => {
      let sum = 0
      const samples = 400
      for (let index = 0; index < samples; index += 1) {
        const x = -Math.PI + (2 * Math.PI * (index + 0.5)) / samples
        const target = x < 0 ? -1 : 1
        sum += (squareWavePartial(x, harmonics) - target) ** 2
      }
      return sum / samples
    }
    expect(errorOf(31)).toBeLessThan(errorOf(3))
  })

  it('部分和在跳变处存在吉布斯过冲', () => {
    const { max } = squareWaveOvershoot(9)
    expect(max).toBeGreaterThan(1.05)
    expect(max).toBeLessThan(1.2)
  })

  it('时间控制会推进扫描相位', () => {
    const params = createDefaultParams(fourierSquareWave)
    const state = runSteps(fourierSquareWave, params, 120) as { t: number; ticks: number }
    expect(state.ticks).toBe(120)
    expect(state.t).toBeCloseTo(1, 6)
  })
})

describe('阻尼振动案例', () => {
  const base = createDefaultParams(dampedOscillator)

  it('移除驱动力后振幅按阻尼衰减', () => {
    const state = runSteps(dampedOscillator, { ...base, force: 0 }, 1200) as DampedOscillatorState
    expect(Math.abs(state.x)).toBeLessThan(0.2)
  })

  it('接近固有频率且阻尼较小时出现共振放大', () => {
    const state = runSteps(
      dampedOscillator,
      { ...base, omega: 2, force: 0.6, damping: 0.08 },
      1200,
    ) as DampedOscillatorState
    const maxDisplacement = Math.max(...state.trail.map((point) => Math.abs(point.x)))
    expect(maxDisplacement).toBeGreaterThan(1)
  })
})
