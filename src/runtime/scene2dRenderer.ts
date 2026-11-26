import type { Scene2DExperimentSpec } from '../ai/schema'
import {
  CANVAS,
  MONO_FONT,
  SANS_FONT,
  clamp,
  drawLegend,
  drawPlotFrame,
  drawText,
  paintBackground,
  plotTopPadding,
} from '../experiments/canvasKit'
import type {
  ExperimentDefinition,
  ParamValues,
  ProbeDefinition,
  SimulationModel,
  TelemetryDefinition,
  Viewport,
} from '../types/experiment'
import { resolveSceneColor } from '../types/scene2d'
import type {
  AnnotationElement,
  CircleElement,
  CurveElement,
  ExprNum,
  Point2D,
  PointElement,
  PolygonElement,
  PolylineElement,
  Scene2DSpec,
  SceneElement,
  SegmentElement,
} from '../types/scene2d'
import {
  compileExpression,
  compileTemplateText,
  formatDynamicNumber,
  renderTemplateText,
} from './expr'
import type { ExprEvaluator, TemplateSegment } from './expr'

export interface Scene2DState {
  t: number
}

interface PlotLayout {
  x: number
  y: number
  width: number
  height: number
  xMin: number
  xMax: number
  yMin: number
  yMax: number
  scaleX: number
  scaleY: number
  offsetX: number
  offsetY: number
  toScreenX: (wx: number) => number
  toScreenY: (wy: number) => number
  toWorldX: (sx: number) => number
  toWorldY: (sy: number) => number
}

const DEFAULT_Z: Record<SceneElement['type'], number> = {
  polygon: 10,
  circle: 20,
  curve: 30,
  polyline: 35,
  segment: 40,
  point: 50,
  annotation: 60,
}

type CompiledPoint = [ExprEvaluator, ExprEvaluator]

interface CompiledBase {
  id: string
  zIndex: number
  order: number
  visible?: ExprEvaluator
  opacity?: ExprEvaluator
}

type CompiledElement =
  | (CompiledBase & {
      type: 'polyline'
      points: CompiledPoint[]
      closed: boolean
      smooth: boolean
      stroke?: string
      fill?: string
      lineWidth: number
      dashed: boolean
    })
  | (CompiledBase & {
      type: 'curve'
      mode: 'explicit'
      y: ExprEvaluator
      xRange?: [ExprEvaluator, ExprEvaluator]
      samples: number
      fillToY?: ExprEvaluator
      fillColor?: string
      stroke: string
      lineWidth: number
      dashed: boolean
    })
  | (CompiledBase & {
      type: 'curve'
      mode: 'parametric'
      x: ExprEvaluator
      y: ExprEvaluator
      uRange: [ExprEvaluator, ExprEvaluator]
      samples: number
      fillToY?: ExprEvaluator
      fillColor?: string
      stroke: string
      lineWidth: number
      dashed: boolean
    })
  | (CompiledBase & {
      type: 'segment'
      from: CompiledPoint
      to: CompiledPoint
      arrow: 'none' | 'end' | 'both'
      stroke: string
      lineWidth: number
      dashed: boolean
      label?: string
    })
  | (CompiledBase & {
      type: 'point'
      at: CompiledPoint
      shape: NonNullable<PointElement['shape']>
      radius: number
      color: string
      halo: boolean
      label?: string
      labelOffset: [number, number]
      showCoords: boolean
    })
  | (CompiledBase & {
      type: 'circle'
      center: CompiledPoint
      radius: ExprEvaluator
      startAngle?: ExprEvaluator
      endAngle?: ExprEvaluator
      stroke?: string
      fill?: string
      lineWidth: number
      dashed: boolean
    })
  | (CompiledBase & {
      type: 'polygon'
      points: CompiledPoint[]
      fill?: string
      stroke?: string
      lineWidth: number
      dashed: boolean
    })
  | (CompiledBase & {
      type: 'annotation'
      at: CompiledPoint
      segments: TemplateSegment[]
      align: 'left' | 'center' | 'right'
      color: string
      badge: boolean
    })

function mustCompile(expr: ExprNum, allowed: ReadonlySet<string>): ExprEvaluator {
  const result = compileExpression(expr, allowed)
  if (!result.ok) {
    throw new Error(`Scene2D 表达式编译失败：${result.message}`)
  }
  return result.evaluate
}

function compilePoint(point: Point2D, allowed: ReadonlySet<string>): CompiledPoint {
  return [mustCompile(point[0], allowed), mustCompile(point[1], allowed)]
}

