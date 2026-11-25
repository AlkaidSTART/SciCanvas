import { create } from 'zustand'
import { MAX_HEAL_ATTEMPTS } from '../ai/heal'
import type { GeneratedExperimentSpec } from '../ai/schema'
import { DEFAULT_EXPERIMENT, getExperimentById } from '../experiments'
import type {
  ProbeReadout,
  RuntimeErrorInfo,
  RuntimeStatus,
} from '../runtime/CanvasRuntime'
import { createDefaultParams, sanitizeParams } from '../runtime/params'
import type {
  ControlValue,
  ExperimentDefinition,
  ParamValues,
  TelemetrySample,
} from '../types/experiment'

export type ExperimentSource = 'preset' | 'ai'

export type HealStatus = 'idle' | 'requesting' | 'applied' | 'succeeded' | 'failed'

export interface AiVersionSnapshot {
  spec: GeneratedExperimentSpec
  params: ParamValues
}

/** 修复失败时保留最后候选，便于用户显式重试。 */
export interface HealFailure {
  spec: GeneratedExperimentSpec
  params: ParamValues
  error: RuntimeErrorInfo
}

export interface HealState {
  status: HealStatus
  attempt: number
  maxAttempts: number
  message: string
  failed: HealFailure | null
}

function createInitialHeal(): HealState {
  return { status: 'idle', attempt: 0, maxAttempts: MAX_HEAL_ATTEMPTS, message: '', failed: null }
}

interface WorkbenchState {
  experiment: ExperimentDefinition
  params: ParamValues
  speed: number
  /** 自增后触发运行时重建，用于「回到默认实验」、切换案例与应用生成结果。 */
  reloadKey: number
  /** 边界态应用后自增，运行时据此重置仿真并继续播放。 */
  restartKey: number
  status: RuntimeStatus
  error: RuntimeErrorInfo | null
  /** 有界遥测快照，由本地运行时推送；仅当前实验声明 telemetry 时有值。 */
  telemetry: TelemetrySample[]
  /** 悬停探针读数，指针离开画布或读数失效时为 null。 */
  probe: ProbeReadout | null
  /** 当前实验来自内置预设还是 AI 生成。 */
  source: ExperimentSource
  /** AI 生成成功后的原始描述，供隔离沙盒初始化使用。 */
  aiSpec: GeneratedExperimentSpec | null
  /** 最近一次通过初始化的 AI 版本，用于修复失败后恢复。 */
  lastGoodAi: AiVersionSnapshot | null
  /** 自动修复的可视化状态。 */
  heal: HealState
  setParam: (key: string, value: ControlValue) => void
  setSpeed: (speed: number) => void
  selectExperiment: (id: string) => void
  applyGeneratedExperiment: (spec: GeneratedExperimentSpec, params?: ParamValues) => void
  /** 原子应用实验声明的边界态参数，并请求运行时重置后继续播放。 */
  applyCornerCase: (id: string) => void
  syncStatus: (status: RuntimeStatus) => void
  syncError: (error: RuntimeErrorInfo | null) => void
  syncTelemetry: (samples: TelemetrySample[]) => void
  syncProbe: (readout: ProbeReadout | null) => void
  resetToDefault: () => void
  markAiVersionGood: () => void
  restoreLastGoodAi: () => boolean
  setHealRequesting: (attempt: number) => void
  setHealApplied: (attempt: number) => void
  setHealSucceeded: (attempt: number, message?: string) => void
  setHealFailed: (attempt: number, message: string, failed?: HealFailure | null) => void
  resetHeal: () => void
  retryFailedHeal: () => void
}

/**
 * 工作台的全局状态：当前实验、参数、倍速与运行状态。
 * 运行时实例本身有生命周期副作用，仍由 useExperimentRuntime 持有。
 */
