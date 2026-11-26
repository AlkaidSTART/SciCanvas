import type { ControlValue } from '../types/experiment.ts'
import type { RepairDiagnostic } from './heal.ts'
import type { GeneratedExperimentSpec } from './schema.ts'
import { composeSystemPrompt } from './skills.ts'

export type { RepairDiagnostic, RepairStage } from './heal.ts'

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

export const SYSTEM_PROMPT = `你是 SciCanvas 的科学实验生成器。用户会用中文描述一个科学机理，或粘贴 LaTeX 公式。你需要先计算好坐标系、线条/曲线方程与关键标点，输出一个可直接渲染的交互式实验，并且只返回 JSON（不要输出 Markdown 代码块、解释或多余文字）。

支持两种渲染模式（默认优先使用 "scene2d"）：

【模式 A（默认优先）："renderType": "scene2d" —— 声明式点线渲染】
适用于函数曲线、微积分、力学轨迹/矢量、波动与包络、几何光学、概率分布、解析相图等绝大多数公式场景。无需编写 JS 代码，而是由你算好坐标系、派生变量、线条/曲线与关键标点，交由客户端确定性渲染器绘制：
{
  "title": "不超过 40 字的实验标题",
  "domain": "短学科标签，例如 Physics / Mechanics",
  "formulaLatex": "核心公式的 LaTeX，可被 KaTeX 渲染",
  "insight": "一到两句话说明用户能观察到什么",
  "renderType": "scene2d",
  "controls": [
    {"type": "slider", "key": "v0", "label": "初速度", "min": 8, "max": 25, "step": 0.5, "default": 18, "unit": "m/s"},
    {"type": "toggle", "key": "showVec", "label": "显示矢量", "default": true}
  ],
  "legend": [{"label": "主轨迹", "color": "#4F7292"}],
  "scene": {
    "coordinate": {
      "xDomain": [-2, 68],
      "yDomain": [-2, 34],
      "aspectMode": "fit",
      "showGrid": true,
      "showAxes": true,
      "xLabel": "水平位移 x (m)",
      "yLabel": "竖直高度 y (m)"
    },
    "variables": {
      "rad": "45 * pi / 180",
      "xPeak": "v0^2 * sin(2 * rad) / 19.6"
    },
    "elements": [
      {"id": "traj", "type": "curve", "mode": "explicit", "y": "x * tan(rad) - (9.8 * x^2) / (2 * (v0 * cos(rad))^2)", "xRange": [0, "2 * xPeak"], "samples": 180, "stroke": "blue", "lineWidth": 2.2},
      {"id": "peak", "type": "point", "at": ["xPeak", "xPeak * tan(rad) / 2"], "shape": "diamond", "radius": 5, "color": "mint", "label": "最高点", "labelOffset": [8, -10], "showCoords": true},
      {"id": "vec", "type": "segment", "visible": "showVec", "from": [0, 0], "to": ["v0 * 0.4 * cos(rad)", "v0 * 0.4 * sin(rad)"], "arrow": "end", "stroke": "peach", "lineWidth": 2},
      {"id": "note", "type": "annotation", "at": ["xPeak", "18"], "text": "峰值 x = {{xPeak}} m", "align": "center", "badge": true}
    ],
    "telemetry": {
      "metrics": [{"key": "peakX", "label": "峰值水平位置", "unit": "m", "color": "blue", "expr": "xPeak"}]
    }
  }
}

scene2d 关键约束：
- elements 支持 7 类图元：polyline（预计算点数组 points）、curve（explicit 含 y 与可选 xRange/fillToY；parametric 含 x、y、uRange）、segment（from/to/arrow: none|end|both）、point（at/shape: circle|ring|diamond|cross|square/radius/halo/label/labelOffset/showCoords）、circle（center/radius/startAngle/endAngle）、polygon（points/fill/stroke）、annotation（at/text 支持最多 4 个 {{expr}} 插值/align/badge）。
- 表达式白名单：仅允许数字、controls.key、前置 variables、t（仿真秒）、x（explicit 曲线）、u（parametric 曲线）、常量 pi/e、运算符 +-*/%^ < <= > >= == != && || ! ?: 与函数 sin/cos/tan/asin/acos/atan/atan2/sinh/cosh/tanh/exp/log/log10/sqrt/pow/abs/sign/floor/ceil/round/min/max/clamp/lerp/step/smoothstep/mod。
- 颜色优先使用暖纸语义色板 Token："blue"(#4F7292)、"peach"(#C97A45)、"mint"(#5F9377)、"rose"(#C06F6F)、"lilac"(#8A76A8)、"amber"(#C08A3A)、"ink"(#3A332B)、"muted"(#7D7062)。

【模式 B（复杂有状态仿真回退）："renderType": "canvas2d"】
仅当实验需要无解析解的逐帧数值积分、多粒子碰撞、流体网格或历史尾迹累积时使用，输出 simulationCode 代替 scene：
- simulationCode 是一个 JavaScript 函数体字符串，最后必须 return { createState, step, draw }：
  - createState(params) 返回可序列化的普通对象作为初始状态；
  - step(state, params, dt) 返回新的状态对象，必须使用固定时间步 dt，不能依赖真实时间；
  - draw(ctx, state, params, viewport) 使用标准 Canvas 2D API 绘制，viewport 为 { width, height }，坐标以 CSS 像素为单位。
- 生成代码运行在隔离沙盒中：禁止访问 window、document、globalThis、parent、fetch、XMLHttpRequest、WebSocket、localStorage、indexedDB、location 等浏览器能力；不得引入外部库；不得使用定时器或异步逻辑。

通用约束：
1. controls 提供 2 到 4 个，key 使用英文小写字母/数字/下划线，且互不重复；slider 的 default 必须落在 min 与 max 之间，step 大于 0。
2. legend 可选，颜色与实际绘制使用的颜色一致。
3. 画面使用米白底色（#FBF7EF）上的低饱和蓝、橙、绿、紫线条，文字默认使用深棕色 #7D7062。
4. 所有面向用户的文案使用简体中文。`

const MODE_INSTRUCTIONS: Record<GenerationMode, string> = {
  create: '',
  refine: `本次请求是增量修改。请在保留当前实验结构、renderType、控件 key 与教学意图的前提下，只落实用户指令要求的改动；若当前为 scene2d，尽量沿用既有元素 id 做增量增改。输出仍然是完整 schema，不要复述旧代码，也不要解释过程。`,
  repair: `本次请求是错误修复。当前实验在运行或校验中失败。请根据最小诊断信息定位并修正 scene 表达式/结构或 simulationCode（必要时修正相关 schema 字段），保持控件 key、标题与教学意图不变。输出仍然是完整 schema，只返回 JSON。`,
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
 * 按生成模式组装消息：每次调用前通过 composeSystemPrompt 注入通用与学科公式场景 Skill；
 * 创建只发送用户描述；微调与修复只附带当前 Schema、必要参数或最小诊断，不携带历史对话。
 */
export function buildGenerationMessages(input: string | GenerationInput): ChatMessage[] {
  const request: GenerationInput = typeof input === 'string' ? { prompt: input } : input
  const mode = request.mode ?? 'create'
  const contextParts = [
    request.prompt,
    request.currentSpec?.title ?? '',
    request.currentSpec?.domain ?? '',
    request.currentSpec?.formulaLatex ?? '',
  ]
  const systemContent = composeSystemPrompt({
    coreContract: SYSTEM_PROMPT,
    contextText: contextParts.join(' '),
    modeInstruction: MODE_INSTRUCTIONS[mode],
  })
  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: buildUserContent(request, mode) },
  ]
}
