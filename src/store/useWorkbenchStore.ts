import { create } from 'zustand'
import { DEFAULT_EXPERIMENT, getExperimentById } from '../experiments'
import type { RuntimeErrorInfo, RuntimeStatus } from '../runtime/CanvasRuntime'
import { createDefaultParams, sanitizeParams } from '../runtime/params'
import type { ControlValue, ExperimentDefinition, ParamValues } from '../types/experiment'

interface WorkbenchState {
  experiment: ExperimentDefinition
  params: ParamValues
  speed: number
  /** 自增后触发运行时重建，用于「回到默认实验」和切换案例。 */
  reloadKey: number
  status: RuntimeStatus
  error: RuntimeErrorInfo | null
  setParam: (key: string, value: ControlValue) => void
  setSpeed: (speed: number) => void
  selectExperiment: (id: string) => void
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
      reloadKey: reloadKey + 1,
    })
  },

  syncStatus: (status) => set({ status }),

  syncError: (error) => set({ error }),

  resetToDefault: () => {
    const { experiment, reloadKey } = get()
    set({
      params: createDefaultParams(experiment),
      speed: 1,
      error: null,
      reloadKey: reloadKey + 1,
    })
  },
}))
