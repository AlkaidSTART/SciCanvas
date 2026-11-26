export type RenderType = 'canvas2d' | 'scene2d'

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

/**
 * 边界态快捷参数组合：点击后把声明的参数一次性写入所有相关控件，
 * 并按实验语义重新初始化仿真状态（由工作台统一重置）。
 * params 只包含需要覆盖的键，其余参数保持当前值。
 */
export interface CornerCase {
  id: string
  label: string
  description?: string
  params: ParamValues
}

/** 遥测指标的一次采样值，键与 TelemetryMetric.key 对应。 */
export interface TelemetrySample {
  t: number
  values: Record<string, number>
}

export interface TelemetryMetric {
  key: string
  label: string
  unit?: string
  color: string
  /** 浮层展示的小数位，默认 2。 */
  precision?: number
}

/** 实验声明的实时遥测：运行时按固定仿真时间间隔采样并维护有界缓存。 */
export interface TelemetryDefinition<S = unknown> {
  metrics: TelemetryMetric[]
  /** 缓存长度上限，运行时限制在 2–600，默认 180。 */
  capacity?: number
  /** 采样间隔（仿真秒），默认 0.1。 */
  interval?: number
  sample: (state: S, params: ParamValues, simTime: number) => Record<string, number>
}

export interface ProbePoint {
  x: number
  y: number
}

export interface ProbeReading {
  /** 指针位置的坐标描述，例如 "x = 0.42 m"。 */
  position: string
  /** 局部量名称，例如 "感染占比 I"。 */
  label: string
  /** 局部量数值（含单位），例如 "12.3%" */
  value: string
  detail?: string
}

