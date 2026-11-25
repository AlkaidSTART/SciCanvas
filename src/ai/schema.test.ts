import { describe, expect, it } from 'vitest'
import { compileSimulationCode, validateGeneratedSpec } from './schema'

const validCode = `return {
  createState: function () { return { t: 0 } },
  step: function (state) { return { t: state.t + 1 } },
  draw: function (ctx, state, params, viewport) {
    ctx.clearRect(0, 0, viewport.width, viewport.height)
  }
}`

export function makeSpec(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: '阻尼单摆',
    domain: 'Physics / Mechanics',
    formulaLatex: '\\ddot{\\theta} + \\gamma\\dot{\\theta} + \\omega^2\\theta = 0',
    insight: '观察阻尼系数如何让摆幅逐渐衰减。',
    renderType: 'canvas2d',
    controls: [
      { type: 'slider', key: 'damping', label: '阻尼', min: 0, max: 2, step: 0.01, default: 0.2 },
      { type: 'toggle', key: 'trail', label: '轨迹', default: true },
    ],
    legend: [{ label: '摆角', color: '#4F7292' }],
    simulationCode: validCode,
    ...overrides,
  }
}

describe('validateGeneratedSpec', () => {
  it('接受结构完整、可编译的生成结果', () => {
    const result = validateGeneratedSpec(makeSpec())
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.spec.title).toBe('阻尼单摆')
      expect(result.spec.renderType).toBe('canvas2d')
      expect(result.spec.controls).toHaveLength(2)
    }
  })

  it('拒绝缺失或为空的标题', () => {
    const result = validateGeneratedSpec(makeSpec({ title: '  ' }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues.join()).toContain('title')
  })

  it('拒绝超过上限的控件数量', () => {
    const controls = Array.from({ length: 7 }, (_, index) => ({
      type: 'toggle',
      key: `flag${index}`,
      label: `开关 ${index}`,
      default: true,
    }))
    const result = validateGeneratedSpec(makeSpec({ controls }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues.join()).toContain('controls 最多支持')
  })

  it('拒绝越界的滑动条配置', () => {
    const result = validateGeneratedSpec(
      makeSpec({
        controls: [
          { type: 'slider', key: 'gain', label: '增益', min: 5, max: 1, step: 0, default: 9 },
        ],
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues.join()).toContain('min')
  })

  it('拒绝重复或不安全的控件 key', () => {
    const duplicated = validateGeneratedSpec(
      makeSpec({
        controls: [
          { type: 'toggle', key: 'same', label: 'A', default: true },
          { type: 'toggle', key: 'same', label: 'B', default: false },
        ],
      }),
    )
    expect(duplicated.ok).toBe(false)

    const unsafe = validateGeneratedSpec(
      makeSpec({ controls: [{ type: 'toggle', key: 'bad-key', label: 'A', default: true }] }),
    )
    expect(unsafe.ok).toBe(false)
    if (!unsafe.ok) expect(unsafe.issues.join()).toContain('bad-key')
  })

  it('拒绝语法错误的仿真代码', () => {
    const result = validateGeneratedSpec(makeSpec({ simulationCode: 'return {' }))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues.join()).toContain('simulationCode')
      expect(result.issues.join()).toContain('语法错误')
    }
  })

  it('拒绝超长仿真代码', () => {
    const result = validateGeneratedSpec(makeSpec({ simulationCode: `// ${'x'.repeat(20_001)}` }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues.join()).toContain('simulationCode')
  })

  it('拒绝非法图例', () => {
    const result = validateGeneratedSpec(makeSpec({ legend: [{ label: '', color: '#fff' }] }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues.join()).toContain('legend')
  })

  it('拒绝非对象输入', () => {
    expect(validateGeneratedSpec(null).ok).toBe(false)
    expect(validateGeneratedSpec([]).ok).toBe(false)
    expect(validateGeneratedSpec('spec').ok).toBe(false)
  })

  it('校验阶段只编译不执行生成代码', () => {
    const marker = '__scicanvas_validation_executed__'
    const globalRecord = globalThis as Record<string, unknown>
    delete globalRecord[marker]

    const result = validateGeneratedSpec(
      makeSpec({
        simulationCode: `globalThis.${marker} = true;\n${validCode}`,
      }),
    )

    expect(result.ok).toBe(true)
    expect(globalRecord[marker]).toBeUndefined()
  })
})

describe('compileSimulationCode', () => {
  it('编译后可显式实例化模型', () => {
    const compiled = compileSimulationCode(validCode)
    expect(compiled.ok).toBe(true)
    if (compiled.ok) {
      const model = compiled.factory()
      expect(model.createState({})).toEqual({ t: 0 })
    }
  })

  it('语法错误返回可读信息', () => {
    const compiled = compileSimulationCode('return {')
    expect(compiled.ok).toBe(false)
    if (!compiled.ok) expect(compiled.message.length).toBeGreaterThan(0)
  })
})