function niceTickStep(span: number, targetTicks: number): number {
  const raw = span / Math.max(2, targetTicks)
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)))
  const residual = raw / magnitude
  if (residual <= 1.5) return magnitude
  if (residual <= 3.5) return 2 * magnitude
  if (residual <= 7.5) return 5 * magnitude
  return 10 * magnitude
}

function formatTick(value: number): string {
  if (Math.abs(value) < 1e-9) return '0'
  if (Math.abs(value) >= 1000 || Math.abs(value) < 0.01) return value.toExponential(1)
  return Number(value.toFixed(3)).toString()
}

function computePlotLayout(scene: Scene2DSpec, viewport: Viewport): PlotLayout {
  const { width, height } = viewport
  const top = plotTopPadding(width, height)
  const left = width < 520 ? 44 : 58
  const right = width < 520 ? 22 : 34
  const bottom = scene.coordinate.xLabel ? 52 : 38
  const plotW = Math.max(40, width - left - right)
  const plotH = Math.max(40, height - top - bottom)

  const [xMin, xMax] = scene.coordinate.xDomain
  const [yMin, yMax] = scene.coordinate.yDomain
  const spanX = xMax - xMin
  const spanY = yMax - yMin

  let scaleX = plotW / spanX
  let scaleY = plotH / spanY
  let offsetX = left
  let offsetY = top

  if (scene.coordinate.aspectMode === 'fit') {
    const uniform = Math.min(scaleX, scaleY)
    scaleX = uniform
    scaleY = uniform
    offsetX = left + (plotW - spanX * uniform) / 2
    offsetY = top + (plotH - spanY * uniform) / 2
  }

  return {
    x: left,
    y: top,
    width: plotW,
    height: plotH,
    xMin,
    xMax,
    yMin,
    yMax,
    scaleX,
    scaleY,
    offsetX,
    offsetY,
    toScreenX: (wx) => offsetX + (wx - xMin) * scaleX,
    toScreenY: (wy) => offsetY + (yMax - wy) * scaleY,
    toWorldX: (sx) => xMin + (sx - offsetX) / scaleX,
    toWorldY: (sy) => yMax - (sy - offsetY) / scaleY,
  }
}

function buildScope(
  params: ParamValues,
  t: number,
  compiledVars: Array<{ key: string; evaluate: ExprEvaluator }>,
): Record<string, number> {
  const scope: Record<string, number> = { t }
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      scope[key] = value
    } else if (typeof value === 'boolean') {
      scope[key] = value ? 1 : 0
    }
  }
  for (const item of compiledVars) {
    scope[item.key] = item.evaluate(scope)
  }
  return scope
}

