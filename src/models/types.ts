export type LlmApiFormat = 'chat' | 'response' | 'anthropic'

export const LLM_API_FORMATS: readonly LlmApiFormat[] = ['chat', 'response', 'anthropic']

export interface LlmApiFormatOption {
  value: LlmApiFormat
  label: string
  shortLabel: string
  endpointSuffix: string
  description: string
}

export const LLM_API_FORMAT_OPTIONS: readonly LlmApiFormatOption[] = [
  {
    value: 'chat',
    label: 'OpenAI Chat Completions',
    shortLabel: 'Chat',
    endpointSuffix: '/chat/completions',
    description: '标准对话补全格式，兼容 DeepSeek、豆包、通义千问及多数 OpenAI 兼容网关',
  },
  {
    value: 'response',
    label: 'OpenAI Responses API',
    shortLabel: 'Response',
    endpointSuffix: '/responses',
    description: '新一代 OpenAI Responses 接口格式，兼容 OpenAI 与火山引擎 Ark Responses',
  },
  {
    value: 'anthropic',
    label: 'Anthropic Messages',
    shortLabel: 'Anthropic',
    endpointSuffix: '/messages',
    description: 'Anthropic Claude 原生消息格式（x-api-key + anthropic-version 请求头）',
  },
]

export interface LlmEndpointConfig {
  id: string
  name: string
  providerId: string
  isPreset: boolean
  isActive: boolean
  baseUrl: string
  apiKey: string
  model: string
  visionModel: string
  apiFormat: LlmApiFormat
  createdAt: number
  updatedAt: number
}

export interface UpsertLlmEndpointInput {
  id?: string
  name: string
  providerId?: string
  isPreset?: boolean
  isActive?: boolean
  baseUrl: string
  apiKey: string
  model: string
  visionModel?: string
  apiFormat: LlmApiFormat
}

export interface LlmPresetTemplate {
  id: string
  providerId: string
  name: string
  badge: string
  description: string
  baseUrl: string
  model: string
  visionModel: string
  apiFormat: LlmApiFormat
  suggestedModels: readonly string[]
  supportedFormats: readonly LlmApiFormat[]
  docsUrl: string
}

export function isLlmApiFormat(value: unknown): value is LlmApiFormat {
  return value === 'chat' || value === 'response' || value === 'anthropic'
}

export function normalizeLlmApiFormat(value: unknown): LlmApiFormat {
  return isLlmApiFormat(value) ? value : 'chat'
}
