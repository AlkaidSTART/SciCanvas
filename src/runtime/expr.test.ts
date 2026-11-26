import { describe, expect, it } from 'vitest'
import {
  compileExpression,
  compileTemplateText,
  parseExpression,
  renderTemplateText,
} from './expr'

describe('expr engine', () => {
  it('正确计算基本算术、幂运算、优先级与数学函数', () => {
    const allowed = new Set(['x', 'v0', 'g', 't'])
    const c1 = compileExpression('v0 * t - 0.5 * g * t^2', allowed)
    expect(c1.ok).toBe(true)
    if (c1.ok) {
      expect(c1.evaluate({ v0: 20, g: 10, t: 2 })).toBeCloseTo(20, 6)
    }

    // 确认 -x^2 按数学惯例解析为 -(x^2)
    const c2 = compileExpression('-x^2 + 4', allowed)
    expect(c2.ok).toBe(true)
    if (c2.ok) {
      expect(c2.evaluate({ x: 3 })).toBe(-5)
    }

    // 常量 pi 与三角函数
    const c3 = compileExpression('sin(pi / 2) + cos(0)', allowed)
    expect(c3.ok).toBe(true)
    if (c3.ok) {
      expect(c3.evaluate({})).toBeCloseTo(2, 6)
    }
  })

  it('支持条件三元、逻辑与比较运算', () => {
    const allowed = new Set(['x', 'show'])
    const compiled = compileExpression('show && x > 0 ? sqrt(x) : 0', allowed)
    expect(compiled.ok).toBe(true)
    if (compiled.ok) {
      expect(compiled.evaluate({ show: 1, x: 9 })).toBe(3)
      expect(compiled.evaluate({ show: 0, x: 9 })).toBe(0)
      expect(compiled.evaluate({ show: 1, x: -4 })).toBe(0)
    }
  })

  it('拒绝未声明变量、未知函数与危险语法', () => {
    const allowed = new Set(['x'])
    expect(compileExpression('window', allowed).ok).toBe(false)
    expect(compileExpression('eval(x)', allowed).ok).toBe(false)
    expect(compileExpression('sin(x, 2)', allowed).ok).toBe(false)
    expect(compileExpression('x; alert(1)', allowed).ok).toBe(false)
    expect(parseExpression('('.repeat(20) + '1' + ')'.repeat(20)).ok).toBe(false)
  })

  it('除零返回 NaN 而不抛出异常', () => {
    const compiled = compileExpression('1 / x', new Set(['x']))
    expect(compiled.ok).toBe(true)
    if (compiled.ok) {
      expect(Number.isNaN(compiled.evaluate({ x: 0 }))).toBe(true)
    }
  })

  it('支持标注模板中的 {{expr}} 动态插值并限制数量', () => {
    const allowed = new Set(['xPeak', 'yPeak'])
    const tpl = compileTemplateText('顶点 ({{xPeak}}, {{yPeak}}) m', allowed)
    expect(tpl.ok).toBe(true)
    if (tpl.ok) {
      expect(renderTemplateText(tpl.segments, { xPeak: 12.5, yPeak: 8.001 })).toBe(
        '顶点 (12.5, 8) m',
      )
    }

    const tooMany = compileTemplateText('{{xPeak}}{{xPeak}}{{xPeak}}{{xPeak}}{{xPeak}}', allowed)
    expect(tooMany.ok).toBe(false)
  })
})
