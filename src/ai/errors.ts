export type AiErrorCode =
  | 'aborted'
  | 'network'
  | 'timeout'
  | 'rate_limit'
  | 'not_configured'
  | 'invalid_json'
  | 'schema_invalid'
  | 'server_error'
  | 'bad_request'
  | 'image_invalid'
  | 'image_too_large'

export const AI_ERROR_MESSAGES: Record<AiErrorCode, string> = {
  aborted: '已取消生成',
  network: '无法连接生成服务，请检查网络后重试',
  timeout: '生成超时，请稍后重试',
  rate_limit: '请求过于频繁，请稍后再试',
  not_configured: '服务端尚未配置模型凭证，请联系管理员',
  invalid_json: '模型返回内容无法解析，请重试',
  schema_invalid: '模型输出未通过结构校验，请调整描述后重试',
  server_error: '生成服务暂时不可用，请稍后重试',
  bad_request: '请求不合法，请检查输入后重试',
  image_invalid: '图片格式不受支持，请使用 PNG、JPEG 或 WebP',
  image_too_large: '图片过大，请压缩到 4 MB 以内',
}
