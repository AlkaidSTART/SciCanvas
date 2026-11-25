// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { generateExperiment } from './generate'
import type { AiServerConfig } from './generate'

const spec = {
  title: '阻尼单摆',
  domain: 'Physics / Mechanics',
  formulaLatex: '\\ddot{\\theta} + \\gamma\\dot{\\theta} + \\omega^2\\theta = 0',
  insight: '观察阻尼系数如何让摆幅逐渐衰减。',
  renderType: 'canvas2d',
  controls: [
    { type: 'slider', key: 'damping', label: '阻尼', min: 0, max: 2, step: 0.01, default: 0.2 },
  ],
  legend: [{ label: '摆角', color: '#4F7292' }],
  simulationCode: `return {
    createState: function () { return { t: 0 } },
    step: function (state) { return { t: state.t + 1 } },
    draw: function () {}
  }`,
}

const config: AiServerConfig = {
  apiKey: 'sk-test-secret',
  baseUrl: 'https://api.example.test/v1/',
  model: 'test-model',
  timeoutMs: 1_000,
}

function completion(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('generateExperiment（服务端）', () => {
  it('转发请求、校验模型输出并隐藏凭证', async () => {
    let requestUrl = ''
    let requestInit: RequestInit | undefined
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(url)
      requestInit = init
      return completion(JSON.stringify(spec))
    }) as typeof fetch

    const result = await generateExperiment({ prompt: '模拟阻尼单摆' }, { ...config, fetchImpl })

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    if (result.body.ok) {
      expect(result.body.spec.title).toBe('阻尼单摆')
      expect(result.body.spec.controls).toHaveLength(1)
    }

    expect(requestUrl).toBe('https://api.example.test/v1/chat/completions')
    const headers = requestInit?.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer sk-test-secret')
    const body = JSON.parse(String(requestInit?.body)) as Record<string, unknown>
    expect(body.model).toBe('test-model')
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(Array.isArray(body.messages)).toBe(true)

    expect(JSON.stringify(result.body)).not.toContain('sk-test-secret')
  })

  it('接受带 Markdown 围栏的 JSON', async () => {
    const fetchImpl = (async () =>
      completion('```json\n' + JSON.stringify(spec) + '\n```')) as typeof fetch
    const result = await generateExperiment({ prompt: 'x' }, { ...config, fetchImpl })
    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
  })

  it('未配置凭证时直接返回 not_configured 且不请求上游', async () => {
    const fetchImpl = vi.fn()
    const result = await generateExperiment({ prompt: 'x' }, { ...config, apiKey: undefined, fetchImpl })
    expect(result.status).toBe(503)
    expect(result.body).toMatchObject({ ok: false, error: { code: 'not_configured' } })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('拒绝空输入与超长输入', async () => {
    const fetchImpl = vi.fn()
    const empty = await generateExperiment({}, { ...config, fetchImpl })
    expect(empty.status).toBe(400)
    if (!empty.body.ok) expect(empty.body.error.code).toBe('bad_request')

    const tooLong = await generateExperiment(
      { prompt: 'x'.repeat(4_001) },
      { ...config, fetchImpl },
    )
    expect(tooLong.status).toBe(400)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('映射上游 429', async () => {
    const fetchImpl = (async () => new Response('', { status: 429 })) as typeof fetch
    const result = await generateExperiment({ prompt: 'x' }, { ...config, fetchImpl })
    expect(result.status).toBe(429)
    if (!result.body.ok) expect(result.body.error.code).toBe('rate_limit')
  })

  it('上游凭证错误不泄露响应体', async () => {
    const fetchImpl = (async () =>
      new Response('sk-test-secret invalid', { status: 401 })) as typeof fetch
    const result = await generateExperiment({ prompt: 'x' }, { ...config, fetchImpl })
    expect(result.status).toBe(502)
    expect(result.body).toMatchObject({ ok: false, error: { code: 'not_configured' } })
    expect(JSON.stringify(result.body)).not.toContain('sk-test-secret')
  })

  it('上游超时返回 timeout', async () => {
    const fetchImpl = ((_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })) as typeof fetch
    const result = await generateExperiment(
      { prompt: 'x' },
      { ...config, timeoutMs: 10, fetchImpl },
    )
    expect(result.status).toBe(504)
    if (!result.body.ok) expect(result.body.error.code).toBe('timeout')
  })

  it('模型返回非 JSON 文本时返回 invalid_json', async () => {
    const fetchImpl = (async () => completion('这不是 JSON')) as typeof fetch
    const result = await generateExperiment({ prompt: 'x' }, { ...config, fetchImpl })
    expect(result.status).toBe(502)
    if (!result.body.ok) expect(result.body.error.code).toBe('invalid_json')
  })

  it('模型输出不符合 Schema 时返回 schema_invalid', async () => {
    const fetchImpl = (async () =>
      completion(JSON.stringify({ title: '只有标题' }))) as typeof fetch
    const result = await generateExperiment({ prompt: 'x' }, { ...config, fetchImpl })
    expect(result.status).toBe(502)
    if (!result.body.ok) expect(result.body.error.code).toBe('schema_invalid')
  })
})
