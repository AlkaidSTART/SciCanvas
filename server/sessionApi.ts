import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { validateGeneratedSpec } from '../src/ai/schema.ts'
import type {
  AppendMessageInput,
  CreateSessionInput,
  SaveGenerationInput,
} from '../src/sessions/types.ts'
import { createSqliteSessionStore } from './sqliteStore.ts'
import type { SqliteSessionStore } from './sqliteStore.ts'

const MAX_BODY_BYTES = 256 * 1024

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.end(JSON.stringify(body))
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0
    let tooLarge = false
    const chunks: Buffer[] = []

    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        tooLarge = true
        chunks.length = 0
        return
      }
      if (!tooLarge) chunks.push(chunk)
    })
    req.on('end', () => {
      if (tooLarge) {
        reject(new Error('payload_too_large'))
        return
      }
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve(text ? JSON.parse(text) : {})
      } catch {
        reject(new Error('invalid_json'))
      }
    })
    req.on('error', reject)
  })
}

export function createSessionApiMiddleware(store: SqliteSessionStore) {
  return (
    req: IncomingMessage,
    res: ServerResponse,
    next: (error?: unknown) => void,
  ): void => {
    const rawUrl = req.url ?? ''
    const url = new URL(rawUrl, 'http://localhost')
    const pathname = url.pathname

    if (!pathname.startsWith('/api/sessions') && !pathname.startsWith('/api/generations')) {
      next()
      return
    }

    void (async () => {
      const method = (req.method ?? 'GET').toUpperCase()

      // GET /api/sessions
      if (pathname === '/api/sessions' && method === 'GET') {
        const limitParam = Number(url.searchParams.get('limit') ?? '100')
        const sessions = store.listSessions(Number.isFinite(limitParam) ? limitParam : 100)
        sendJson(res, 200, { ok: true, sessions, dbPath: store.dbPath })
        return
      }

      // POST /api/sessions
      if (pathname === '/api/sessions' && method === 'POST') {
        const body = await readJsonBody(req)
        if (!isRecord(body) || typeof body.title !== 'string') {
          sendJson(res, 400, { ok: false, error: '缺少有效的会话标题 title' })
          return
        }
        const input: CreateSessionInput = {
          id: typeof body.id === 'string' ? body.id : undefined,
          title: body.title,
          source: body.source === 'image' ? 'image' : 'text',
          workspaceRecordId:
            typeof body.workspaceRecordId === 'string' ? body.workspaceRecordId : null,
          initialPrompt: typeof body.initialPrompt === 'string' ? body.initialPrompt : undefined,
          initialMode:
            body.initialMode === 'refine' ||
            body.initialMode === 'repair' ||
            body.initialMode === 'recognize'
              ? body.initialMode
              : 'create',
        }
        const detail = store.createSession(input)
        sendJson(res, 201, { ok: true, detail })
        return
      }

      // /api/sessions/:id
      const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/)
      if (sessionMatch) {
        const sessionId = decodeURIComponent(sessionMatch[1])
        if (method === 'GET') {
          const detail = store.getSessionDetail(sessionId)
          if (!detail) {
            sendJson(res, 404, { ok: false, error: '会话不存在' })
            return
          }
          sendJson(res, 200, { ok: true, detail })
          return
        }
        if (method === 'DELETE') {
          const deleted = store.deleteSession(sessionId)
          if (!deleted) {
            sendJson(res, 404, { ok: false, error: '会话不存在' })
            return
          }
          sendJson(res, 200, { ok: true })
          return
        }
        res.setHeader('Allow', 'GET, DELETE')
        sendJson(res, 405, { ok: false, error: '不支持的请求方法' })
        return
      }

      // POST /api/sessions/:id/messages
      const messageMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/messages$/)
      if (messageMatch) {
        if (method !== 'POST') {
          res.setHeader('Allow', 'POST')
          sendJson(res, 405, { ok: false, error: '仅支持 POST 请求' })
          return
        }
        const sessionId = decodeURIComponent(messageMatch[1])
        const body = await readJsonBody(req)
        if (
          !isRecord(body) ||
          (body.role !== 'user' && body.role !== 'assistant' && body.role !== 'system') ||
          typeof body.content !== 'string'
        ) {
          sendJson(res, 400, { ok: false, error: '消息参数不合法' })
          return
        }
        const input: AppendMessageInput = {
          id: typeof body.id === 'string' ? body.id : undefined,
          role: body.role,
          mode:
            body.mode === 'refine' || body.mode === 'repair' || body.mode === 'recognize'
              ? body.mode
              : 'create',
          content: body.content,
          status: body.status === 'error' ? 'error' : 'ok',
          generationId: typeof body.generationId === 'string' ? body.generationId : null,
        }
        const message = store.appendMessage(sessionId, input)
        if (!message) {
          sendJson(res, 404, { ok: false, error: '会话不存在' })
          return
        }
        sendJson(res, 201, { ok: true, message })
        return
      }

      // POST /api/sessions/:id/generations
      const generationMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/generations$/)
      if (generationMatch) {
        if (method !== 'POST') {
          res.setHeader('Allow', 'POST')
          sendJson(res, 405, { ok: false, error: '仅支持 POST 请求' })
          return
        }
        const sessionId = decodeURIComponent(generationMatch[1])
        const body = await readJsonBody(req)
        if (!isRecord(body) || typeof body.prompt !== 'string') {
          sendJson(res, 400, { ok: false, error: '缺少 prompt 或 spec 参数' })
          return
        }
        const validation = validateGeneratedSpec(body.spec)
        if (!validation.ok) {
          sendJson(res, 400, {
            ok: false,
            error: `生成内容未通过校验：${validation.issues[0] ?? '格式错误'}`,
          })
          return
        }
        const input: SaveGenerationInput = {
          id: typeof body.id === 'string' ? body.id : undefined,
          messageId: typeof body.messageId === 'string' ? body.messageId : null,
          mode: body.mode === 'refine' || body.mode === 'repair' ? body.mode : 'create',
          prompt: body.prompt,
          spec: validation.spec,
          params: isRecord(body.params)
            ? (body.params as SaveGenerationInput['params'])
            : null,
          assistantSummary:
            typeof body.assistantSummary === 'string' ? body.assistantSummary : null,
        }
        const result = store.saveGeneration(sessionId, input)
        if (!result) {
          sendJson(res, 404, { ok: false, error: '会话不存在' })
          return
        }
        sendJson(res, 201, { ok: true, result })
        return
      }

      // GET /api/generations
      if (pathname === '/api/generations' && method === 'GET') {
        const sessionId = url.searchParams.get('sessionId') ?? undefined
        const limitParam = Number(url.searchParams.get('limit') ?? '100')
        const generations = store.listGenerations({
          sessionId,
          limit: Number.isFinite(limitParam) ? limitParam : 100,
        })
        sendJson(res, 200, { ok: true, generations })
        return
      }

      // GET /api/generations/:id
      const singleGenMatch = pathname.match(/^\/api\/generations\/([^/]+)$/)
      if (singleGenMatch && method === 'GET') {
        const id = decodeURIComponent(singleGenMatch[1])
        const generation = store.getGeneration(id)
        if (!generation) {
          sendJson(res, 404, { ok: false, error: '生成记录不存在' })
          return
        }
        sendJson(res, 200, { ok: true, generation })
        return
      }

      sendJson(res, 404, { ok: false, error: '接口不存在' })
    })().catch((error: unknown) => {
      if (res.headersSent) return
      const msg = error instanceof Error ? error.message : ''
      if (msg === 'payload_too_large') {
        sendJson(res, 413, { ok: false, error: '请求体过大' })
        return
      }
      if (msg === 'invalid_json') {
        sendJson(res, 400, { ok: false, error: '请求体不是合法 JSON' })
        return
      }
      sendJson(res, 500, { ok: false, error: 'SQLite 存储服务内部错误' })
    })
  }
}

export interface SessionApiPluginOptions {
  dbPath?: string
}

/**
 * Vite 开发与预览服务器的 SQLite 会话持久化插件。
 */
export function sessionApiPlugin(options: SessionApiPluginOptions = {}): Plugin {
  let store: SqliteSessionStore | null = null
  const getStore = () => {
    if (!store) {
      store = createSqliteSessionStore(options.dbPath || undefined)
    }
    return store
  }

  return {
    name: 'scicanvas-sqlite-session-api',
    configureServer(server) {
      server.middlewares.use(createSessionApiMiddleware(getStore()))
      server.httpServer?.once('close', () => {
        store?.close()
        store = null
      })
    },
    configurePreviewServer(server) {
      server.middlewares.use(createSessionApiMiddleware(getStore()))
      server.httpServer?.once('close', () => {
        store?.close()
        store = null
      })
    },
  }
}
