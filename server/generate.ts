import { AI_ERROR_MESSAGES } from '../src/ai/errors.ts'
import type { AiErrorCode } from '../src/ai/errors.ts'
import {
  DEFAULT_REPAIR_INSTRUCTION,
  MAX_PROMPT_LENGTH,
  buildGenerationMessages,
} from '../src/ai/prompt.ts'
import type { GenerationMode, RepairDiagnostic } from '../src/ai/prompt.ts'
import { validateGeneratedSpec } from '../src/ai/schema.ts'
import type { GeneratedExperimentSpec } from '../src/ai/schema.ts'
import type { LlmApiFormat } from '../src/models/types.ts'
import type { ControlValue } from '../src/types/experiment.ts'
import { buildTextLlmRequest } from './llmAdapter.ts'
import { extractContent, isRecord, parseModelJson } from './modelText.ts'

export interface AiServerConfig {
  apiKey?: string
  baseUrl: string
  model: string
  /** 多模态识别使用的模型；缺省时回退到 model。 */
  visionModel?: string
  /** 回复协议格式：chat / response / anthropic，缺省为 chat。 */
  apiFormat?: LlmApiFormat
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

const MODES: readonly GenerationMode[] = ['create', 'refine', 'repair']
const MAX_CURRENT_PARAMS = 12
const MAX_PARAM_KEY_LENGTH = 80
const MAX_PARAM_TEXT_LENGTH = 200
const MAX_DIAGNOSTIC_LENGTH = 1000
const MAX_REPAIR_ATTEMPT = 2

type ParamsReadResult =
  | { ok: true; params: Record<string, ControlValue> }
  | { ok: false; message: string }

/** 只接受数量有限的原始值参数，避免把任意对象带入提示词。 */
function readCurrentParams(value: unknown): ParamsReadResult {
  if (value === undefined) return { ok: true, params: {} }
  if (!isRecord(value)) return { ok: false, message: 'currentParams 必须是对象' }
  const entries = Object.entries(value)
  if (entries.length > MAX_CURRENT_PARAMS) {
    return { ok: false, message: `currentParams 最多 ${MAX_CURRENT_PARAMS} 项` }
  }
  const params: Record<string, ControlValue> = {}
  for (const [key, raw] of entries) {
    if (!key || key.length > MAX_PARAM_KEY_LENGTH) {
      return { ok: false, message: 'currentParams 的键名不合法' }
    }
    if (typeof raw === 'string') {
      if (raw.length > MAX_PARAM_TEXT_LENGTH) {
        return { ok: false, message: `currentParams.${key} 过长` }
      }
      params[key] = raw
    } else if (typeof raw === 'boolean') {
      params[key] = raw
    } else if (typeof raw === 'number' && Number.isFinite(raw)) {
      params[key] = raw
    } else {
      return { ok: false, message: `currentParams.${key} 必须是数字、布尔值或字符串` }
    }
  }
  return { ok: true, params }
}

type DiagnosticReadResult =
  | { ok: true; diagnostic: RepairDiagnostic }
  | { ok: false; message: string }

function readDiagnostic(value: unknown): DiagnosticReadResult {
  if (!isRecord(value)) return { ok: false, message: 'diagnostic 必须是对象' }
  const stage = value.stage
  if (stage !== 'init' && stage !== 'first-frame' && stage !== 'runtime') {
    return { ok: false, message: 'diagnostic.stage 必须是 init / first-frame / runtime' }
  }
  const message = typeof value.message === 'string' ? value.message.trim() : ''
  if (!message) return { ok: false, message: 'diagnostic.message 必须是非空字符串' }
  if (message.length > MAX_DIAGNOSTIC_LENGTH) {
    return { ok: false, message: `diagnostic.message 不能超过 ${MAX_DIAGNOSTIC_LENGTH} 个字符` }
  }
  const attempt = value.attempt
  if (
    typeof attempt !== 'number' ||
    !Number.isInteger(attempt) ||
    attempt < 1 ||
    attempt > MAX_REPAIR_ATTEMPT
  ) {
    return { ok: false, message: `diagnostic.attempt 必须是 1 到 ${MAX_REPAIR_ATTEMPT} 的整数` }
  }
  return { ok: true, diagnostic: { stage, message, attempt } }
}

/**
 * 服务端生成入口：纯函数式处理，便于测试注入 fetch 与超时。
 * 凭证只用于发往模型服务的请求头，不会写入响应。
 */
export async function generateExperiment(
  input: unknown,
  config: AiServerConfig,
): Promise<GenerateResult> {
  const rawMode = isRecord(input) ? input.mode : undefined
  if (rawMode !== undefined && !MODES.includes(rawMode as GenerationMode)) {
    return failure(400, 'bad_request', 'mode 只能是 create / refine / repair')
  }
  const mode: GenerationMode = (rawMode as GenerationMode | undefined) ?? 'create'

  const rawPrompt =
    isRecord(input) && typeof input.prompt === 'string' ? input.prompt.trim() : ''
  const prompt = mode === 'repair' && !rawPrompt ? DEFAULT_REPAIR_INSTRUCTION : rawPrompt
  if (!prompt) return failure(400, 'bad_request', '请先描述想探索的科学问题')
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return failure(400, 'bad_request', `描述不能超过 ${MAX_PROMPT_LENGTH} 个字符`)
  }

  let currentSpec: GeneratedExperimentSpec | undefined
  if (mode !== 'create') {
    const rawSpec = isRecord(input) ? input.currentSpec : undefined
    if (rawSpec === undefined) {
      return failure(400, 'bad_request', '当前请求缺少实验上下文 currentSpec')
    }
    const validation = validateGeneratedSpec(rawSpec)
    if (!validation.ok) {
      return failure(
        400,
        'bad_request',
        `当前实验上下文不合法：${validation.issues.slice(0, 2).join('；')}`,
      )
    }
    currentSpec = validation.spec
  }

  let currentParams: Record<string, ControlValue> | undefined
  if (mode === 'refine') {
    const parsed = readCurrentParams(isRecord(input) ? input.currentParams : undefined)
    if (!parsed.ok) return failure(400, 'bad_request', parsed.message)
    currentParams = parsed.params
  }

  let diagnostic: RepairDiagnostic | undefined
  if (mode === 'repair') {
    const parsed = readDiagnostic(isRecord(input) ? input.diagnostic : undefined)
    if (!parsed.ok) return failure(400, 'bad_request', parsed.message)
    diagnostic = parsed.diagnostic
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
    const messages = buildGenerationMessages({
      prompt,
      mode,
      currentSpec,
      currentParams,
      diagnostic,
    })
    const systemMessage = messages.find((m) => m.role === 'system')?.content ?? ''
    const userMessage = messages.find((m) => m.role === 'user')?.content ?? prompt
    const built = buildTextLlmRequest({
      apiFormat: config.apiFormat,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
      systemPrompt: systemMessage,
      userPrompt: userMessage,
      temperature: mode === 'repair' ? 0.3 : mode === 'refine' ? 0.5 : 0.6,
      jsonMode: true,
    })
    const response = await fetchImpl(built.url, {
      method: 'POST',
      headers: built.headers,
      body: JSON.stringify(built.body),
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

    const content = extractContent(payload, config.apiFormat)
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
