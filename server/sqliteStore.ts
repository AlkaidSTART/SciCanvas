import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { GenerationMode } from '../src/ai/prompt.ts'
import type { GeneratedExperimentSpec } from '../src/ai/schema.ts'
import type {
  AppendMessageInput,
  CreateSessionInput,
  SaveGenerationInput,
  SaveGenerationResult,
  SessionDetail,
  SessionMessage,
  SessionMessageMode,
  SessionMessageRole,
  SessionMessageStatus,
  SessionSource,
  SessionSummary,
  StoredGeneration,
} from '../src/sessions/types.ts'
import type { ParamValues } from '../src/types/experiment.ts'

export const DEFAULT_SQLITE_DB_PATH = resolve(process.cwd(), 'data', 'scicanvas.db')

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'text',
  workspace_record_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS session_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  mode TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ok',
  generation_id TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS generations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  message_id TEXT,
  mode TEXT NOT NULL,
  prompt TEXT NOT NULL,
  title TEXT NOT NULL,
  domain TEXT NOT NULL,
  formula_latex TEXT NOT NULL,
  insight TEXT NOT NULL,
  render_type TEXT NOT NULL,
  controls_json TEXT NOT NULL,
  legend_json TEXT,
  simulation_code TEXT NOT NULL,
  spec_json TEXT NOT NULL,
  params_json TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_session_created ON session_messages(session_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_generations_session_created ON generations(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_generations_created ON generations(created_at DESC);
`

interface SessionRow {
  id: string
  title: string
  source: string
  workspace_record_id: string | null
  created_at: number
  updated_at: number
  message_count: number
  generation_count: number
  last_prompt: string | null
  latest_generation_id: string | null
  latest_generation_title: string | null
  latest_generation_domain: string | null
}

interface MessageRow {
  id: string
  session_id: string
  role: string
  mode: string
  content: string
  status: string
  generation_id: string | null
  created_at: number
}

interface GenerationRow {
  id: string
  session_id: string
  message_id: string | null
  mode: string
  prompt: string
  title: string
  domain: string
  formula_latex: string
  insight: string
  render_type: string
  spec_json: string
  params_json: string | null
  created_at: number
}

function mapSessionRow(row: SessionRow): SessionSummary {
  return {
    id: row.id,
    title: row.title,
    source: row.source === 'image' ? 'image' : 'text',
    workspaceRecordId: row.workspace_record_id ?? null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    messageCount: Number(row.message_count ?? 0),
    generationCount: Number(row.generation_count ?? 0),
    lastPrompt: row.last_prompt ?? null,
    latestGenerationId: row.latest_generation_id ?? null,
    latestGenerationTitle: row.latest_generation_title ?? null,
    latestGenerationDomain: row.latest_generation_domain ?? null,
  }
}

function mapMessageRow(row: MessageRow): SessionMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role as SessionMessageRole,
    mode: row.mode as SessionMessageMode,
    content: row.content,
    status: row.status === 'error' ? 'error' : 'ok',
    generationId: row.generation_id ?? null,
    createdAt: Number(row.created_at),
  }
}

function mapGenerationRow(row: GenerationRow): StoredGeneration {
  const spec = JSON.parse(row.spec_json) as GeneratedExperimentSpec
  const params = row.params_json ? (JSON.parse(row.params_json) as ParamValues) : null
  return {
    id: row.id,
    sessionId: row.session_id,
    messageId: row.message_id ?? null,
    mode: row.mode as GenerationMode,
    prompt: row.prompt,
    title: row.title,
    domain: row.domain,
    formulaLatex: row.formula_latex,
    insight: row.insight,
    renderType: row.render_type === 'scene2d' ? 'scene2d' : 'canvas2d',
    spec,
    params,
    createdAt: Number(row.created_at),
  }
}

const SESSION_SUMMARY_SELECT = `
SELECT
  s.id,
  s.title,
  s.source,
  s.workspace_record_id,
  s.created_at,
  s.updated_at,
  (SELECT COUNT(*) FROM session_messages m WHERE m.session_id = s.id) AS message_count,
  (SELECT COUNT(*) FROM generations g WHERE g.session_id = s.id) AS generation_count,
  (SELECT m.content FROM session_messages m WHERE m.session_id = s.id AND m.role = 'user' ORDER BY m.created_at DESC LIMIT 1) AS last_prompt,
  (SELECT g.id FROM generations g WHERE g.session_id = s.id ORDER BY g.created_at DESC LIMIT 1) AS latest_generation_id,
  (SELECT g.title FROM generations g WHERE g.session_id = s.id ORDER BY g.created_at DESC LIMIT 1) AS latest_generation_title,
  (SELECT g.domain FROM generations g WHERE g.session_id = s.id ORDER BY g.created_at DESC LIMIT 1) AS latest_generation_domain
FROM sessions s
`

export interface SqliteSessionStore {
  readonly dbPath: string
  listSessions: (limit?: number) => SessionSummary[]
  getSession: (id: string) => SessionSummary | null
  getSessionDetail: (id: string) => SessionDetail | null
  createSession: (input: CreateSessionInput) => SessionDetail
  deleteSession: (id: string) => boolean
  appendMessage: (sessionId: string, input: AppendMessageInput) => SessionMessage | null
  saveGeneration: (sessionId: string, input: SaveGenerationInput) => SaveGenerationResult | null
  listGenerations: (options?: { sessionId?: string; limit?: number }) => StoredGeneration[]
  getGeneration: (id: string) => StoredGeneration | null
  close: () => void
}

/**
 * 基于 Node.js 内置 node:sqlite 的会话与生成内容存储层。
 * 传入 ":memory:" 可用于单元测试。
 */
export function createSqliteSessionStore(dbPath: string = DEFAULT_SQLITE_DB_PATH): SqliteSessionStore {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true })
  }

  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA foreign_keys = ON;')
  if (dbPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;')
  }
  db.exec(SCHEMA_SQL)

  const stmtListSessions = db.prepare(
    `${SESSION_SUMMARY_SELECT} ORDER BY s.updated_at DESC LIMIT ?`,
  )
  const stmtGetSession = db.prepare(`${SESSION_SUMMARY_SELECT} WHERE s.id = ?`)
  const stmtInsertSession = db.prepare(
    `INSERT INTO sessions (id, title, source, workspace_record_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
  const stmtTouchSession = db.prepare(
    `UPDATE sessions SET updated_at = ? WHERE id = ?`,
  )
  const stmtUpdateSessionTitle = db.prepare(
    `UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?`,
  )
  const stmtDeleteSession = db.prepare(`DELETE FROM sessions WHERE id = ?`)
  const stmtSessionExists = db.prepare(`SELECT 1 AS ok FROM sessions WHERE id = ?`)

  const stmtInsertMessage = db.prepare(
    `INSERT INTO session_messages (id, session_id, role, mode, content, status, generation_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const stmtListMessages = db.prepare(
    `SELECT id, session_id, role, mode, content, status, generation_id, created_at
     FROM session_messages
     WHERE session_id = ?
     ORDER BY created_at ASC, rowid ASC`,
  )

  const stmtInsertGeneration = db.prepare(
    `INSERT INTO generations (
      id, session_id, message_id, mode, prompt, title, domain,
      formula_latex, insight, render_type, controls_json, legend_json,
      simulation_code, spec_json, params_json, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const stmtListGenerationsBySession = db.prepare(
    `SELECT id, session_id, message_id, mode, prompt, title, domain,
            formula_latex, insight, render_type, spec_json, params_json, created_at
     FROM generations
     WHERE session_id = ?
     ORDER BY created_at DESC, rowid DESC
     LIMIT ?`,
  )
  const stmtListAllGenerations = db.prepare(
    `SELECT id, session_id, message_id, mode, prompt, title, domain,
            formula_latex, insight, render_type, spec_json, params_json, created_at
     FROM generations
     ORDER BY created_at DESC, rowid DESC
     LIMIT ?`,
  )
  const stmtGetGeneration = db.prepare(
    `SELECT id, session_id, message_id, mode, prompt, title, domain,
            formula_latex, insight, render_type, spec_json, params_json, created_at
     FROM generations
     WHERE id = ?`,
  )

  const getSession = (id: string): SessionSummary | null => {
    const row = stmtGetSession.get(id) as SessionRow | undefined
    return row ? mapSessionRow(row) : null
  }

  const listSessions = (limit = 100): SessionSummary[] => {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)))
    const rows = stmtListSessions.all(safeLimit) as unknown as SessionRow[]
    return rows.map(mapSessionRow)
  }

  const getSessionDetail = (id: string): SessionDetail | null => {
    const session = getSession(id)
    if (!session) return null
    const messages = (stmtListMessages.all(id) as unknown as MessageRow[]).map(mapMessageRow)
    const generations = (
      stmtListGenerationsBySession.all(id, 200) as unknown as GenerationRow[]
    ).map(mapGenerationRow)
    return { session, messages, generations }
  }

  const createSession = (input: CreateSessionInput): SessionDetail => {
    const now = input.createdAt ?? Date.now()
    const id = input.id?.trim() || randomUUID()
    const title = input.title.trim().slice(0, 120) || '新会话'
    const source: SessionSource = input.source === 'image' ? 'image' : 'text'
    const workspaceRecordId = input.workspaceRecordId ?? null

    db.exec('BEGIN IMMEDIATE')
    try {
      stmtInsertSession.run(id, title, source, workspaceRecordId, now, now)
      if (input.initialPrompt && input.initialPrompt.trim().length > 0) {
        const messageId = randomUUID()
        stmtInsertMessage.run(
          messageId,
          id,
          'user',
          input.initialMode ?? 'create',
          input.initialPrompt.trim(),
          'ok',
          null,
          now,
        )
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }

    return getSessionDetail(id)!
  }

  const deleteSession = (id: string): boolean => {
    const result = stmtDeleteSession.run(id)
    return Number(result.changes) > 0
  }

  const appendMessage = (sessionId: string, input: AppendMessageInput): SessionMessage | null => {
    if (!stmtSessionExists.get(sessionId)) return null
    const now = input.createdAt ?? Date.now()
    const id = input.id?.trim() || randomUUID()
    const status: SessionMessageStatus = input.status === 'error' ? 'error' : 'ok'
    const generationId = input.generationId ?? null

    db.exec('BEGIN IMMEDIATE')
    try {
      stmtInsertMessage.run(
        id,
        sessionId,
        input.role,
        input.mode,
        input.content,
        status,
        generationId,
        now,
      )
      stmtTouchSession.run(now, sessionId)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }

    return {
      id,
      sessionId,
      role: input.role,
      mode: input.mode,
      content: input.content,
      status,
      generationId,
      createdAt: now,
    }
  }

  const saveGeneration = (
    sessionId: string,
    input: SaveGenerationInput,
  ): SaveGenerationResult | null => {
    if (!stmtSessionExists.get(sessionId)) return null
    const now = input.createdAt ?? Date.now()
    const generationId = input.id?.trim() || randomUUID()
    const spec = input.spec
    const summaryText = input.assistantSummary?.trim() || null
    const messageId = summaryText ? (input.messageId?.trim() || randomUUID()) : (input.messageId ?? null)

    db.exec('BEGIN IMMEDIATE')
    try {
      stmtInsertGeneration.run(
        generationId,
        sessionId,
        messageId,
        input.mode,
        input.prompt,
        spec.title,
        spec.domain,
        spec.formulaLatex,
        spec.insight,
        spec.renderType,
        JSON.stringify(spec.controls),
        spec.legend ? JSON.stringify(spec.legend) : null,
        'simulationCode' in spec ? spec.simulationCode : '',
        JSON.stringify(spec),
        input.params ? JSON.stringify(input.params) : null,
        now,
      )

      let message: SessionMessage | null = null
      if (summaryText && messageId) {
        stmtInsertMessage.run(
          messageId,
          sessionId,
          'assistant',
          input.mode,
          summaryText,
          'ok',
          generationId,
          now,
        )
        message = {
          id: messageId,
          sessionId,
          role: 'assistant',
          mode: input.mode,
          content: summaryText,
          status: 'ok',
          generationId,
          createdAt: now,
        }
      }

      stmtUpdateSessionTitle.run(spec.title, now, sessionId)
      db.exec('COMMIT')

      const session = getSession(sessionId)!
      const generation: StoredGeneration = {
        id: generationId,
        sessionId,
        messageId,
        mode: input.mode,
        prompt: input.prompt,
        title: spec.title,
        domain: spec.domain,
        formulaLatex: spec.formulaLatex,
        insight: spec.insight,
        renderType: spec.renderType,
        spec,
        params: input.params ?? null,
        createdAt: now,
      }
      return { generation, message, session }
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  const listGenerations = (options?: {
    sessionId?: string
    limit?: number
  }): StoredGeneration[] => {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(options?.limit ?? 100)))
    const rows = options?.sessionId
      ? (stmtListGenerationsBySession.all(options.sessionId, safeLimit) as unknown as GenerationRow[])
      : (stmtListAllGenerations.all(safeLimit) as unknown as GenerationRow[])
    return rows.map(mapGenerationRow)
  }

  const getGeneration = (id: string): StoredGeneration | null => {
    const row = stmtGetGeneration.get(id) as GenerationRow | undefined
    return row ? mapGenerationRow(row) : null
  }

  return {
    dbPath,
    listSessions,
    getSession,
    getSessionDetail,
    createSession,
    deleteSession,
    appendMessage,
    saveGeneration,
    listGenerations,
    getGeneration,
    close: () => db.close(),
  }
}
