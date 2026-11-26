import { describe, expect, it } from 'vitest'
import { formatCapturedFormulaAppend } from './bridge'

describe('formatCapturedFormulaAppend', () => {
  it('inserts trimmed formula when existing prompt is empty', () => {
    const result = formatCapturedFormulaAppend('   ', '  E = mc^2  ', 200)
    expect(result).toEqual({
      nextPrompt: 'E = mc^2',
      appended: true,
      truncated: false,
    })
  })

  it('appends formula on a new line when prompt already has text', () => {
    const result = formatCapturedFormulaAppend('阻尼振子模型：  ', '\\ddot{x} + 2\\zeta\\omega_0\\dot{x} + \\omega_0^2 x = 0', 200)
    expect(result).toEqual({
      nextPrompt: '阻尼振子模型：\n\\ddot{x} + 2\\zeta\\omega_0\\dot{x} + \\omega_0^2 x = 0',
      appended: true,
      truncated: false,
    })
  })

  it('ignores blank formula input', () => {
    const result = formatCapturedFormulaAppend('已有描述', '   \n\t  ', 200)
    expect(result).toEqual({
      nextPrompt: '已有描述',
      appended: false,
      truncated: false,
    })
  })

  it('truncates gracefully when exceeding maxLength', () => {
    const result = formatCapturedFormulaAppend('已有描述', 'a'.repeat(30), 12)
    expect(result.nextPrompt.length).toBe(12)
    expect(result.appended).toBe(true)
    expect(result.truncated).toBe(true)
  })
})