function drawGridAndAxes(
  ctx: CanvasRenderingContext2D,
  scene: Scene2DSpec,
  layout: PlotLayout,
): void {
  const showGrid = scene.coordinate.showGrid !== false
  const showAxes = scene.coordinate.showAxes !== false
  const worldLeft = layout.toWorldX(layout.x)
  const worldRight = layout.toWorldX(layout.x + layout.width)
  const worldBottom = layout.toWorldY(layout.y + layout.height)
  const worldTop = layout.toWorldY(layout.y)

  const xStep = niceTickStep(worldRight - worldLeft, Math.max(4, Math.floor(layout.width / 85)))
  const yStep = niceTickStep(worldTop - worldBottom, Math.max(3, Math.floor(layout.height / 70)))

  const firstX = Math.ceil(worldLeft / xStep) * xStep
  const firstY = Math.ceil(worldBottom / yStep) * yStep

  if (showGrid) {
    ctx.save()
    ctx.strokeStyle = CANVAS.grid
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let x = firstX; x <= worldRight + xStep * 1e-6; x += xStep) {
      const sx = Math.round(layout.toScreenX(x)) + 0.5
      if (sx >= layout.x && sx <= layout.x + layout.width) {
        ctx.moveTo(sx, layout.y)
        ctx.lineTo(sx, layout.y + layout.height)
      }
    }
    for (let y = firstY; y <= worldTop + yStep * 1e-6; y += yStep) {
      const sy = Math.round(layout.toScreenY(y)) + 0.5
      if (sy >= layout.y && sy <= layout.y + layout.height) {
        ctx.moveTo(layout.x, sy)
        ctx.lineTo(layout.x + layout.width, sy)
      }
    }
    ctx.stroke()
    ctx.restore()
  }

  drawPlotFrame(ctx, layout)

  if (showAxes) {
    ctx.save()
    ctx.strokeStyle = CANVAS.axis
    ctx.lineWidth = 1.15
    ctx.beginPath()
    if (worldBottom <= 0 && worldTop >= 0) {
      const y0 = Math.round(layout.toScreenY(0)) + 0.5
      ctx.moveTo(layout.x, y0)
      ctx.lineTo(layout.x + layout.width, y0)
    }
    if (worldLeft <= 0 && worldRight >= 0) {
      const x0 = Math.round(layout.toScreenX(0)) + 0.5
      ctx.moveTo(x0, layout.y)
      ctx.lineTo(x0, layout.y + layout.height)
    }
    ctx.stroke()
    ctx.restore()

    for (let x = firstX; x <= worldRight + xStep * 1e-6; x += xStep) {
      const sx = layout.toScreenX(x)
      if (sx < layout.x + 8 || sx > layout.x + layout.width - 8) continue
      drawText(ctx, formatTick(x), sx, layout.y + layout.height + 15, {
        align: 'center',
        size: 9.5,
        color: CANVAS.textFaint,
      })
    }
    for (let y = firstY; y <= worldTop + yStep * 1e-6; y += yStep) {
      const sy = layout.toScreenY(y)
      if (sy < layout.y + 8 || sy > layout.y + layout.height - 8) continue
      drawText(ctx, formatTick(y), layout.x - 8, sy + 3.5, {
        align: 'right',
        size: 9.5,
        color: CANVAS.textFaint,
      })
    }
  }

  if (scene.coordinate.xLabel) {
    drawText(
      ctx,
      scene.coordinate.xLabel,
      layout.x + layout.width / 2,
      layout.y + layout.height + 34,
      { align: 'center', size: 10.5, color: CANVAS.text, mono: false },
    )
  }

  if (scene.coordinate.yLabel) {
    ctx.save()
    ctx.translate(layout.x - 38, layout.y + layout.height / 2)
    ctx.rotate(-Math.PI / 2)
    drawText(ctx, scene.coordinate.yLabel, 0, 0, {
      align: 'center',
      baseline: 'middle',
      size: 10.5,
      color: CANVAS.text,
      mono: false,
    })
    ctx.restore()
  }
}

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  color: string,
  size = 8,
): void {
  const angle = Math.atan2(toY - fromY, toX - fromX)
  ctx.save()
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(toX, toY)
  ctx.lineTo(toX - size * Math.cos(angle - Math.PI / 6), toY - size * Math.sin(angle - Math.PI / 6))
  ctx.lineTo(toX - size * Math.cos(angle + Math.PI / 6), toY - size * Math.sin(angle + Math.PI / 6))
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

function drawPointShape(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  shape: NonNullable<PointElement['shape']>,
  color: string,
  halo: boolean,
): void {
  ctx.save()
  if (halo) {
    ctx.fillStyle = CANVAS.halo
    ctx.beginPath()
    ctx.arc(x, y, radius + 5, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.fillStyle = color
  ctx.strokeStyle = color
  ctx.lineWidth = 2

  switch (shape) {
    case 'circle':
      ctx.beginPath()
      ctx.arc(x, y, radius, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = CANVAS.background
      ctx.lineWidth = 1.4
      ctx.stroke()
      break
    case 'ring':
      ctx.fillStyle = CANVAS.background
      ctx.beginPath()
      ctx.arc(x, y, radius, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = color
      ctx.lineWidth = 2.2
      ctx.stroke()
      break
    case 'diamond':
      ctx.beginPath()
      ctx.moveTo(x, y - radius - 1)
      ctx.lineTo(x + radius + 1, y)
      ctx.lineTo(x, y + radius + 1)
      ctx.lineTo(x - radius - 1, y)
      ctx.closePath()
      ctx.fill()
      break
    case 'square':
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2)
      break
    case 'cross': {
      const r = radius + 1
      ctx.beginPath()
      ctx.moveTo(x - r, y - r)
      ctx.lineTo(x + r, y + r)
      ctx.moveTo(x + r, y - r)
      ctx.lineTo(x - r, y + r)
      ctx.stroke()
      break
    }
  }
  ctx.restore()
}

function drawBadgeLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  align: 'left' | 'center' | 'right',
  color: string,
  badge: boolean,
): void {
  ctx.save()
  ctx.font = `500 11px ${SANS_FONT}`
  const metrics = ctx.measureText(text)
  const textWidth = metrics.width
  const padX = 7
  const boxH = 20

  let boxX = x
  if (align === 'center') boxX = x - textWidth / 2 - padX
  else if (align === 'right') boxX = x - textWidth - padX * 2
  const boxY = y - boxH / 2

  if (badge) {
    ctx.fillStyle = 'rgba(252, 249, 242, 0.92)'
    ctx.strokeStyle = CANVAS.frame
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.roundRect(boxX, boxY, textWidth + padX * 2, boxH, 6)
    ctx.fill()
    ctx.stroke()
  }

  ctx.fillStyle = color
  ctx.textAlign = align
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x, y)
  ctx.restore()
}

function compileElements(
  scene: Scene2DSpec,
  allowedBase: ReadonlySet<string>,
): CompiledElement[] {
  const compiled: CompiledElement[] = scene.elements.map((element, order) => {
    const base: CompiledBase = {
      id: element.id,
      zIndex: element.zIndex ?? DEFAULT_Z[element.type],
      order,
      ...(element.visible !== undefined
        ? {
            visible:
              typeof element.visible === 'boolean'
                ? () => (element.visible ? 1 : 0)
                : mustCompile(element.visible, allowedBase),
          }
        : {}),
      ...(element.opacity !== undefined
        ? { opacity: mustCompile(element.opacity, allowedBase) }
        : {}),
    }

    switch (element.type) {
      case 'polyline': {
        const el = element as PolylineElement
        return {
          ...base,
          type: 'polyline',
          points: el.points.map((pt) => compilePoint(pt, allowedBase)),
          closed: el.closed === true,
          smooth: el.smooth === true,
          ...(el.stroke ? { stroke: resolveSceneColor(el.stroke) } : {}),
          ...(el.fill ? { fill: resolveSceneColor(el.fill) } : {}),
          lineWidth: el.lineWidth ?? 2,
          dashed: el.dashed === true,
        }
      }
      case 'curve': {
        const el = element as CurveElement
        if (el.mode === 'explicit') {
          const scope = new Set(allowedBase)
          scope.add('x')
          return {
            ...base,
            type: 'curve',
            mode: 'explicit',
            y: mustCompile(el.y, scope),
            ...(el.xRange
              ? {
                  xRange: [
                    mustCompile(el.xRange[0], allowedBase),
                    mustCompile(el.xRange[1], allowedBase),
                  ] as [ExprEvaluator, ExprEvaluator],
                }
              : {}),
            samples: el.samples ?? 180,
            ...(el.fillToY !== undefined ? { fillToY: mustCompile(el.fillToY, scope) } : {}),
            ...(el.fillColor ? { fillColor: resolveSceneColor(el.fillColor) } : {}),
            stroke: resolveSceneColor(el.stroke),
            lineWidth: el.lineWidth ?? 2.2,
            dashed: el.dashed === true,
          }
        }
        const scope = new Set(allowedBase)
        scope.add('u')
        return {
          ...base,
          type: 'curve',
          mode: 'parametric',
          x: mustCompile(el.x, scope),
          y: mustCompile(el.y, scope),
          uRange: [
            mustCompile(el.uRange[0], allowedBase),
            mustCompile(el.uRange[1], allowedBase),
          ],
          samples: el.samples ?? 180,
          ...(el.fillToY !== undefined ? { fillToY: mustCompile(el.fillToY, scope) } : {}),
          ...(el.fillColor ? { fillColor: resolveSceneColor(el.fillColor) } : {}),
          stroke: resolveSceneColor(el.stroke),
          lineWidth: el.lineWidth ?? 2.2,
          dashed: el.dashed === true,
        }
      }
      case 'segment': {
        const el = element as SegmentElement
        return {
          ...base,
          type: 'segment',
          from: compilePoint(el.from, allowedBase),
          to: compilePoint(el.to, allowedBase),
          arrow: el.arrow ?? 'none',
          stroke: resolveSceneColor(el.stroke),
          lineWidth: el.lineWidth ?? 1.8,
          dashed: el.dashed === true,
          ...(el.label ? { label: el.label } : {}),
        }
      }
      case 'point': {
        const el = element as PointElement
        return {
          ...base,
          type: 'point',
          at: compilePoint(el.at, allowedBase),
          shape: el.shape ?? 'circle',
          radius: el.radius ?? 5,
          color: resolveSceneColor(el.color, CANVAS.peach),
          halo: el.halo === true,
          ...(el.label ? { label: el.label } : {}),
          labelOffset: el.labelOffset ?? [8, -10],
          showCoords: el.showCoords === true,
        }
      }
      case 'circle': {
        const el = element as CircleElement
        return {
          ...base,
          type: 'circle',
          center: compilePoint(el.center, allowedBase),
          radius: mustCompile(el.radius, allowedBase),
          ...(el.startAngle !== undefined
            ? { startAngle: mustCompile(el.startAngle, allowedBase) }
            : {}),
          ...(el.endAngle !== undefined
            ? { endAngle: mustCompile(el.endAngle, allowedBase) }
            : {}),
          ...(el.stroke ? { stroke: resolveSceneColor(el.stroke) } : {}),
          ...(el.fill ? { fill: resolveSceneColor(el.fill) } : {}),
          lineWidth: el.lineWidth ?? 1.8,
          dashed: el.dashed === true,
        }
      }
      case 'polygon': {
        const el = element as PolygonElement
        return {
          ...base,
          type: 'polygon',
          points: el.points.map((pt) => compilePoint(pt, allowedBase)),
          ...(el.fill ? { fill: resolveSceneColor(el.fill) } : {}),
          ...(el.stroke ? { stroke: resolveSceneColor(el.stroke) } : {}),
          lineWidth: el.lineWidth ?? 1.6,
          dashed: el.dashed === true,
        }
      }
      case 'annotation': {
        const el = element as AnnotationElement
        const tpl = compileTemplateText(el.text, allowedBase)
        if (!tpl.ok) {
          throw new Error(`标注模板编译失败：${tpl.message}`)
        }
        return {
          ...base,
          type: 'annotation',
          at: compilePoint(el.at, allowedBase),
          segments: tpl.segments,
          align: el.align ?? 'left',
          color: resolveSceneColor(el.color, CANVAS.textStrong),
          badge: el.badge === true,
        }
      }
    }
  })

  return compiled.sort((a, b) => a.zIndex - b.zIndex || a.order - b.order)
}

function drawCompiledElement(
  ctx: CanvasRenderingContext2D,
  element: CompiledElement,
  layout: PlotLayout,
  scope: Record<string, number>,
): void {
  if (element.visible && !element.visible(scope)) return

  const alpha = element.opacity ? clamp(element.opacity(scope), 0, 1) : 1
  if (!Number.isFinite(alpha) || alpha <= 0) return

  ctx.save()
  ctx.globalAlpha = alpha

  switch (element.type) {
    case 'polygon': {
      const pts: Array<[number, number]> = []
      for (const [fx, fy] of element.points) {
        const wx = fx(scope)
        const wy = fy(scope)
        if (!Number.isFinite(wx) || !Number.isFinite(wy)) {
          ctx.restore()
          return
        }
        pts.push([layout.toScreenX(wx), layout.toScreenY(wy)])
      }
      ctx.beginPath()
      ctx.moveTo(pts[0][0], pts[0][1])
      for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i][0], pts[i][1])
      ctx.closePath()
      if (element.fill) {
        ctx.save()
        ctx.globalAlpha = alpha * 0.22
        ctx.fillStyle = element.fill
        ctx.fill()
        ctx.restore()
      }
      if (element.stroke) {
        ctx.strokeStyle = element.stroke
        ctx.lineWidth = element.lineWidth
        if (element.dashed) ctx.setLineDash([5, 4])
        ctx.stroke()
      }
      break
    }

    case 'polyline': {
      const pts: Array<[number, number]> = []
      for (const [fx, fy] of element.points) {
        const wx = fx(scope)
        const wy = fy(scope)
        if (Number.isFinite(wx) && Number.isFinite(wy)) {
          pts.push([layout.toScreenX(wx), layout.toScreenY(wy)])
        }
      }
      if (pts.length < 2) break
      ctx.beginPath()
      ctx.moveTo(pts[0][0], pts[0][1])
      if (element.smooth && pts.length > 2) {
        for (let i = 1; i < pts.length - 1; i += 1) {
          const midX = (pts[i][0] + pts[i + 1][0]) / 2
          const midY = (pts[i][1] + pts[i + 1][1]) / 2
          ctx.quadraticCurveTo(pts[i][0], pts[i][1], midX, midY)
        }
        ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1])
      } else {
        for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i][0], pts[i][1])
      }
      if (element.closed) ctx.closePath()
      if (element.fill) {
        ctx.save()
        ctx.globalAlpha = alpha * 0.2
        ctx.fillStyle = element.fill
        ctx.fill()
        ctx.restore()
      }
      if (element.stroke) {
        ctx.strokeStyle = element.stroke
        ctx.lineWidth = element.lineWidth
        ctx.lineJoin = 'round'
        ctx.lineCap = 'round'
        if (element.dashed) ctx.setLineDash([5, 4])
        ctx.stroke()
      }
      break
    }

    case 'curve': {
      const points: Array<{ sx: number; sy: number; fillY?: number } | null> = []
      if (element.mode === 'explicit') {
        const xStart = element.xRange ? element.xRange[0](scope) : layout.xMin
        const xEnd = element.xRange ? element.xRange[1](scope) : layout.xMax
        if (!Number.isFinite(xStart) || !Number.isFinite(xEnd) || xEnd <= xStart) break
        const localScope = { ...scope }
        for (let i = 0; i <= element.samples; i += 1) {
          const wx = xStart + ((xEnd - xStart) * i) / element.samples
          localScope.x = wx
          const wy = element.y(localScope)
          if (!Number.isFinite(wy)) {
            points.push(null)
            continue
          }
          const fillWorldY = element.fillToY ? element.fillToY(localScope) : undefined
          points.push({
            sx: layout.toScreenX(wx),
            sy: layout.toScreenY(wy),
            ...(fillWorldY !== undefined && Number.isFinite(fillWorldY)
              ? { fillY: layout.toScreenY(fillWorldY) }
              : {}),
          })
        }
      } else {
        const uStart = element.uRange[0](scope)
        const uEnd = element.uRange[1](scope)
        if (!Number.isFinite(uStart) || !Number.isFinite(uEnd) || uEnd <= uStart) break
        const localScope = { ...scope }
        for (let i = 0; i <= element.samples; i += 1) {
          const u = uStart + ((uEnd - uStart) * i) / element.samples
          localScope.u = u
          const wx = element.x(localScope)
          const wy = element.y(localScope)
          if (!Number.isFinite(wx) || !Number.isFinite(wy)) {
            points.push(null)
            continue
          }
          const fillWorldY = element.fillToY ? element.fillToY(localScope) : undefined
          points.push({
            sx: layout.toScreenX(wx),
            sy: layout.toScreenY(wy),
            ...(fillWorldY !== undefined && Number.isFinite(fillWorldY)
              ? { fillY: layout.toScreenY(fillWorldY) }
              : {}),
          })
        }
      }

      if (element.fillToY) {
        ctx.save()
        ctx.globalAlpha = alpha * 0.16
        ctx.fillStyle = element.fillColor ?? element.stroke
        let segStart = -1
        const flushFill = (start: number, end: number) => {
          if (end - start < 1) return
          const first = points[start]
          const last = points[end]
          if (!first || !last || first.fillY === undefined || last.fillY === undefined) return
          ctx.beginPath()
          ctx.moveTo(first.sx, first.fillY)
          for (let k = start; k <= end; k += 1) {
            const p = points[k]!
            ctx.lineTo(p.sx, p.sy)
          }
          ctx.lineTo(last.sx, last.fillY)
          ctx.closePath()
          ctx.fill()
        }
        for (let i = 0; i < points.length; i += 1) {
          if (points[i] !== null) {
            if (segStart === -1) segStart = i
          } else if (segStart !== -1) {
            flushFill(segStart, i - 1)
            segStart = -1
          }
        }
        if (segStart !== -1) flushFill(segStart, points.length - 1)
        ctx.restore()
      }

      ctx.strokeStyle = element.stroke
      ctx.lineWidth = element.lineWidth
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      if (element.dashed) ctx.setLineDash([5, 4])
      ctx.beginPath()
      let penDown = false
      for (const pt of points) {
        if (!pt) {
          penDown = false
          continue
        }
        if (!penDown) {
          ctx.moveTo(pt.sx, pt.sy)
          penDown = true
        } else {
          ctx.lineTo(pt.sx, pt.sy)
        }
      }
      ctx.stroke()
      break
    }

    case 'segment': {
      const x1 = element.from[0](scope)
      const y1 = element.from[1](scope)
      const x2 = element.to[0](scope)
      const y2 = element.to[1](scope)
      if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) {
        break
      }
      const sx1 = layout.toScreenX(x1)
      const sy1 = layout.toScreenY(y1)
      const sx2 = layout.toScreenX(x2)
      const sy2 = layout.toScreenY(y2)

      ctx.strokeStyle = element.stroke
      ctx.lineWidth = element.lineWidth
      ctx.lineCap = 'round'
      if (element.dashed) ctx.setLineDash([5, 4])
      ctx.beginPath()
      ctx.moveTo(sx1, sy1)
      ctx.lineTo(sx2, sy2)
      ctx.stroke()
      ctx.setLineDash([])

      if (Math.hypot(sx2 - sx1, sy2 - sy1) > 4) {
        if (element.arrow === 'end' || element.arrow === 'both') {
          drawArrowHead(ctx, sx1, sy1, sx2, sy2, element.stroke)
        }
        if (element.arrow === 'both') {
          drawArrowHead(ctx, sx2, sy2, sx1, sy1, element.stroke)
        }
      }

      if (element.label) {
        const mx = (sx1 + sx2) / 2
        const my = (sy1 + sy2) / 2 - 8
        drawText(ctx, element.label, mx, my, {
          align: 'center',
          size: 10,
          color: element.stroke,
          mono: false,
        })
      }
      break
    }

    case 'circle': {
      const cx = element.center[0](scope)
      const cy = element.center[1](scope)
      const r = element.radius(scope)
      if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(r) || r <= 0) break
      const sx = layout.toScreenX(cx)
      const sy = layout.toScreenY(cy)
      const rx = r * layout.scaleX
      const ry = r * layout.scaleY
      const start = element.startAngle ? -element.startAngle(scope) : 0
      const end = element.endAngle ? -element.endAngle(scope) : Math.PI * 2
      const anticlockwise = element.startAngle !== undefined || element.endAngle !== undefined

      ctx.beginPath()
      ctx.ellipse(sx, sy, rx, ry, 0, start, end, anticlockwise)
      if (element.fill) {
        ctx.save()
        ctx.globalAlpha = alpha * 0.2
        ctx.fillStyle = element.fill
        ctx.fill()
        ctx.restore()
      }
      if (element.stroke) {
        ctx.strokeStyle = element.stroke
        ctx.lineWidth = element.lineWidth
        if (element.dashed) ctx.setLineDash([5, 4])
        ctx.stroke()
      }
      break
    }

    case 'point': {
      const wx = element.at[0](scope)
      const wy = element.at[1](scope)
      if (!Number.isFinite(wx) || !Number.isFinite(wy)) break
      const sx = layout.toScreenX(wx)
      const sy = layout.toScreenY(wy)
      drawPointShape(ctx, sx, sy, element.radius, element.shape, element.color, element.halo)

      const parts: string[] = []
      if (element.label) parts.push(element.label)
      if (element.showCoords) {
        parts.push(`(${formatDynamicNumber(wx)}, ${formatDynamicNumber(wy)})`)
      }
      if (parts.length > 0) {
        const [dx, dy] = element.labelOffset
        drawText(ctx, parts.join(' '), sx + dx, sy + dy, {
          size: 10.5,
          weight: 500,
          color: CANVAS.textStrong,
          mono: false,
        })
      }
      break
    }

    case 'annotation': {
      const wx = element.at[0](scope)
      const wy = element.at[1](scope)
      if (!Number.isFinite(wx) || !Number.isFinite(wy)) break
      const sx = layout.toScreenX(wx)
      const sy = layout.toScreenY(wy)
      const rendered = renderTemplateText(element.segments, scope)
      drawBadgeLabel(ctx, rendered, sx, sy, element.align, element.color, element.badge)
      break
    }
  }

  ctx.restore()
}

