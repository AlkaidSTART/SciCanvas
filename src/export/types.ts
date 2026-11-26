import type { GeneratedExperimentSpec } from '../ai/schema'
import type { ParamValues } from '../types/experiment'

export const EXPORT_FORMAT_VERSION = 1

/**
 * 离线导出文件中内联的实验载荷。主应用与导出播放器共用这一结构，
 * 预设实验只携带 id 与当前参数，AI 实验额外携带已校验的代码与元数据。
 */
export interface ExportPayload {
  version: number
  kind: 'preset' | 'ai'
  title: string
  experimentId?: string
  spec?: GeneratedExperimentSpec
  params: ParamValues
  speed: number
  /** 预先渲染为 MathML，导出文件不依赖 KaTeX 字体或 CSS 资源。 */
  formulaHtml: string
}
