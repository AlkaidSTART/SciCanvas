import { compileExpression, compileTemplateText } from '../runtime/expr.ts'

export type ExprNum = number | string
export type Point2D = [ExprNum, ExprNum]

export const SCENE_PALETTE = {
  blue: '#4F7292',
  peach: '#C97A45',
  mint: '#5F9377',
  rose: '#C06F6F',
  lilac: '#8A76A8',
  amber: '#C08A3A',
  ink: '#3A332B',
  muted: '#7D7062',
} as const

export type ScenePaletteToken = keyof typeof SCENE_PALETTE
export type SceneColor = ScenePaletteToken | (string & {})

export interface SceneCoordinate {
  xDomain: [number, number]
  yDomain: [number, number]
  aspectMode?: 'stretch' | 'fit'
  showGrid?: boolean
  showAxes?: boolean
  xLabel?: string
  yLabel?: string
}

export interface SceneTelemetryMetric {
  key: string
  label: string
  unit?: string
  color: SceneColor
  expr: ExprNum
  precision?: number
}

export interface SceneTelemetrySpec {
  metrics: SceneTelemetryMetric[]
}

interface BaseSceneElement {
  id: string
  visible?: boolean | string
  opacity?: ExprNum
  zIndex?: number
}

export interface PolylineElement extends BaseSceneElement {
  type: 'polyline'
  points: Point2D[]
  closed?: boolean
  smooth?: boolean
  stroke?: SceneColor
  fill?: SceneColor
  lineWidth?: number
  dashed?: boolean
}

export interface ExplicitCurveElement extends BaseSceneElement {
  type: 'curve'
  mode: 'explicit'
  y: string
  xRange?: [ExprNum, ExprNum]
  samples?: number
  fillToY?: ExprNum
  fillColor?: SceneColor
  stroke: SceneColor
  lineWidth?: number
  dashed?: boolean
}

export interface ParametricCurveElement extends BaseSceneElement {
  type: 'curve'
  mode: 'parametric'
  x: string
  y: string
  uRange: [ExprNum, ExprNum]
  samples?: number
  fillToY?: ExprNum
  fillColor?: SceneColor
  stroke: SceneColor
  lineWidth?: number
  dashed?: boolean
}

export type CurveElement = ExplicitCurveElement | ParametricCurveElement

export interface SegmentElement extends BaseSceneElement {
  type: 'segment'
  from: Point2D
  to: Point2D
  arrow?: 'none' | 'end' | 'both'
  stroke: SceneColor
  lineWidth?: number
  dashed?: boolean
  label?: string
}

export type PointShape = 'circle' | 'ring' | 'diamond' | 'cross' | 'square'

export interface PointElement extends BaseSceneElement {
  type: 'point'
  at: Point2D
  shape?: PointShape
  radius?: number
  color: SceneColor
  halo?: boolean
  label?: string
  labelOffset?: [number, number]
  showCoords?: boolean
}

export interface CircleElement extends BaseSceneElement {
  type: 'circle'
  center: Point2D
  radius: ExprNum
  startAngle?: ExprNum
  endAngle?: ExprNum
  stroke?: SceneColor
  fill?: SceneColor
  lineWidth?: number
  dashed?: boolean
}

export interface PolygonElement extends BaseSceneElement {
  type: 'polygon'
  points: Point2D[]
  fill?: SceneColor
  stroke?: SceneColor
  lineWidth?: number
  dashed?: boolean
}

export interface AnnotationElement extends BaseSceneElement {
  type: 'annotation'
  at: Point2D
  text: string
  align?: 'left' | 'center' | 'right'
  color?: SceneColor
  badge?: boolean
}

export type SceneElement =
  | PolylineElement
  | CurveElement
  | SegmentElement
  | PointElement
  | CircleElement
  | PolygonElement
  | AnnotationElement

export interface Scene2DSpec {
  coordinate: SceneCoordinate
  variables?: Record<string, ExprNum>
  elements: SceneElement[]
  telemetry?: SceneTelemetrySpec
}

export const MAX_SCENE_VARIABLES = 24
export const MAX_SCENE_ELEMENTS = 80
export const MAX_POLYLINE_POINTS = 500
export const MAX_POLYGON_POINTS = 200
export const MIN_CURVE_SAMPLES = 16
export const MAX_CURVE_SAMPLES = 600
export const MAX_TELEMETRY_METRICS = 4

