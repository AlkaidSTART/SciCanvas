import { describe, expect, it } from 'vitest'
import {
  BASE_FORMULA_SCENE_SKILL,
  composeSystemPrompt,
  selectFormulaSkills,
} from './skills'

describe('formula-scene skills', () => {
  it('能根据中文与 LaTeX 关键词匹配对应的学科专项 Skill', () => {
    const mechanics = selectFormulaSkills('斜抛运动 y = x \\tan\\theta - g x^2 / (2 v_0^2)')
    expect(mechanics.map((s) => s.id)).toContain('mechanics-kinematics')

    const stats = selectFormulaSkills('正态分布概率密度函数 \\mu 与 \\sigma 变化')
    expect(stats.map((s) => s.id)).toContain('probability-stats')

    const optics = selectFormulaSkills('斯涅尔定律光路折射与入射角')
    expect(optics.map((s) => s.id)).toContain('optics-geometry')
  })

  it('每次组装 System Prompt 时都包含基础建模 Skill 且最多注入 2 个专项 Skill', () => {
    const prompt = composeSystemPrompt({
      coreContract: 'CORE_CONTRACT',
      contextText: '导数切线、抛体速度、正态分布、相空间分岔',
      modeInstruction: 'MODE_HINT',
    })
    expect(prompt).toContain('CORE_CONTRACT')
    expect(prompt).toContain(BASE_FORMULA_SCENE_SKILL)
    expect(prompt).toContain('MODE_HINT')
    const skillHeaderCount = (prompt.match(/【专项 Skill ·/g) ?? []).length
    expect(skillHeaderCount).toBeLessThanOrEqual(2)
    expect(skillHeaderCount).toBeGreaterThan(0)
  })
})
