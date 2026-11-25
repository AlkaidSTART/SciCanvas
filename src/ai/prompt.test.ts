import { describe, expect, it } from 'vitest'
import { MAX_PROMPT_LENGTH, buildGenerationMessages } from './prompt'

describe('buildGenerationMessages', () => {
  it('包含系统约束与用户原始描述', () => {
    const messages = buildGenerationMessages('  模拟一个阻尼单摆  ')
    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('system')
    expect(messages[1]).toEqual({ role: 'user', content: '模拟一个阻尼单摆' })

    const system = messages[0].content
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
})
