import { describe, expect, it } from 'vitest'
import { DEFAULT_EXPERIMENT, EXPERIMENTS } from '../experiments'
import { createDefaultParams } from '../runtime/params'
import type { ExperimentDefinition } from '../types/experiment'
import {
  buildStandaloneHtml,
  createExportPayload,
  ExportError,
  MAX_EXPORT_BYTES,
  renderFormulaMathml,
  sanitizeExportFileName,
} from './html'

const preset = EXPERIMENTS[0]

function presetInput() {
  return {
    experiment: preset,
    params: createDefaultParams(preset),
    speed: 1,
    source: 'preset' as const,
    aiSpec: null,
  }
}

describe('M6 导出文件名', () => {
  it('去除跨平台非法字符并保留可读标题', () => {
    expect(sanitizeExportFileName('阻尼振子: 相位图/能量?')).toBe('阻尼振子 相位图 能量.html')
  })

  it('空标题回退到默认名称', () => {
    expect(sanitizeExportFileName('   ')).toBe('SciCanvas-实验.html')
    expect(sanitizeExportFileName('///:?')).toBe('SciCanvas-实验.html')
  })

  it('避免重复扩展名、首尾点和过长标题', () => {
    expect(sanitizeExportFileName('SIR 模型.html')).toBe('SIR 模型.html')
    expect(sanitizeExportFileName('....')).toBe('SciCanvas-实验.html')
    expect(sanitizeExportFileName('长'.repeat(120)).length).toBe(85)
  })

  it('避开 Windows 保留名', () => {
    expect(sanitizeExportFileName('CON')).toBe('SciCanvas-CON.html')
  })
})

describe('M6 导出载荷', () => {
  it('预设实验写入当前参数并生成 MathML 公式', () => {
    const params = { ...createDefaultParams(preset), [preset.controls[0].key]: preset.controls[0].default }
    const payload = createExportPayload({ ...presetInput(), params, speed: 2 })

    expect(payload.version).toBe(1)
    expect(payload.kind).toBe('preset')
    expect(payload.experimentId).toBe(preset.id)
    expect(payload.title).toBe(preset.title)
    expect(payload.params).not.toBe(params)
    expect(payload.speed).toBe(2)
    expect(payload.formulaHtml).toContain('<math')
  })

  it('不支持的渲染类型会给出明确原因', () => {
    const unsupported = { ...DEFAULT_EXPERIMENT, renderType: 'webgl' } as unknown as ExperimentDefinition
    expect(() =>
      createExportPayload({ ...presetInput(), experiment: unsupported }),
    ).toThrowError(ExportError)
    expect(() =>
      createExportPayload({ ...presetInput(), experiment: unsupported }),
    ).toThrowError(/webgl/)
  })

  it('AI 实验缺少代码或代码无法编译时拒绝导出', () => {
    expect(() =>
      createExportPayload({ ...presetInput(), source: 'ai', aiSpec: null }),
    ).toThrowError(/缺少可导出的代码/)

    const broken = {
      ...{
        title: '坏代码',
        domain: '测试',
        formulaLatex: 'x',
        insight: '',
        controls: [],
        simulationCode: 'return {',
      },
    }
    expect(() =>
      createExportPayload({
        ...presetInput(),
        source: 'ai',
        aiSpec: broken as never,
      }),
    ).toThrowError(/无法编译/)
  })
})

describe('M6 单文件 HTML', () => {
  it('内联播放器、载荷与公式，不引用外部资源', () => {
    const payload = createExportPayload(presetInput())
    const { html, bytes } = buildStandaloneHtml(payload, 'console.log("player")')

    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('window.__SCICANVAS_EXPORT__ = ')
    expect(html).toContain('console.log("player")')
    expect(html).toContain('Content-Security-Policy')
    expect(html).toContain('\\u003cmath')
    expect(html).not.toMatch(/<link\b/i)
    expect(html).not.toMatch(/\bsrc\s*=\s*["']https?:/i)
    expect(html).not.toContain('@import')
    expect(bytes).toBe(new TextEncoder().encode(html).length)
  })

  it('转义标题与载荷，避免破坏内联脚本', () => {
    const payload = createExportPayload(presetInput())
    payload.title = '</script><script>alert(1)</script>'
    const { html } = buildStandaloneHtml(payload, 'const ok = true')

    expect(html).not.toContain('</script><script>alert(1)</script>')
    expect(html).toContain('&lt;/script&gt;')
    expect(html.match(/<script>/g)).toHaveLength(2)
  })

  it('播放器为空或体积超限时拒绝生成', () => {
    const payload = createExportPayload(presetInput())
    expect(() => buildStandaloneHtml(payload, '   ')).toThrowError(/运行时尚未就绪/)
    expect(() =>
      buildStandaloneHtml(payload, 'x'.repeat(MAX_EXPORT_BYTES)),
    ).toThrowError(/超过 8 MB 上限/)
  })

  it('公式渲染始终返回可内联的 MathML', () => {
    const html = renderFormulaMathml('\\frac{a}{b} = \\sqrt{c}')
    expect(html).toContain('<math')
    expect(html).toContain('</math>')
    expect(html).not.toContain('<link')
  })
})
