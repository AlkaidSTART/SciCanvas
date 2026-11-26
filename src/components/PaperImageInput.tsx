import { useCallback, useEffect, useRef, useState } from 'react'
import { generateExperiment, recognizeImage } from '../ai/client'
import type { RecognitionResult } from '../ai/client'
import {
  MAX_IMAGE_BYTES,
  formatBytes,
  readImageFile,
  validateImageDataUrl,
  validateImageMeta,
} from '../ai/image'
import type { SupportedImageType } from '../ai/image'
import { buildRecognitionPrompt } from '../ai/recognition'
import { useFloatingBallStore } from '../store/useFloatingBallStore'
import { useWorkbenchStore } from '../store/useWorkbenchStore'

interface LoadedImage {
  dataUrl: string
  mime: SupportedImageType
  name: string
  size: number
}

interface RecognitionDraft {
  formulaLatex: string
  description: string
}

const fieldClass =
  'resize-none rounded-[8px] border border-line bg-surface-soft px-2.5 py-[7px] text-[11px] leading-[1.55] text-ink placeholder:text-ink-faint focus:border-accent-line focus:outline-none disabled:cursor-not-allowed disabled:opacity-60'

interface PaperImageInputProps {
  onImageLoaded?: () => void
}

/**
 * 论文截图输入 → 多模态识别 → 用户确认编辑 → 复用 M3 文本生成。
 * 所有失败都停留在当前步骤，不替换画布上已有的实验。
 */
