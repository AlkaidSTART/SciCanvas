import type { LlmApiFormat } from '../src/models/types.ts'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function extractChatContent(payload: Record<string, unknown>): string | null {
  if (!Array.isArray(payload.choices) || payload.choices.length === 0) return null
  const choice = payload.choices[0]
  if (!isRecord(choice) || !isRecord(choice.message)) return null
  const content = choice.message.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const text = content
      .map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : ''))
      .join('')
    return text.length > 0 ? text : null
  }
  return null
}

function extractResponseContent(payload: Record<string, unknown>): string | null {
  if (typeof payload.output_text === 'string' && payload.output_text.length > 0) {
    return payload.output_text
  }
  if (!Array.isArray(payload.output)) return null
  const parts: string[] = []
  for (const item of payload.output) {
    if (!isRecord(item)) continue
    if (typeof item.text === 'string') {
      parts.push(item.text)
      continue
    }
    if (Array.isArray(item.content)) {
      for (const block of item.content) {
        if (!isRecord(block)) continue
        if (typeof block.text === 'string') {
          parts.push(block.text)
        }
      }
    }
  }
  const joined = parts.join('')
  return joined.length > 0 ? joined : null
}

function extractAnthropicContent(payload: Record<string, unknown>): string | null {
  if (!Array.isArray(payload.content)) return null
  const text = payload.content
    .map((block) =>
      isRecord(block) && block.type === 'text' && typeof block.text === 'string'
        ? block.text
        : '',
    )
    .join('')
  return text.length > 0 ? text : null
}

/**
 * 兼容 OpenAI Chat Completions、OpenAI Responses API 与 Anthropic Messages 三种回复格式。
 */
export function extractContent(payload: unknown, apiFormat?: LlmApiFormat): string | null {
  if (!isRecord(payload)) return null

  if (apiFormat === 'anthropic') {
    return extractAnthropicContent(payload) ?? extractChatContent(payload) ?? extractResponseContent(payload)
  }
  if (apiFormat === 'response') {
    return extractResponseContent(payload) ?? extractChatContent(payload) ?? extractAnthropicContent(payload)
  }
  return extractChatContent(payload) ?? extractResponseContent(payload) ?? extractAnthropicContent(payload)
}

/** 去掉模型偶尔附带的 Markdown 代码围栏或前后解释文字。 */
export function parseModelJson(content: string): unknown {
  let text = content.trim()
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fenced) text = fenced[1].trim()
  if (!text.startsWith('{')) {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start >= 0 && end > start) text = text.slice(start, end + 1)
  }
  return JSON.parse(text)
}
