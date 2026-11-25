import { describe, expect, it } from 'vitest'
import {
  coerceControlValue,
  createDefaultParams,
  describeControlValue,
  sanitizeParams,
  snapSliderValue,
} from './params'
import { dampedOscillator } from '../experiments/dampedOscillator'

describe('参数控件', () => {
  it('按 Schema 生成默认参数', () => {
    const params = createDefaultParams(dampedOscillator)
    expect(params).toEqual({
      damping: 0.24,
      omega: 1.5,
      force: 0.6,
      showPhase: true,
    })
  })

  it('把滑动条数值对齐到步长', () => {
    const control = { type: 'slider' as const, key: 'k', label: 'k', min: 0.08, max: 2, step: 0.02, default: 0.24 }
    expect(snapSliderValue(control, 0.333)).toBe(0.34)
    expect(snapSliderValue(control, 99)).toBe(2)
    expect(snapSliderValue(control, -1)).toBe(0.08)
  })

  it('裁剪越界参数、补齐缺失项并丢弃未知键', () => {
    const params = sanitizeParams(dampedOscillator, {
      damping: 12,
      omega: Number.NaN,
      showPhase: 'yes',
      unknownKey: 42,
    })
    expect(params.damping).toBe(2)
    expect(params.omega).toBe(1.5)
    expect(params.force).toBe(0.6)
    expect(params.showPhase).toBe(true)
    expect('unknownKey' in params).toBe(false)
  })

  it('接受合法布尔值与下拉选项', () => {
    const toggle = dampedOscillator.controls.find((control) => control.type === 'toggle')
    if (!toggle || toggle.type !== 'toggle') throw new Error('缺少 toggle 控件')
    expect(coerceControlValue(toggle, false)).toBe(false)

    const select = {
      type: 'select' as const,
      key: 'mode',
      label: '模式',
      options: [
        { value: 'a', label: '模式 A' },
        { value: 'b', label: '模式 B' },
      ],
      default: 'a',
    }
    expect(coerceControlValue(select, 'b')).toBe('b')
    expect(coerceControlValue(select, 'c')).toBe('a')
  })

  it('数值展示使用固定小数位与单位', () => {
    const damping = dampedOscillator.controls.find((control) => control.key === 'damping')
    const omega = dampedOscillator.controls.find((control) => control.key === 'omega')
    if (!damping || !omega) throw new Error('缺少内置控件')
    expect(describeControlValue(damping, 0.24)).toBe('0.24 N·s/m')
    expect(describeControlValue(omega, 1.5)).toBe('1.50 rad/s')
  })
})
