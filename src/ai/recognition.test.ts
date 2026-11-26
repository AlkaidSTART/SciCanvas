import { describe, expect, it } from 'vitest'
import { buildRecognitionPrompt, normalizeRecognition } from './recognition'
import type { RecognitionResult } from './recognition'

const valid: RecognitionResult = {
  formulaLatex: '\\frac{dN}{dt} = rN\\left(1-\\frac{N}{K}\\right)',
  description: '逻辑斯蒂增长模型，观察增长率与环境容纳量的影响。',
  variables: [
    { symbol: 'N', meaning: '种群数量' },
    { symbol: 'K', meaning: '环境容纳量' },
  ],
  uncertain: ['图中 r 的单位不清晰'],
  confidence: 0.82,
}

describe('识别结果校验', () => {
  it('接受完整结果并去除首尾空白', () => {
    const result = normalizeRecognition({
      ...valid,
      formulaLatex: `  ${valid.formulaLatex}  `,
      description: ` ${valid.description} `,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.result.formulaLatex).toBe(valid.formulaLatex)
      expect(result.result.description).toBe(valid.description)
      expect(result.result.variables).toHaveLength(2)
      expect(result.result.uncertain).toEqual(['图中 r 的单位不清晰'])
      expect(result.result.confidence).toBe(0.82)
    }
  })

  it('缺少变量或不确定项时使用空数组', () => {
    const result = normalizeRecognition({
      formulaLatex: 'a^2+b^2=c^2',
      description: '勾股定理',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.result.variables).toEqual([])
      expect(result.result.uncertain).toEqual([])
      expect(result.result.confidence).toBeUndefined()
    }
  })

  it('公式与说明都为空时拒绝', () => {
    const result = normalizeRecognition({ formulaLatex: '  ', description: '   ' })
    expect(result.ok).toBe(false)
  })

  it('拒绝非法字段类型与超量变量', () => {
    expect(normalizeRecognition(null)).toMatchObject({ ok: false })
    expect(normalizeRecognition({ formulaLatex: 1, description: 'x' })).toMatchObject({
      ok: false,
    })
    expect(
      normalizeRecognition({
        formulaLatex: 'x',
        variables: Array.from({ length: 13 }, () => ({ symbol: 'a', meaning: 'b' })),
      }),
    ).toMatchObject({ ok: false })
    expect(normalizeRecognition({ formulaLatex: 'x', confidence: 'high' })).toMatchObject({
      ok: false,
    })
  })

  it('把置信度限制在 0 到 1', () => {
    const high = normalizeRecognition({ formulaLatex: 'x', description: '', confidence: 1.6 })
    expect(high.ok && high.result.confidence).toBe(1)
    const low = normalizeRecognition({ formulaLatex: 'x', description: '', confidence: -0.3 })
    expect(low.ok && low.result.confidence).toBe(0)
  })
})

describe('把确认后的识别内容转为生成请求', () => {
  it('包含公式、说明、变量与需确认项', () => {
    const prompt = buildRecognitionPrompt(valid)
    expect(prompt).toContain(valid.formulaLatex)
    expect(prompt).toContain(valid.description)
    expect(prompt).toContain('N：种群数量')
    expect(prompt).toContain('图中 r 的单位不清晰')
    expect(prompt).toContain('请根据以下论文截图识别结果生成一个可交互实验')
  })

  it('完全为空时返回空字符串', () => {
    expect(
      buildRecognitionPrompt({
        formulaLatex: ' ',
        description: ' ',
        variables: [],
        uncertain: [],
      }),
    ).toBe('')
  })
})
