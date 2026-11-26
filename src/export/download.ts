/** 下载完成后延迟释放的毫秒数，给浏览器留出读取 Blob 的时间。 */
export const BLOB_REVOKE_DELAY_MS = 1000

/**
 * 触发浏览器下载单文件 HTML，并在下载启动后释放临时 Blob URL，
 * 避免长期持有导出内容导致内存无法回收。
 */
export function downloadHtmlFile(html: string, fileName: string): void {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.rel = 'noopener'
  anchor.style.display = 'none'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), BLOB_REVOKE_DELAY_MS)
}