const IDENT_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const RESERVED_VAR_NAMES = new Set(['t', 'x', 'u', 'pi', 'PI', 'e', 'E'])
const COLOR_HEX_OR_FUNC = /^(#[0-9a-fA-F]{3,8}|rgba?\([^)]{3,40}\))$/
const POINT_SHAPES = new Set<PointShape>(['circle', 'ring', 'diamond', 'cross', 'square'])

export function resolveSceneColor(color?: string, fallback: string = SCENE_PALETTE.blue): string {
  if (!color) return fallback
  const trimmed = color.trim()
  if (trimmed in SCENE_PALETTE) {
    return SCENE_PALETTE[trimmed as ScenePaletteToken]
  }
  if (COLOR_HEX_OR_FUNC.test(trimmed)) {
    return trimmed
  }
  return fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isValidColor(value: unknown): value is SceneColor {
  if (!isNonEmptyString(value)) return false
  const trimmed = value.trim()
  return trimmed in SCENE_PALETTE || COLOR_HEX_OR_FUNC.test(trimmed)
}

function validateExprNum(
  raw: unknown,
  path: string,
  allowed: ReadonlySet<string>,
  issues: string[],
): ExprNum | null {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) {
      issues.push(`${path} 必须是有限数字`)
      return null
    }
    return raw
  }
  if (typeof raw === 'string') {
    const compiled = compileExpression(raw, allowed)
    if (!compiled.ok) {
      issues.push(`${path} 表达式不合法：${compiled.message}`)
      return null
    }
    return raw.trim()
  }
  issues.push(`${path} 必须是数字或数学表达式字符串`)
  return null
}

function validatePoint2D(
  raw: unknown,
  path: string,
  allowed: ReadonlySet<string>,
  issues: string[],
): Point2D | null {
  if (!Array.isArray(raw) || raw.length !== 2) {
    issues.push(`${path} 必须是二元坐标数组 [x, y]`)
    return null
  }
  const x = validateExprNum(raw[0], `${path}[0]`, allowed, issues)
  const y = validateExprNum(raw[1], `${path}[1]`, allowed, issues)
  if (x === null || y === null) return null
  return [x, y]
}

function validateDomain(raw: unknown, path: string, issues: string[]): [number, number] | null {
  if (!Array.isArray(raw) || raw.length !== 2) {
    issues.push(`${path} 必须是 [min, max] 数组`)
    return null
  }
  const [min, max] = raw
  if (!isFiniteNumber(min) || !isFiniteNumber(max)) {
    issues.push(`${path} 的起止值必须都是有限数字`)
    return null
  }
  if (max - min <= 1e-9) {
    issues.push(`${path} 必须满足 min < max`)
    return null
  }
  return [min, max]
}

function validateLineWidth(raw: unknown, path: string, issues: string[]): number | undefined {
  if (raw === undefined) return undefined
  if (!isFiniteNumber(raw) || raw < 0.5 || raw > 6) {
    issues.push(`${path} 必须是 0.5–6 之间的数字`)
    return undefined
  }
  return raw
}

export type Scene2DValidationResult =
  | { ok: true; scene: Scene2DSpec }
  | { ok: false; issues: string[] }

/**
 * 服务端与客户端共用的 Scene2D 结构与表达式静态校验。
 */
