import { afterEach, describe, expect, it, vi } from 'vitest'
import { BLOB_REVOKE_DELAY_MS, downloadHtmlFile } from './download'

const originalCreateObjectURL = URL.createObjectURL
const originalRevokeObjectURL = URL.revokeObjectURL

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  URL.createObjectURL = originalCreateObjectURL
  URL.revokeObjectURL = originalRevokeObjectURL
})

describe('M6 下载与 Blob 回收', () => {
  it('触发一次下载，并在延迟后释放临时 URL', () => {
    vi.useFakeTimers()
    const createObjectURL = vi.fn((blob: Blob) => {
      expect(blob.type).toBe('text/html;charset=utf-8')
      return 'blob:scicanvas-test'
    })
    const revokeObjectURL = vi.fn()
    URL.createObjectURL = createObjectURL
    URL.revokeObjectURL = revokeObjectURL

    let downloadedName = ''
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        downloadedName = this.download
      })

    downloadHtmlFile('<html><body>ok</body></html>', '阻尼振子.html')

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(click).toHaveBeenCalledTimes(1)
    expect(downloadedName).toBe('阻尼振子.html')
    expect(document.querySelector('a[download]')).toBeNull()
    expect(revokeObjectURL).not.toHaveBeenCalled()

    vi.advanceTimersByTime(BLOB_REVOKE_DELAY_MS)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:scicanvas-test')
  })
})
