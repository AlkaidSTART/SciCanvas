import { MODEL_CONFIG_VERSION } from './types'
import type { ModelConfig, ModelConfigDraft } from './types'

const MAX_API_KEY_LENGTH = 512
const MAX_BASE_URL_LENGTH = 500
const MAX_MODEL_LENGTH = 120

export type ModelConfigValidation =
  | { ok: true; value: ModelConfigDraft }
  | { ok: false; message: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 校验并规范化用户输入；端点留空时视为使用部署方默认模型。 */
export function validateModelConfig(draft: ModelConfigDraft): ModelConfigValidation {
  const apiKey = draft.apiKey.trim()
  const baseUrl = draft.baseUrl.trim().replace(/\/+$/, '')
  const model = draft.model.trim()

  if (apiKey.length > MAX_API_KEY_LENGTH) {
    return { ok: false, message: `API Key 不能超过 ${MAX_API_KEY_LENGTH} 个字符` }
  }
  if (baseUrl.length > MAX_BASE_URL_LENGTH) {
    return { ok: false, message: `API 端点不能超过 ${MAX_BASE_URL_LENGTH} 个字符` }
  }
  if (model.length > MAX_MODEL_LENGTH) {
    return { ok: false, message: `默认模型不能超过 ${MAX_MODEL_LENGTH} 个字符` }
  }
  if (baseUrl) {
    let parsed: URL
    try {
      parsed = new URL(baseUrl)
    } catch {
      return { ok: false, message: 'API 端点不是合法 URL，例如 https://api.example.com/v1' }
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { ok: false, message: 'API 端点仅支持 http 或 https 协议' }
    }
    if (parsed.username || parsed.password) {
      return { ok: false, message: 'API 端点不能包含账号密码' }
    }
  }

  return { ok: true, value: { apiKey, baseUrl, model } }
}

export function createModelConfig(draft: ModelConfigDraft, now = Date.now()): ModelConfig {
  return {
    version: MODEL_CONFIG_VERSION,
    apiKey: draft.apiKey.trim(),
    baseUrl: draft.baseUrl.trim().replace(/\/+$/, ''),
    model: draft.model.trim(),
    updatedAt: now,
  }
}

/** 读取模型配置：结构版本或字段不合法时返回 null，不删除原始数据。 */
export function normalizeModelConfig(input: unknown): ModelConfig | null {
  if (!isRecord(input)) return null
  if (input.version !== MODEL_CONFIG_VERSION) return null
  if (
    typeof input.apiKey !== 'string' ||
    typeof input.baseUrl !== 'string' ||
    typeof input.model !== 'string'
  ) {
    return null
  }
  const updatedAt = typeof input.updatedAt === 'number' && Number.isFinite(input.updatedAt)
    ? input.updatedAt
    : 0
  return {
    version: MODEL_CONFIG_VERSION,
    apiKey: input.apiKey,
    baseUrl: input.baseUrl,
    model: input.model,
    updatedAt,
  }
}

/** 界面摘要只显示末四位，避免整枚密钥长时间暴露在屏幕上。 */
export function maskApiKey(apiKey: string): string {
  const trimmed = apiKey.trim()
  if (!trimmed) return ''
  if (trimmed.length <= 8) return '••••'
  return `••••${trimmed.slice(-4)}`
}
