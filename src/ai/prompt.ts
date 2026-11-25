import type { ControlValue } from '../types/experiment'
import type { RepairDiagnostic } from './heal'
import type { GeneratedExperimentSpec } from './schema'

export type { RepairDiagnostic, RepairStage } from './heal'

export const MAX_PROMPT_LENGTH = 4000
export const DEFAULT_REPAIR_INSTRUCTION =
  '请修复当前实验的运行错误，保持原有教学意图、交互控件与视觉风格。'

export type GenerationMode = 'create' | 'refine' | 'repair'

export interface GenerationInput {
  prompt: string
  mode?: GenerationMode
  currentSpec?: GeneratedExperimentSpec
  currentParams?: Record<string, ControlValue>
  diagnostic?: RepairDiagnostic
}

export interface ChatMessage {
  role: 'system' | 'user'
  content: string
}

export const SYSTEM_PROMPT = `你是 SciCanvas 的科学实验生成器。用户会用中文描述一个科学机理，或粘贴 LaTeX 公式。你需要输出一个可直接在 Canvas 2D 中运行的交互式仿真实验，并且只返回 JSON。

输出必须严格符合以下字段（不要输出 Markdown 代码块、解释或多余文字）：
{
  "title": "不超过 40 字的实验标题",
  "domain": "短学科标签，例如 Physics / Mechanics",
  "formulaLatex": "核心公式的 LaTeX，可被 KaTeX 渲染",
  "insight": "一到两句话说明用户能观察到什么",
  "renderType": "canvas2d",
  "controls": [
    {"type": "slider", "key": "damping", "label": "阻尼系数", "min": 0, "max": 2, "step": 0.01, "default": 0.2, "unit": ""},
    {"type": "toggle", "key": "trail", "label": "显示轨迹", "default": true},
    {"type": "select", "key": "mode", "label": "模式", "options": [{"value": "a", "label": "模式 A"}], "default": "a"}
  ],
  "legend": [{"label": "位置", "color": "#4F7292"}],
  "simulationCode": "函数体代码"
}

约束：
1. controls 提供 2 到 4 个，key 使用英文小写字母/数字/下划线，且互不重复；slider 的 default 必须落在 min 与 max 之间，step 大于 0。
2. legend 可选，颜色与 simulationCode 中实际绘制使用的颜色一致。
3. simulationCode 是一个 JavaScript 函数体字符串，最后必须 return { createState, step, draw }：
   - createState(params) 返回可序列化的普通对象作为初始状态；
   - step(state, params, dt) 返回新的状态对象，必须使用固定时间步 dt，不能依赖真实时间；
   - draw(ctx, state, params, viewport) 使用标准 Canvas 2D API 绘制，viewport 为 { width, height }，坐标以 CSS 像素为单位。
4. 生成代码运行在隔离沙盒中：禁止访问 window、document、globalThis、parent、fetch、XMLHttpRequest、WebSocket、localStorage、indexedDB、location 等浏览器能力；不得引入外部库；不得使用定时器或异步逻辑。
5. 仿真必须确定、可重复，并在参数取极值时保持数值稳定；不要绘制 HTML，也不要尝试修改页面。
6. 画面使用米白底色（#FBF7EF）上的低饱和蓝、橙、绿、紫线条，文字默认使用深棕色 #7D7062。
7. 所有面向用户的文案使用简体中文。`

const MODE_INSTRUCTIONS: Record<GenerationMode, string> = {
  create: '',
  refine: `

本次请求是增量修改。请在保留当前实验结构、控件 key 与教学意图的前提下，只落实用户指令要求的改动；未要求修改的部分尽量保持一致。输出仍然是完整 schema，不要复述旧代码，也不要解释过程。`,
  repair: `

本次请求是错误修复。当前实验在隔离沙盒中运行失败。请根据最小诊断信息定位并修正 simulationCode（必要时修正相关 schema 字段），保持控件 key、标题与教学意图不变。输出仍然是完整 schema，只返回 JSON。`,
}

function buildUserContent(input: GenerationInput, mode: GenerationMode): string {
  if (mode === 'create') return input.prompt.trim()
  if (mode === 'refine') {
    return JSON.stringify(
      {
        instruction: input.prompt.trim(),
        currentSpec: input.currentSpec,
        currentParams: input.currentParams ?? {},
      },
      null,
      2,
    )
  }
  return JSON.stringify(
    {
      instruction: input.prompt.trim() || DEFAULT_REPAIR_INSTRUCTION,
      diagnostic: input.diagnostic,
      currentSpec: input.currentSpec,
    },
    null,
    2,
  )
}

/**
 * 按生成模式组装消息：创建只发送用户描述；微调与修复只附带当前 Schema、
 * 必要参数或最小诊断，不携带历史对话与任何服务端信息。
 */
export function buildGenerationMessages(input: string | GenerationInput): ChatMessage[] {
  const request: GenerationInput = typeof input === 'string' ? { prompt: input } : input
  const mode = request.mode ?? 'create'
  return [
    { role: 'system', content: `${SYSTEM_PROMPT}${MODE_INSTRUCTIONS[mode]}` },
    { role: 'user', content: buildUserContent(request, mode) },
  ]
}
