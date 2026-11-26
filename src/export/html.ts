import katex from 'katex'
import { compileSimulationCode, validateGeneratedSpec } from '../ai/schema'
import type { GeneratedExperimentSpec } from '../ai/schema'
import type { ExperimentDefinition, ParamValues } from '../types/experiment'
import { EXPORT_FORMAT_VERSION } from './types'
import type { ExportPayload } from './types'

/** 单文件导出的体积上限，超过时拒绝生成而不是交给用户一个打不开的文件。 */
export const MAX_EXPORT_BYTES = 8 * 1024 * 1024
const MAX_FILE_NAME_LENGTH = 80
const FALLBACK_FILE_NAME = 'SciCanvas-实验'
const INVALID_FILE_NAME = /[<>:"/\\|?*]/g
const CONTROL_CHARS = /\p{Cc}/gu
const RESERVED_FILE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

export class ExportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExportError'
  }
}

export interface ExportInput {
  experiment: ExperimentDefinition
  params: ParamValues
  speed: number
  source: 'preset' | 'ai'
  aiSpec: GeneratedExperimentSpec | null
}

export interface StandaloneHtml {
  html: string
  bytes: number
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 去掉跨平台非法字符，并保证文件名可读、长度可控。 */
export function sanitizeExportFileName(title: string): string {
  const normalized = title.normalize('NFC').replace(CONTROL_CHARS, ' ').replace(INVALID_FILE_NAME, ' ')
  const withoutExtension = normalized
    .replace(/\s+/g, ' ')
    .replace(/\.html?$/i, '')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .trim()

  let base = withoutExtension || FALLBACK_FILE_NAME
  if (RESERVED_FILE_NAME.test(base)) base = `SciCanvas-${base}`
  if (base.length > MAX_FILE_NAME_LENGTH) base = base.slice(0, MAX_FILE_NAME_LENGTH).trim()
  return `${base}.html`
}

/**
 * 导出文件使用 MathML 而非 KaTeX HTML：浏览器原生排版，
 * 无需内联字体与样式表，离线打开也不会请求任何外部资源。
 */
export function renderFormulaMathml(latex: string): string {
  try {
    return katex.renderToString(latex, {
      throwOnError: false,
      displayMode: true,
      strict: false,
      output: 'mathml',
    })
  } catch (error) {
    throw new ExportError(`公式渲染失败：${errorMessage(error)}`)
  }
}

export function createExportPayload(input: ExportInput): ExportPayload {
  const { experiment, params, speed, source, aiSpec } = input

  if (experiment.renderType !== 'canvas2d' && experiment.renderType !== 'scene2d') {
    throw new ExportError(`暂不支持导出 "${experiment.renderType}" 渲染类型的实验`)
  }

  if (source === 'ai') {
    if (!aiSpec) {
      throw new ExportError('当前 AI 实验缺少可导出的代码，请重新生成后再试')
    }
    if (aiSpec.renderType === 'scene2d') {
      const validation = validateGeneratedSpec(aiSpec)
      if (!validation.ok) {
        throw new ExportError(`AI 声明式场景校验失败：${validation.issues[0]}`)
      }
    } else {
      if (!aiSpec.simulationCode.trim()) {
        throw new ExportError('AI 实验代码为空，无法生成可运行的导出文件')
      }
      const compiled = compileSimulationCode(aiSpec.simulationCode)
      if (!compiled.ok) {
        throw new ExportError(`AI 实验代码无法编译：${compiled.message}`)
      }
    }
    return {
      version: EXPORT_FORMAT_VERSION,
      kind: 'ai',
      title: aiSpec.title,
      spec: aiSpec,
      params: { ...params },
      speed,
      formulaHtml: renderFormulaMathml(aiSpec.formulaLatex),
    }
  }

  return {
    version: EXPORT_FORMAT_VERSION,
    kind: 'preset',
    title: experiment.title,
    experimentId: experiment.id,
    params: { ...params },
    speed,
    formulaHtml: renderFormulaMathml(experiment.formulaLatex),
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 内联脚本里不能出现 `</script`，同时把行分隔符转义成合法 JS 字符串。 */
function escapeInlineScript(value: string): string {
  return value
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

function escapePlayerCode(code: string): string {
  return code.replace(/<\/script/gi, '<\\/script')
}

/**
 * 组装完全自包含的 HTML：播放器运行时、实验载荷与公式均内联，
 * 并用 CSP 禁止导出页发起任何网络请求。
 */
export function buildStandaloneHtml(
  payload: ExportPayload,
  playerCode: string,
): StandaloneHtml {
  if (!playerCode.trim()) {
    throw new ExportError('导出运行时尚未就绪，请刷新页面后重试')
  }

  let payloadJson: string
  try {
    payloadJson = escapeInlineScript(JSON.stringify(payload))
  } catch (error) {
    throw new ExportError(`实验数据序列化失败：${errorMessage(error)}`)
  }

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'">
<title>${escapeHtml(payload.title)} · SciCanvas</title>
</head>
<body>
<div id="scicanvas-root"></div>
<script>window.__SCICANVAS_EXPORT__ = ${payloadJson};</script>
<script>${escapePlayerCode(playerCode)}</script>
</body>
</html>`

  const bytes = new TextEncoder().encode(html).length
  if (bytes > MAX_EXPORT_BYTES) {
    throw new ExportError(
      `导出文件约 ${(bytes / 1024 / 1024).toFixed(1)} MB，超过 ${MAX_EXPORT_BYTES / 1024 / 1024} MB 上限；请减少实验代码或参数后再试`,
    )
  }
  return { html, bytes }
}
