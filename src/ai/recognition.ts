export interface RecognitionVariable {
  symbol: string
  meaning: string
}

/** 多模态识别结果：公式、机理说明、变量符号与需要人工确认的内容。 */
export interface RecognitionResult {
  formulaLatex: string
  description: string
  variables: RecognitionVariable[]
  uncertain: string[]
  confidence?: number
}

export type RecognitionValidation =
  | { ok: true; result: RecognitionResult }
  | { ok: false; issues: string[] }

export const MAX_RECOGNITION_FORMULA = 1200
export const MAX_RECOGNITION_DESCRIPTION = 2000
export const MAX_RECOGNITION_VARIABLES = 12
export const MAX_RECOGNITION_VARIABLE_TEXT = 160
export const MAX_RECOGNITION_UNCERTAIN = 8
export const MAX_RECOGNITION_UNCERTAIN_TEXT = 200

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readText(
  value: unknown,
  field: string,
  maxLength: number,
  issues: string[],
  options: { allowEmpty?: boolean } = {},
): string {
  if (typeof value !== 'string') {
    issues.push(`${field} 必须是字符串`)
    return ''
  }
  const text = value.trim()
  if (!options.allowEmpty && !text) issues.push(`${field} 不能为空`)
  if (text.length > maxLength) issues.push(`${field} 不能超过 ${maxLength} 个字符`)
  return text
}

/**
 * 校验模型返回的识别结果。客户端与服务端共用，
 * 不接受未经校验的字段直接进入确认界面或生成链路。
 */
export function normalizeRecognition(value: unknown): RecognitionValidation {
  const issues: string[] = []
  if (!isRecord(value)) return { ok: false, issues: ['识别结果必须是对象'] }

  const formulaLatex = readText(value.formulaLatex, 'formulaLatex', MAX_RECOGNITION_FORMULA, issues, {
    allowEmpty: true,
  })
  const description = readText(value.description, 'description', MAX_RECOGNITION_DESCRIPTION, issues, {
    allowEmpty: true,
  })
  if (!formulaLatex && !description) {
    issues.push('未识别到公式或机理说明，请换一张更清晰的截图')
  }

  const variables: RecognitionVariable[] = []
  if (value.variables !== undefined) {
    if (!Array.isArray(value.variables)) {
      issues.push('variables 必须是数组')
    } else if (value.variables.length > MAX_RECOGNITION_VARIABLES) {
      issues.push(`variables 最多 ${MAX_RECOGNITION_VARIABLES} 项`)
    } else {
      value.variables.forEach((item, index) => {
        if (!isRecord(item)) {
          issues.push(`variables[${index}] 必须是对象`)
          return
        }
        const symbol = readText(item.symbol, `variables[${index}].symbol`, MAX_RECOGNITION_VARIABLE_TEXT, issues)
        const meaning = readText(item.meaning, `variables[${index}].meaning`, MAX_RECOGNITION_VARIABLE_TEXT, issues)
        if (symbol && meaning) variables.push({ symbol, meaning })
      })
    }
  }

  const uncertain: string[] = []
  if (value.uncertain !== undefined) {
    if (!Array.isArray(value.uncertain)) {
      issues.push('uncertain 必须是数组')
    } else if (value.uncertain.length > MAX_RECOGNITION_UNCERTAIN) {
      issues.push(`uncertain 最多 ${MAX_RECOGNITION_UNCERTAIN} 项`)
    } else {
      value.uncertain.forEach((item, index) => {
        const text = readText(item, `uncertain[${index}]`, MAX_RECOGNITION_UNCERTAIN_TEXT, issues)
        if (text) uncertain.push(text)
      })
    }
  }

  let confidence: number | undefined
  if (value.confidence !== undefined) {
    if (typeof value.confidence !== 'number' || !Number.isFinite(value.confidence)) {
      issues.push('confidence 必须是 0 到 1 之间的数字')
    } else {
      confidence = Math.min(1, Math.max(0, value.confidence))
    }
  }

  if (issues.length > 0) return { ok: false, issues }
  return {
    ok: true,
    result: {
      formulaLatex,
      description,
      variables,
      uncertain,
      ...(confidence === undefined ? {} : { confidence }),
    },
  }
}

function joinVariables(variables: RecognitionVariable[]): string {
  return variables.map((item) => `${item.symbol}：${item.meaning}`).join('；')
}

/**
 * 把用户确认（可能经过编辑）的识别结果拼成 M3 的文本生成请求，
 * 不另起一套生成或校验逻辑。
 */
export function buildRecognitionPrompt(result: RecognitionResult): string {
  const formula = result.formulaLatex.trim()
  const description = result.description.trim()
  if (!formula && !description) return ''

  const lines = ['请根据以下论文截图识别结果生成一个可交互实验。']
  lines.push(`公式（LaTeX）：${formula || '无'}`)
  lines.push(`机理说明：${description || '见公式'}`)
  if (result.variables.length > 0) {
    lines.push(`变量：${joinVariables(result.variables)}`)
  }
  if (result.uncertain.length > 0) {
    lines.push(`需要确认的内容：${result.uncertain.join('；')}`)
  }
  lines.push('请忠实还原截图中的变量与关系，并生成合适的交互控件。')
  return lines.join('\n')
}
