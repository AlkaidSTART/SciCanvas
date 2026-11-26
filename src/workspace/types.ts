import type { GeneratedExperimentSpec } from '../ai/schema'
import type { ParamValues } from '../types/experiment'

/** 记录结构版本：用于识别旧记录并执行迁移，未知新版本保持只读。 */
export const WORKSPACE_SCHEMA_VERSION = 1
/** 模型配置独立存储分区，拥有自己的结构版本。 */
export const MODEL_CONFIG_VERSION = 1

export type WorkspaceSource = 'preset' | 'ai'

/**
 * 一条本地实验记录（对应一个绘画窗口）：保存所属实验组、实验标识、代码版本、参数快照与整理状态。
 * AI 实验的 spec 即代码版本载体；预设实验只需 experimentId。
 */
export interface WorkspaceRecord {
  id: string
  /** 所属实验组 ID；同一实验内可包含多个绘画窗口。 */
  groupId?: string
  /** 所属实验组名称。 */
  groupTitle?: string
  /** 关联的 SQLite 会话 ID，切换绘画窗口时自动恢复对应会话。 */
  sessionId?: string | null
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

/** 按实验组聚合后的工作区视图模型。 */
export interface ExperimentGroupSummary {
  groupId: string
  title: string
  domain: string
  windows: WorkspaceEntry[]
  updatedAt: number
  favoriteCount: number
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
