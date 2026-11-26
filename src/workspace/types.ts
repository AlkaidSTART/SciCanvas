import type { GeneratedExperimentSpec } from '../ai/schema'
import type { ParamValues } from '../types/experiment'

/** 记录结构版本：用于识别旧记录并执行迁移，未知新版本保持只读。 */
export const WORKSPACE_SCHEMA_VERSION = 1
/** 模型配置独立存储分区，拥有自己的结构版本。 */
export const MODEL_CONFIG_VERSION = 1

export type WorkspaceSource = 'preset' | 'ai'

/**
 * 一条本地实验记录：保存实验标识、代码版本、参数快照与整理状态。
 * AI 实验的 spec 即代码版本载体；预设实验只需 experimentId。
 */
export interface WorkspaceRecord {
  id: string
  title: string
  domain: string
  source: WorkspaceSource
  experimentId: string
  schemaVersion: number
  codeVersion: number
  spec: GeneratedExperimentSpec | null
  params: ParamValues
  speed: number
  favorite: boolean
  createdAt: number
  updatedAt: number
}

export type WorkspaceRecordStatus = 'ok' | 'migrated' | 'unsupported'

/** 列表项在记录之上附带兼容状态；unsupported 记录保留原始数据用于导出。 */
export interface WorkspaceEntry extends WorkspaceRecord {
  status: WorkspaceRecordStatus
  issue?: string
  raw?: unknown
}

/** 用户自有模型配置。只保存在 IndexedDB，不写入 localStorage 或 Cookie。 */
export interface ModelConfig {
  version: number
  apiKey: string
  baseUrl: string
  model: string
  updatedAt: number
}

export interface ModelConfigDraft {
  apiKey: string
  baseUrl: string
  model: string
}
