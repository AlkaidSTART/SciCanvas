import type { ControlValue } from '../types/experiment'
import { AI_ERROR_MESSAGES } from './errors'
import type { AiErrorCode } from './errors'
import { DEFAULT_REPAIR_INSTRUCTION, MAX_PROMPT_LENGTH } from './prompt'
import type { GenerationMode, RepairDiagnostic } from './prompt'
import { validateGeneratedSpec } from './schema'
import type { GeneratedExperimentSpec } from './schema'

export type { AiErrorCode } from './errors'

export const DEFAULT_CLIENT_TIMEOUT_MS = 60_000

export class AiGenerationError extends Error {
  readonly code: AiErrorCode

  constructor(code: AiErrorCode, message?: string) {
    super(message ?? AI_ERROR_MESSAGES[code])
    this.name = 'AiGenerationError'
    this.code = code
  }
}

export interface GenerateExperimentRequest {
  prompt: string
  mode?: GenerationMode
  currentSpec?: GeneratedExperimentSpec
  currentParams?: Record<string, ControlValue>
  diagnostic?: RepairDiagnostic
}

export interface GenerateExperimentOptions {
  signal?: AbortSignal
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isErrorCode(value: unknown): value is AiErrorCode {
  return typeof value === 'string' && value in AI_ERROR_MESSAGES
}

function codeFromStatus(status: number): AiErrorCode {
  if (status === 400 || status === 413) return 'bad_request'
  if (status === 401 || status === 403 || status === 503) return 'not_configured'
  if (status === 429) return 'rate_limit'
  if (status === 504) return 'timeout'
  return 'server_error'
}

function readServerError(payload: unknown): { code?: AiErrorCode; message?: string } {
  if (!isRecord(payload) || !isRecord(payload.error)) return {}
  return {
    code: isErrorCode(payload.error.code) ? payload.error.code : undefined,
    message:
      typeof payload.error.message === 'string' && payload.error.message.trim().length > 0
        ? payload.error.message
        : undefined,
  }
}

function buildRequestBody(input: string | GenerateExperimentRequest): Record<string, unknown> {
  const request: GenerateExperimentRequest = typeof input === 'string' ? { prompt: input } : input
  const mode = request.mode ?? 'create'
  const text =
    mode === 'repair'
      ? request.prompt.trim() || DEFAULT_REPAIR_INSTRUCTION
      : request.prompt.trim()

  const body: Record<string, unknown> = { prompt: text }
  if (typeof input === 'string') return body

  body.mode = mode
  if (mode === 'refine') {
    body.currentSpec = request.currentSpec
    body.currentParams = request.currentParams ?? {}
  }
  if (mode === 'repair') {
    body.currentSpec = request.currentSpec
    body.diagnostic = request.diagnostic
  }
  return body
}

/**
 * 浏览器侧生成客户端：只与服务端代理通信，不接触模型凭证。
 * 超时、取消与各类失败都转换为带稳定 code 的 AiGenerationError。
 */
export async function generateExperiment(
  input: string | GenerateExperimentRequest,
  options: GenerateExperimentOptions = {},
): Promise<GeneratedExperimentSpec> {
  const request: GenerateExperimentRequest = typeof input === 'string' ? { prompt: input } : input
  const mode = request.mode ?? 'create'
  const text =
    mode === 'repair'
      ? request.prompt.trim() || DEFAULT_REPAIR_INSTRUCTION
      : request.prompt.trim()
  if (!text) throw new AiGenerationError('bad_request', '请先描述想探索的科学问题')
  if (text.length > MAX_PROMPT_LENGTH) {
    throw new AiGenerationError('bad_request', `描述不能超过 ${MAX_PROMPT_LENGTH} 个字符`)
  }
  if (options.signal?.aborted) throw new AiGenerationError('aborted')

  const controller = new AbortController()
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, options.timeoutMs ?? DEFAULT_CLIENT_TIMEOUT_MS)
  const abortFromCaller = () => controller.abort()
  options.signal?.addEventListener('abort', abortFromCaller)

  try {
    const fetchImpl = options.fetchImpl ?? fetch
    const response = await fetchImpl('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildRequestBody(input)),
      signal: controller.signal,
    })

    let payload: unknown = null
    try {
      payload = await response.json()
    } catch {
      payload = null
    }

    if (!response.ok) {
      const serverError = readServerError(payload)
      throw new AiGenerationError(
        serverError.code ?? codeFromStatus(response.status),
        serverError.message,
      )
    }
    if (payload === null) throw new AiGenerationError('invalid_json')
    if (!isRecord(payload) || payload.ok !== true) {
      const serverError = readServerError(payload)
      throw new AiGenerationError(serverError.code ?? 'invalid_json', serverError.message)
    }

    const validation = validateGeneratedSpec(payload.spec)
    if (!validation.ok) {
      throw new AiGenerationError(
        'schema_invalid',
        `模型输出未通过校验：${validation.issues.slice(0, 2).join('；')}`,
      )
    }
    return validation.spec
  } catch (error) {
    if (error instanceof AiGenerationError) throw error
    if (options.signal?.aborted) throw new AiGenerationError('aborted')
    if (timedOut) throw new AiGenerationError('timeout')
    throw new AiGenerationError('network')
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', abortFromCaller)
  }
}
