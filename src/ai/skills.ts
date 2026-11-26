/**
 * SciCanvas 公式场景增强 Skill 库。
 * 每次调用大模型前，都会注入基础公式建模 Skill + 按用户输入自动路由的学科专项 Skill，
 * 显著提升大模型预先计算坐标系、线条、曲线与科学标点的准确度与审美一致性。
 */

export type FormulaSkillId =
  | 'calculus-function'
  | 'mechanics-kinematics'
  | 'optics-geometry'
  | 'probability-stats'
  | 'dynamical-phase'

export interface FormulaSkill {
  id: FormulaSkillId
  name: string
  patterns: RegExp[]
  instruction: string
}

export const BASE_FORMULA_SCENE_SKILL = `【公式场景建模 Skill（每次必遵循）】
在输出最终 JSON 前，请先在内部按以下四步完成数学与几何规划：
1. 解析公式与量纲：明确自变量、因变量、核心可调参数、物理单位、定义域与奇点。
2. 先定坐标系与视野：根据默认参数与滑块极值反推 xDomain 与 yDomain，四周留出 10%–15% 呼吸边距；涉及几何图形、圆弧、受力或矢量时必须设 aspectMode: "fit"。
3. 动静分离算线条与标点：
   - 静态参考线/边界/辅助几何直接给出精确坐标（segment / polyline / polygon）；
   - 随滑块或时间 t 变化的主曲线使用 curve（explicit 或 parametric）表达；
   - 极值点、零点、交点、平衡点、运动质点等关键位置通过 variables + point 绑定表达式，保证拖动滑块时曲线与标点同步精确联动。
4. 标注避让与一致性自检：
   - 每张 scene2d 图至少标注 2–5 个有科学意义的 point 标点，善用 labelOffset 错开相邻文案；
   - 每个 control.key 都必须在至少一个表达式或 visible 条件中被引用（禁止无效滑块）；
   - legend 的颜色必须与对应线条一致；分母可能为 0 时使用 max(abs(...), 0.001) 保护。`

export const FORMULA_SKILLS: readonly FormulaSkill[] = [
  {
    id: 'calculus-function',
    name: '微积分与函数分析 Skill',
    patterns: [
      /导数|微积分|积分|切线|法线|极值|拐点|泰勒|傅里叶|级数|渐近线|函数图像/i,
      /\\int|\\frac\{d|\\sum|\\lim|f'\(|taylor|fourier|derivative|integral/i,
    ],
    instruction: `【专项 Skill · 微积分与函数分析】
- 优先使用 renderType: "scene2d"；主函数用 curve(mode: "explicit")，必要时用虚线 curve 叠画原函数/目标函数对照。
- 涉及积分或面积时，使用 curve.fillToY 绘出阴影区域；涉及导数时，用 segment 画出动点处的切线并标注斜率。
- 用 point 明确标出驻点、极值点、零点或拐点，并开启 showCoords: true。`,
  },
  {
    id: 'mechanics-kinematics',
    name: '力学、运动学与波动 Skill',
    patterns: [
      /抛体|斜抛|平抛|简谐|阻尼|共振|弹簧|单摆|圆周|受力|速度|加速度|波动|干涉|驻波|包络/i,
      /\\ddot|\\dot|v_0|\\omega|\\theta|pendulum|oscillat|wave|projectile|spring/i,
    ],
    instruction: `【专项 Skill · 力学与波动场景】
- 空间轨迹/受力/圆周运动必须设置 aspectMode: "fit"，保证几何比例真实。
- 用 variables 计算关键物理量（如最高点、落地点、周期、角频率），用时间变量 t 驱动运动质点 point(halo: true) 与瞬时速度/受力矢量 segment(arrow: "end")。
- 阻尼/衰减波场景请额外用虚线 curve 画出上下包络线，并配置 telemetry 展示瞬时位移或能量。`,
  },
  {
    id: 'optics-geometry',
    name: '几何、光学与三角 Skill',
    patterns: [
      /折射|反射|透镜|斯涅尔|光路|焦点|椭圆|双曲线|抛物线|圆锥曲线|单位圆|几何|矢量|向量/i,
      /snell|lens|ray|optics|ellipse|hyperbola|parabola|vector|unit circle/i,
    ],
    instruction: `【专项 Skill · 几何与光学场景】
- 必须设置 aspectMode: "fit"。
- 光学场景用 polyline 绘制完整光路、用虚线 segment 绘制法线与主光轴、用 circle（配 startAngle/endAngle）绘制入射角/折射角弧线，并标出入射点、焦点与像点。
- 几何/圆锥曲线场景明确标出圆心、焦点、顶点与准线。`,
  },
  {
    id: 'probability-stats',
    name: '概率分布与统计拟合 Skill',
    patterns: [
      /正态|高斯|泊松|二项|指数分布|概率|密度|分布|均值|方差|标准差|置信区间|回归|拟合/i,
      /\\mu|\\sigma|gaussian|normal distribution|pdf|cdf|variance|probability/i,
    ],
    instruction: `【专项 Skill · 概率分布与统计场景】
- 用 curve(mode: "explicit") 绘制 PDF/CDF 曲线，并用 fillToY: 0 在均值 ± kσ 或置信区间内填充半透明阴影。
- 用竖直虚线 segment 标出均值 μ 与 μ ± σ 的位置，并用 point 标出分布峰值点与分位点。
- 使用 annotation 动态展示当前参数下的关键统计量（如峰值密度或区间宽度）。`,
  },
  {
    id: 'dynamical-phase',
    name: '动力系统与相空间 Skill',
    patterns: [
      /相空间|相图|平衡点|鞍点|极限环|分岔|吸引子|稳定点|零斜线|洛伦兹|捕食/i,
      /phase portrait|saddle|bifurcation|nullcline|attractor|limit cycle/i,
    ],
    instruction: `【专项 Skill · 动力系统与相空间】
- 使用 point(shape: "circle") 标注稳定平衡点，使用 point(shape: "ring") 标注不稳定平衡点/鞍点。
- 用虚线 curve 绘制零斜线（nullclines），用 parametric curve + segment(arrow: "end") 表达代表性相轨线及其演化方向。
- 若系统无解析闭式轨线且必须依赖逐帧数值积分与多条历史尾迹，可回退使用 renderType: "canvas2d"。`,
  },
]

const MAX_MATCHED_SKILLS = 2

/**
 * 根据用户输入文本与已有实验领域，确定性匹配最相关的 0–2 个公式场景专项 Skill。
 */
export function selectFormulaSkills(contextText: string): FormulaSkill[] {
  const matched: FormulaSkill[] = []
  for (const skill of FORMULA_SKILLS) {
    if (skill.patterns.some((pattern) => pattern.test(contextText))) {
      matched.push(skill)
      if (matched.length >= MAX_MATCHED_SKILLS) break
    }
  }
  return matched
}

/**
 * 每次调用大模型前的统一 System Prompt 组装器：
 * 核心 Schema 协议 + 通用公式建模 Skill + 匹配到的学科专项 Skill + 模式指令。
 */
export function composeSystemPrompt(options: {
  coreContract: string
  contextText: string
  modeInstruction?: string
}): string {
  const skills = selectFormulaSkills(options.contextText)
  const parts = [
    options.coreContract,
    BASE_FORMULA_SCENE_SKILL,
    ...skills.map((skill) => skill.instruction),
  ]
  if (options.modeInstruction && options.modeInstruction.trim().length > 0) {
    parts.push(options.modeInstruction.trim())
  }
  return parts.join('\n\n')
}