export const useWorkbenchStore = create<WorkbenchState>()((set, get) => ({
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
  heal: createInitialHeal(),

  setParam: (key, value) => {
    const { experiment, params } = get()
    set({ params: sanitizeParams(experiment, { ...params, [key]: value }) })
  },

  setSpeed: (speed) => set({ speed }),

  /**
   * 切换案例时一次性替换实验、参数与运行态：
   * reloadKey 自增让 useExperimentRuntime 销毁旧运行时并按新案例默认参数重建。
   */
  selectExperiment: (id) => {
    const { experiment, reloadKey } = get()
    const next = getExperimentById(id)
    if (!next) return
    if (next.id === experiment.id) {
      set({
        params: createDefaultParams(next),
        speed: 1,
        status: 'running',
        error: null,
        telemetry: [],
        probe: null,
        source: 'preset',
        aiSpec: null,
        lastGoodAi: null,
        heal: createInitialHeal(),
        reloadKey: reloadKey + 1,
      })
      return
    }
    set({
      experiment: next,
      params: createDefaultParams(next),
      speed: 1,
      status: 'running',
      error: null,
      telemetry: [],
      probe: null,
      source: 'preset',
      aiSpec: null,
      lastGoodAi: null,
      heal: createInitialHeal(),
      reloadKey: reloadKey + 1,
    })
  },

  /**
   * 应用已校验的生成结果。模型方法只是占位：AI 实验的实际推演
   * 由隔离 iframe 沙盒执行，主线程运行时不会调用这里。
   * lastGoodAi 保留不变，便于修复失败时恢复上一可用版本。
   */
  applyGeneratedExperiment: (spec, params) => {
    const { reloadKey } = get()
    const experiment: ExperimentDefinition = {
      id: 'ai-generated',
      title: spec.title,
      domain: spec.domain,
      formulaLatex: spec.formulaLatex,
      insight: spec.insight,
      renderType: 'canvas2d',
      controls: spec.controls,
      ...(spec.legend ? { legend: spec.legend } : {}),
      model: {
        createState: () => {
          throw new Error('AI 实验需在隔离沙盒中运行')
        },
        step: (state) => state,
        draw: () => {},
      },
    }
    set({
      experiment,
      source: 'ai',
      aiSpec: spec,
      params: params
        ? sanitizeParams(experiment, params)
        : createDefaultParams(experiment),
      speed: 1,
      status: 'running',
      error: null,
      telemetry: [],
      probe: null,
      heal: createInitialHeal(),
      reloadKey: reloadKey + 1,
    })
  },

  /**
   * 边界态一次性写入所有相关参数：合并当前值后统一清洗，
   * 保证控件显示与模型读到的参数完全一致。
   */
  applyCornerCase: (id) => {
    const { experiment, params, restartKey, source } = get()
    if (source !== 'preset') return
    const cornerCase = experiment.cornerCases?.find((item) => item.id === id)
    if (!cornerCase) return
    set({
      params: sanitizeParams(experiment, { ...params, ...cornerCase.params }),
      status: 'running',
      error: null,
      telemetry: [],
      probe: null,
      restartKey: restartKey + 1,
    })
  },

  syncStatus: (status) => set({ status }),

  syncError: (error) => set({ error }),

  syncTelemetry: (samples) => set({ telemetry: samples }),

  syncProbe: (readout) => set({ probe: readout }),

  /** AI 实验失败或用户主动回退时，直接回到内置默认实验。 */
  resetToDefault: () => {
    const { experiment, reloadKey, source } = get()
    const target = source === 'ai' ? DEFAULT_EXPERIMENT : experiment
    set({
      experiment: target,
      params: createDefaultParams(target),
      speed: 1,
      status: 'running',
      error: null,
      telemetry: [],
      probe: null,
      source: 'preset',
      aiSpec: null,
      lastGoodAi: null,
      heal: createInitialHeal(),
      reloadKey: reloadKey + 1,
    })
  },

  /** 沙盒首帧成功后记录当前 AI 版本；同一 spec 对象只快照一次。 */
  markAiVersionGood: () => {
    const { source, aiSpec, lastGoodAi, params } = get()
    if (source !== 'ai' || !aiSpec) return
    if (lastGoodAi && lastGoodAi.spec === aiSpec) return
    set({ lastGoodAi: { spec: aiSpec, params: { ...params } } })
  },

  /**
   * 显式恢复上一可用 AI 版本；若从未有可用版本则回到默认实验。
   * 返回是否恢复了 AI 快照。
   */
  restoreLastGoodAi: () => {
    const { lastGoodAi } = get()
    if (!lastGoodAi) {
      get().resetToDefault()
      return false
    }
    get().applyGeneratedExperiment(lastGoodAi.spec, lastGoodAi.params)
    return true
  },

  setHealRequesting: (attempt) =>
    set((state) => ({
      heal: { ...state.heal, status: 'requesting', attempt, message: '', failed: null },
    })),

  setHealApplied: (attempt) =>
    set((state) => ({ heal: { ...state.heal, status: 'applied', attempt } })),

  setHealSucceeded: (attempt, message) =>
    set((state) => ({
      heal: {
        ...state.heal,
        status: 'succeeded',
        attempt,
        message: message ?? `第 ${attempt} 次自动修复成功`,
        failed: null,
      },
    })),

  setHealFailed: (attempt, message, failed) =>
    set((state) => ({
      heal: {
        ...state.heal,
        status: 'failed',
        attempt,
        message,
        failed: failed ?? state.heal.failed,
      },
    })),

  resetHeal: () => set({ heal: createInitialHeal() }),

  /** 重新应用最后失败的候选，触发新一轮自动修复。 */
  retryFailedHeal: () => {
    const { heal } = get()
    if (!heal.failed) return
    get().applyGeneratedExperiment(heal.failed.spec, heal.failed.params)
  },
}))