/** 实验声明的悬停探针：point 与 viewport 都使用 CSS 像素坐标。 */
export interface ProbeDefinition<S = unknown> {
  hint?: string
  read: (
    state: S,
    params: ParamValues,
    point: ProbePoint,
    viewport: Viewport,
  ) => ProbeReading | null
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
  /** 可选能力：未声明时对应控件与浮层整体隐藏，不做空态占位。 */
  cornerCases?: CornerCase[]
  telemetry?: TelemetryDefinition<S>
  probe?: ProbeDefinition<S>
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

/** 解析并校验控件数组，供完整实验校验与 AI 结构化输出复用。 */
export function parseControls(raw: unknown): {
  controls: ControlDefinition[]
  issues: string[]
} {
  const issues: string[] = []
  const controls: ControlDefinition[] = []
  if (!Array.isArray(raw) || raw.length === 0) {
    return { controls, issues: ['controls 必须是非空数组'] }
  }
  const seenKeys = new Set<string>()
  raw.forEach((control, index) => {
    const validated = validateControl(control, index, seenKeys, issues)
    if (validated) controls.push(validated)
  })
  return { controls, issues }
}

/** 解析并校验图例数组；图例只影响画面说明，不参与仿真。 */
export function parseLegend(raw: unknown): {
  legend: LegendItem[]
  issues: string[]
} {
  const issues: string[] = []
  const legend: LegendItem[] = []
  if (!Array.isArray(raw) || raw.length === 0) {
    return { legend, issues: ['legend 必须是非空数组'] }
  }
  raw.forEach((item, index) => {
    if (!isRecord(item) || !isNonEmptyString(item.label) || !isNonEmptyString(item.color)) {
      issues.push(`legend[${index}] 必须包含非空的 label 与 color`)
      return
    }
    if (item.dashed !== undefined && typeof item.dashed !== 'boolean') {
      issues.push(`legend[${index}].dashed 必须是布尔值`)
      return
    }
    legend.push(item as unknown as LegendItem)
  })
  return { legend, issues }
}

/**
 * 解析并校验边界态：参数键必须对应已声明控件，且取值落在控件允许范围内。
 * 校验通过后由工作台清洗并应用，避免写入不可控的参数。
 */
export function parseCornerCases(
  raw: unknown,
  controls: ControlDefinition[],
): { cornerCases: CornerCase[]; issues: string[] } {
  const issues: string[] = []
  const cornerCases: CornerCase[] = []
  if (!Array.isArray(raw) || raw.length === 0) {
    return { cornerCases, issues: ['cornerCases 必须是非空数组'] }
  }

  const controlsByKey = new Map(controls.map((control) => [control.key, control]))
  const seenIds = new Set<string>()

  raw.forEach((item, index) => {
    const path = `cornerCases[${index}]`
    if (!isRecord(item)) {
      issues.push(`${path} 必须是对象`)
      return
    }
    if (!isNonEmptyString(item.id)) {
      issues.push(`${path}.id 必须是非空字符串`)
      return
    }
    if (seenIds.has(item.id)) {
      issues.push(`${path}.id "${item.id}" 与前面的边界态重复`)
      return
    }
    if (!isNonEmptyString(item.label)) {
      issues.push(`${path}.label 必须是非空字符串`)
      return
    }
    if (item.description !== undefined && typeof item.description !== 'string') {
      issues.push(`${path}.description 必须是字符串`)
      return
    }
    if (!isRecord(item.params) || Object.keys(item.params).length === 0) {
      issues.push(`${path}.params 必须是非空对象`)
      return
    }

    const params: ParamValues = {}
    let valid = true
    for (const [key, value] of Object.entries(item.params)) {
      const control = controlsByKey.get(key)
      if (!control) {
        issues.push(`${path}.params.${key} 未在 controls 中声明`)
        valid = false
        continue
      }
      if (control.type === 'slider') {
        if (!isFiniteNumber(value) || value < control.min || value > control.max) {
          issues.push(
            `${path}.params.${key} 必须是 ${control.min}–${control.max} 之间的有限数字`,
          )
          valid = false
          continue
        }
      } else if (control.type === 'toggle') {
        if (typeof value !== 'boolean') {
          issues.push(`${path}.params.${key} 必须是布尔值`)
          valid = false
          continue
        }
      } else if (typeof value !== 'string' || !control.options.some((option) => option.value === value)) {
        issues.push(`${path}.params.${key} 必须是 options 中的某个 value`)
        valid = false
        continue
      }
      params[key] = value as ControlValue
    }

    if (!valid) return
    seenIds.add(item.id)
    cornerCases.push({
      id: item.id,
      label: item.label,
      ...(item.description !== undefined ? { description: item.description as string } : {}),
      params,
    })
  })

  return { cornerCases, issues }
}

/** 遥测声明：指标键唯一，缓存与采样间隔必须落在运行时支持的安全范围内。 */
export function parseTelemetry(raw: unknown): {
  telemetry?: TelemetryDefinition
  issues: string[]
} {
  const issues: string[] = []
  if (!isRecord(raw)) {
    return { issues: ['telemetry 必须是对象'] }
  }
  if (typeof raw.sample !== 'function') {
    issues.push('telemetry.sample 必须是函数')
  }

  const metrics: TelemetryMetric[] = []
  if (!Array.isArray(raw.metrics) || raw.metrics.length === 0) {
    issues.push('telemetry.metrics 必须是非空数组')
  } else {
    const seenKeys = new Set<string>()
    raw.metrics.forEach((metric, index) => {
      const path = `telemetry.metrics[${index}]`
      if (!isRecord(metric)) {
        issues.push(`${path} 必须是对象`)
        return
      }
      if (!isNonEmptyString(metric.key)) {
        issues.push(`${path}.key 必须是非空字符串`)
        return
      }
      if (seenKeys.has(metric.key)) {
        issues.push(`${path}.key "${metric.key}" 与前面的指标重复`)
        return
      }
      if (!isNonEmptyString(metric.label) || !isNonEmptyString(metric.color)) {
        issues.push(`${path} 必须包含非空的 label 与 color`)
        return
      }
      if (metric.unit !== undefined && typeof metric.unit !== 'string') {
        issues.push(`${path}.unit 必须是字符串`)
        return
      }
      if (
        metric.precision !== undefined &&
        (!Number.isInteger(metric.precision) || (metric.precision as number) < 0 || (metric.precision as number) > 6)
      ) {
        issues.push(`${path}.precision 必须是 0–6 的整数`)
        return
      }
      seenKeys.add(metric.key)
      metrics.push(metric as unknown as TelemetryMetric)
    })
  }

  const capacity = raw.capacity
  if (capacity !== undefined) {
    if (!Number.isInteger(capacity) || (capacity as number) < 2 || (capacity as number) > 600) {
      issues.push('telemetry.capacity 必须是 2–600 的整数')
    }
  }
  const interval = raw.interval
  if (interval !== undefined && (!isFiniteNumber(interval) || interval <= 0)) {
    issues.push('telemetry.interval 必须是大于 0 的有限数字')
  }

  if (issues.length > 0) return { issues }
  return {
    telemetry: {
      metrics,
      ...(capacity !== undefined ? { capacity: capacity as number } : {}),
      ...(interval !== undefined ? { interval: interval as number } : {}),
      sample: raw.sample as TelemetryDefinition['sample'],
    },
    issues,
  }
}

/** 悬停探针声明：只要求一个返回局部读数的回调，坐标由运行时统一换算。 */
export function parseProbe(raw: unknown): { probe?: ProbeDefinition; issues: string[] } {
  const issues: string[] = []
  if (!isRecord(raw)) {
    return { issues: ['probe 必须是对象'] }
  }
  if (raw.hint !== undefined && typeof raw.hint !== 'string') {
    issues.push('probe.hint 必须是字符串')
  }
  if (typeof raw.read !== 'function') {
    issues.push('probe.read 必须是函数')
  }
  if (issues.length > 0) return { issues }
  return {
    probe: {
      ...(raw.hint !== undefined ? { hint: raw.hint as string } : {}),
      read: raw.read as ProbeDefinition['read'],
    },
    issues,
  }
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

  if (input.renderType !== 'canvas2d' && input.renderType !== 'scene2d') {
    issues.push('renderType 目前仅支持 "canvas2d" 或 "scene2d"')
  }

  if (input.legend !== undefined) {
    issues.push(...parseLegend(input.legend).issues)
  }

  const parsedControls = parseControls(input.controls)
  issues.push(...parsedControls.issues)

  // 可选探索能力：未声明即不启用，声明了就必须自洽。
  if (input.cornerCases !== undefined) {
    issues.push(...parseCornerCases(input.cornerCases, parsedControls.controls).issues)
  }
  if (input.telemetry !== undefined) {
    issues.push(...parseTelemetry(input.telemetry).issues)
  }
  if (input.probe !== undefined) {
    issues.push(...parseProbe(input.probe).issues)
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
