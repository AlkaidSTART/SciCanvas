import tailwindcss from '@tailwindcss/vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { defineConfig, loadEnv } from 'vite'
import { aiProxyPlugin } from './server/aiProxy.ts'
import { standalonePlayerPlugin } from './server/playerBundle.ts'
import { sessionApiPlugin } from './server/sessionApi.ts'
import { createSqliteSessionStore } from './server/sqliteStore.ts'
import type { SqliteSessionStore } from './server/sqliteStore.ts'

const DEFAULT_TASK_TIMEOUT_MS = 45_000
const host = process.env.TAURI_DEV_HOST

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // 模型凭证只在此构建进程中使用，不会注入客户端环境变量。
  const env = loadEnv(mode, process.cwd(), '')
  const timeoutMs = Number(env.AI_TIMEOUT_MS)
  const dbPath = env.SCICANVAS_DB_PATH || undefined
  let sharedStore: SqliteSessionStore | null = null
  const getSharedStore = () => {
    if (!sharedStore) {
      sharedStore = createSqliteSessionStore(dbPath)
    }
    return sharedStore
  }

  return {
    clearScreen: false,
    server: {
      port: 1420,
      strictPort: true,
      host: host || false,
      hmr: host
        ? {
            protocol: 'ws',
            host,
            port: 1421,
          }
        : undefined,
      watch: {
        ignored: ['**/src-tauri/**'],
      },
    },
    plugins: [
      tailwindcss(),
      react(),
      babel({ presets: [reactCompilerPreset()] }),
      standalonePlayerPlugin(),
      sessionApiPlugin({
        dbPath,
        getStore: getSharedStore,
      }),
      aiProxyPlugin({
        apiKey: env.AI_API_KEY,
        baseUrl: env.AI_BASE_URL || 'https://api.openai.com/v1',
        model: env.AI_MODEL || 'gpt-4o-mini',
        visionModel: env.AI_VISION_MODEL || env.AI_MODEL || 'gpt-4o-mini',
        timeoutMs:
          Number.isFinite(timeoutMs) && timeoutMs > 0
            ? timeoutMs
            : DEFAULT_TASK_TIMEOUT_MS,
        getActiveEndpoint: () => getSharedStore().getActiveLlmEndpoint(),
      }),
    ],
  }
})
