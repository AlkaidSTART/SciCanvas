import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { GeneratedExperimentSpec } from '../ai/schema'
import type { SessionStorageClient } from '../sessions/client'
import type {
  AppendMessageInput,
  CreateSessionInput,
  SaveGenerationInput,
  SessionDetail,
  SessionMessage,
  SessionSummary,
  StoredGeneration,
} from '../sessions/types'
import {
  resetSessionStorageClient,
  setSessionStorageClient,
  useSessionStore,
} from './useSessionStore'

const SAMPLE_SPEC: GeneratedExperimentSpec = {
  title: '洛伦兹吸引子',
  domain: '非线性动力学',
  formulaLatex: '\\dot{x} = \\sigma(y - x)',
  insight: '参数超过阈值时系统进入混沌状态。',
  renderType: 'canvas2d',
  controls: [
    {
      type: 'slider',
      key: 'sigma',
      label: 'σ',
      min: 1,
      max: 20,
      step: 0.5,
      default: 10,
    },
  ],
  simulationCode:
    'return { createState: () => ({ t: 0 }), step: (s, dt) => ({ t: s.t + dt }), draw: () => {} };',
}

function createMemoryClient(): SessionStorageClient {
  const sessions = new Map<string, SessionDetail>()
  let seq = 1

  return {
    listSessions: async () => ({
      sessions: [...sessions.values()]
        .map((detail) => detail.session)
        .sort((a, b) => b.updatedAt - a.updatedAt),
      dbPath: ':memory:',
    }),
    getSessionDetail: async (sessionId) => sessions.get(sessionId) ?? null,
    createSession: async (input: CreateSessionInput) => {
      const id = input.id ?? `s-${seq++}`
      const now = input.createdAt ?? Date.now()
      const messages: SessionMessage[] = input.initialPrompt
        ? [
            {
              id: `m-${seq++}`,
              sessionId: id,
              role: 'user',
              mode: input.initialMode ?? 'create',
              content: input.initialPrompt,
              status: 'ok',
              generationId: null,
              createdAt: now,
            },
          ]
        : []
      const summary: SessionSummary = {
        id,
        title: input.title,
        source: input.source ?? 'text',
        workspaceRecordId: input.workspaceRecordId ?? null,
        createdAt: now,
        updatedAt: now,
        messageCount: messages.length,
        generationCount: 0,
        lastPrompt: input.initialPrompt ?? null,
        latestGenerationId: null,
        latestGenerationTitle: null,
        latestGenerationDomain: null,
      }
      const detail: SessionDetail = { session: summary, messages, generations: [] }
      sessions.set(id, detail)
      return detail
    },
    deleteSession: async (sessionId) => {
      sessions.delete(sessionId)
    },
    appendMessage: async (sessionId, input: AppendMessageInput) => {
      const detail = sessions.get(sessionId)
      if (!detail) throw new Error('会话不存在')
      const now = input.createdAt ?? Date.now()
      const msg: SessionMessage = {
        id: input.id ?? `m-${seq++}`,
        sessionId,
        role: input.role,
        mode: input.mode,
        content: input.content,
        status: input.status ?? 'ok',
        generationId: input.generationId ?? null,
        createdAt: now,
      }
      detail.messages.push(msg)
      detail.session.messageCount += 1
      detail.session.updatedAt = now
      return msg
    },
    saveGeneration: async (sessionId, input: SaveGenerationInput) => {
      const detail = sessions.get(sessionId)
      if (!detail) throw new Error('会话不存在')
      const now = input.createdAt ?? Date.now()
      const genId = input.id ?? `g-${seq++}`
      const msgId = input.assistantSummary ? `m-${seq++}` : null
      const generation: StoredGeneration = {
        id: genId,
        sessionId,
        messageId: msgId,
        mode: input.mode,
        prompt: input.prompt,
        title: input.spec.title,
        domain: input.spec.domain,
        formulaLatex: input.spec.formulaLatex,
        insight: input.spec.insight,
        renderType: input.spec.renderType,
        spec: input.spec,
        params: input.params ?? null,
        createdAt: now,
      }
      detail.generations.unshift(generation)
      let message: SessionMessage | null = null
      if (input.assistantSummary && msgId) {
        message = {
          id: msgId,
          sessionId,
          role: 'assistant',
          mode: input.mode,
          content: input.assistantSummary,
          status: 'ok',
          generationId: genId,
          createdAt: now,
        }
        detail.messages.push(message)
        detail.session.messageCount += 1
      }
      detail.session.title = input.spec.title
      detail.session.generationCount += 1
      detail.session.latestGenerationId = genId
      detail.session.latestGenerationTitle = input.spec.title
      detail.session.latestGenerationDomain = input.spec.domain
      detail.session.updatedAt = now
      return { generation, message, session: { ...detail.session } }
    },
    listGenerations: async () =>
      [...sessions.values()].flatMap((detail) => detail.generations),
  }
}

beforeEach(() => {
  setSessionStorageClient(createMemoryClient())
  useSessionStore.setState({
    hydrated: false,
    loading: false,
    sessions: [],
    dbPath: null,
    activeSessionId: null,
    selectedSessionId: null,
    selectedDetail: null,
    loadingDetail: false,
    error: null,
  })
})

afterEach(() => {
  resetSessionStorageClient()
})

describe('useSessionStore', () => {
  it('creates a session, saves generated content, and deletes cleanly', async () => {
    const store = useSessionStore.getState()
    const sessionId = await store.startSession({
      title: '洛伦兹吸引子',
      source: 'text',
      initialPrompt: '模拟洛伦兹吸引子',
    })
    expect(sessionId).toBeTruthy()
    expect(useSessionStore.getState().activeSessionId).toBe(sessionId)

    const gen = await useSessionStore.getState().recordGeneration(sessionId!, {
      mode: 'create',
      prompt: '模拟洛伦兹吸引子',
      spec: SAMPLE_SPEC,
      params: { sigma: 10 },
      assistantSummary: '已生成实验「洛伦兹吸引子」',
    })
    expect(gen?.title).toBe('洛伦兹吸引子')
    expect(useSessionStore.getState().sessions).toHaveLength(1)
    expect(useSessionStore.getState().sessions[0].generationCount).toBe(1)

    await useSessionStore.getState().selectSession(sessionId!)
    expect(useSessionStore.getState().selectedDetail?.generations).toHaveLength(1)
    expect(useSessionStore.getState().selectedDetail?.messages).toHaveLength(2)

    const deleted = await useSessionStore.getState().deleteSession(sessionId!)
    expect(deleted).toBe(true)
    expect(useSessionStore.getState().sessions).toHaveLength(0)
    expect(useSessionStore.getState().activeSessionId).toBeNull()
  })
})
