import { assertValidExperiment } from '../types/experiment'
import type { ExperimentDefinition } from '../types/experiment'
import { dampedOscillator } from './dampedOscillator'
import { fourierSquareWave } from './fourier'
import { optimizerLandscape } from './optimizers'
import { sirEpidemic } from './sir'

/**
 * M2 预设案例库：四个跨学科实验全部本地运行，不依赖 AI 或外部服务。
 * 每次加载都走一遍 Schema 校验，避免预设代码演进时漏掉必填元数据。
 */
export const EXPERIMENTS: ExperimentDefinition[] = [
  assertValidExperiment(optimizerLandscape),
  assertValidExperiment(dampedOscillator),
  assertValidExperiment(sirEpidemic),
  assertValidExperiment(fourierSquareWave),
]

export const DEFAULT_EXPERIMENT_ID = dampedOscillator.id

export const DEFAULT_EXPERIMENT =
  EXPERIMENTS.find((experiment) => experiment.id === DEFAULT_EXPERIMENT_ID) ?? EXPERIMENTS[0]

export function getExperimentById(id: string): ExperimentDefinition | undefined {
  return EXPERIMENTS.find((experiment) => experiment.id === id)
}
