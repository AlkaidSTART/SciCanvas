import { describe, expect, it } from 'vitest'
import { MAX_PROMPT_LENGTH, buildGenerationMessages } from './prompt'
import type { GeneratedExperimentSpec } from './schema'

const spec: GeneratedExperimentSpec = {
  title: '阻尼单摆',
  domain: 'Physics / Mechanics',
  formulaLatex: '\\ddot{\\theta} + \\gamma\\dot{\\theta} + \\omega^2\\theta = 0',
  insight: '观察阻尼衰减。',
  renderType: 'canvas2d',
  controls: [
    { type: 'slider', key: 'damping', label: '阻尼', min: 0, max: 2, step: 0.01, default: 0.2 },
  ],
  simulationCode: `return {
    createState: function () { return {} },
    step: function (state) { return state },
    draw: function () {}
  }`,
}

describe('buildGenerationMessages', () => {
  it('包含系统约束与用户原始描述', () => {
    const messages = buildGenerationMessages('  模拟一个阻尼单摆  ')
    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('system')
    expect(messages[1]).toEqual({ role: 'user', content: '模拟一个阻尼单摆' })

    const system = messages[0].content
    expect(system).toContain('scene2d')
    expect(system).toContain('公式场景建模 Skill')
    expect(system).toContain('力学与波动场景')
    expect(system).toContain('simulationCode')
    expect(system).toContain('createState')
    expect(system).toContain('step')
    expect(system).toContain('draw')
    expect(system).toContain('JSON')
    expect(system).toContain('禁止访问 window')
  })

  it('声明与服务端一致的输入长度上限', () => {
    expect(MAX_PROMPT_LENGTH).toBe(4000)
  })

  it('微调模式只携带当前 Schema、参数与指令', () => {
    const messages = buildGenerationMessages({
      prompt: '  加入随机噪声  ',
      mode: 'refine',
      currentSpec: spec,
      currentParams: { damping: 0.4 },
    })

    expect(messages[0].content).toContain('增量修改')
    const payload = JSON.parse(messages[1].content) as Record<string, unknown>
    expect(payload).toEqual({
      instruction: '加入随机噪声',
      currentSpec: spec,
      currentParams: { damping: 0.4 },
    })
    expect(messages[1].content).not.toContain('历史')
  })

  it('修复模式携带诊断与当前 Schema', () => {
    const messages = buildGenerationMessages({
      prompt: '',
      mode: 'repair',
      currentSpec: spec,
      diagnostic: { stage: 'init', message: 'x is not defined', attempt: 1 },
    })

    expect(messages[0].content).toContain('错误修复')
    const payload = JSON.parse(messages[1].content) as Record<string, unknown>
    expect(payload.diagnostic).toEqual({ stage: 'init', message: 'x is not defined', attempt: 1 })
    expect(payload.currentSpec).toEqual(spec)
    expect(String(payload.instruction).length).toBeGreaterThan(0)
  })

  it('创建模式保持原有用户内容格式', () => {
    const messages = buildGenerationMessages({ prompt: '模拟单摆', mode: 'create' })
    expect(messages[1]).toEqual({ role: 'user', content: '模拟单摆' })
  })
})
