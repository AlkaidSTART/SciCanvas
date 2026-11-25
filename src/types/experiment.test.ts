import { describe, expect, it } from 'vitest'
import { assertValidExperiment, validateExperiment } from './experiment'
import { dampedOscillator } from '../experiments/dampedOscillator'

const model = {
  createState: () => ({ value: 0 }),
  step: (state: { value: number }) => state,
  draw: () => {},
}

function makeExperiment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'test-experiment',
    title: '测试实验',
    domain: 'Test / Unit',
    formulaLatex: 'x = 1',
    insight: '用于验证 Schema 的实验。',
    renderType: 'canvas2d',
    controls: [
      { type: 'slider', key: 'gain', label: '增益', min: 0, max: 10, step: 0.1, default: 1 },
    ],
    model,
    ...overrides,
  }
}

describe('validateExperiment', () => {
  it('接受内置基准实验', () => {
    const result = validateExperiment(dampedOscillator)
    expect(result.ok).toBe(true)
  })

  it('接受结构完整的最小实验', () => {
    const result = validateExperiment(makeExperiment())
    expect(result.ok).toBe(true)
  })

  it('拒绝缺失必填字段的定义', () => {
    const result = validateExperiment(makeExperiment({ title: '   ' }))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues.join()).toContain('title')
    }
  })

  it('拒绝非 canvas2d 的渲染类型', () => {
    const result = validateExperiment(makeExperiment({ renderType: 'threejs' }))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues.join()).toContain('renderType')
    }
  })

  it('拒绝越界或非法的滑动条配置', () => {
    const result = validateExperiment(
      makeExperiment({
        controls: [
          { type: 'slider', key: 'gain', label: '增益', min: 5, max: 1, step: 0, default: 9 },
        ],
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues.join()).toContain('min')
      expect(result.issues.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('拒绝重复的控件 key', () => {
    const result = validateExperiment(
      makeExperiment({
        controls: [
          { type: 'slider', key: 'gain', label: '增益', min: 0, max: 1, step: 0.1, default: 0.5 },
          { type: 'toggle', key: 'gain', label: '重复键', default: true },
        ],
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues.join()).toContain('重复')
    }
  })

  it('拒绝缺失模型生命周期方法的定义', () => {
    const result = validateExperiment(makeExperiment({ model: { createState: model.createState } }))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues.join()).toContain('model.step')
      expect(result.issues.join()).toContain('model.draw')
    }
  })

  it('assertValidExperiment 对非法定义抛出详细信息', () => {
    expect(() => assertValidExperiment(makeExperiment({ id: '' }))).toThrowError(/校验失败/)
  })
})
