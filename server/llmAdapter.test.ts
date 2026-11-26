// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { generateExperiment } from './generate.ts'
import { buildTextLlmRequest, buildVisionLlmRequest, resolveEndpointUrl } from './llmAdapter.ts'
import { extractContent } from './modelText.ts'
import { recognizePaperImage } from './recognize.ts'

const SAMPLE_SPEC = {
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

const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

describe('llmAdapter & multi-format responses (chat / response / anthropic)', () => {
  it('resolves endpoint URLs without duplicating suffixes', () => {
    expect(resolveEndpointUrl('https://api.deepseek.com/v1/', 'chat')).toBe(
      'https://api.deepseek.com/v1/chat/completions',
    )
    expect(resolveEndpointUrl('https://api.deepseek.com/v1/chat/completions', 'chat')).toBe(
      'https://api.deepseek.com/v1/chat/completions',
    )
    expect(resolveEndpointUrl('https://api.openai.com/v1', 'response')).toBe(
      'https://api.openai.com/v1/responses',
    )
    expect(resolveEndpointUrl('https://api.anthropic.com/v1', 'anthropic')).toBe(
      'https://api.anthropic.com/v1/messages',
    )
  })

  it('builds requests for chat, response, and anthropic formats', () => {
    const responseReq = buildTextLlmRequest({
      apiFormat: 'response',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      apiKey: 'ark-secret',
      model: 'doubao-seed-1-6',
      systemPrompt: 'sys',
      userPrompt: 'usr',
      temperature: 0.5,
    })
    expect(responseReq.url).toBe('https://ark.cn-beijing.volces.com/api/v3/responses')
    expect(responseReq.headers.Authorization).toBe('Bearer ark-secret')
    expect(responseReq.body).toMatchObject({
      model: 'doubao-seed-1-6',
      instructions: 'sys',
      input: 'usr',
      text: { format: { type: 'json_object' } },
    })

    const anthropicReq = buildVisionLlmRequest({
      apiFormat: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      apiKey: 'sk-ant-key',
      model: 'claude-sonnet-4-20250514',
      systemPrompt: 'sys',
      userText: 'identify',
      imageDataUrl: TINY_PNG,
      temperature: 0.2,
    })
    expect(anthropicReq.url).toBe('https://api.anthropic.com/v1/messages')
    expect(anthropicReq.headers['x-api-key']).toBe('sk-ant-key')
    expect(anthropicReq.headers['anthropic-version']).toBe('2023-06-01')
    expect(anthropicReq.body.system).toBe('sys')
  })

  it('extracts text from chat, response, and anthropic response payloads', () => {
    expect(
      extractContent({ choices: [{ message: { content: '{"a":1}' } }] }, 'chat'),
    ).toBe('{"a":1}')

    expect(extractContent({ output_text: '{"b":2}' }, 'response')).toBe('{"b":2}')

    expect(
      extractContent(
        {
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: '{"c":3}' }],
            },
          ],
        },
        'response',
      ),
    ).toBe('{"c":3}')

    expect(
      extractContent(
        {
          content: [{ type: 'text', text: '{"d":4}' }],
        },
        'anthropic',
      ),
    ).toBe('{"d":4}')
  })

  it('supports OpenAI Responses API end-to-end in generateExperiment', async () => {
    let seenUrl = ''
    const fetchImpl = (async (url: RequestInfo | URL) => {
      seenUrl = String(url)
      return new Response(
        JSON.stringify({
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: JSON.stringify(SAMPLE_SPEC) }],
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }) as typeof fetch

    const result = await generateExperiment(
      { prompt: '模拟阻尼单摆' },
      {
        apiKey: 'sk-resp',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        apiFormat: 'response',
        timeoutMs: 2_000,
        fetchImpl,
      },
    )

    expect(seenUrl).toBe('https://api.openai.com/v1/responses')
    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
  })

  it('supports Anthropic Messages API end-to-end in recognizePaperImage', async () => {
    let seenUrl = ''
    let seenHeaders: Record<string, string> = {}
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      seenUrl = String(url)
      seenHeaders = (init?.headers ?? {}) as Record<string, string>
      return new Response(
        JSON.stringify({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                formulaLatex: 'F = ma',
                description: '牛顿第二定律',
                variables: [{ symbol: 'F', meaning: '合力' }],
                uncertain: [],
                confidence: 0.92,
              }),
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }) as typeof fetch

    const result = await recognizePaperImage(
      { image: TINY_PNG },
      {
        apiKey: 'sk-ant-test',
        baseUrl: 'https://api.anthropic.com/v1',
        model: 'claude-sonnet-4-20250514',
        apiFormat: 'anthropic',
        timeoutMs: 2_000,
        fetchImpl,
      },
    )

    expect(seenUrl).toBe('https://api.anthropic.com/v1/messages')
    expect(seenHeaders['x-api-key']).toBe('sk-ant-test')
    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
  })
})
