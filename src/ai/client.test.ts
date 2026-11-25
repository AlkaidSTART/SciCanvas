import { describe, expect, it, vi } from 'vitest'
import { AiGenerationError, generateExperiment } from './client'

const validSpec = {
  title: '阻尼单摆',
  domain: 'Physics / Mechanics',
  formulaLatex: '\\ddot{\\theta} + \\gamma\\dot{\\theta} + \\omega^2\\theta = 0',
  insight: '观察阻尼系数如何让摆幅逐渐衰减。',
  renderType: 'canvas2d',
  controls: [
    { type: 'slider', key: 'damping', label: '阻尼', min: 0, max: 2, step: 0.01, default: 0.2 },
  ],
  simulationCode: `return {
    createState: function () { return { t: 0 } },
    step: function (state) { return { t: state.t + 1 } },
    draw: function () {}
  }`,
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

function brokenResponse(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      throw new Error('not json')
    },
  } as unknown as Response
}

describe('generateExperiment', () => {
  it('成功返回并通过客户端二次校验', async () => {
    const calls: Array<{ url: RequestInfo | URL; init?: RequestInit }> = []
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url, init })
      return jsonResponse({ ok: true, spec: validSpec })
    }) as typeof fetch
    const spec = await generateExperiment('模拟阻尼单摆', { fetchImpl })

    expect(spec.title).toBe('阻尼单摆')
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('/api/generate')
    expect(calls[0].init?.method).toBe('POST')
    const body = JSON.parse(String(calls[0].init?.body)) as Record<string, unknown>
    expect(body).toEqual({ prompt: '模拟阻尼单摆' })
    expect(String(calls[0].init?.body)).not.toContain('sk-')
  })

  it('空描述不会发起请求', async () => {
    const fetchImpl = vi.fn()
    await expect(
      generateExperiment('   ', { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({ code: 'bad_request' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('映射服务端限额与未配置错误', async () => {
    const rateLimited = vi.fn(async () => brokenResponse(429))
    await expect(
      generateExperiment('x', { fetchImpl: rateLimited as unknown as typeof fetch }),
    ).rejects.toMatchObject({ code: 'rate_limit' })

    const notConfigured = vi.fn(async () =>
      jsonResponse(
        { ok: false, error: { code: 'not_configured', message: '服务端尚未配置模型凭证' } },
        503,
      ),
    )
    const error = await generateExperiment('x', {
      fetchImpl: notConfigured as unknown as typeof fetch,
    }).catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(AiGenerationError)
    expect(error).toMatchObject({ code: 'not_configured' })
  })

  it('无法解析的响应返回 invalid_json', async () => {
    const fetchImpl = vi.fn(async () => brokenResponse(200))
    await expect(
      generateExperiment('x', { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({ code: 'invalid_json' })
  })

  it('Schema 不合法的模型输出不会进入运行态', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true, spec: { title: '只有标题' } }))
    await expect(
      generateExperiment('x', { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({ code: 'schema_invalid' })
  })

  it('网络失败返回 network', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(
      generateExperiment('x', { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({ code: 'network' })
  })

  it('调用方取消返回 aborted', async () => {
    const fetchImpl = (() =>
      new Promise<Response>((_resolve, reject) => {
        setTimeout(() => reject(new Error('aborted')), 50)
      })) as typeof fetch
    const controller = new AbortController()
    const promise = generateExperiment('x', {
      fetchImpl,
      signal: controller.signal,
      timeoutMs: 5_000,
    })
    controller.abort()
    await expect(promise).rejects.toMatchObject({ code: 'aborted' })
  })

  it('超过客户端超时返回 timeout', async () => {
    const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })) as typeof fetch
    await expect(
      generateExperiment('x', { fetchImpl, timeoutMs: 10 }),
    ).rejects.toMatchObject({ code: 'timeout' })
  })
})
