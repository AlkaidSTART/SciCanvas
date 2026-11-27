import type { LlmApiFormat, LlmPresetTemplate, UpsertLlmEndpointInput } from './types.ts'
import { isLlmApiFormat } from './types.ts'

export const LLM_PRESET_TEMPLATES: readonly LlmPresetTemplate[] = [
  {
    id: 'preset-deepseek',
    providerId: 'deepseek',
    name: 'DeepSeek',
    badge: '深度求索',
    description: '性价比极高的中文推理与代码生成模型，默认兼容 OpenAI Chat 与 Anthropic 格式。',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    visionModel: '',
    apiFormat: 'chat',
    suggestedModels: ['deepseek-chat', 'deepseek-reasoner'],
    supportedFormats: ['chat', 'anthropic'],
    docsUrl: 'https://api-docs.deepseek.com/',
  },
  {
    id: 'preset-doubao',
    providerId: 'doubao',
    name: '豆包 (Doubao)',
    badge: '火山引擎 Ark',
    description: '字节跳动火山引擎方舟端点，支持 Chat Completions 与 Responses 两种协议，支持多模态识图。',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-1-5-pro-32k-250115',
    visionModel: 'doubao-1-5-vision-pro-32k-250115',
    apiFormat: 'chat',
    suggestedModels: [
      'doubao-1-5-pro-32k-250115',
      'doubao-seed-1-6-250615',
      'doubao-1-5-vision-pro-32k-250115',
    ],
    supportedFormats: ['chat', 'response'],
    docsUrl: 'https://www.volcengine.com/docs/82379',
  },
  {
    id: 'preset-qwen',
    providerId: 'qwen',
    name: '通义千问 (Qwen)',
    badge: '阿里云百炼',
    description: '阿里云百炼 DashScope OpenAI 兼容端点，内置千问文本与多模态视觉模型。',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    visionModel: 'qwen-vl-max',
    apiFormat: 'chat',
    suggestedModels: ['qwen-plus', 'qwen-max', 'qwen-turbo', 'qwen-vl-max'],
    supportedFormats: ['chat', 'response'],
    docsUrl: 'https://help.aliyun.com/zh/model-studio/',
  },
  {
    id: 'preset-openai',
    providerId: 'openai',
    name: 'OpenAI',
    badge: '官方接口',
    description: 'OpenAI 官方端点，支持 Responses API 与传统 Chat Completions 两种回复格式。',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    visionModel: 'gpt-4o-mini',
    apiFormat: 'response',
    suggestedModels: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1', 'o4-mini'],
    supportedFormats: ['response', 'chat'],
    docsUrl: 'https://platform.openai.com/docs/api-reference',
  },
  {
    id: 'preset-anthropic',
    providerId: 'anthropic',
    name: 'Anthropic (Claude)',
    badge: 'Claude 原生',
    description: 'Anthropic 官方 Messages API 端点，原生支持 Claude 系列文本与图片理解。',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-4-20250514',
    visionModel: 'claude-sonnet-4-20250514',
    apiFormat: 'anthropic',
    suggestedModels: [
      'claude-sonnet-4-20250514',
      'claude-3-7-sonnet-20250219',
      'claude-3-5-haiku-20241022',
    ],
    supportedFormats: ['anthropic'],
    docsUrl: 'https://docs.anthropic.com/en/api/messages',
  },
]

const MAX_NAME_LENGTH = 80
const MAX_BASE_URL_LENGTH = 500
const MAX_API_KEY_LENGTH = 512
const MAX_MODEL_LENGTH = 160

export type LlmEndpointValidation =
  | { ok: true; value: UpsertLlmEndpointInput }
  | { ok: false; message: string }

export function getPresetTemplateById(id: string): LlmPresetTemplate | undefined {
  return LLM_PRESET_TEMPLATES.find((item) => item.id === id)
}

export function validateLlmEndpointInput(input: UpsertLlmEndpointInput): LlmEndpointValidation {
  const name = input.name.trim()
  const baseUrl = input.baseUrl.trim().replace(/\/+$/, '')
  const apiKey = input.apiKey.trim()
  const model = input.model.trim()
  const visionModel = (input.visionModel ?? '').trim()
  const apiFormat: LlmApiFormat = input.apiFormat

  if (!name) {
    return { ok: false, message: '请填写端点名称' }
  }
  if (name.length > MAX_NAME_LENGTH) {
    return { ok: false, message: `端点名称不能超过 ${MAX_NAME_LENGTH} 个字符` }
  }
  if (!baseUrl) {
    return { ok: false, message: '请填写 API 端点地址 (Base URL)' }
  }
  if (baseUrl.length > MAX_BASE_URL_LENGTH) {
    return { ok: false, message: `API 端点地址不能超过 ${MAX_BASE_URL_LENGTH} 个字符` }
  }

  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch {
    return { ok: false, message: 'API 端点不是合法 URL，例如 https://api.deepseek.com/v1' }
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, message: 'API 端点仅支持 http 或 https 协议' }
  }
  if (parsed.username || parsed.password) {
    return { ok: false, message: 'API 端点不能包含账号密码' }
  }

  if (apiKey.length > MAX_API_KEY_LENGTH) {
    return { ok: false, message: `API Key 不能超过 ${MAX_API_KEY_LENGTH} 个字符` }
  }
  if (model.length > MAX_MODEL_LENGTH) {
    return { ok: false, message: `模型名称不能超过 ${MAX_MODEL_LENGTH} 个字符` }
  }
  if (visionModel.length > MAX_MODEL_LENGTH) {
    return { ok: false, message: `多模态视觉模型名称不能超过 ${MAX_MODEL_LENGTH} 个字符` }
  }
  if (!isLlmApiFormat(apiFormat)) {
    return { ok: false, message: '回复格式必须是 chat、response 或 anthropic' }
  }

  return {
    ok: true,
    value: {
      id: input.id?.trim() || undefined,
      name,
      providerId: input.providerId?.trim() || 'custom',
      isPreset: Boolean(input.isPreset),
      isActive: Boolean(input.isActive),
      baseUrl,
      apiKey,
      model,
      visionModel,
      apiFormat,
    },
  }
}
