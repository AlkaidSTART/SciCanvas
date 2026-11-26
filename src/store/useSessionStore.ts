import { create } from 'zustand'
import { sessionClient } from '../sessions/client'
import type { SessionStorageClient } from '../sessions/client'
import type {
  AppendMessageInput,
  CreateSessionInput,
  SaveGenerationInput,
  SessionDetail,
  SessionSummary,
  StoredGeneration,
} from '../sessions/types'

let activeClient: SessionStorageClient = sessionClient

/** 供测试注入内存或 mock SQLite 客户端。 */
export function setSessionStorageClient(client: SessionStorageClient): void {
  activeClient = client
}

export function resetSessionStorageClient(): void {
  activeClient = sessionClient
}

function upsertSessionSummary(
  sessions: SessionSummary[],
  summary: SessionSummary,
): SessionSummary[] {
  const filtered = sessions.filter((item) => item.id !== summary.id)
  return [summary, ...filtered].sort((a, b) => b.updatedAt - a.updatedAt)
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

interface SessionState {
  hydrated: boolean
  loading: boolean
  sessions: SessionSummary[]
  dbPath: string | null
  /** 当前正在进行的 AI 会话 ID；微调与自动修复会自动归入同一会话。 */
  activeSessionId: string | null
  /** 工作区弹窗中当前查看的会话详情。 */
  selectedSessionId: string | null
  selectedDetail: SessionDetail | null
  loadingDetail: boolean
  error: string | null
  loadSessions: () => Promise<void>
  selectSession: (sessionId: string | null) => Promise<void>
  setActiveSessionId: (sessionId: string | null) => void
  startSession: (input: CreateSessionInput) => Promise<string | null>
  recordMessage: (sessionId: string, input: AppendMessageInput) => Promise<void>
  recordGeneration: (
    sessionId: string,
    input: SaveGenerationInput,
  ) => Promise<StoredGeneration | null>
  deleteSession: (sessionId: string) => Promise<boolean>
}

export const useSessionStore = create<SessionState>()((set, get) => ({
  hydrated: false,
  loading: false,
  sessions: [],
  dbPath: null,
  activeSessionId: null,
  selectedSessionId: null,
  selectedDetail: null,
  loadingDetail: false,
  error: null,

  loadSessions: async () => {
    set({ loading: true })
    try {
      const result = await activeClient.listSessions(100)
      set({
        hydrated: true,
        loading: false,
        sessions: result.sessions,
        dbPath: result.dbPath,
        error: null,
      })
    } catch (error) {
      set({
        hydrated: true,
        loading: false,
        error: errorMessage(error, '读取 SQLite 会话记录失败'),
      })
    }
  },

  selectSession: async (sessionId) => {
    if (!sessionId) {
      set({ selectedSessionId: null, selectedDetail: null, loadingDetail: false })
      return
    }
    set({ selectedSessionId: sessionId, loadingDetail: true })
    try {
      const detail = await activeClient.getSessionDetail(sessionId)
      if (get().selectedSessionId !== sessionId) return
      set({
        selectedDetail: detail,
        loadingDetail: false,
        error: null,
      })
    } catch (error) {
      if (get().selectedSessionId !== sessionId) return
      set({
        loadingDetail: false,
        error: errorMessage(error, '读取会话详情失败'),
      })
    }
  },

  setActiveSessionId: (sessionId) => set({ activeSessionId: sessionId }),

  startSession: async (input) => {
    try {
      const detail = await activeClient.createSession(input)
      set((state) => ({
        activeSessionId: detail.session.id,
        sessions: upsertSessionSummary(state.sessions, detail.session),
        selectedDetail:
          state.selectedSessionId === detail.session.id ? detail : state.selectedDetail,
        error: null,
      }))
      return detail.session.id
    } catch (error) {
      set({ error: errorMessage(error, '创建 SQLite 会话记录失败') })
      return null
    }
  },

  recordMessage: async (sessionId, input) => {
    try {
      const message = await activeClient.appendMessage(sessionId, input)
      set((state) => {
        const nextSessions = state.sessions.map((item) =>
          item.id === sessionId
            ? {
                ...item,
                updatedAt: Math.max(item.updatedAt, message.createdAt),
                messageCount: item.messageCount + 1,
                lastPrompt: message.role === 'user' ? message.content : item.lastPrompt,
              }
            : item,
        )
        const nextDetail =
          state.selectedDetail && state.selectedDetail.session.id === sessionId
            ? {
                ...state.selectedDetail,
                session:
                  nextSessions.find((item) => item.id === sessionId) ??
                  state.selectedDetail.session,
                messages: [...state.selectedDetail.messages, message],
              }
            : state.selectedDetail
        return {
          sessions: [...nextSessions].sort((a, b) => b.updatedAt - a.updatedAt),
          selectedDetail: nextDetail,
          error: null,
        }
      })
    } catch (error) {
      set({ error: errorMessage(error, '写入 SQLite 会话消息失败') })
    }
  },

  recordGeneration: async (sessionId, input) => {
    try {
      const result = await activeClient.saveGeneration(sessionId, input)
      set((state) => {
        const nextSessions = upsertSessionSummary(state.sessions, result.session)
        const nextDetail =
          state.selectedDetail && state.selectedDetail.session.id === sessionId
            ? {
                session: result.session,
                messages: result.message
                  ? [...state.selectedDetail.messages, result.message]
                  : state.selectedDetail.messages,
                generations: [result.generation, ...state.selectedDetail.generations],
              }
            : state.selectedDetail
        return {
          sessions: nextSessions,
          selectedDetail: nextDetail,
          error: null,
        }
      })
      return result.generation
    } catch (error) {
      set({ error: errorMessage(error, '保存生成内容到 SQLite 失败') })
      return null
    }
  },

  deleteSession: async (sessionId) => {
    try {
      await activeClient.deleteSession(sessionId)
      set((state) => ({
        sessions: state.sessions.filter((item) => item.id !== sessionId),
        activeSessionId: state.activeSessionId === sessionId ? null : state.activeSessionId,
        selectedSessionId: state.selectedSessionId === sessionId ? null : state.selectedSessionId,
        selectedDetail: state.selectedSessionId === sessionId ? null : state.selectedDetail,
        error: null,
      }))
      return true
    } catch (error) {
      set({ error: errorMessage(error, '删除 SQLite 会话失败') })
      return false
    }
  },
}))
