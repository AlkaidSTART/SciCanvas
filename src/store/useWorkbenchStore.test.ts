import { beforeEach, describe, expect, it } from 'vitest'
import type { GeneratedExperimentSpec } from '../ai/schema'
import { EXPERIMENTS, DEFAULT_EXPERIMENT, DEFAULT_EXPERIMENT_ID } from '../experiments'
import { createDefaultParams } from '../runtime/params'
import { useWorkbenchStore } from './useWorkbenchStore'

const initialState = useWorkbenchStore.getState()

const aiSpec: GeneratedExperimentSpec = {
  title: 'AI 谐振子',
  domain: 'Physics / AI',
  formulaLatex: 'x(t) = A\\cos(\\omega t)',
  insight: '调节刚度观察振动周期变化。',
  renderType: 'canvas2d',
  controls: [
    { type: 'slider', key: 'stiffness', label: '刚度', min: 0.1, max: 2, step: 0.1, default: 1 },
  ],
  simulationCode: `return {
    createState: function () { return { x: 1 } },
    step: function (state, params, dt) { return { x: state.x - params.stiffness * dt } },
    draw: function () {}
  }`,
}

beforeEach(() => {
  useWorkbenchStore.setState({
    experiment: DEFAULT_EXPERIMENT,
    params: createDefaultParams(DEFAULT_EXPERIMENT),
    speed: 1,
    reloadKey: 0,
    status: 'running',
    error: null,
    source: 'preset',
    aiSpec: null,
  })
})

describe('案例切换', () => {
  it('默认加载阻尼振动案例', () => {
    const state = useWorkbenchStore.getState()
    expect(state.experiment.id).toBe(DEFAULT_EXPERIMENT_ID)
    expect(state.params).toEqual(createDefaultParams(DEFAULT_EXPERIMENT))
    expect(state.source).toBe('preset')
  })

  for (const preset of EXPERIMENTS) {
    it(`切换到「${preset.title}」会重置参数与运行态`, () => {
      const before = useWorkbenchStore.getState()
      useWorkbenchStore.getState().setSpeed(2)
      useWorkbenchStore.getState().syncError({ scope: 'draw', message: '旧案例异常' })
      useWorkbenchStore.getState().syncStatus('error')

      useWorkbenchStore.getState().selectExperiment(preset.id)
      const after = useWorkbenchStore.getState()
      expect(after.experiment.id).toBe(preset.id)
      expect(after.params).toEqual(createDefaultParams(preset))
      expect(after.speed).toBe(1)
      expect(after.status).toBe('running')
      expect(after.error).toBeNull()
      expect(after.reloadKey).toBe(before.reloadKey + 1)
      expect(after.source).toBe('preset')
      expect(after.aiSpec).toBeNull()
    })
  }

  it('快速连续切换只保留最后一个案例', () => {
    for (const preset of EXPERIMENTS) {
      useWorkbenchStore.getState().selectExperiment(preset.id)
    }
    const state = useWorkbenchStore.getState()
    expect(state.experiment.id).toBe(EXPERIMENTS[EXPERIMENTS.length - 1].id)
    expect(state.params).toEqual(createDefaultParams(EXPERIMENTS[EXPERIMENTS.length - 1]))
  })

  it('重复选择当前案例会按默认参数重新开始', () => {
    const preset = EXPERIMENTS[0]
    useWorkbenchStore.getState().selectExperiment(preset.id)
    useWorkbenchStore.getState().setParam(preset.controls[0].key, 0.001)
    const before = useWorkbenchStore.getState()
    useWorkbenchStore.getState().selectExperiment(preset.id)
    const after = useWorkbenchStore.getState()
    expect(after.params).toEqual(createDefaultParams(preset))
    expect(after.reloadKey).toBe(before.reloadKey + 1)
  })

  it('未知案例 ID 不会改变当前状态', () => {
    const before = useWorkbenchStore.getState()
    useWorkbenchStore.getState().selectExperiment('not-exist')
    const after = useWorkbenchStore.getState()
    expect(after.experiment.id).toBe(before.experiment.id)
    expect(after.reloadKey).toBe(before.reloadKey)
  })

  it('初始状态包含案例切换与回退动作', () => {
    expect(typeof initialState.selectExperiment).toBe('function')
    expect(typeof initialState.resetToDefault).toBe('function')
    expect(typeof initialState.applyGeneratedExperiment).toBe('function')
  })
})

describe('AI 实验应用与回退', () => {
  it('应用生成结果会替换实验元数据并重置运行态', () => {
    useWorkbenchStore.getState().setSpeed(2)
    useWorkbenchStore.getState().syncStatus('paused')
    const before = useWorkbenchStore.getState()

    useWorkbenchStore.getState().applyGeneratedExperiment(aiSpec)
    const after = useWorkbenchStore.getState()

    expect(after.source).toBe('ai')
    expect(after.aiSpec).toBe(aiSpec)
    expect(after.experiment.title).toBe(aiSpec.title)
    expect(after.experiment.domain).toBe(aiSpec.domain)
    expect(after.experiment.formulaLatex).toBe(aiSpec.formulaLatex)
    expect(after.experiment.controls).toEqual(aiSpec.controls)
    expect(after.params).toEqual(createDefaultParams(after.experiment))
    expect(after.speed).toBe(1)
    expect(after.status).toBe('running')
    expect(after.error).toBeNull()
    expect(after.reloadKey).toBe(before.reloadKey + 1)
  })

  it('切换预设会退出 AI 实验', () => {
    useWorkbenchStore.getState().applyGeneratedExperiment(aiSpec)
    useWorkbenchStore.getState().selectExperiment(EXPERIMENTS[0].id)
    const state = useWorkbenchStore.getState()
    expect(state.source).toBe('preset')
    expect(state.aiSpec).toBeNull()
    expect(state.experiment.id).toBe(EXPERIMENTS[0].id)
  })

  it('从 AI 实验回到默认实验', () => {
    useWorkbenchStore.getState().applyGeneratedExperiment(aiSpec)
    useWorkbenchStore.getState().resetToDefault()
    const state = useWorkbenchStore.getState()
    expect(state.source).toBe('preset')
    expect(state.aiSpec).toBeNull()
    expect(state.experiment.id).toBe(DEFAULT_EXPERIMENT_ID)
    expect(state.params).toEqual(createDefaultParams(DEFAULT_EXPERIMENT))
  })

  it('预设状态下重置保留当前案例', () => {
    const preset = EXPERIMENTS[2]
    useWorkbenchStore.getState().selectExperiment(preset.id)
    useWorkbenchStore.getState().setParam(preset.controls[0].key, 0.001)
    useWorkbenchStore.getState().resetToDefault()
    const state = useWorkbenchStore.getState()
    expect(state.experiment.id).toBe(preset.id)
    expect(state.params).toEqual(createDefaultParams(preset))
  })
})
