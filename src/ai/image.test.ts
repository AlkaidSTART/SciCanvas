import { describe, expect, it } from 'vitest'
import {
  MAX_IMAGE_BYTES,
  formatBytes,
  isSupportedImageType,
  validateImageDataUrl,
  validateImageMeta,
} from './image'

const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

function oversizedDataUrl(): string {
  const base64Length = Math.ceil(((MAX_IMAGE_BYTES + 1) * 4) / 3)
  return `data:image/png;base64,${'A'.repeat(base64Length)}`
}

describe('图片输入校验', () => {
  it('接受 PNG / JPEG / WebP', () => {
    expect(isSupportedImageType('image/png')).toBe(true)
    expect(isSupportedImageType('image/jpeg')).toBe(true)
    expect(isSupportedImageType('image/webp')).toBe(true)
    expect(isSupportedImageType('image/gif')).toBe(false)
  })

  it('校验合法 data URL 并估算解码大小', () => {
    const result = validateImageDataUrl(TINY_PNG)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.mime).toBe('image/png')
      expect(result.bytes).toBeGreaterThan(0)
      expect(result.bytes).toBeLessThan(1024)
    }
  })

  it('拒绝非图片 data URL、不支持格式与损坏的 base64', () => {
    const text = validateImageDataUrl('data:text/plain;base64,aGVsbG8=')
    expect(text).toMatchObject({ ok: false, code: 'image_invalid' })

    const gif = validateImageDataUrl('data:image/gif;base64,R0lGODlhAQABAAAAACw=')
    expect(gif).toMatchObject({ ok: false, code: 'image_invalid' })

    const remote = validateImageDataUrl('https://example.test/a.png')
    expect(remote).toMatchObject({ ok: false, code: 'image_invalid' })

    const broken = validateImageDataUrl('data:image/png;base64,abc-def')
    expect(broken).toMatchObject({ ok: false, code: 'image_invalid' })

    expect(validateImageDataUrl(undefined)).toMatchObject({ ok: false, code: 'image_invalid' })
  })

  it('超过 4 MB 的图片返回 image_too_large', () => {
    const result = validateImageDataUrl(oversizedDataUrl())
    expect(result).toMatchObject({ ok: false, code: 'image_too_large' })
    if (!result.ok) expect(result.message).toContain('4 MB')
  })

  it('按文件元信息提前拦截格式与大小', () => {
    expect(validateImageMeta({ type: 'image/jpeg', size: 1024 })).toMatchObject({
      ok: true,
      mime: 'image/jpeg',
    })
    expect(validateImageMeta({ type: 'image/gif', size: 1024 })).toMatchObject({
      ok: false,
      code: 'image_invalid',
    })
    expect(validateImageMeta({ type: 'image/png', size: 0 })).toMatchObject({
      ok: false,
      code: 'image_invalid',
    })
    expect(validateImageMeta({ type: 'image/png', size: MAX_IMAGE_BYTES + 1 })).toMatchObject({
      ok: false,
      code: 'image_too_large',
    })
  })

  it('格式化文件大小', () => {
    expect(formatBytes(900)).toBe('900 B')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(MAX_IMAGE_BYTES)).toBe('4.0 MB')
  })
})
