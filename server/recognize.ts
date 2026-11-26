import { AI_ERROR_MESSAGES } from '../src/ai/errors.ts'
import type { AiErrorCode } from '../src/ai/errors.ts'
import { validateImageDataUrl } from '../src/ai/image.ts'
import { normalizeRecognition } from '../src/ai/recognition.ts'
import type { RecognitionResult } from '../src/ai/recognition.ts'
import type { AiServerConfig } from './generate.ts'
import { buildVisionLlmRequest } from './llmAdapter.ts'
import { extractContent, isRecord, parseModelJson } from './modelText.ts'

export const RECOGNITION_SYSTEM_PROMPT = `你是 SciCanvas 的论文截图识别助手。用户会提供一张论文中的公式或机理示意图截图。请提取可用于构建交互实验的信息，并且只返回 JSON：
{
  "formulaLatex": "主要公式的 LaTeX（不含 $ 定界符），没有公式时为空字符串",
  "description": "用简体中文说明图中的科学机理、变量关系与可观察现象",
  "variables": [{"symbol": "变量符号", "meaning": "物理含义与单位"}],
  "uncertain": ["难以辨认或需要用户确认的内容"],
  "confidence": 0.85
}

约束：
1. 只描述图中确实存在的内容，不要补充臆测的结论、数据或引用。
2. 公式使用标准 LaTeX；多行公式用 \\\\ 换行，不要使用 Markdown 代码块。
3. variables 最多 12 项，符号保持论文原样；看不清的符号放入 uncertain。
4. confidence 为 0 到 1 的数字，表示整体识别置信度。
5. 所有面向用户的文字使用简体中文。
6. 若截图包含坐标系、曲线、光路或几何示意图，请在 description 中明确说明横纵坐标含义、关键曲线关系与重要特征标点（如极值点、交点、平衡点、焦点），便于后续直接生成 scene2d 交互图。`

const RECOGNITION_INSTRUCTION = '识别这张论文截图，提取公式、变量与机理描述。'
const DEFAULT_TIMEOUT_MS = 60_000

export interface RecognitionSuccessBody {
  ok: true
  recognition: RecognitionResult
}

export interface RecognitionFailureBody {
  ok: false
  error: {
    code: AiErrorCode
    message: string
  }
}

export type RecognitionResponseBody = RecognitionSuccessBody | RecognitionFailureBody

export interface RecognitionResponse {
  status: number
  body: RecognitionResponseBody
}

function failure(status: number, code: AiErrorCode, message?: string): RecognitionResponse {
  return {
    status,
    body: { ok: false, error: { code, message: message ?? AI_ERROR_MESSAGES[code] } },
  }
}

function mapUpstreamFailure(status: number): RecognitionResponse {
  // 不读取或回传上游响应体，避免把服务端细节或凭证带到浏览器。
  if (status === 429) return failure(429, 'rate_limit')
  if (status === 401 || status === 403) {
    return failure(502, 'not_configured', '服务端模型凭证无效或权限不足')
  }
  if (status === 408 || status === 504) return failure(504, 'timeout')
  return failure(502, 'server_error')
}

/**
 * 服务端多模态识别入口：校验图片 data URL 与大小后转发给配置的模型，
 * 凭证只出现在发往上游的请求头中，不写入响应。
 */
export async function recognizePaperImage(
  input: unknown,
  config: AiServerConfig,
): Promise<RecognitionResponse> {
  const rawImage = isRecord(input) ? input.image : undefined
  const imageValidation = validateImageDataUrl(rawImage)
  if (!imageValidation.ok) {
    return failure(
      imageValidation.code === 'image_too_large' ? 413 : 400,
      imageValidation.code,
      imageValidation.message,
    )
  }
  const image = rawImage as string

  if (!config.apiKey) return failure(503, 'not_configured')

  const timeoutMs =
    Number.isFinite(config.timeoutMs) && config.timeoutMs > 0
      ? config.timeoutMs
      : DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const fetchImpl = config.fetchImpl ?? fetch
    const built = buildVisionLlmRequest({
      apiFormat: config.apiFormat,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.visionModel || config.model,
      systemPrompt: RECOGNITION_SYSTEM_PROMPT,
      userText: RECOGNITION_INSTRUCTION,
      imageDataUrl: image,
      temperature: 0.2,
      jsonMode: true,
    })
    const response = await fetchImpl(built.url, {
      method: 'POST',
      headers: built.headers,
      body: JSON.stringify(built.body),
      signal: controller.signal,
    })

    if (!response.ok) return mapUpstreamFailure(response.status)

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

    const validation = normalizeRecognition(parsed)
    if (!validation.ok) {
      return failure(
        502,
        'schema_invalid',
        `识别结果未通过校验：${validation.issues.slice(0, 3).join('；')}`,
      )
    }
    return { status: 200, body: { ok: true, recognition: validation.result } }
  } catch {
    if (controller.signal.aborted) return failure(504, 'timeout')
    return failure(502, 'server_error')
  } finally {
    clearTimeout(timer)
  }
}
