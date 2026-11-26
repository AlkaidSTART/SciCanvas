import tailwindcss from '@tailwindcss/vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { defineConfig, loadEnv } from 'vite'
import { aiProxyPlugin } from './server/aiProxy.ts'
import { standalonePlayerPlugin } from './server/playerBundle.ts'

const DEFAULT_TASK_TIMEOUT_MS = 45_000

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // 模型凭证只在此构建进程中使用，不会注入客户端环境变量。
  const env = loadEnv(mode, process.cwd(), '')
  const timeoutMs = Number(env.AI_TIMEOUT_MS)

  return {
    plugins: [
      tailwindcss(),
      react(),
      babel({ presets: [reactCompilerPreset()] }),
      standalonePlayerPlugin(),
      aiProxyPlugin({
        apiKey: env.AI_API_KEY,
        baseUrl: env.AI_BASE_URL || 'https://api.openai.com/v1',
        model: env.AI_MODEL || 'gpt-4o-mini',
        visionModel: env.AI_VISION_MODEL || env.AI_MODEL || 'gpt-4o-mini',
        timeoutMs:
          Number.isFinite(timeoutMs) && timeoutMs > 0
            ? timeoutMs
            : DEFAULT_TASK_TIMEOUT_MS,
      }),
    ],
  }
})