export function validateScene2D(
  raw: unknown,
  controlKeys: readonly string[],
): Scene2DValidationResult {
  const issues: string[] = []
  if (!isRecord(raw)) {
    return { ok: false, issues: ['scene 必须是对象'] }
  }

  // 1. 坐标系校验
  let coordinate: SceneCoordinate | null = null
  if (!isRecord(raw.coordinate)) {
    issues.push('scene.coordinate 必须是对象')
  } else {
    const xDomain = validateDomain(raw.coordinate.xDomain, 'scene.coordinate.xDomain', issues)
    const yDomain = validateDomain(raw.coordinate.yDomain, 'scene.coordinate.yDomain', issues)
    const aspectMode = raw.coordinate.aspectMode
    if (aspectMode !== undefined && aspectMode !== 'stretch' && aspectMode !== 'fit') {
      issues.push('scene.coordinate.aspectMode 只能是 "stretch" 或 "fit"')
    }
    if (raw.coordinate.showGrid !== undefined && typeof raw.coordinate.showGrid !== 'boolean') {
      issues.push('scene.coordinate.showGrid 必须是布尔值')
    }
    if (raw.coordinate.showAxes !== undefined && typeof raw.coordinate.showAxes !== 'boolean') {
      issues.push('scene.coordinate.showAxes 必须是布尔值')
    }
    if (raw.coordinate.xLabel !== undefined && typeof raw.coordinate.xLabel !== 'string') {
      issues.push('scene.coordinate.xLabel 必须是字符串')
    }
    if (raw.coordinate.yLabel !== undefined && typeof raw.coordinate.yLabel !== 'string') {
      issues.push('scene.coordinate.yLabel 必须是字符串')
    }
    if (xDomain && yDomain) {
      coordinate = {
        xDomain,
        yDomain,
        ...(aspectMode === 'stretch' || aspectMode === 'fit' ? { aspectMode } : {}),
        ...(typeof raw.coordinate.showGrid === 'boolean'
          ? { showGrid: raw.coordinate.showGrid }
          : {}),
        ...(typeof raw.coordinate.showAxes === 'boolean'
          ? { showAxes: raw.coordinate.showAxes }
          : {}),
        ...(typeof raw.coordinate.xLabel === 'string' && raw.coordinate.xLabel.trim()
          ? { xLabel: raw.coordinate.xLabel.trim().slice(0, 40) }
          : {}),
        ...(typeof raw.coordinate.yLabel === 'string' && raw.coordinate.yLabel.trim()
          ? { yLabel: raw.coordinate.yLabel.trim().slice(0, 40) }
          : {}),
      }
    }
  }

  // 2. 变量作用域：controls + t + 顺序声明的 variables（禁止循环引用）
  const allowedBase = new Set<string>(['t', ...controlKeys])
  const controlKeySet = new Set(controlKeys)
  let variables: Record<string, ExprNum> | undefined

  if (raw.variables !== undefined) {
    if (!isRecord(raw.variables)) {
      issues.push('scene.variables 必须是对象')
    } else {
      const entries = Object.entries(raw.variables)
      if (entries.length > MAX_SCENE_VARIABLES) {
        issues.push(`scene.variables 最多声明 ${MAX_SCENE_VARIABLES} 个变量`)
      } else {
        const nextVars: Record<string, ExprNum> = {}
        for (const [key, value] of entries) {
          if (!IDENT_PATTERN.test(key)) {
            issues.push(`scene.variables.${key} 变量名不合法`)
            continue
          }
          if (RESERVED_VAR_NAMES.has(key) || controlKeySet.has(key)) {
            issues.push(`scene.variables.${key} 与内置变量或控件 key 冲突`)
            continue
          }
          const validated = validateExprNum(value, `scene.variables.${key}`, allowedBase, issues)
          if (validated !== null) {
            nextVars[key] = validated
            allowedBase.add(key)
          }
        }
        if (Object.keys(nextVars).length > 0) variables = nextVars
      }
    }
  }

  // 3. 图元校验
  const elements: SceneElement[] = []
  if (!Array.isArray(raw.elements) || raw.elements.length === 0) {
    issues.push('scene.elements 必须是非空数组')
  } else if (raw.elements.length > MAX_SCENE_ELEMENTS) {
    issues.push(`scene.elements 最多支持 ${MAX_SCENE_ELEMENTS} 个图元`)
  } else {
    const seenIds = new Set<string>()
    raw.elements.forEach((item, index) => {
      const path = `scene.elements[${index}]`
      if (!isRecord(item)) {
        issues.push(`${path} 必须是对象`)
        return
      }
      if (!isNonEmptyString(item.id)) {
        issues.push(`${path}.id 必须是非空字符串`)
        return
      }
      const id = item.id.trim()
      if (seenIds.has(id)) {
        issues.push(`${path}.id "${id}" 与前面的图元重复`)
        return
      }
      seenIds.add(id)

      const base: BaseSceneElement = { id }
      if (item.visible !== undefined) {
        if (typeof item.visible === 'boolean') {
          base.visible = item.visible
        } else if (typeof item.visible === 'string') {
          const compiled = compileExpression(item.visible, allowedBase)
          if (!compiled.ok) {
            issues.push(`${path}.visible 表达式不合法：${compiled.message}`)
          } else {
            base.visible = item.visible.trim()
          }
        } else {
          issues.push(`${path}.visible 必须是布尔值或表达式字符串`)
        }
      }
      if (item.opacity !== undefined) {
        const op = validateExprNum(item.opacity, `${path}.opacity`, allowedBase, issues)
        if (op !== null) base.opacity = op
      }
      if (item.zIndex !== undefined) {
        if (!isFiniteNumber(item.zIndex)) {
          issues.push(`${path}.zIndex 必须是有限数字`)
        } else {
          base.zIndex = item.zIndex
        }
      }

      switch (item.type) {
        case 'polyline': {
          if (!Array.isArray(item.points) || item.points.length < 2) {
            issues.push(`${path}.points 至少需要 2 个坐标点`)
            return
          }
          if (item.points.length > MAX_POLYLINE_POINTS) {
            issues.push(`${path}.points 最多支持 ${MAX_POLYLINE_POINTS} 个点`)
            return
          }
          const points: Point2D[] = []
          item.points.forEach((pt, pIdx) => {
            const parsed = validatePoint2D(pt, `${path}.points[${pIdx}]`, allowedBase, issues)
            if (parsed) points.push(parsed)
          })
          if (item.stroke !== undefined && !isValidColor(item.stroke)) {
            issues.push(`${path}.stroke 颜色不合法`)
          }
          if (item.fill !== undefined && !isValidColor(item.fill)) {
            issues.push(`${path}.fill 颜色不合法`)
          }
          const lineWidth = validateLineWidth(item.lineWidth, `${path}.lineWidth`, issues)
          elements.push({
            ...base,
            type: 'polyline',
            points,
            ...(typeof item.closed === 'boolean' ? { closed: item.closed } : {}),
            ...(typeof item.smooth === 'boolean' ? { smooth: item.smooth } : {}),
            ...(isValidColor(item.stroke) ? { stroke: item.stroke.trim() } : {}),
            ...(isValidColor(item.fill) ? { fill: item.fill.trim() } : {}),
            ...(lineWidth !== undefined ? { lineWidth } : {}),
            ...(typeof item.dashed === 'boolean' ? { dashed: item.dashed } : {}),
          })
          return
        }

        case 'curve': {
          const mode = item.mode
          if (mode !== 'explicit' && mode !== 'parametric') {
            issues.push(`${path}.mode 必须是 "explicit" 或 "parametric"`)
            return
          }
          if (!isValidColor(item.stroke)) {
            issues.push(`${path}.stroke 必须是合法颜色`)
          }
          if (item.fillColor !== undefined && !isValidColor(item.fillColor)) {
            issues.push(`${path}.fillColor 颜色不合法`)
          }
          let samples: number | undefined
          if (item.samples !== undefined) {
            if (
              !Number.isInteger(item.samples) ||
              (item.samples as number) < MIN_CURVE_SAMPLES ||
              (item.samples as number) > MAX_CURVE_SAMPLES
            ) {
              issues.push(`${path}.samples 必须是 ${MIN_CURVE_SAMPLES}–${MAX_CURVE_SAMPLES} 的整数`)
            } else {
              samples = item.samples as number
            }
          }
          const lineWidth = validateLineWidth(item.lineWidth, `${path}.lineWidth`, issues)

          if (mode === 'explicit') {
            const curveScope = new Set(allowedBase)
            curveScope.add('x')
            if (!isNonEmptyString(item.y)) {
              issues.push(`${path}.y 必须是非空表达式字符串`)
              return
            }
            const yCheck = compileExpression(item.y, curveScope)
            if (!yCheck.ok) {
              issues.push(`${path}.y 表达式不合法：${yCheck.message}`)
            }
            let xRange: [ExprNum, ExprNum] | undefined
            if (item.xRange !== undefined) {
              const parsedRange = validatePoint2D(item.xRange, `${path}.xRange`, allowedBase, issues)
              if (parsedRange) xRange = parsedRange
            }
            let fillToY: ExprNum | undefined
            if (item.fillToY !== undefined) {
              const parsedFill = validateExprNum(item.fillToY, `${path}.fillToY`, curveScope, issues)
              if (parsedFill !== null) fillToY = parsedFill
            }
            elements.push({
              ...base,
              type: 'curve',
              mode: 'explicit',
              y: item.y.trim(),
              ...(xRange ? { xRange } : {}),
              ...(samples !== undefined ? { samples } : {}),
              ...(fillToY !== undefined ? { fillToY } : {}),
              ...(isValidColor(item.fillColor) ? { fillColor: item.fillColor.trim() } : {}),
              stroke: isValidColor(item.stroke) ? item.stroke.trim() : SCENE_PALETTE.blue,
              ...(lineWidth !== undefined ? { lineWidth } : {}),
              ...(typeof item.dashed === 'boolean' ? { dashed: item.dashed } : {}),
            })
            return
          }

          // parametric
          const paramScope = new Set(allowedBase)
          paramScope.add('u')
          if (!isNonEmptyString(item.x) || !isNonEmptyString(item.y)) {
            issues.push(`${path} 的参数曲线必须包含非空表达式 x 与 y`)
            return
          }
          const xCheck = compileExpression(item.x, paramScope)
          if (!xCheck.ok) issues.push(`${path}.x 表达式不合法：${xCheck.message}`)
          const yCheck = compileExpression(item.y, paramScope)
          if (!yCheck.ok) issues.push(`${path}.y 表达式不合法：${yCheck.message}`)
          const uRange = validatePoint2D(item.uRange, `${path}.uRange`, allowedBase, issues)
          let fillToY: ExprNum | undefined
          if (item.fillToY !== undefined) {
            const parsedFill = validateExprNum(item.fillToY, `${path}.fillToY`, paramScope, issues)
            if (parsedFill !== null) fillToY = parsedFill
          }
          if (uRange) {
            elements.push({
              ...base,
              type: 'curve',
              mode: 'parametric',
              x: item.x.trim(),
              y: item.y.trim(),
              uRange,
              ...(samples !== undefined ? { samples } : {}),
              ...(fillToY !== undefined ? { fillToY } : {}),
              ...(isValidColor(item.fillColor) ? { fillColor: item.fillColor.trim() } : {}),
              stroke: isValidColor(item.stroke) ? item.stroke.trim() : SCENE_PALETTE.blue,
              ...(lineWidth !== undefined ? { lineWidth } : {}),
              ...(typeof item.dashed === 'boolean' ? { dashed: item.dashed } : {}),
            })
          }
          return
        }

        case 'segment': {
          const from = validatePoint2D(item.from, `${path}.from`, allowedBase, issues)
          const to = validatePoint2D(item.to, `${path}.to`, allowedBase, issues)
          if (!isValidColor(item.stroke)) {
            issues.push(`${path}.stroke 必须是合法颜色`)
          }
          if (
            item.arrow !== undefined &&
            item.arrow !== 'none' &&
            item.arrow !== 'end' &&
            item.arrow !== 'both'
          ) {
            issues.push(`${path}.arrow 只能是 "none" / "end" / "both"`)
          }
          const lineWidth = validateLineWidth(item.lineWidth, `${path}.lineWidth`, issues)
          if (from && to) {
            elements.push({
              ...base,
              type: 'segment',
              from,
              to,
              ...(item.arrow === 'none' || item.arrow === 'end' || item.arrow === 'both'
                ? { arrow: item.arrow }
                : {}),
              stroke: isValidColor(item.stroke) ? item.stroke.trim() : SCENE_PALETTE.blue,
              ...(lineWidth !== undefined ? { lineWidth } : {}),
              ...(typeof item.dashed === 'boolean' ? { dashed: item.dashed } : {}),
              ...(typeof item.label === 'string' && item.label.trim()
                ? { label: item.label.trim().slice(0, 40) }
                : {}),
            })
          }
          return
        }

        case 'point': {
          const at = validatePoint2D(item.at, `${path}.at`, allowedBase, issues)
          if (!isValidColor(item.color)) {
            issues.push(`${path}.color 必须是合法颜色`)
          }
          if (item.shape !== undefined && !POINT_SHAPES.has(item.shape as PointShape)) {
            issues.push(`${path}.shape 必须是 circle / ring / diamond / cross / square`)
          }
          if (item.radius !== undefined && (!isFiniteNumber(item.radius) || item.radius < 2 || item.radius > 14)) {
            issues.push(`${path}.radius 必须是 2–14 之间的数字`)
          }
          let labelOffset: [number, number] | undefined
          if (item.labelOffset !== undefined) {
            if (
              !Array.isArray(item.labelOffset) ||
              item.labelOffset.length !== 2 ||
              !isFiniteNumber(item.labelOffset[0]) ||
              !isFiniteNumber(item.labelOffset[1])
            ) {
              issues.push(`${path}.labelOffset 必须是 [dx, dy] 数字数组`)
            } else {
              labelOffset = [item.labelOffset[0], item.labelOffset[1]]
            }
          }
          if (at) {
            elements.push({
              ...base,
              type: 'point',
              at,
              ...(item.shape && POINT_SHAPES.has(item.shape as PointShape)
                ? { shape: item.shape as PointShape }
                : {}),
              ...(isFiniteNumber(item.radius) ? { radius: item.radius } : {}),
              color: isValidColor(item.color) ? item.color.trim() : SCENE_PALETTE.peach,
              ...(typeof item.halo === 'boolean' ? { halo: item.halo } : {}),
              ...(typeof item.label === 'string' && item.label.trim()
                ? { label: item.label.trim().slice(0, 40) }
                : {}),
              ...(labelOffset ? { labelOffset } : {}),
              ...(typeof item.showCoords === 'boolean' ? { showCoords: item.showCoords } : {}),
            })
          }
          return
        }

        case 'circle': {
          const center = validatePoint2D(item.center, `${path}.center`, allowedBase, issues)
          const radius = validateExprNum(item.radius, `${path}.radius`, allowedBase, issues)
          const startAngle =
            item.startAngle !== undefined
              ? validateExprNum(item.startAngle, `${path}.startAngle`, allowedBase, issues)
              : undefined
          const endAngle =
            item.endAngle !== undefined
              ? validateExprNum(item.endAngle, `${path}.endAngle`, allowedBase, issues)
              : undefined
          if (item.stroke !== undefined && !isValidColor(item.stroke)) {
            issues.push(`${path}.stroke 颜色不合法`)
          }
          if (item.fill !== undefined && !isValidColor(item.fill)) {
            issues.push(`${path}.fill 颜色不合法`)
          }
          const lineWidth = validateLineWidth(item.lineWidth, `${path}.lineWidth`, issues)
          if (center && radius !== null) {
            elements.push({
              ...base,
              type: 'circle',
              center,
              radius,
              ...(startAngle !== undefined && startAngle !== null ? { startAngle } : {}),
              ...(endAngle !== undefined && endAngle !== null ? { endAngle } : {}),
              ...(isValidColor(item.stroke) ? { stroke: item.stroke.trim() } : {}),
              ...(isValidColor(item.fill) ? { fill: item.fill.trim() } : {}),
              ...(lineWidth !== undefined ? { lineWidth } : {}),
              ...(typeof item.dashed === 'boolean' ? { dashed: item.dashed } : {}),
            })
          }
          return
        }

        case 'polygon': {
          if (!Array.isArray(item.points) || item.points.length < 3) {
            issues.push(`${path}.points 至少需要 3 个顶点`)
            return
          }
          if (item.points.length > MAX_POLYGON_POINTS) {
            issues.push(`${path}.points 最多支持 ${MAX_POLYGON_POINTS} 个顶点`)
            return
          }
          const points: Point2D[] = []
          item.points.forEach((pt, pIdx) => {
            const parsed = validatePoint2D(pt, `${path}.points[${pIdx}]`, allowedBase, issues)
            if (parsed) points.push(parsed)
          })
          if (item.stroke !== undefined && !isValidColor(item.stroke)) {
            issues.push(`${path}.stroke 颜色不合法`)
          }
          if (item.fill !== undefined && !isValidColor(item.fill)) {
            issues.push(`${path}.fill 颜色不合法`)
          }
          const lineWidth = validateLineWidth(item.lineWidth, `${path}.lineWidth`, issues)
          elements.push({
            ...base,
            type: 'polygon',
            points,
            ...(isValidColor(item.fill) ? { fill: item.fill.trim() } : {}),
            ...(isValidColor(item.stroke) ? { stroke: item.stroke.trim() } : {}),
            ...(lineWidth !== undefined ? { lineWidth } : {}),
            ...(typeof item.dashed === 'boolean' ? { dashed: item.dashed } : {}),
          })
          return
        }

        case 'annotation': {
          const at = validatePoint2D(item.at, `${path}.at`, allowedBase, issues)
          if (!isNonEmptyString(item.text)) {
            issues.push(`${path}.text 必须是非空字符串`)
            return
          }
          const text = item.text.trim()
          if (text.length > 120) {
            issues.push(`${path}.text 不能超过 120 个字符`)
            return
          }
          const tpl = compileTemplateText(text, allowedBase)
          if (!tpl.ok) {
            issues.push(`${path}.text ${tpl.message}`)
          }
          if (
            item.align !== undefined &&
            item.align !== 'left' &&
            item.align !== 'center' &&
            item.align !== 'right'
          ) {
            issues.push(`${path}.align 只能是 "left" / "center" / "right"`)
          }
          if (item.color !== undefined && !isValidColor(item.color)) {
            issues.push(`${path}.color 颜色不合法`)
          }
          if (at) {
            elements.push({
              ...base,
              type: 'annotation',
              at,
              text,
              ...(item.align === 'left' || item.align === 'center' || item.align === 'right'
                ? { align: item.align }
                : {}),
              ...(isValidColor(item.color) ? { color: item.color.trim() } : {}),
              ...(typeof item.badge === 'boolean' ? { badge: item.badge } : {}),
            })
          }
          return
        }

        default:
          issues.push(
            `${path}.type 必须是 polyline / curve / segment / point / circle / polygon / annotation 之一`,
          )
      }
    })
  }

  // 4. 可选遥测指标校验
  let telemetry: SceneTelemetrySpec | undefined
  if (raw.telemetry !== undefined) {
    if (!isRecord(raw.telemetry) || !Array.isArray(raw.telemetry.metrics) || raw.telemetry.metrics.length === 0) {
      issues.push('scene.telemetry.metrics 必须是非空数组')
    } else if (raw.telemetry.metrics.length > MAX_TELEMETRY_METRICS) {
      issues.push(`scene.telemetry.metrics 最多支持 ${MAX_TELEMETRY_METRICS} 项`)
    } else {
      const metrics: SceneTelemetryMetric[] = []
      const seenMetricKeys = new Set<string>()
      raw.telemetry.metrics.forEach((metric, index) => {
        const path = `scene.telemetry.metrics[${index}]`
        if (!isRecord(metric)) {
          issues.push(`${path} 必须是对象`)
          return
        }
        if (!isNonEmptyString(metric.key) || !IDENT_PATTERN.test(metric.key)) {
          issues.push(`${path}.key 不合法`)
          return
        }
        if (seenMetricKeys.has(metric.key)) {
          issues.push(`${path}.key "${metric.key}" 重复`)
          return
        }
        seenMetricKeys.add(metric.key)
        if (!isNonEmptyString(metric.label)) {
          issues.push(`${path}.label 必须是非空字符串`)
          return
        }
        if (!isValidColor(metric.color)) {
          issues.push(`${path}.color 颜色不合法`)
          return
        }
        const expr = validateExprNum(metric.expr, `${path}.expr`, allowedBase, issues)
        if (expr === null) return
        if (
          metric.precision !== undefined &&
          (!Number.isInteger(metric.precision) || (metric.precision as number) < 0 || (metric.precision as number) > 6)
        ) {
          issues.push(`${path}.precision 必须是 0–6 的整数`)
          return
        }
        metrics.push({
          key: metric.key.trim(),
          label: metric.label.trim().slice(0, 32),
          color: metric.color.trim(),
          expr,
          ...(typeof metric.unit === 'string' && metric.unit.trim()
            ? { unit: metric.unit.trim().slice(0, 16) }
            : {}),
          ...(typeof metric.precision === 'number' ? { precision: metric.precision } : {}),
        })
      })
      if (metrics.length > 0) telemetry = { metrics }
    }
  }

  if (issues.length > 0 || !coordinate) {
    return { ok: false, issues }
  }

  return {
    ok: true,
    scene: {
      coordinate,
      ...(variables ? { variables } : {}),
      elements,
      ...(telemetry ? { telemetry } : {}),
    },
  }
}
