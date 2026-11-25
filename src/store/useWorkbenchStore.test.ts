import { beforeEach, describe, expect, it } from 'vitest'
import { EXPERIMENTS, DEFAULT_EXPERIMENT, DEFAULT_EXPERIMENT_ID } from '../experiments'
import { createDefaultParams } from '../runtime/params'
import { useWorkbenchStore } from './useWorkbenchStore'

const initialState = useWorkbenchStore.getState()

beforeEach(() => {
  useWorkbenchStore.setState({
    experiment: DEFAULT_EXPERIMENT,
    params: createDefaultParams(DEFAULT_EXPERIMENT),
    speed: 1,
    reloadKey: 0,
    status: 'running',
    error: null,
  })
})

describe('案例切换', () => {
  it('默认加载阻尼振动案例', () => {
    const state = useWorkbenchStore.getState()
    expect(state.experiment.id).toBe(DEFAULT_EXPERIMENT_ID)
    expect(state.params).toEqual(createDefaultParams(DEFAULT_EXPERIMENT))
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

  it('初始状态包含四个案例所需的动作', () => {
    expect(typeof initialState.selectExperiment).toBe('function')
    expect(typeof initialState.resetToDefault).toBe('function')
  })
})
