// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { MAX_IMAGE_BYTES } from '../src/ai/image.ts'
import type { AiServerConfig } from './generate.ts'
import { recognizePaperImage } from './recognize.ts'

const tinyPng =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

const recognition = {
  formulaLatex: '\\frac{dN}{dt} = rN\\left(1-\\frac{N}{K}\\right)',
  description: '逻辑斯蒂增长：观察增长率 r 与容纳量 K 对种群曲线的影响。',
  variables: [
    { symbol: 'N', meaning: '种群数量' },
    { symbol: 'K', meaning: '环境容纳量' },
  ],
  uncertain: ['图中 r 的单位不清晰'],
  confidence: 0.86,
}

const config: AiServerConfig = {
  apiKey: 'sk-test-secret',
  baseUrl: 'https://api.example.test/v1/',
  model: 'text-model',
  visionModel: 'vision-model',
  timeoutMs: 1_000,
}

function completion(content: unknown): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function oversizedDataUrl(): string {
  const base64Length = Math.ceil(((MAX_IMAGE_BYTES + 1) * 4) / 3)
  return `data:image/png;base64,${'A'.repeat(base64Length)}`
}

describe('recognizePaperImage（服务端）', () => {
  it('以多模态消息转发图片、使用视觉模型并隐藏凭证', async () => {
    let requestUrl = ''
    let requestInit: RequestInit | undefined
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(url)
      requestInit = init
      return completion(JSON.stringify(recognition))
    }) as typeof fetch

    const result = await recognizePaperImage({ image: tinyPng }, { ...config, fetchImpl })

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    if (result.body.ok) {
      expect(result.body.recognition.formulaLatex).toBe(recognition.formulaLatex)
      expect(result.body.recognition.variables).toHaveLength(2)
      expect(result.body.recognition.confidence).toBe(0.86)
    }

    expect(requestUrl).toBe('https://api.example.test/v1/chat/completions')
    const headers = requestInit?.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer sk-test-secret')

    const body = JSON.parse(String(requestInit?.body)) as Record<string, unknown>
    expect(body.model).toBe('vision-model')
    expect(body.response_format).toEqual({ type: 'json_object' })
    const messages = body.messages as Array<{ role: string; content: unknown }>
    expect(messages[0].role).toBe('system')
    expect(messages[1].role).toBe('user')
    const parts = messages[1].content as Array<Record<string, unknown>>
    expect(parts[0]).toMatchObject({ type: 'text' })
    expect(parts[1]).toMatchObject({ type: 'image_url', image_url: { url: tinyPng } })

    expect(JSON.stringify(result.body)).not.toContain('sk-test-secret')
    expect(JSON.stringify(result.body)).not.toContain('data:image')
  })

  it('未配置视觉模型时回退到文本模型', async () => {
    let requestInit: RequestInit | undefined
    const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      requestInit = init
      return completion(JSON.stringify(recognition))
    }) as typeof fetch

    const result = await recognizePaperImage(
      { image: tinyPng },
      { ...config, visionModel: undefined, fetchImpl },
    )
    expect(result.status).toBe(200)
    const body = JSON.parse(String(requestInit?.body)) as Record<string, unknown>
    expect(body.model).toBe('text-model')
  })

  it('支持分段文本内容的响应', async () => {
    const fetchImpl = (async () =>
      completion([{ type: 'text', text: JSON.stringify(recognition) }])) as typeof fetch
    const result = await recognizePaperImage({ image: tinyPng }, { ...config, fetchImpl })
    expect(result.status).toBe(200)
  })

  it('未配置凭证时返回 not_configured 且不请求上游', async () => {
    const fetchImpl = vi.fn()
    const result = await recognizePaperImage(
      { image: tinyPng },
      { ...config, apiKey: undefined, fetchImpl },
    )
    expect(result.status).toBe(503)
    expect(result.body).toMatchObject({ ok: false, error: { code: 'not_configured' } })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('拒绝缺失、非图片与不支持格式的输入', async () => {
    const fetchImpl = vi.fn()

    const missing = await recognizePaperImage({}, { ...config, fetchImpl })
    expect(missing.status).toBe(400)
    if (!missing.body.ok) expect(missing.body.error.code).toBe('image_invalid')

    const remote = await recognizePaperImage(
      { image: 'https://example.test/paper.png' },
      { ...config, fetchImpl },
    )
    expect(remote.status).toBe(400)

    const gif = await recognizePaperImage(
      { image: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' },
      { ...config, fetchImpl },
    )
    expect(gif.status).toBe(400)
    if (!gif.body.ok) expect(gif.body.error.code).toBe('image_invalid')

    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('超过 4 MB 的图片返回 413 且不请求上游', async () => {
    const fetchImpl = vi.fn()
    const result = await recognizePaperImage(
      { image: oversizedDataUrl() },
      { ...config, fetchImpl },
    )
    expect(result.status).toBe(413)
    if (!result.body.ok) {
      expect(result.body.error.code).toBe('image_too_large')
      expect(result.body.error.message).toContain('4 MB')
    }
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('映射上游限额、凭证错误与超时', async () => {
    const limited = await recognizePaperImage(
      { image: tinyPng },
      { ...config, fetchImpl: (async () => new Response('', { status: 429 })) as typeof fetch },
    )
    expect(limited.status).toBe(429)
    if (!limited.body.ok) expect(limited.body.error.code).toBe('rate_limit')

    const unauthorized = await recognizePaperImage(
      { image: tinyPng },
      {
        ...config,
        fetchImpl: (async () => new Response('sk-test-secret invalid', { status: 401 })) as typeof fetch,
      },
    )
    expect(unauthorized.status).toBe(502)
    if (!unauthorized.body.ok) expect(unauthorized.body.error.code).toBe('not_configured')
    expect(JSON.stringify(unauthorized.body)).not.toContain('sk-test-secret')

    const timeoutImpl = ((_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })) as typeof fetch
    const timedOut = await recognizePaperImage(
      { image: tinyPng },
      { ...config, timeoutMs: 10, fetchImpl: timeoutImpl },
    )
    expect(timedOut.status).toBe(504)
    if (!timedOut.body.ok) expect(timedOut.body.error.code).toBe('timeout')
  })

  it('模型返回非 JSON 或无效结构时给出明确错误', async () => {
    const notJson = await recognizePaperImage(
      { image: tinyPng },
      { ...config, fetchImpl: (async () => completion('这不是 JSON')) as typeof fetch },
    )
    expect(notJson.status).toBe(502)
    if (!notJson.body.ok) expect(notJson.body.error.code).toBe('invalid_json')

    const empty = await recognizePaperImage(
      { image: tinyPng },
      {
        ...config,
        fetchImpl: (async () =>
          completion(JSON.stringify({ formulaLatex: ' ', description: ' ' }))) as typeof fetch,
      },
    )
    expect(empty.status).toBe(502)
    if (!empty.body.ok) expect(empty.body.error.code).toBe('schema_invalid')
  })
})
