import { parseControls, parseLegend } from '../types/experiment.ts'
import type {
  ControlDefinition,
  LegendItem,
  SimulationModel,
} from '../types/experiment.ts'
import { validateScene2D } from '../types/scene2d.ts'
import type { Scene2DSpec } from '../types/scene2d.ts'

export const MAX_SIMULATION_CODE_LENGTH = 20000
export const MAX_GENERATED_CONTROLS = 6

const MAX_TITLE_LENGTH = 80
const MAX_DOMAIN_LENGTH = 80
const MAX_FORMULA_LENGTH = 600
const MAX_INSIGHT_LENGTH = 800
const CONTROL_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

interface BaseGeneratedExperimentSpec {
  title: string
  domain: string
  formulaLatex: string
  insight: string
  controls: ControlDefinition[]
  legend?: LegendItem[]
}

/** 传统代码沙盒模式：模型返回仿真代码，运行前只编译不执行。 */
export interface Canvas2DExperimentSpec extends BaseGeneratedExperimentSpec {
  renderType: 'canvas2d'
  simulationCode: string
}

/** 声明式点线渲染模式：模型先计算坐标系、线条、曲线与关键标点，由内置渲染器绘制。 */
export interface Scene2DExperimentSpec extends BaseGeneratedExperimentSpec {
  renderType: 'scene2d'
  scene: Scene2DSpec
}

export type GeneratedExperimentSpec = Canvas2DExperimentSpec | Scene2DExperimentSpec

export type GeneratedSpecValidation =
  | { ok: true; spec: GeneratedExperimentSpec }
  | { ok: false; issues: string[] }

export type SimulationCompileResult =
  | { ok: true; factory: () => SimulationModel }
  | { ok: false; message: string }

/**
 * 只做语法编译，不执行生成代码。
 * 真正的实例化发生在 iframe 沙盒内，避免校验阶段就触碰主应用上下文。
 */
export function compileSimulationCode(code: string): SimulationCompileResult {
  try {
    const factory = new Function('"use strict";\n' + code) as () => SimulationModel
    return { ok: true, factory }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

function readText(
  value: unknown,
  field: string,
  maxLength: number,
  issues: string[],
): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    issues.push(`${field} 必须是非空字符串`)
    return ''
  }
  const text = value.trim()
  if (text.length > maxLength) {
    issues.push(`${field} 不能超过 ${maxLength} 个字符`)
    return ''
  }
  return text
}

/**
 * 服务端与客户端共用的生成结果校验：字段、长度、控件范围，
 * 以及按 renderType 分别校验 simulationCode（canvas2d）或 scene（scene2d）。
 */
export function validateGeneratedSpec(input: unknown): GeneratedSpecValidation {
  const issues: string[] = []
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, issues: ['生成结果必须是 JSON 对象'] }
  }
  const raw = input as Record<string, unknown>

  const title = readText(raw.title, 'title', MAX_TITLE_LENGTH, issues)
  const domain = readText(raw.domain, 'domain', MAX_DOMAIN_LENGTH, issues)
  const formulaLatex = readText(raw.formulaLatex, 'formulaLatex', MAX_FORMULA_LENGTH, issues)
  const insight = readText(raw.insight, 'insight', MAX_INSIGHT_LENGTH, issues)

  const renderType = raw.renderType ?? 'canvas2d'
  if (renderType !== 'canvas2d' && renderType !== 'scene2d') {
    issues.push('renderType 目前仅支持 "canvas2d" 或 "scene2d"')
  }

  if (Array.isArray(raw.controls) && raw.controls.length > MAX_GENERATED_CONTROLS) {
    issues.push(`controls 最多支持 ${MAX_GENERATED_CONTROLS} 个控件`)
  }
  const { controls, issues: controlIssues } = parseControls(raw.controls)
  issues.push(...controlIssues)
  for (const control of controls) {
    if (!CONTROL_KEY_PATTERN.test(control.key)) {
      issues.push(`控件 key "${control.key}" 只能包含字母、数字与下划线，且不能以数字开头`)
    }
  }

  let legend: LegendItem[] | undefined
  if (raw.legend !== undefined) {
    const parsed = parseLegend(raw.legend)
    issues.push(...parsed.issues)
    if (parsed.issues.length === 0) legend = parsed.legend
  }

  if (renderType === 'scene2d') {
    const sceneResult = validateScene2D(
      raw.scene,
      controls.map((control) => control.key),
    )
    if (!sceneResult.ok) {
      issues.push(...sceneResult.issues)
    }
    if (issues.length > 0 || !sceneResult.ok) {
      return { ok: false, issues }
    }
    return {
      ok: true,
      spec: {
        title,
        domain,
        formulaLatex,
        insight,
        renderType: 'scene2d',
        controls,
        ...(legend ? { legend } : {}),
        scene: sceneResult.scene,
      },
    }
  }

  let simulationCode = ''
  if (typeof raw.simulationCode !== 'string' || raw.simulationCode.trim().length === 0) {
    issues.push('simulationCode 必须是非空字符串')
  } else if (raw.simulationCode.length > MAX_SIMULATION_CODE_LENGTH) {
    issues.push(`simulationCode 不能超过 ${MAX_SIMULATION_CODE_LENGTH} 个字符`)
  } else {
    simulationCode = raw.simulationCode
    const compiled = compileSimulationCode(simulationCode)
    if (!compiled.ok) {
      issues.push(`simulationCode 存在语法错误：${compiled.message}`)
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues }
  }
  return {
    ok: true,
    spec: {
      title,
      domain,
      formulaLatex,
      insight,
      renderType: 'canvas2d',
      controls,
      ...(legend ? { legend } : {}),
      simulationCode,
    },
  }
}
