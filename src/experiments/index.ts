import { assertValidExperiment } from '../types/experiment'
import { dampedOscillator } from './dampedOscillator'

/**
 * M1 只有一个可直接体验的内置基准实验。
 * 后续阶段的案例库会在这里注册更多实验。
 */
export const DEFAULT_EXPERIMENT = assertValidExperiment(dampedOscillator)
