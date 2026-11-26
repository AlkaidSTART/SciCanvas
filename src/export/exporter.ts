import { useWorkbenchStore } from '../store/useWorkbenchStore'
import { downloadHtmlFile } from './download'
import {
  buildStandaloneHtml,
  createExportPayload,
  ExportError,
  sanitizeExportFileName,
} from './html'

export interface ExportResult {
  fileName: string
  bytes: number
}

/**
 * 导出当前实验为单文件 HTML。播放器运行时按需加载，
 * 任何一步失败都会抛出可读原因，且不会改动当前实验状态。
 */
export async function exportCurrentExperiment(): Promise<ExportResult> {
  const { experiment, params, speed, source, aiSpec } = useWorkbenchStore.getState()

  const payload = createExportPayload({ experiment, params, speed, source, aiSpec })

  let playerCode: string
  try {
    const module = await import('virtual:scicanvas-player')
    playerCode = module.default
  } catch (error) {
    throw new ExportError(
      `导出运行时加载失败：${error instanceof Error ? error.message : String(error)}`,
    )
  }

  const { html, bytes } = buildStandaloneHtml(payload, playerCode)
  const fileName = sanitizeExportFileName(payload.title)
  downloadHtmlFile(html, fileName)
  return { fileName, bytes }
}
