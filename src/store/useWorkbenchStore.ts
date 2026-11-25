import { create } from 'zustand'
import type { GeneratedExperimentSpec } from '../ai/schema'
import { DEFAULT_EXPERIMENT, getExperimentById } from '../experiments'
import type { RuntimeErrorInfo, RuntimeStatus } from '../runtime/CanvasRuntime'
import { createDefaultParams, sanitizeParams } from '../runtime/params'
import type { ControlValue, ExperimentDefinition, ParamValues } from '../types/experiment'

export type ExperimentSource = 'preset' | 'ai'

interface WorkbenchState {
  experiment: ExperimentDefinition
  params: ParamValues
  speed: number
  /** 自增后触发运行时重建，用于「回到默认实验」、切换案例与应用生成结果。 */
  reloadKey: number
  status: RuntimeStatus
  error: RuntimeErrorInfo | null
  /** 当前实验来自内置预设还是 AI 生成。 */
  source: ExperimentSource
  /** AI 生成成功后的原始描述，供隔离沙盒初始化使用。 */
  aiSpec: GeneratedExperimentSpec | null
  setParam: (key: string, value: ControlValue) => void
  setSpeed: (speed: number) => void
  selectExperiment: (id: string) => void
  applyGeneratedExperiment: (spec: GeneratedExperimentSpec) => void
  syncStatus: (status: RuntimeStatus) => void
  syncError: (error: RuntimeErrorInfo | null) => void
  resetToDefault: () => void
}

/**
 * 工作台的全局状态：当前实验、参数、倍速与运行时状态。
 * 运行时实例本身有生命周期副作用，仍由 useExperimentRuntime 持有。
 */
export const useWorkbenchStore = create<WorkbenchState>()((set, get) => ({
  experiment: DEFAULT_EXPERIMENT,
  params: createDefaultParams(DEFAULT_EXPERIMENT),
  speed: 1,
  reloadKey: 0,
  status: 'running',
  error: null,
  source: 'preset',
  aiSpec: null,

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
        source: 'preset',
        aiSpec: null,
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
      source: 'preset',
      aiSpec: null,
      reloadKey: reloadKey + 1,
    })
  },

  /**
   * 应用已校验的生成结果。模型方法只是占位：AI 实验的实际推演
   * 由隔离 iframe 沙盒执行，主线程运行时不会调用这里。
   */
  applyGeneratedExperiment: (spec) => {
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
      params: createDefaultParams(experiment),
      speed: 1,
      status: 'running',
      error: null,
      reloadKey: reloadKey + 1,
    })
  },

  syncStatus: (status) => set({ status }),

  syncError: (error) => set({ error }),

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
      source: 'preset',
      aiSpec: null,
      reloadKey: reloadKey + 1,
    })
  },
}))