/**
 * 将已校验的 Scene2DExperimentSpec 编译为标准 ExperimentDefinition：
 * 直接运行在 CanvasRuntime 上，支持高清 DPR、悬停探针、实时遥测与离线 HTML 导出。
 */
export function compileScene2DExperiment(
  spec: Scene2DExperimentSpec,
  id = 'ai-generated',
): ExperimentDefinition {
  const scene = spec.scene
  const allowedBase = new Set<string>(['t', ...spec.controls.map((control) => control.key)])
  const compiledVars: Array<{ key: string; evaluate: ExprEvaluator }> = []

  if (scene.variables) {
    for (const [key, expr] of Object.entries(scene.variables)) {
      compiledVars.push({ key, evaluate: mustCompile(expr, allowedBase) })
      allowedBase.add(key)
    }
  }

  const compiledElements = compileElements(scene, allowedBase)
  const clippedElements = compiledElements.filter(
    (el) => el.type !== 'point' && el.type !== 'annotation',
  )
  const overlayElements = compiledElements.filter(
    (el) => el.type === 'point' || el.type === 'annotation',
  )

  const model: SimulationModel<Scene2DState> = {
    createState: () => ({ t: 0 }),
    step: (state, _params, dt) => ({ t: state.t + dt }),
    draw: (ctx, state, params, viewport) => {
      paintBackground(ctx, viewport.width, viewport.height)
      const layout = computePlotLayout(scene, viewport)
      drawGridAndAxes(ctx, scene, layout)

      const scope = buildScope(params, state.t, compiledVars)

      // 曲线/折线/区域裁剪在绘图框内，防止渐近线发散污染全局画布
      ctx.save()
      ctx.beginPath()
      ctx.rect(layout.x, layout.y, layout.width, layout.height)
      ctx.clip()
      for (const element of clippedElements) {
        drawCompiledElement(ctx, element, layout, scope)
      }
      ctx.restore()

      // 关键标点与文字标注绘制在顶层，避免贴边文字被裁切
      for (const element of overlayElements) {
        drawCompiledElement(ctx, element, layout, scope)
      }

      if (spec.legend && spec.legend.length > 0 && viewport.width >= 420) {
        const legendX = layout.x + layout.width - 148
        const legendY = layout.y + 18
        if (legendX > layout.x + 80) {
          drawLegend(ctx, spec.legend, legendX, legendY, { gap: 18, size: 10 })
        }
      }

      // 右下角轻量时间读数（存在含 t 动态元素时尤有用）
      if (state.t > 0) {
        drawText(ctx, `t = ${state.t.toFixed(2)} s`, layout.x + layout.width - 6, layout.y + layout.height - 8, {
          align: 'right',
          size: 9.5,
          color: CANVAS.textFaint,
        })
      }
    },
  }

  // 悬停探针：优先吸附附近标点，否则显示当前世界坐标与主曲线函数值
  const firstExplicitCurve = compiledElements.find(
    (el): el is Extract<CompiledElement, { type: 'curve'; mode: 'explicit' }> =>
      el.type === 'curve' && el.mode === 'explicit',
  )
  const pointElements = compiledElements.filter(
    (el): el is Extract<CompiledElement, { type: 'point' }> => el.type === 'point',
  )

  const probe: ProbeDefinition<Scene2DState> = {
    hint: '悬停画布读取世界坐标与关键标点',
    read: (state, params, pointer, viewport) => {
      const layout = computePlotLayout(scene, viewport)
      if (
        pointer.x < layout.x ||
        pointer.x > layout.x + layout.width ||
        pointer.y < layout.y ||
        pointer.y > layout.y + layout.height
      ) {
        return null
      }
      const scope = buildScope(params, state.t, compiledVars)
      for (const pt of pointElements) {
        if (pt.visible && !pt.visible(scope)) continue
        const wx = pt.at[0](scope)
        const wy = pt.at[1](scope)
        if (!Number.isFinite(wx) || !Number.isFinite(wy)) continue
        const dist = Math.hypot(pointer.x - layout.toScreenX(wx), pointer.y - layout.toScreenY(wy))
        if (dist <= 14) {
          return {
            position: `x = ${formatDynamicNumber(wx)}, y = ${formatDynamicNumber(wy)}`,
            label: pt.label ?? '关键标点',
            value: `(${formatDynamicNumber(wx)}, ${formatDynamicNumber(wy)})`,
          }
        }
      }

      const wx = layout.toWorldX(pointer.x)
      const wy = layout.toWorldY(pointer.y)
      if (firstExplicitCurve && (!firstExplicitCurve.visible || firstExplicitCurve.visible(scope))) {
        const curveY = firstExplicitCurve.y({ ...scope, x: wx })
        if (Number.isFinite(curveY)) {
          return {
            position: `x = ${formatDynamicNumber(wx)}`,
            label: '曲线函数值 y(x)',
            value: formatDynamicNumber(curveY),
            detail: `光标 y = ${formatDynamicNumber(wy)}`,
          }
        }
      }

      return {
        position: `t = ${state.t.toFixed(2)} s`,
        label: '世界坐标',
        value: `(${formatDynamicNumber(wx)}, ${formatDynamicNumber(wy)})`,
      }
    },
  }

  let telemetry: TelemetryDefinition<Scene2DState> | undefined
  if (scene.telemetry && scene.telemetry.metrics.length > 0) {
    const compiledMetrics = scene.telemetry.metrics.map((metric) => ({
      key: metric.key,
      label: metric.label,
      ...(metric.unit ? { unit: metric.unit } : {}),
      color: resolveSceneColor(metric.color),
      ...(metric.precision !== undefined ? { precision: metric.precision } : {}),
      evaluate: mustCompile(metric.expr, allowedBase),
    }))
    telemetry = {
      metrics: compiledMetrics.map(({ evaluate: _evaluate, ...rest }) => rest),
      sample: (state, params) => {
        const scope = buildScope(params, state.t, compiledVars)
        const values: Record<string, number> = {}
        for (const metric of compiledMetrics) {
          const v = metric.evaluate(scope)
          if (Number.isFinite(v)) values[metric.key] = v
        }
        return values
      },
    }
  }

  const definition: ExperimentDefinition<Scene2DState> = {
    id,
    title: spec.title,
    domain: spec.domain,
    formulaLatex: spec.formulaLatex,
    insight: spec.insight,
    renderType: 'scene2d',
    controls: spec.controls,
    ...(spec.legend ? { legend: spec.legend } : {}),
    ...(telemetry ? { telemetry } : {}),
    probe,
    model,
  }
  return definition as unknown as ExperimentDefinition
}

export { MONO_FONT }
