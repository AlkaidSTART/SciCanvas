export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 兼容字符串内容与分段内容（部分 OpenAI 兼容服务返回数组）。 */
export function extractContent(payload: unknown): string | null {
  if (!isRecord(payload) || !Array.isArray(payload.choices) || payload.choices.length === 0) {
    return null
  }
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
