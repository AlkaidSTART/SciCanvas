import { invoke } from '@tauri-apps/api/core'
import { isDesktopApp } from '../floatingBall/bridge'
import type {
  AppendMessageInput,
  CreateSessionInput,
  SaveGenerationInput,
  SaveGenerationResult,
  SessionDetail,
  SessionMessage,
  SessionSummary,
  StoredGeneration,
} from './types'

export interface ListSessionsResult {
  sessions: SessionSummary[]
  dbPath: string | null
}

export interface SessionStorageClient {
  listSessions: (limit?: number) => Promise<ListSessionsResult>
  getSessionDetail: (sessionId: string) => Promise<SessionDetail | null>
  createSession: (input: CreateSessionInput) => Promise<SessionDetail>
  deleteSession: (sessionId: string) => Promise<void>
  appendMessage: (sessionId: string, input: AppendMessageInput) => Promise<SessionMessage>
  saveGeneration: (sessionId: string, input: SaveGenerationInput) => Promise<SaveGenerationResult>
  listGenerations: (options?: { sessionId?: string; limit?: number }) => Promise<StoredGeneration[]>
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  let data: unknown = null
  try {
    data = await response.json()
  } catch {
    data = null
  }
  if (!response.ok) {
    const errorMessage =
      typeof data === 'object' &&
      data !== null &&
      'error' in data &&
      typeof (data as { error?: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `SQLite 请求失败 (${response.status})`
    throw new Error(errorMessage)
  }
  return data as T
}

/**
 * 创建 Web 端 SQLite 会话客户端（走同源 /api/sessions 与 /api/generations 接口）。
 */
export function createHttpSessionClient(fetchImpl: typeof fetch = fetch): SessionStorageClient {
  return {
    listSessions: async (limit = 100) => {
      const response = await fetchImpl(`/api/sessions?limit=${encodeURIComponent(String(limit))}`, {
        method: 'GET',
      })
      const payload = await parseJsonResponse<{
        ok: true
        sessions: SessionSummary[]
        dbPath?: string
      }>(response)
      return {
        sessions: payload.sessions ?? [],
        dbPath: payload.dbPath ?? null,
      }
    },

    getSessionDetail: async (sessionId) => {
      const response = await fetchImpl(`/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'GET',
      })
      if (response.status === 404) return null
      const payload = await parseJsonResponse<{ ok: true; detail: SessionDetail }>(response)
      return payload.detail
    },

    createSession: async (input) => {
      const response = await fetchImpl('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      const payload = await parseJsonResponse<{ ok: true; detail: SessionDetail }>(response)
      return payload.detail
    },

    deleteSession: async (sessionId) => {
      const response = await fetchImpl(`/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
      })
      if (response.status === 404) return
      await parseJsonResponse<{ ok: true }>(response)
    },

    appendMessage: async (sessionId, input) => {
      const response = await fetchImpl(
        `/api/sessions/${encodeURIComponent(sessionId)}/messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        },
      )
      const payload = await parseJsonResponse<{ ok: true; message: SessionMessage }>(response)
      return payload.message
    },

    saveGeneration: async (sessionId, input) => {
      const response = await fetchImpl(
        `/api/sessions/${encodeURIComponent(sessionId)}/generations`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        },
      )
      const payload = await parseJsonResponse<{ ok: true; result: SaveGenerationResult }>(response)
      return payload.result
    },

    listGenerations: async (options) => {
      const params = new URLSearchParams()
      if (options?.sessionId) params.set('sessionId', options.sessionId)
      if (options?.limit !== undefined) params.set('limit', String(options.limit))
      const query = params.toString()
      const response = await fetchImpl(`/api/generations${query ? `?${query}` : ''}`, {
        method: 'GET',
      })
      const payload = await parseJsonResponse<{ ok: true; generations: StoredGeneration[] }>(
        response,
      )
      return payload.generations ?? []
    },
  }
}

/**
 * 创建 Tauri 桌面端 SQLite 会话客户端（通过 IPC 调用 Rust rusqlite 后端）。
 */
export function createTauriSessionClient(): SessionStorageClient {
  return {
    listSessions: async (limit = 100) => {
      const result = await invoke<{ sessions: SessionSummary[]; dbPath: string }>(
        'sqlite_list_sessions',
        { limit },
      )
      return {
        sessions: result.sessions ?? [],
        dbPath: result.dbPath ?? null,
      }
    },

    getSessionDetail: async (sessionId) => {
      return invoke<SessionDetail | null>('sqlite_get_session_detail', { sessionId })
    },

    createSession: async (input) => {
      return invoke<SessionDetail>('sqlite_create_session', { input })
    },

    deleteSession: async (sessionId) => {
      await invoke<boolean>('sqlite_delete_session', { sessionId })
    },

    appendMessage: async (sessionId, input) => {
      return invoke<SessionMessage>('sqlite_append_message', { sessionId, input })
    },

    saveGeneration: async (sessionId, input) => {
      return invoke<SaveGenerationResult>('sqlite_save_generation', { sessionId, input })
    },

    listGenerations: async (options) => {
      return invoke<StoredGeneration[]>('sqlite_list_generations', {
        sessionId: options?.sessionId ?? null,
        limit: options?.limit ?? 100,
      })
    },
  }
}

const httpClient = createHttpSessionClient()
const tauriClient = createTauriSessionClient()

/** 根据当前运行环境（Tauri 桌面端 / Web 端）自动路由到对应的 SQLite 持久化层。 */
export const sessionClient: SessionStorageClient = {
  listSessions: (limit) =>
    isDesktopApp() ? tauriClient.listSessions(limit) : httpClient.listSessions(limit),
  getSessionDetail: (sessionId) =>
    isDesktopApp()
      ? tauriClient.getSessionDetail(sessionId)
      : httpClient.getSessionDetail(sessionId),
  createSession: (input) =>
    isDesktopApp() ? tauriClient.createSession(input) : httpClient.createSession(input),
  deleteSession: (sessionId) =>
    isDesktopApp() ? tauriClient.deleteSession(sessionId) : httpClient.deleteSession(sessionId),
  appendMessage: (sessionId, input) =>
    isDesktopApp()
      ? tauriClient.appendMessage(sessionId, input)
      : httpClient.appendMessage(sessionId, input),
  saveGeneration: (sessionId, input) =>
    isDesktopApp()
      ? tauriClient.saveGeneration(sessionId, input)
      : httpClient.saveGeneration(sessionId, input),
  listGenerations: (options) =>
    isDesktopApp()
      ? tauriClient.listGenerations(options)
      : httpClient.listGenerations(options),
}