export function PaperImageInput({ onImageLoaded }: PaperImageInputProps = {}) {
  const applyGeneratedExperiment = useWorkbenchStore((state) => state.applyGeneratedExperiment)
  const presentation = useWorkbenchStore((state) => state.presentation)
  const pendingImage = useFloatingBallStore((state) => state.pendingImage)
  const setPendingImage = useFloatingBallStore((state) => state.setPendingImage)

  const [image, setImage] = useState<LoadedImage | null>(null)
  const [imageError, setImageError] = useState<string | null>(null)
  const [recognizing, setRecognizing] = useState(false)
  const [recognition, setRecognition] = useState<RecognitionResult | null>(null)
  const [draft, setDraft] = useState<RecognitionDraft | null>(null)
  const [generating, setGenerating] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const recognizeControllerRef = useRef<AbortController | null>(null)
  const generateControllerRef = useRef<AbortController | null>(null)

  useEffect(
    () => () => {
      recognizeControllerRef.current?.abort()
      generateControllerRef.current?.abort()
    },
    [],
  )

  const loadFile = useCallback(
    async (file: File) => {
      if (recognizing || generating) return
      const meta = validateImageMeta({ type: file.type, size: file.size })
      if (!meta.ok) {
        setImageError(meta.message)
        return
      }
      try {
        const dataUrl = await readImageFile(file)
        const dataValidation = validateImageDataUrl(dataUrl)
        if (!dataValidation.ok) {
          setImageError(dataValidation.message)
          return
        }
        setImage({
          dataUrl,
          mime: dataValidation.mime,
          name: file.name || '粘贴的截图',
          size: dataValidation.bytes,
        })
        setImageError(null)
        setAiError(null)
        setRecognition(null)
        setDraft(null)
        onImageLoaded?.()
      } catch {
        setImageError('图片读取失败，请重新选择')
      }
    },
    [recognizing, generating, onImageLoaded],
  )

  // 接收悬浮球框选的论文公式截图，自动载入预览区等待识别。
  useEffect(() => {
    const consumePending = (pending: { dataUrl: string; name: string } | null) => {
      if (!pending) return
      const validation = validateImageDataUrl(pending.dataUrl)
      useFloatingBallStore.getState().setPendingImage(null)
      if (!validation.ok) {
        setImageError(validation.message)
        return
      }
      setImage({
        dataUrl: pending.dataUrl,
        mime: validation.mime,
        name: pending.name,
        size: validation.bytes,
      })
      setImageError(null)
      setAiError(null)
      setRecognition(null)
      setDraft(null)
      onImageLoaded?.()
    }

    const unsubscribe = useFloatingBallStore.subscribe((state, prevState) => {
      if (state.pendingImage && state.pendingImage !== prevState.pendingImage) {
        consumePending(state.pendingImage)
      }
    })
    return unsubscribe
  }, [onImageLoaded])

  // 在页面任意位置粘贴截图即可载入，文字粘贴不受影响。
  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      if (presentation) return
      const items = event.clipboardData?.items
      if (!items) return
      for (const item of Array.from(items)) {
        if (item.kind !== 'file' || !item.type.startsWith('image/')) continue
        const file = item.getAsFile()
        if (!file) continue
        event.preventDefault()
        void loadFile(file)
        return
      }
    }
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [loadFile, presentation])

  const handleRecognize = async () => {
    if (!image || recognizing || generating) return
    const controller = new AbortController()
    recognizeControllerRef.current = controller
    setRecognizing(true)
    setImageError(null)
    setAiError(null)
    try {
      const result = await recognizeImage(image.dataUrl, { signal: controller.signal })
      setRecognition(result)
      setDraft({ formulaLatex: result.formulaLatex, description: result.description })
    } catch (error) {
      if (!controller.signal.aborted) {
        setImageError(error instanceof Error ? error.message : '识别失败，请稍后重试')
      }
    } finally {
      if (recognizeControllerRef.current === controller) {
        recognizeControllerRef.current = null
        setRecognizing(false)
      }
    }
  }

  const handleCancelRecognize = () => {
    recognizeControllerRef.current?.abort()
    recognizeControllerRef.current = null
    setRecognizing(false)
  }

  const handleGenerate = async () => {
    if (!draft || !recognition || generating) return
    const prompt = buildRecognitionPrompt({
      ...recognition,
      formulaLatex: draft.formulaLatex,
      description: draft.description,
    })
    if (!prompt) {
      setAiError('请至少保留公式或机理说明')
      return
    }

    const controller = new AbortController()
    generateControllerRef.current = controller
    setGenerating(true)
    setAiError(null)
    try {
      const spec = await generateExperiment(prompt, { signal: controller.signal })
      applyGeneratedExperiment(spec, undefined, { newRecord: true })
      setImage(null)
      setRecognition(null)
      setDraft(null)
      setImageError(null)
    } catch (error) {
      if (!controller.signal.aborted) {
        setAiError(error instanceof Error ? error.message : '生成失败，请稍后重试')
      }
    } finally {
      if (generateControllerRef.current === controller) {
        generateControllerRef.current = null
        setGenerating(false)
      }
    }
  }

  const handleCancelGenerate = () => {
    generateControllerRef.current?.abort()
    generateControllerRef.current = null
    setGenerating(false)
  }

  const handleRemoveImage = () => {
    setImage(null)
    setRecognition(null)
    setDraft(null)
    setAiError(null)
    setImageError(null)
  }

  const confidenceLabel =
    recognition?.confidence === undefined
      ? '未给出置信度'
      : `置信度 ${Math.round(recognition.confidence * 100)}%`

  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-[rgba(138,118,168,0.28)] bg-[rgba(138,118,168,0.05)] p-2.5">
      <h3 className="m-0 flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#6d5a7d]">
        论文截图识别
        <span className="rounded-[5px] border border-[rgba(138,118,168,0.28)] bg-surface px-1.5 py-0.5 font-mono text-[9px] normal-case tracking-normal text-ink-dim">
          M8
        </span>
      </h3>

      <p className="m-0 text-[9.5px] leading-[1.55] text-ink-faint">
        图片会发送给服务端配置的多模态模型用于本次识别，不会写入本地工作区；识别结果需确认后才进入生成。
      </p>

      <input
        ref={fileInputRef}
        className="hidden"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        aria-label="选择论文截图"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void loadFile(file)
        }}
      />

      {!image && (
        <button
          className="flex flex-col items-center gap-1 rounded-[9px] border border-dashed border-[rgba(138,118,168,0.45)] bg-surface/60 px-3 py-4 text-center transition-colors enabled:hover:border-[rgba(138,118,168,0.7)] enabled:hover:bg-[rgba(138,118,168,0.08)] disabled:cursor-not-allowed disabled:opacity-60"
          type="button"
          disabled={recognizing || generating}
          onClick={() => fileInputRef.current?.click()}
        >
          <span className="text-[11px] font-medium text-ink-dim">
            粘贴截图（⌘V）或点击选择
          </span>
          <small className="text-[9.5px] text-ink-faint">
            单张 PNG / JPEG / WebP，不超过 {formatBytes(MAX_IMAGE_BYTES)}
          </small>
        </button>
      )}

      {image && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 rounded-[8px] border border-line bg-surface px-2 py-1.5">
            <img
              src={image.dataUrl}
              alt="待识别的论文截图预览"
              className="h-12 w-16 flex-none rounded-[5px] border border-line bg-canvas object-contain"
            />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[11px] text-ink" title={image.name}>
                {image.name}
              </span>
              <small className="font-mono text-[9.5px] text-ink-faint">
                {image.mime.replace('image/', '').toUpperCase()} · {formatBytes(image.size)}
              </small>
            </div>
          </div>

          {!draft && (
            <div className="flex gap-1.5">
              <button
                className="flex-1 rounded-lg border border-transparent bg-[#6d5a7d] px-3 py-[6px] text-[11px] font-semibold text-[#fbf7ef] transition-colors enabled:hover:bg-[#5d4b6c] disabled:cursor-not-allowed disabled:opacity-45"
                type="button"
                disabled={recognizing || generating}
                onClick={() => void handleRecognize()}
              >
                {recognizing ? '识别中…' : '识别截图'}
              </button>
              {recognizing ? (
                <button
                  className="rounded-lg border border-line bg-surface px-2.5 py-[6px] text-[11px] text-ink-dim transition-colors enabled:hover:border-line-strong enabled:hover:bg-surface-soft enabled:hover:text-ink"
                  type="button"
                  onClick={handleCancelRecognize}
                >
                  取消
                </button>
              ) : (
                <>
                  <button
                    className="rounded-lg border border-line bg-surface px-2.5 py-[6px] text-[11px] text-ink-dim transition-colors enabled:hover:border-line-strong enabled:hover:bg-surface-soft enabled:hover:text-ink"
                    type="button"
                    disabled={generating}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    替换
                  </button>
                  <button
                    className="rounded-lg border border-line bg-surface px-2.5 py-[6px] text-[11px] text-ink-dim transition-colors enabled:hover:border-line-strong enabled:hover:bg-surface-soft enabled:hover:text-ink"
                    type="button"
                    disabled={generating}
                    onClick={handleRemoveImage}
                  >
                    移除
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {imageError && (
        <p
          className="m-0 rounded-[9px] border border-rose/30 bg-rose/[0.1] px-2.5 py-2 text-[10.5px] leading-[1.55] text-[#a9605f]"
          role="alert"
        >
          {imageError}
        </p>
      )}

      {draft && recognition && (
        <div className="flex flex-col gap-2 rounded-[9px] border border-[rgba(138,118,168,0.35)] bg-surface p-2.5">
          <div className="flex items-center justify-between gap-2">
            <h4 className="m-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#6d5a7d]">
              确认识别内容
            </h4>
            <span className="whitespace-nowrap font-mono text-[9px] text-ink-faint">
              {confidenceLabel}
            </span>
          </div>

          {recognition.uncertain.length > 0 && (
            <div className="rounded-[7px] border border-[rgba(217,162,74,0.35)] bg-[rgba(217,162,74,0.1)] px-2 py-1.5">
              <span className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[#9a7229]">
                需要确认
              </span>
              <ul className="m-0 mt-1 list-disc pl-3.5 text-[10px] leading-[1.5] text-[#82611f]">
                {recognition.uncertain.map((item, index) => (
                  <li key={`${index}-${item}`}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          <label className="flex flex-col gap-1">
            <span className="text-[9.5px] text-ink-faint">公式（LaTeX，可留空）</span>
            <textarea
              className={fieldClass}
              rows={2}
              value={draft.formulaLatex}
              disabled={generating}
              aria-label="识别出的公式"
              onChange={(event) =>
                setDraft((current) =>
                  current ? { ...current, formulaLatex: event.target.value } : current,
                )
              }
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[9.5px] text-ink-faint">机理说明</span>
            <textarea
              className={fieldClass}
              rows={4}
              value={draft.description}
              disabled={generating}
              aria-label="识别出的机理说明"
              onChange={(event) =>
                setDraft((current) =>
                  current ? { ...current, description: event.target.value } : current,
                )
              }
            />
          </label>

          {recognition.variables.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[9.5px] text-ink-faint">变量</span>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {recognition.variables.map((variable, index) => (
                  <li
                    key={`${index}-${variable.symbol}`}
                    className="flex items-baseline gap-1.5 text-[10px] leading-[1.45] text-ink-dim"
                  >
                    <code className="rounded-[4px] border border-line bg-surface-soft px-1 py-[1px] font-mono text-[9.5px] text-accent-strong">
                      {variable.symbol}
                    </code>
                    <span className="min-w-0 flex-1">{variable.meaning}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center gap-1.5">
            <button
              className="flex-1 rounded-lg border border-transparent bg-[#6d5a7d] px-3 py-[6px] text-[11px] font-semibold text-[#fbf7ef] transition-colors enabled:hover:bg-[#5d4b6c] disabled:cursor-not-allowed disabled:opacity-45"
              type="button"
              disabled={generating}
              onClick={() => void handleGenerate()}
            >
              {generating ? '生成中…' : '确认并生成实验'}
            </button>
            {generating ? (
              <button
                className="rounded-lg border border-line bg-surface px-2.5 py-[6px] text-[11px] text-ink-dim transition-colors enabled:hover:border-line-strong enabled:hover:bg-surface-soft enabled:hover:text-ink"
                type="button"
                onClick={handleCancelGenerate}
              >
                取消
              </button>
            ) : (
              <button
                className="rounded-lg border border-line bg-surface px-2.5 py-[6px] text-[11px] text-ink-dim transition-colors enabled:hover:border-line-strong enabled:hover:bg-surface-soft enabled:hover:text-ink"
                type="button"
                onClick={() => {
                  setDraft(null)
                  setRecognition(null)
                  setAiError(null)
                }}
              >
                取消
              </button>
            )}
          </div>
          <p className="m-0 text-[9.5px] leading-[1.55] text-ink-faint">
            确认后的内容会作为文本请求复用 M3 生成与 Schema 校验；生成失败时当前实验保持不变。
          </p>
        </div>
      )}

      {aiError && (
        <p
          className="m-0 rounded-[9px] border border-rose/30 bg-rose/[0.1] px-2.5 py-2 text-[10.5px] leading-[1.55] text-[#a9605f]"
          role="alert"
        >
          {aiError}
        </p>
      )}
    </div>
  )
}
