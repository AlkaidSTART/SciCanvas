import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { MAX_IMAGE_BYTES } from '../src/ai/image.ts'
import type { AiServerConfig } from './generate.ts'
import { generateExperiment } from './generate.ts'
import { recognizePaperImage } from './recognize.ts'

/** 微调/修复请求会携带当前实验的完整 schema（含仿真代码），因此放宽到 64KB。 */
const MAX_GENERATE_BODY_BYTES = 64 * 1024
/** 图片 data URL 约为原始字节的 4/3，额外留出 JSON 包装空间。 */
const MAX_RECOGNIZE_BODY_BYTES = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 64 * 1024
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 10
const RECOGNIZE_RATE_LIMIT_MAX = 6

const hits = new Map<string, number[]>()

type Route = 'generate' | 'recognize'

function isRateLimited(key: string, max: number): boolean {
  const now = Date.now()
  const recent = (hits.get(key) ?? []).filter((time) => now - time < RATE_LIMIT_WINDOW_MS)
  if (recent.length >= max) {
    hits.set(key, recent)
    return true
  }
  recent.push(now)
  hits.set(key, recent)
  return false
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.end(JSON.stringify(body))
}

interface BodyError extends Error {
  code: 'payload_too_large' | 'invalid_json'
}

function readJsonBody(req: IncomingMessage, limit: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0
    let tooLarge = false
    const chunks: Buffer[] = []

    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        tooLarge = true
        chunks.length = 0
        return
      }
      if (!tooLarge) chunks.push(chunk)
    })
    req.on('end', () => {
      if (tooLarge) {
        const error = new Error('请求体过大') as BodyError
        error.code = 'payload_too_large'
        reject(error)
        return
      }
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve(text ? JSON.parse(text) : {})
      } catch {
        const error = new Error('请求体不是合法 JSON') as BodyError
        error.code = 'invalid_json'
        reject(error)
      }
    })
    req.on('aborted', () => reject(new Error('请求已中断')))
    req.on('error', reject)
  })
}

function createMiddleware(config: AiServerConfig) {
  return (
    req: IncomingMessage,
    res: ServerResponse,
    next: (error?: unknown) => void,
  ): void => {
    const pathname = (req.url ?? '').split('?')[0]
    const route: Route | null =
      pathname === '/api/generate'
        ? 'generate'
        : pathname === '/api/recognize'
          ? 'recognize'
          : null
    if (!route) {
      next()
      return
    }

    void (async () => {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST')
        sendJson(res, 405, {
          ok: false,
          error: { code: 'bad_request', message: '仅支持 POST 请求' },
        })
        return
      }

      const address = req.socket.remoteAddress ?? 'unknown'
      const rateLimitMax = route === 'recognize' ? RECOGNIZE_RATE_LIMIT_MAX : RATE_LIMIT_MAX
      if (isRateLimited(`${route}:${address}`, rateLimitMax)) {
        sendJson(res, 429, {
          ok: false,
          error: { code: 'rate_limit', message: '请求过于频繁，请稍后再试' },
        })
        return
      }

      let body: unknown
      try {
        body = await readJsonBody(
          req,
          route === 'recognize' ? MAX_RECOGNIZE_BODY_BYTES : MAX_GENERATE_BODY_BYTES,
        )
      } catch (error) {
        const code = (error as BodyError).code
        if (code === 'payload_too_large') {
          sendJson(res, 413, {
            ok: false,
            error:
              route === 'recognize'
                ? { code: 'image_too_large', message: '图片过大，请压缩到 4 MB 以内' }
                : { code: 'bad_request', message: '请求体过大' },
          })
        } else {
          sendJson(res, 400, {
            ok: false,
            error: { code: 'bad_request', message: '请求体不是合法 JSON' },
          })
        }
        return
      }

      const result =
        route === 'recognize'
          ? await recognizePaperImage(body, config)
          : await generateExperiment(body, config)
      sendJson(res, result.status, result.body)
    })().catch(() => {
      if (!res.headersSent) {
        sendJson(res, 500, {
          ok: false,
          error: { code: 'server_error', message: '生成服务出现未知错误' },
        })
      }
    })
  }
}

/**
 * Vite 开发与预览服务器的同源代理插件。
 * 模型凭证只从构建进程的环境变量读取，不进入客户端 bundle。
 */
export function aiProxyPlugin(config: AiServerConfig): Plugin {
  return {
    name: 'scicanvas-ai-proxy',
    configureServer(server) {
      server.middlewares.use(createMiddleware(config))
    },
    configurePreviewServer(server) {
      server.middlewares.use(createMiddleware(config))
    },
  }
}
