export type RenderType = 'canvas2d'

export interface SliderControl {
  type: 'slider'
  key: string
  label: string
  min: number
  max: number
  step: number
  default: number
  unit?: string
}

export interface ToggleControl {
  type: 'toggle'
  key: string
  label: string
  default: boolean
}

export interface SelectOption {
  value: string
  label: string
}

export interface SelectControl {
  type: 'select'
  key: string
  label: string
  options: SelectOption[]
  default: string
}

export type ControlDefinition = SliderControl | ToggleControl | SelectControl
export type ControlValue = number | boolean | string
export type ParamValues = Record<string, ControlValue>

export interface Viewport {
  width: number
  height: number
}

/** 画布内的视觉图例，和模型绘制使用同一份颜色定义，避免说明与画面不一致。 */
export interface LegendItem {
  label: string
  color: string
  dashed?: boolean
}

/**
 * 仿真模型的统一生命周期契约。M3 生成的外部代码需要实现同一组接口，
 * 运行时只依赖这四个方法，不关心模型内部如何组织状态。
 */
export interface SimulationModel<S = unknown> {
  createState(params: ParamValues): S
  step(state: S, params: ParamValues, dt: number): S
  draw(
    ctx: CanvasRenderingContext2D,
    state: S,
    params: ParamValues,
    viewport: Viewport,
  ): void
}

export interface ExperimentDefinition<S = unknown> {
  id: string
  title: string
  domain: string
  formulaLatex: string
  insight: string
  renderType: RenderType
  controls: ControlDefinition[]
  legend?: LegendItem[]
  model: SimulationModel<S>
}

export type ValidationResult =
  | { ok: true; experiment: ExperimentDefinition }
  | { ok: false; issues: string[] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function validateControl(
  raw: unknown,
  index: number,
  seenKeys: Set<string>,
  issues: string[],
): ControlDefinition | null {
  const path = `controls[${index}]`
  if (!isRecord(raw)) {
    issues.push(`${path} 必须是对象`)
    return null
  }
  if (!isNonEmptyString(raw.key)) {
    issues.push(`${path}.key 必须是非空字符串`)
    return null
  }
  if (seenKeys.has(raw.key)) {
    issues.push(`${path}.key "${raw.key}" 与前面的控件重复`)
    return null
  }
  seenKeys.add(raw.key)
  if (!isNonEmptyString(raw.label)) {
    issues.push(`${path}.label 必须是非空字符串`)
    return null
  }

  if (raw.type === 'slider') {
    const { min, max, step, default: defaultValue } = raw
    if (!isFiniteNumber(min) || !isFiniteNumber(max) || !isFiniteNumber(step) || !isFiniteNumber(defaultValue)) {
      issues.push(`${path} 的 min/max/step/default 必须都是有限数字`)
      return null
    }
    if (min >= max) {
      issues.push(`${path}.min 必须小于 max`)
      return null
    }
    if (step <= 0) {
      issues.push(`${path}.step 必须大于 0`)
      return null
    }
    if (defaultValue < min || defaultValue > max) {
      issues.push(`${path}.default 必须位于 min 与 max 之间`)
      return null
    }
    if (raw.unit !== undefined && typeof raw.unit !== 'string') {
      issues.push(`${path}.unit 必须是字符串`)
      return null
    }
    return raw as unknown as SliderControl
  }

  if (raw.type === 'toggle') {
    if (typeof raw.default !== 'boolean') {
      issues.push(`${path}.default 必须是布尔值`)
      return null
    }
    return raw as unknown as ToggleControl
  }

  if (raw.type === 'select') {
    if (!Array.isArray(raw.options) || raw.options.length === 0) {
      issues.push(`${path}.options 必须是非空数组`)
      return null
    }
    const optionsValid = raw.options.every(
      (option) => isRecord(option) && isNonEmptyString(option.value) && isNonEmptyString(option.label),
    )
    if (!optionsValid) {
      issues.push(`${path}.options 每项都必须包含非空的 value 与 label`)
      return null
    }
    if (!isNonEmptyString(raw.default)) {
      issues.push(`${path}.default 必须是非空字符串`)
      return null
    }
    const values = raw.options.map((option) => (option as Record<string, unknown>).value)
    if (!values.includes(raw.default)) {
      issues.push(`${path}.default 必须是 options 中的某个 value`)
      return null
    }
    return raw as unknown as SelectControl
  }

  issues.push(`${path}.type 必须是 slider / toggle / select 之一`)
  return null
}

/**
 * 对来源不可信（预设、AI 生成、导入）的实验定义做运行时校验。
 * 校验通过时返回带类型的副本，失败时返回全部问题，便于工作台局部展示。
 */
export function validateExperiment(input: unknown): ValidationResult {
  const issues: string[] = []
  if (!isRecord(input)) {
    return { ok: false, issues: ['实验定义必须是对象'] }
  }

  const stringFields = ['id', 'title', 'domain', 'formulaLatex', 'insight'] as const
  for (const field of stringFields) {
    if (!isNonEmptyString(input[field])) {
      issues.push(`${field} 必须是非空字符串`)
    }
  }

  if (input.renderType !== 'canvas2d') {
    issues.push('renderType 目前仅支持 "canvas2d"')
  }

  if (input.legend !== undefined) {
    if (!Array.isArray(input.legend) || input.legend.length === 0) {
      issues.push('legend 必须是非空数组')
    } else {
      input.legend.forEach((item, index) => {
        if (!isRecord(item) || !isNonEmptyString(item.label) || !isNonEmptyString(item.color)) {
          issues.push(`legend[${index}] 必须包含非空的 label 与 color`)
        } else if (item.dashed !== undefined && typeof item.dashed !== 'boolean') {
          issues.push(`legend[${index}].dashed 必须是布尔值`)
        }
      })
    }
  }

  const controls: ControlDefinition[] = []
  if (!Array.isArray(input.controls) || input.controls.length === 0) {
    issues.push('controls 必须是非空数组')
  } else {
    const seenKeys = new Set<string>()
    input.controls.forEach((control, index) => {
      const validated = validateControl(control, index, seenKeys, issues)
      if (validated) controls.push(validated)
    })
  }

  const model = input.model
  if (!isRecord(model)) {
    issues.push('model 必须是对象')
  } else {
    for (const method of ['createState', 'step', 'draw'] as const) {
      if (typeof model[method] !== 'function') {
        issues.push(`model.${method} 必须是函数`)
      }
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues }
  }
  return { ok: true, experiment: input as unknown as ExperimentDefinition }
}

/** 加载内置实验时使用：Schema 不合法属于开发期错误，直接抛出详细信息。 */
export function assertValidExperiment(input: unknown): ExperimentDefinition {
  const result = validateExperiment(input)
  if (!result.ok) {
    throw new Error(`实验定义校验失败：\n${result.issues.join('\n')}`)
  }
  return result.experiment
}
