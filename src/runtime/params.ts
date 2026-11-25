import type {
  ControlDefinition,
  ControlValue,
  ExperimentDefinition,
  ParamValues,
  SliderControl,
} from '../types/experiment'

function decimalPlaces(value: number): number {
  const text = String(value)
  const dot = text.indexOf('.')
  return dot === -1 ? 0 : text.length - dot - 1
}

/** 将数值对齐到控件步长，并修正浮点误差。 */
export function snapSliderValue(control: SliderControl, value: number): number {
  const clamped = Math.min(control.max, Math.max(control.min, value))
  const snapped = control.min + Math.round((clamped - control.min) / control.step) * control.step
  const bounded = Math.min(control.max, Math.max(control.min, snapped))
  return Number(bounded.toFixed(decimalPlaces(control.step)))
}

/** 把任意输入转换为该控件允许的合法值，非法时回落到默认值。 */
export function coerceControlValue(control: ControlDefinition, value: unknown): ControlValue {
  if (control.type === 'slider') {
    return typeof value === 'number' && Number.isFinite(value)
      ? snapSliderValue(control, value)
      : control.default
  }
  if (control.type === 'toggle') {
    return typeof value === 'boolean' ? value : control.default
  }
  return typeof value === 'string' && control.options.some((option) => option.value === value)
    ? value
    : control.default
}

export function createDefaultParams(experiment: ExperimentDefinition): ParamValues {
  const params: ParamValues = {}
  for (const control of experiment.controls) {
    params[control.key] = control.default
  }
  return params
}

/** 以控件声明为准清洗参数：裁剪越界值、补齐缺失项、丢弃未知键。 */
export function sanitizeParams(
  experiment: ExperimentDefinition,
  input: Record<string, unknown> | ParamValues,
): ParamValues {
  const params: ParamValues = {}
  for (const control of experiment.controls) {
    params[control.key] = Object.prototype.hasOwnProperty.call(input, control.key)
      ? coerceControlValue(control, input[control.key])
      : control.default
  }
  return params
}

/** 控件区展示用：数值固定小数位并使用等宽数字，避免拖动时宽度抖动。 */
export function describeControlValue(control: ControlDefinition, value: ControlValue): string {
  if (control.type === 'slider' && typeof value === 'number') {
    const text = value.toFixed(decimalPlaces(control.step))
    return control.unit ? `${text} ${control.unit}` : text
  }
  if (control.type === 'toggle') {
    return value ? '开启' : '关闭'
  }
  const option = control.type === 'select'
    ? control.options.find((item) => item.value === value)
    : undefined
  return option ? option.label : String(value)
}
