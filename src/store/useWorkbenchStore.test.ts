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
    restartKey: 0,
    status: 'running',
    error: null,
    telemetry: [],
    probe: null,
    source: 'preset',
    aiSpec: null,
    lastGoodAi: null,
    heal: { status: 'idle', attempt: 0, maxAttempts: 2, message: '', failed: null },
    presentation: false,
    workspaceRecordId: null,
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

describe('M5 边界态与探索状态', () => {  it('边界态一次性写入声明的参数并请求重置', () => {
    const corner = DEFAULT_EXPERIMENT.cornerCases?.[0]
    expect(corner).toBeDefined()
    if (!corner) return

    useWorkbenchStore.getState().setParam('damping', 0.5)
    useWorkbenchStore.getState().syncTelemetry([{ t: 1, values: { energy: 1 } }])
    useWorkbenchStore.getState().syncProbe({
      point: { x: 10, y: 10 },
      reading: { position: 'x = 1', label: '值', value: '1' },
    })
    useWorkbenchStore.getState().syncStatus('error')
    const before = useWorkbenchStore.getState()

    useWorkbenchStore.getState().applyCornerCase(corner.id)
    const after = useWorkbenchStore.getState()

    for (const [key, value] of Object.entries(corner.params)) {
      expect(after.params[key]).toBe(value)
    }
    expect(after.params.damping).toBe(0.08)
    expect(after.params.showPhase).toBe(before.params.showPhase)
    expect(after.restartKey).toBe(before.restartKey + 1)
    expect(after.status).toBe('running')
    expect(after.error).toBeNull()
    expect(after.telemetry).toEqual([])
    expect(after.probe).toBeNull()
  })

  it('未知边界态 id 不改变状态', () => {
    const before = useWorkbenchStore.getState()
    useWorkbenchStore.getState().applyCornerCase('not-exist')
    const after = useWorkbenchStore.getState()
    expect(after.params).toEqual(before.params)
    expect(after.restartKey).toBe(before.restartKey)
  })

  it('AI 实验不提供边界态，调用会被忽略', () => {
    useWorkbenchStore.getState().applyGeneratedExperiment(aiSpec)
    const before = useWorkbenchStore.getState()
    useWorkbenchStore.getState().applyCornerCase('resonance')
    const after = useWorkbenchStore.getState()
    expect(after.params).toEqual(before.params)
    expect(after.restartKey).toBe(before.restartKey)
  })

  it('切换案例会清空遥测与探针残留', () => {
    useWorkbenchStore.getState().syncTelemetry([{ t: 1, values: {} }])
    useWorkbenchStore.getState().syncProbe({
      point: { x: 1, y: 1 },
      reading: { position: 'x = 1', label: '值', value: '1' },
    })
    useWorkbenchStore.getState().selectExperiment(EXPERIMENTS[1].id)
    const state = useWorkbenchStore.getState()
    expect(state.telemetry).toEqual([])
    expect(state.probe).toBeNull()
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

describe('可用版本保护与自动修复状态', () => {
  const nextSpec: GeneratedExperimentSpec = {
    ...aiSpec,
    title: 'AI 谐振子（微调版）',
  }

  it('首帧成功后记录当前 AI 版本，且同一版本不重复快照', () => {
    const store = useWorkbenchStore.getState()
    store.markAiVersionGood()
    expect(useWorkbenchStore.getState().lastGoodAi).toBeNull()

    useWorkbenchStore.getState().applyGeneratedExperiment(aiSpec)
    useWorkbenchStore.getState().setParam('stiffness', 1.6)
    useWorkbenchStore.getState().markAiVersionGood()
    const snapshot = useWorkbenchStore.getState().lastGoodAi
    expect(snapshot?.spec).toBe(aiSpec)
    expect(snapshot?.params.stiffness).toBe(1.6)

    useWorkbenchStore.getState().setParam('stiffness', 1.2)
    useWorkbenchStore.getState().markAiVersionGood()
    expect(useWorkbenchStore.getState().lastGoodAi?.params.stiffness).toBe(1.6)
  })

  it('应用新版本不会丢失上一可用版本', () => {
    useWorkbenchStore.getState().applyGeneratedExperiment(aiSpec)
    useWorkbenchStore.getState().markAiVersionGood()
    useWorkbenchStore.getState().applyGeneratedExperiment(nextSpec)
    const state = useWorkbenchStore.getState()
    expect(state.aiSpec).toBe(nextSpec)
    expect(state.lastGoodAi?.spec).toBe(aiSpec)
  })

  it('显式恢复上一可用版本及其参数', () => {
    useWorkbenchStore.getState().applyGeneratedExperiment(aiSpec)
    useWorkbenchStore.getState().setParam('stiffness', 1.6)
    useWorkbenchStore.getState().markAiVersionGood()
    useWorkbenchStore.getState().applyGeneratedExperiment(nextSpec)

    const restored = useWorkbenchStore.getState().restoreLastGoodAi()
    const state = useWorkbenchStore.getState()
    expect(restored).toBe(true)
    expect(state.aiSpec).toBe(aiSpec)
    expect(state.params.stiffness).toBe(1.6)
    expect(state.source).toBe('ai')
    expect(state.error).toBeNull()
    expect(state.heal.status).toBe('idle')
  })

  it('从未有可用版本时恢复会回到默认实验', () => {
    useWorkbenchStore.getState().applyGeneratedExperiment(aiSpec)
    const restored = useWorkbenchStore.getState().restoreLastGoodAi()
    const state = useWorkbenchStore.getState()
    expect(restored).toBe(false)
    expect(state.source).toBe('preset')
    expect(state.aiSpec).toBeNull()
    expect(state.experiment.id).toBe(DEFAULT_EXPERIMENT_ID)
  })

  it('切换预设会清空可用版本与修复状态', () => {
    useWorkbenchStore.getState().applyGeneratedExperiment(aiSpec)
    useWorkbenchStore.getState().markAiVersionGood()
    useWorkbenchStore.getState().setHealRequesting(1)
    useWorkbenchStore.getState().selectExperiment(EXPERIMENTS[0].id)
    const state = useWorkbenchStore.getState()
    expect(state.lastGoodAi).toBeNull()
    expect(state.heal.status).toBe('idle')
  })

  it('修复状态可从请求中转为成功或失败', () => {
    useWorkbenchStore.getState().setHealRequesting(1)
    expect(useWorkbenchStore.getState().heal).toMatchObject({
      status: 'requesting',
      attempt: 1,
    })
    useWorkbenchStore.getState().setHealApplied(1)
    expect(useWorkbenchStore.getState().heal.status).toBe('applied')
    useWorkbenchStore.getState().setHealSucceeded(1, '已修复')
    expect(useWorkbenchStore.getState().heal).toMatchObject({
      status: 'succeeded',
      message: '已修复',
    })

    const failure = {
      spec: nextSpec,
      params: { stiffness: 0.5 },
      error: { scope: 'init' as const, message: '初始化失败' },
    }
    useWorkbenchStore.getState().setHealFailed(2, '两次都失败', failure)
    expect(useWorkbenchStore.getState().heal).toMatchObject({
      status: 'failed',
      attempt: 2,
      message: '两次都失败',
      failed: failure,
    })
  })

  it('失败后可显式重试最后候选，并重新进入待修复状态', () => {
    useWorkbenchStore.getState().setHealFailed(2, '两次都失败', {
      spec: nextSpec,
      params: { stiffness: 0.5 },
      error: { scope: 'init', message: '初始化失败' },
    })
    useWorkbenchStore.getState().retryFailedHeal()
    const state = useWorkbenchStore.getState()
    expect(state.aiSpec).toBe(nextSpec)
    expect(state.params.stiffness).toBe(0.5)
    expect(state.status).toBe('running')
    expect(state.error).toBeNull()
    expect(state.heal.status).toBe('idle')
  })
})

describe('M6 演示模式', () => {
  it('进入与退出演示模式不会改变当前实验、参数和运行态', () => {
    const preset = EXPERIMENTS[1]
    useWorkbenchStore.getState().selectExperiment(preset.id)
    useWorkbenchStore.getState().setParam(preset.controls[0].key, 0.001)
    useWorkbenchStore.getState().setSpeed(2)
    useWorkbenchStore.getState().syncStatus('paused')
    const before = useWorkbenchStore.getState()

    useWorkbenchStore.getState().enterPresentation()
    const presenting = useWorkbenchStore.getState()
    expect(presenting.presentation).toBe(true)
    expect(presenting.experiment).toBe(before.experiment)
    expect(presenting.params).toBe(before.params)
    expect(presenting.speed).toBe(before.speed)
    expect(presenting.status).toBe('paused')
    expect(presenting.reloadKey).toBe(before.reloadKey)
    expect(presenting.restartKey).toBe(before.restartKey)

    useWorkbenchStore.getState().exitPresentation()
    const after = useWorkbenchStore.getState()
    expect(after.presentation).toBe(false)
    expect(after.experiment).toBe(before.experiment)
    expect(after.params).toBe(before.params)
    expect(after.reloadKey).toBe(before.reloadKey)
  })

  it('AI 实验进入演示模式后仍保留生成版本', () => {
    useWorkbenchStore.getState().applyGeneratedExperiment(aiSpec)
    const before = useWorkbenchStore.getState()
    useWorkbenchStore.getState().enterPresentation()
    const state = useWorkbenchStore.getState()
    expect(state.presentation).toBe(true)
    expect(state.source).toBe('ai')
    expect(state.aiSpec).toBe(aiSpec)
    expect(state.reloadKey).toBe(before.reloadKey)
  })
})

describe('M7 本地记录归属', () => {
  it('切换预设会清除记录 ID，从工作区加载时使用指定 ID', () => {
    useWorkbenchStore.getState().setWorkspaceRecordId('record-1')
    useWorkbenchStore.getState().selectExperiment(EXPERIMENTS[0].id)
    expect(useWorkbenchStore.getState().workspaceRecordId).toBeNull()

    useWorkbenchStore.getState().selectExperiment(EXPERIMENTS[1].id, { recordId: 'record-2' })
    expect(useWorkbenchStore.getState().workspaceRecordId).toBe('record-2')
  })

  it('AI 微调与修复沿用当前记录，新生成才另起一条', () => {
    useWorkbenchStore.getState().applyGeneratedExperiment(aiSpec, undefined, {
      recordId: 'record-3',
    })
    expect(useWorkbenchStore.getState().workspaceRecordId).toBe('record-3')

    const refined: GeneratedExperimentSpec = { ...aiSpec, title: 'AI 谐振子（微调）' }
    useWorkbenchStore.getState().applyGeneratedExperiment(refined)
    expect(useWorkbenchStore.getState().workspaceRecordId).toBe('record-3')

    useWorkbenchStore.getState().applyGeneratedExperiment(aiSpec, undefined, { newRecord: true })
    expect(useWorkbenchStore.getState().workspaceRecordId).toBeNull()
  })

  it('从工作区批量恢复参数会按当前实验控件清洗', () => {
    useWorkbenchStore.getState().applyGeneratedExperiment(aiSpec)
    useWorkbenchStore.getState().setParams({ stiffness: 99, unknown: 'x' })
    const params = useWorkbenchStore.getState().params
    expect(params.stiffness).toBe(2)
    expect(params.unknown).toBeUndefined()
  })

  it('回到默认实验会断开记录归属', () => {
    useWorkbenchStore.getState().applyGeneratedExperiment(aiSpec, undefined, {
      recordId: 'record-4',
    })
    useWorkbenchStore.getState().resetToDefault()
    expect(useWorkbenchStore.getState().workspaceRecordId).toBeNull()
  })
})
