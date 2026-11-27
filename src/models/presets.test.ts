import { describe, expect, it } from 'vitest'
import { LLM_PRESET_TEMPLATES, validateLlmEndpointInput } from './presets'

describe('LLM presets and validation', () => {
  it('includes DeepSeek, Doubao, and Qwen presets', () => {
    const ids = LLM_PRESET_TEMPLATES.map((item) => item.providerId)
    expect(ids).toContain('deepseek')
    expect(ids).toContain('doubao')
    expect(ids).toContain('qwen')
  })

  it('validates and normalizes endpoint inputs', () => {
    const valid = validateLlmEndpointInput({
      name: '  我的千问  ',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1///',
      apiKey: '  sk-qwen-123  ',
      model: ' qwen-plus ',
      visionModel: ' qwen-vl-max ',
      apiFormat: 'chat',
    })
    expect(valid.ok).toBe(true)
    if (valid.ok) {
      expect(valid.value.name).toBe('我的千问')
      expect(valid.value.baseUrl).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1')
      expect(valid.value.apiKey).toBe('sk-qwen-123')
      expect(valid.value.model).toBe('qwen-plus')
      expect(valid.value.visionModel).toBe('qwen-vl-max')
    }
  })

  it('rejects invalid URLs and unsupported formats', () => {
    const badUrl = validateLlmEndpointInput({
      name: 'Bad',
      baseUrl: 'not-a-url',
      apiKey: 'sk-1',
      model: 'm',
      apiFormat: 'chat',
    })
    expect(badUrl.ok).toBe(false)

    const badFormat = validateLlmEndpointInput({
      name: 'BadFmt',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-1',
      model: 'm',
      apiFormat: 'unknown' as 'chat',
    })
    expect(badFormat.ok).toBe(false)
  })

  it('allows empty model name when configuring an endpoint', () => {
    const valid = validateLlmEndpointInput({
      name: '自定义网关',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-custom',
      model: '',
      apiFormat: 'chat',
    })
    expect(valid.ok).toBe(true)
    if (valid.ok) {
      expect(valid.value.model).toBe('')
    }
  })
})
