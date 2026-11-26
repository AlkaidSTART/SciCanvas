import path from 'node:path'
import { build } from 'vite'
import type { Plugin } from 'vite'

const VIRTUAL_MODULE_ID = 'virtual:scicanvas-player'
const RESOLVED_ID = `\0${VIRTUAL_MODULE_ID}`

/**
 * 把独立播放器入口打包成一段 IIFE 代码，供导出时内联进单文件 HTML。
 * 使用嵌套构建而不是提交生成产物，避免运行时与播放器代码版本漂移。
 */
async function bundlePlayer(root: string): Promise<string> {
  const result = await build({
    root,
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      target: 'es2020',
      lib: {
        entry: path.resolve(root, 'src/export/standalone.ts'),
        formats: ['iife'],
        name: 'SciCanvasExport',
        fileName: () => 'scicanvas-export-player.js',
      },
    },
  })

  const outputs = Array.isArray(result) ? result : [result]
  for (const output of outputs) {
    if (!('output' in output)) continue
    for (const item of output.output) {
      if (item.type === 'chunk' && item.isEntry) return item.code
    }
  }
  throw new Error('无法生成离线导出运行时')
}

export function standalonePlayerPlugin(): Plugin {
  let root = process.cwd()
  let bundle: Promise<string> | null = null

  const getBundle = (): Promise<string> => {
    if (!bundle) {
      bundle = bundlePlayer(root).catch((error: unknown) => {
        bundle = null
        throw error
      })
    }
    return bundle
  }

  return {
    name: 'scicanvas-standalone-player',
    configResolved(config) {
      root = config.root
    },
    resolveId(id) {
      return id === VIRTUAL_MODULE_ID ? RESOLVED_ID : null
    },
    async load(id) {
      if (id !== RESOLVED_ID) return null
      const code = await getBundle()
      return `export default ${JSON.stringify(code)}`
    },
  }
}
