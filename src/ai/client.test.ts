import { describe, expect, it, vi } from 'vitest'
import { AiGenerationError, generateExperiment, recognizeImage } from './client'
import type { GeneratedExperimentSpec } from './schema'

const validSpec: GeneratedExperimentSpec = {
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

describe('增量修改与修复请求', () => {
  it('微调请求携带当前 Schema、当前参数与指令', async () => {
    let body: Record<string, unknown> = {}
    const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>
      return jsonResponse({ ok: true, spec: validSpec })
    }) as typeof fetch

    const spec = await generateExperiment(
      {
        prompt: '  加入随机噪声  ',
        mode: 'refine',
        currentSpec: validSpec,
        currentParams: { damping: 0.2, trail: true },
      },
      { fetchImpl },
    )

    expect(spec.title).toBe('阻尼单摆')
    expect(body).toMatchObject({
      prompt: '加入随机噪声',
      mode: 'refine',
      currentParams: { damping: 0.2, trail: true },
    })
    expect(body.currentSpec).toEqual(validSpec)
    expect(String(JSON.stringify(body))).not.toContain('sk-')
  })

  it('修复请求携带最小诊断，缺省指令使用稳定文案', async () => {
    let body: Record<string, unknown> = {}
    const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>
      return jsonResponse({ ok: true, spec: validSpec })
    }) as typeof fetch

    await generateExperiment(
      {
        prompt: '   ',
        mode: 'repair',
        currentSpec: validSpec,
        diagnostic: { stage: 'first-frame', message: '首帧绘制失败', attempt: 1 },
      },
      { fetchImpl },
    )

    expect(typeof body.prompt).toBe('string')
    expect(String(body.prompt).length).toBeGreaterThan(0)
    expect(body).toMatchObject({ mode: 'repair' })
    expect(body.currentSpec).toEqual(validSpec)
    expect(body.diagnostic).toEqual({
      stage: 'first-frame',
      message: '首帧绘制失败',
      attempt: 1,
    })
  })

  it('空的微调指令不会发起请求', async () => {
    const fetchImpl = vi.fn()
    await expect(
      generateExperiment(
        { prompt: '  ', mode: 'refine', currentSpec: validSpec },
        { fetchImpl: fetchImpl as unknown as typeof fetch },
      ),
    ).rejects.toMatchObject({ code: 'bad_request' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('修复结果仍需客户端二次校验', async () => {
    const fetchImpl = (async () =>
      jsonResponse({ ok: true, spec: { title: '损坏结果' } })) as typeof fetch
    await expect(
      generateExperiment(
        {
          prompt: '修复',
          mode: 'repair',
          currentSpec: validSpec,
          diagnostic: { stage: 'init', message: 'x', attempt: 2 },
        },
        { fetchImpl },
      ),
    ).rejects.toMatchObject({ code: 'schema_invalid' })
  })
})

const tinyPng =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

describe('recognizeImage', () => {
  it('只把图片 data URL 发送到识别代理并校验结果', async () => {
    let body: Record<string, unknown> = {}
    const calls: Array<RequestInfo | URL> = []
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push(url)
      body = JSON.parse(String(init?.body)) as Record<string, unknown>
      return jsonResponse({
        ok: true,
        recognition: {
          formulaLatex: 'E=mc^2',
          description: '质能方程',
          variables: [{ symbol: 'E', meaning: '能量' }],
          uncertain: [],
          confidence: 0.9,
        },
      })
    }) as typeof fetch

    const result = await recognizeImage(tinyPng, { fetchImpl })

    expect(result.formulaLatex).toBe('E=mc^2')
    expect(result.variables).toEqual([{ symbol: 'E', meaning: '能量' }])
    expect(calls).toEqual(['/api/recognize'])
    expect(body).toEqual({ image: tinyPng })
    expect(String(JSON.stringify(body))).not.toContain('sk-')
  })

  it('不支持的图片在本地拦截，不发起请求', async () => {
    const fetchImpl = vi.fn()
    await expect(
      recognizeImage('data:image/gif;base64,R0lGODlhAQABAAAAACw=', {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: 'image_invalid' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('映射服务端的图片过大与限额错误', async () => {
    const tooLarge = vi.fn(async () =>
      jsonResponse(
        { ok: false, error: { code: 'image_too_large', message: '图片过大，请压缩到 4 MB 以内' } },
        413,
      ),
    )
    await expect(
      recognizeImage(tinyPng, { fetchImpl: tooLarge as unknown as typeof fetch }),
    ).rejects.toMatchObject({ code: 'image_too_large' })

    const limited = vi.fn(async () => brokenResponse(429))
    await expect(
      recognizeImage(tinyPng, { fetchImpl: limited as unknown as typeof fetch }),
    ).rejects.toMatchObject({ code: 'rate_limit' })
  })

  it('识别结果不符合协议时返回 schema_invalid', async () => {
    const fetchImpl = (async () =>
      jsonResponse({ ok: true, recognition: { formulaLatex: ' ', description: ' ' } })) as typeof fetch
    await expect(recognizeImage(tinyPng, { fetchImpl })).rejects.toMatchObject({
      code: 'schema_invalid',
    })
  })

  it('网络失败返回 network', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(
      recognizeImage(tinyPng, { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({ code: 'network' })
  })
})
