export const MAX_IMAGE_BYTES = 4 * 1024 * 1024
export const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

export type SupportedImageType = (typeof SUPPORTED_IMAGE_TYPES)[number]

export interface ImageMeta {
  type: string
  size: number
}

export type ImageValidation =
  | { ok: true; mime: SupportedImageType; bytes: number }
  | { ok: false; code: 'image_invalid' | 'image_too_large'; message: string }

const DATA_URL_PATTERN = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/

export function isSupportedImageType(type: string): type is SupportedImageType {
  return (SUPPORTED_IMAGE_TYPES as readonly string[]).includes(type)
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${Math.max(bytes, 0)} B`
}

/** 只根据文件元信息做格式与大小校验，避免读取超大文件。 */
export function validateImageMeta(meta: ImageMeta): ImageValidation {
  if (!isSupportedImageType(meta.type)) {
    return {
      ok: false,
      code: 'image_invalid',
      message: '图片格式不受支持，请使用 PNG、JPEG 或 WebP',
    }
  }
  if (!Number.isFinite(meta.size) || meta.size <= 0) {
    return { ok: false, code: 'image_invalid', message: '图片内容为空，请重新选择' }
  }
  if (meta.size > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      code: 'image_too_large',
      message: `图片大小为 ${formatBytes(meta.size)}，请压缩到 4 MB 以内`,
    }
  }
  return { ok: true, mime: meta.type, bytes: meta.size }
}

/** 服务端与客户端共用的 data URL 校验：格式白名单 + 解码后大小上限。 */
export function validateImageDataUrl(dataUrl: unknown): ImageValidation {
  if (typeof dataUrl !== 'string') {
    return { ok: false, code: 'image_invalid', message: '请提供图片数据' }
  }
  const match = DATA_URL_PATTERN.exec(dataUrl)
  if (!match) {
    return {
      ok: false,
      code: 'image_invalid',
      message: '图片格式不受支持，请使用 PNG、JPEG 或 WebP',
    }
  }
  const mime = match[1] as SupportedImageType
  const base64 = match[2]
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  const bytes = Math.floor((base64.length * 3) / 4) - padding
  if (bytes <= 0) {
    return { ok: false, code: 'image_invalid', message: '图片内容为空，请重新选择' }
  }
  if (bytes > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      code: 'image_too_large',
      message: `图片解码后约 ${formatBytes(bytes)}，请压缩到 4 MB 以内`,
    }
  }
  return { ok: true, mime, bytes }
}

/** 浏览器侧把文件读成 data URL；调用前应先用 validateImageMeta 校验。 */
export function readImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('图片读取失败'))
    }
    reader.readAsDataURL(file)
  })
}
