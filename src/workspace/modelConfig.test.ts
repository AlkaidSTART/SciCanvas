import { describe, expect, it } from 'vitest'
import { createModelConfig, maskApiKey, normalizeModelConfig, validateModelConfig } from './modelConfig'

describe('M7 模型配置', () => {
  it('规范化并去除端点末尾斜杠', () => {
    const result = validateModelConfig({
      apiKey: '  sk-test  ',
      baseUrl: ' https://api.example.com/v1/ ',
      model: ' gpt-4o-mini ',
    })
    expect(result).toEqual({
      ok: true,
      value: {
        apiKey: 'sk-test',
        baseUrl: 'https://api.example.com/v1',
        model: 'gpt-4o-mini',
      },
    })
  })

  it('拒绝非法端点与超长字段', () => {
    expect(validateModelConfig({ apiKey: '', baseUrl: 'not-a-url', model: '' })).toMatchObject({
      ok: false,
    })
    expect(
      validateModelConfig({ apiKey: '', baseUrl: 'ftp://example.com', model: '' }),
    ).toMatchObject({ ok: false })
    expect(
      validateModelConfig({ apiKey: 'x'.repeat(513), baseUrl: '', model: '' }),
    ).toMatchObject({ ok: false })
  })

  it('允许全部留空，表示使用部署方默认模型', () => {
    expect(validateModelConfig({ apiKey: '', baseUrl: '', model: '' })).toEqual({
      ok: true,
      value: { apiKey: '', baseUrl: '', model: '' },
    })
  })

  it('写入配置带独立结构版本，未知版本读取为 null', () => {
    const config = createModelConfig(
      { apiKey: 'sk-12345678', baseUrl: '', model: '' },
      1234,
    )
    expect(config).toMatchObject({ version: 1, updatedAt: 1234 })
    expect(normalizeModelConfig(config)).toEqual(config)
    expect(normalizeModelConfig({ ...config, version: 9 })).toBeNull()
    expect(normalizeModelConfig({ version: 1, apiKey: 1 })).toBeNull()
  })

  it('界面摘要只暴露密钥末四位', () => {
    expect(maskApiKey('sk-12345678')).toBe('••••5678')
    expect(maskApiKey('short')).toBe('••••')
    expect(maskApiKey('')).toBe('')
  })
})
