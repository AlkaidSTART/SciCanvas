import type { GenerationMode } from '../ai/prompt'
import type { GeneratedExperimentSpec } from '../ai/schema'
import type { ParamValues } from '../types/experiment'

export type SessionSource = 'text' | 'image'
export type SessionMessageRole = 'user' | 'assistant' | 'system'
export type SessionMessageMode = GenerationMode | 'recognize'
export type SessionMessageStatus = 'ok' | 'error'

/** 一条会话记录（对应 SQLite `sessions` 表）。 */
export interface SessionSummary {
  id: string
  title: string
  source: SessionSource
  workspaceRecordId: string | null
  createdAt: number
  updatedAt: number
  messageCount: number
  generationCount: number
  lastPrompt: string | null
  latestGenerationId: string | null
  latestGenerationTitle: string | null
  latestGenerationDomain: string | null
}

/** 会话中的单条消息记录（对应 SQLite `session_messages` 表）。 */
export interface SessionMessage {
  id: string
  sessionId: string
  role: SessionMessageRole
  mode: SessionMessageMode
  content: string
  status: SessionMessageStatus
  generationId: string | null
  createdAt: number
}

/** 一次成功生成的内容记录（对应 SQLite `generations` 表）。 */
export interface StoredGeneration {
  id: string
  sessionId: string
  messageId: string | null
  mode: GenerationMode
  prompt: string
  title: string
  domain: string
  formulaLatex: string
  insight: string
  renderType: GeneratedExperimentSpec['renderType']
  spec: GeneratedExperimentSpec
  params: ParamValues | null
  createdAt: number
}

/** 会话详情：包含会话元信息、完整消息流与全部生成内容。 */
export interface SessionDetail {
  session: SessionSummary
  messages: SessionMessage[]
  generations: StoredGeneration[]
}

export interface CreateSessionInput {
  id?: string
  title: string
  source?: SessionSource
  workspaceRecordId?: string | null
  initialPrompt?: string
  initialMode?: SessionMessageMode
  createdAt?: number
}

export interface AppendMessageInput {
  id?: string
  role: SessionMessageRole
  mode: SessionMessageMode
  content: string
  status?: SessionMessageStatus
  generationId?: string | null
  createdAt?: number
}

export interface SaveGenerationInput {
  id?: string
  messageId?: string | null
  mode: GenerationMode
  prompt: string
  spec: GeneratedExperimentSpec
  params?: ParamValues | null
  assistantSummary?: string | null
  createdAt?: number
}

export interface SaveGenerationResult {
  generation: StoredGeneration
  message: SessionMessage | null
  session: SessionSummary
}
