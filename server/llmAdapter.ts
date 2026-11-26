import type { LlmApiFormat } from '../src/models/types.ts'
import { normalizeLlmApiFormat } from '../src/models/types.ts'

export interface LlmTextRequestOptions {
  apiFormat?: LlmApiFormat
  baseUrl: string
  apiKey: string
  model: string
  systemPrompt: string
  userPrompt: string
  temperature: number
  jsonMode?: boolean
  maxTokens?: number
}

export interface LlmVisionRequestOptions {
  apiFormat?: LlmApiFormat
  baseUrl: string
  apiKey: string
  model: string
  systemPrompt: string
  userText: string
  imageDataUrl: string
  temperature: number
  jsonMode?: boolean
  maxTokens?: number
}

export interface BuiltLlmRequest {
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
}

export function resolveEndpointUrl(baseUrl: string, apiFormat?: LlmApiFormat): string {
  const format = normalizeLlmApiFormat(apiFormat)
  const trimmed = baseUrl.trim().replace(/\/+$/, '')

  if (format === 'response') {
    return trimmed.endsWith('/responses') ? trimmed : `${trimmed}/responses`
  }
  if (format === 'anthropic') {
    return trimmed.endsWith('/messages') ? trimmed : `${trimmed}/messages`
  }
  return trimmed.endsWith('/chat/completions') ? trimmed : `${trimmed}/chat/completions`
}

function buildAuthHeaders(apiKey: string, apiFormat: LlmApiFormat): Record<string, string> {
  if (apiFormat === 'anthropic') {
    return {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    }
  }
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  }
}

function parseDataUrl(dataUrl: string): { mediaType: string; data: string } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,([\s\S]+)$/)
  if (!match) return null
  return { mediaType: match[1], data: match[2] }
}

/** 按 chat / response / anthropic 三种协议组装纯文本模型请求。 */
export function buildTextLlmRequest(options: LlmTextRequestOptions): BuiltLlmRequest {
  const format = normalizeLlmApiFormat(options.apiFormat)
  const url = resolveEndpointUrl(options.baseUrl, format)
  const headers = buildAuthHeaders(options.apiKey, format)

  if (format === 'anthropic') {
    return {
      url,
      headers,
      body: {
        model: options.model,
        max_tokens: options.maxTokens ?? 4096,
        system: options.systemPrompt,
        messages: [{ role: 'user', content: options.userPrompt }],
        temperature: options.temperature,
      },
    }
  }

  if (format === 'response') {
    const body: Record<string, unknown> = {
      model: options.model,
      instructions: options.systemPrompt,
      input: options.userPrompt,
      temperature: options.temperature,
    }
    if (options.jsonMode !== false) {
      body.text = { format: { type: 'json_object' } }
    }
    return { url, headers, body }
  }

  const body: Record<string, unknown> = {
    model: options.model,
    messages: [
      { role: 'system', content: options.systemPrompt },
      { role: 'user', content: options.userPrompt },
    ],
    temperature: options.temperature,
  }
  if (options.jsonMode !== false) {
    body.response_format = { type: 'json_object' }
  }
  return { url, headers, body }
}

/** 按 chat / response / anthropic 三种协议组装多模态图片识别请求。 */
export function buildVisionLlmRequest(options: LlmVisionRequestOptions): BuiltLlmRequest {
  const format = normalizeLlmApiFormat(options.apiFormat)
  const url = resolveEndpointUrl(options.baseUrl, format)
  const headers = buildAuthHeaders(options.apiKey, format)

  if (format === 'anthropic') {
    const parsed = parseDataUrl(options.imageDataUrl)
    const content: unknown[] = parsed
      ? [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: parsed.mediaType,
              data: parsed.data,
            },
          },
          { type: 'text', text: options.userText },
        ]
      : [{ type: 'text', text: options.userText }]

    return {
      url,
      headers,
      body: {
        model: options.model,
        max_tokens: options.maxTokens ?? 2048,
        system: options.systemPrompt,
        messages: [{ role: 'user', content }],
        temperature: options.temperature,
      },
    }
  }

  if (format === 'response') {
    const body: Record<string, unknown> = {
      model: options.model,
      instructions: options.systemPrompt,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: options.userText },
            { type: 'input_image', image_url: options.imageDataUrl },
          ],
        },
      ],
      temperature: options.temperature,
    }
    if (options.jsonMode !== false) {
      body.text = { format: { type: 'json_object' } }
    }
    return { url, headers, body }
  }

  const body: Record<string, unknown> = {
    model: options.model,
    messages: [
      { role: 'system', content: options.systemPrompt },
      {
        role: 'user',
        content: [
          { type: 'text', text: options.userText },
          { type: 'image_url', image_url: { url: options.imageDataUrl } },
        ],
      },
    ],
    temperature: options.temperature,
  }
  if (options.jsonMode !== false) {
    body.response_format = { type: 'json_object' }
  }
  return { url, headers, body }
}
