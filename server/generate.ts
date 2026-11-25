import { AI_ERROR_MESSAGES } from '../src/ai/errors.ts'
import type { AiErrorCode } from '../src/ai/errors.ts'
import { MAX_PROMPT_LENGTH, buildGenerationMessages } from '../src/ai/prompt.ts'
import { validateGeneratedSpec } from '../src/ai/schema.ts'
import type { GeneratedExperimentSpec } from '../src/ai/schema.ts'

export interface AiServerConfig {
  apiKey?: string
  baseUrl: string
  model: string
  timeoutMs: number
  fetchImpl?: typeof fetch
}

export interface AiSuccessBody {
  ok: true
  spec: GeneratedExperimentSpec
}

export interface AiFailureBody {
  ok: false
  error: {
    code: AiErrorCode
    message: string
  }
}

export type AiResponseBody = AiSuccessBody | AiFailureBody

export interface GenerateResult {
  status: number
  body: AiResponseBody
}

const DEFAULT_TIMEOUT_MS = 45_000

function failure(status: number, code: AiErrorCode, message?: string): GenerateResult {
  return {
    status,
    body: { ok: false, error: { code, message: message ?? AI_ERROR_MESSAGES[code] } },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 兼容字符串内容与分段内容（部分 OpenAI 兼容服务返回数组）。 */
function extractContent(payload: unknown): string | null {
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
function parseModelJson(content: string): unknown {
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

/**
 * 服务端生成入口：纯函数式处理，便于测试注入 fetch 与超时。
 * 凭证只用于发往模型服务的请求头，不会写入响应。
 */
export async function generateExperiment(
  input: unknown,
  config: AiServerConfig,
): Promise<GenerateResult> {
  const prompt = isRecord(input) && typeof input.prompt === 'string' ? input.prompt.trim() : ''
  if (!prompt) return failure(400, 'bad_request', '请先描述想探索的科学问题')
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return failure(400, 'bad_request', `描述不能超过 ${MAX_PROMPT_LENGTH} 个字符`)
  }
  if (!config.apiKey) return failure(503, 'not_configured')

  const timeoutMs =
    Number.isFinite(config.timeoutMs) && config.timeoutMs > 0
      ? config.timeoutMs
      : DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const fetchImpl = config.fetchImpl ?? fetch
    const response = await fetchImpl(`${config.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: buildGenerationMessages(prompt),
        temperature: 0.6,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      // 不读取或回传上游响应体，避免把服务端细节或凭证带到浏览器。
      if (response.status === 429) return failure(429, 'rate_limit')
      if (response.status === 401 || response.status === 403) {
        return failure(502, 'not_configured', '服务端模型凭证无效或权限不足')
      }
      if (response.status === 408 || response.status === 504) return failure(504, 'timeout')
      return failure(502, 'server_error')
    }

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      return failure(502, 'invalid_json', '模型服务返回了无法解析的响应')
    }

    const content = extractContent(payload)
    if (content === null) {
      return failure(502, 'invalid_json', '模型服务未返回可用的文本内容')
    }

    let parsed: unknown
    try {
      parsed = parseModelJson(content)
    } catch {
      return failure(502, 'invalid_json', '模型输出不是合法 JSON')
    }

    const validation = validateGeneratedSpec(parsed)
    if (!validation.ok) {
      return failure(
        502,
        'schema_invalid',
        `模型输出未通过校验：${validation.issues.slice(0, 3).join('；')}`,
      )
    }
    return { status: 200, body: { ok: true, spec: validation.spec } }
  } catch {
    if (controller.signal.aborted) return failure(504, 'timeout')
    return failure(502, 'server_error')
  } finally {
    clearTimeout(timer)
  }
}
