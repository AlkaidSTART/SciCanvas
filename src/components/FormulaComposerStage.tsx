import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { generateExperiment, recognizeImage } from '../ai/client'
import {
  formatBytes,
  readImageFile,
  validateImageDataUrl,
  validateImageMeta,
} from '../ai/image'
import type { SupportedImageType } from '../ai/image'
import { MAX_PROMPT_LENGTH } from '../ai/prompt'
import { buildRecognitionPrompt } from '../ai/recognition'
import { selectFormulaSkills } from '../ai/skills'
import type { AppRoute } from '../hooks/useAppRoute'
import { useFloatingBallStore } from '../store/useFloatingBallStore'
import { useModelConfigStore } from '../store/useModelConfigStore'
import { useSessionStore } from '../store/useSessionStore'
import { useWorkbenchStore } from '../store/useWorkbenchStore'
import { createExperimentGroupId } from '../workspace/records'
import {
  ArrowRightIcon,
  BoltIcon,
  CloseIcon,
  FolderIcon,
  FolderPlusIcon,
  ModelIcon,
  PlusIcon,
  SparklesIcon,
  StopIcon,
} from './icons'
import { FAST_TRANSITION, MEDIUM_TRANSITION, TAP_BUTTON } from './motion'

interface FormulaComposerStageProps {
  onNavigate: (route: AppRoute) => void
}

interface AttachedImage {
  dataUrl: string
  mime: SupportedImageType
  name: string
  size: number
}

const QUICK_FORMULAS = [
  {
    label: '阻尼受迫振动',
    prompt:
      '模拟阻尼受迫振动 $m\\ddot{x} + c\\dot{x} + kx = F_0\\cos(\\omega t)$，可调阻尼系数与驱动频率，并展示位移随时间的变化与包络线。',
  },
  {
    label: '正态分布密度',
    prompt:
      '绘制正态分布概率密度函数 $f(x)=\\frac{1}{\\sigma\\sqrt{2\\pi}}e^{-\\frac{(x-\\mu)^2}{2\\sigma^2}}$，可调均值 $\\mu$ 与标准差 $\\sigma$，高亮 $\\mu\\pm\\sigma$ 区间面积。',
  },
  {
    label: '斯涅尔光路折射',
    prompt:
      '根据斯涅尔定律 $n_1\\sin\\theta_1 = n_2\\sin\\theta_2$ 绘制光路折射实验，展示入射光线、折射光线、法线与入射角/折射角。',
  },
  {
    label: '洛伦兹吸引子',
    prompt:
      '用 LaTeX 描述洛伦兹吸引子：$\\dot{x}=\\sigma(y-x),\\ \\dot{y}=x(\\rho-z)-y,\\ \\dot{z}=xy-\\beta z$，展示参数变化下的混沌轨迹。',
  },
] as const

export function FormulaComposerStage({ onNavigate }: FormulaComposerStageProps) {
  const composerTarget = useWorkbenchStore((state) => state.composerTarget)
  const openComposer = useWorkbenchStore((state) => state.openComposer)
  const applyGeneratedExperiment = useWorkbenchStore((state) => state.applyGeneratedExperiment)
  const healStatus = useWorkbenchStore((state) => state.heal.status)
  const presentation = useWorkbenchStore((state) => state.presentation)

  const activeModelEndpoint = useModelConfigStore(
    (state) => state.endpoints.find((item) => item.isActive) ?? null,
  )

  const prompt = useFloatingBallStore((state) => state.promptDraft)
  const setPrompt = useFloatingBallStore((state) => state.setPromptDraft)

  const [loading, setLoading] = useState(false)
  const [recognizing, setRecognizing] = useState(false)
  const [image, setImage] = useState<AttachedImage | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [promptHighlighted, setPromptHighlighted] = useState(false)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const generateControllerRef = useRef<AbortController | null>(null)
  const recognizeControllerRef = useRef<AbortController | null>(null)

  const healing = healStatus === 'requesting' || healStatus === 'applied'
  const matchedSkills = useMemo(() => selectFormulaSkills(prompt), [prompt])
  const isInsideFolder = composerTarget.groupId !== null

  const focusInput = useCallback(() => {
    window.requestAnimationFrame(() => {
      const input = textareaRef.current
      if (!input) return
      input.focus()
      const end = input.value.length
      input.setSelectionRange(end, end)
    })
  }, [])

  useEffect(() => {
    focusInput()
  }, [composerTarget.groupId, composerTarget.groupTitle, focusInput])

  useEffect(
    () => () => {
      generateControllerRef.current?.abort()
      recognizeControllerRef.current?.abort()
    },
    [],
  )

  // 自动根据内容微调输入框高度
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 76), 220)}px`
  }, [prompt])

  const loadFile = useCallback(
    async (file: File) => {
      if (recognizing || loading) return
      const meta = validateImageMeta({ type: file.type, size: file.size })
      if (!meta.ok) {
        setErrorMessage(meta.message)
        return
      }
      try {
        const dataUrl = await readImageFile(file)
        const validation = validateImageDataUrl(dataUrl)
        if (!validation.ok) {
          setErrorMessage(validation.message)
          return
        }
        setImage({
          dataUrl,
          mime: validation.mime,
          name: file.name || '粘贴的公式截图',
          size: validation.bytes,
        })
        setErrorMessage(null)
      } catch {
        setErrorMessage('图片读取失败，请重新选择')
      }
    },
    [loading, recognizing],
  )

  // 监听悬浮球发来的文本高亮与截图
  useEffect(() => {
    let timer: number | null = null
    const consumePendingImage = (pending: { dataUrl: string; name: string } | null) => {
      if (!pending) return
      const validation = validateImageDataUrl(pending.dataUrl)
      useFloatingBallStore.getState().setPendingImage(null)
      if (!validation.ok) {
        setErrorMessage(validation.message)
        return
      }
      setImage({
        dataUrl: pending.dataUrl,
        mime: validation.mime,
        name: pending.name,
        size: validation.bytes,
      })
      setErrorMessage(null)
    }

    consumePendingImage(useFloatingBallStore.getState().pendingImage)

    const unsubscribe = useFloatingBallStore.subscribe((state, prevState) => {
      if (state.pendingImage && state.pendingImage !== prevState.pendingImage) {
        consumePendingImage(state.pendingImage)
      }
      if (state.promptFlashKey !== prevState.promptFlashKey) {
        setPromptHighlighted(true)
        focusInput()
        if (timer !== null) window.clearTimeout(timer)
        timer = window.setTimeout(() => {
          setPromptHighlighted(false)
          timer = null
        }, 1400)
      }
    })
    return () => {
      unsubscribe()
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [focusInput])

  // 支持直接 ⌘V 粘贴论文公式截图
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

  const handleRecognizeImage = async () => {
    if (!image || recognizing || loading) return
    const controller = new AbortController()
    recognizeControllerRef.current = controller
    setRecognizing(true)
    setErrorMessage(null)
    try {
      const result = await recognizeImage(image.dataUrl, { signal: controller.signal })
      const recognizedPrompt = buildRecognitionPrompt(result)
      if (recognizedPrompt) {
        const merged = prompt.trim()
          ? `${prompt.trim()}\n\n${recognizedPrompt}`
          : recognizedPrompt
        setPrompt(merged.slice(0, MAX_PROMPT_LENGTH))
      }
      setImage(null)
      focusInput()
    } catch (error) {
      if (!controller.signal.aborted) {
        setErrorMessage(error instanceof Error ? error.message : '截图识别失败，请稍后重试')
      }
    } finally {
      if (recognizeControllerRef.current === controller) {
        recognizeControllerRef.current = null
      }
      setRecognizing(false)
    }
  }

  const runGenerate = async () => {
    if (loading || recognizing || healing) return
    const text = prompt.trim()
    if (!text) {
      setErrorMessage('请先输入公式或科学问题描述')
      focusInput()
      return
    }

    const controller = new AbortController()
    generateControllerRef.current = controller
    setLoading(true)
    setErrorMessage(null)

    const targetGroupId = composerTarget.groupId ?? createExperimentGroupId()
    const targetGroupTitleOverride = composerTarget.groupTitle

    const sessionStore = useSessionStore.getState()
    const sessionId = await sessionStore.startSession({
      title: text.slice(0, 48),
      source: 'text',
      initialPrompt: text,
      initialMode: 'create',
    })

    try {
      const spec = await generateExperiment(text, { signal: controller.signal })
      const resolvedGroupTitle = targetGroupTitleOverride ?? spec.title
      applyGeneratedExperiment(spec, undefined, {
        newRecord: true,
        groupId: targetGroupId,
        groupTitle: resolvedGroupTitle,
      })
      setPrompt('')
      setImage(null)
      onNavigate('workbench')
      if (sessionId) {
        void useSessionStore.getState().recordGeneration(sessionId, {
          mode: 'create',
          prompt: text,
          spec,
          params: useWorkbenchStore.getState().params,
          assistantSummary: `已通过 Skill 优化生成「${spec.title}」（${spec.domain}）`,
        })
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = error instanceof Error ? error.message : '生成失败，请稍后重试'
        setErrorMessage(message)
        if (sessionId) {
          void useSessionStore.getState().recordMessage(sessionId, {
            role: 'assistant',
            mode: 'create',
            content: message,
            status: 'error',
          })
        }
      }
    } finally {
      if (generateControllerRef.current === controller) {
        generateControllerRef.current = null
      }
      setLoading(false)
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void runGenerate()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void runGenerate()
    }
  }

  const handleCancel = () => {
    generateControllerRef.current?.abort()
    generateControllerRef.current = null
    setLoading(false)
  }

  const canSubmit = prompt.trim().length > 0 && !loading && !recognizing && !healing

  return (
    <section
      className="workbench-scroll flex min-h-0 flex-1 flex-col items-center justify-between overflow-y-auto px-5 pb-8 pt-10 sm:px-8"
      aria-label="新建公式绘图"
    >
      {/* 顶部留白 + 居中 Logo 与欢迎标题（仿照干净的对话启动页） */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={MEDIUM_TRANSITION}
        className="my-auto flex w-full max-w-[720px] flex-col items-center pb-6 pt-4 text-center"
      >
        <div className="mb-5 grid size-[54px] place-items-center rounded-[16px] border border-[rgba(124,157,187,0.28)] bg-[radial-gradient(circle_at_30%_25%,rgba(195,178,218,0.38),rgba(224,162,121,0.18))] text-[#6d5a7d] shadow-[0_8px_24px_rgba(58,51,43,0.06)]">
          <BoltIcon className="size-7" />
        </div>

        <h1 className="m-0 text-[24px] font-[600] tracking-[-0.01em] text-ink sm:text-[26px]">
          {isInsideFolder
            ? `在「${composerTarget.groupTitle ?? '当前实验'}」中新建实验`
            : '欢迎回来，今天想探索哪个公式？'}
        </h1>

        <p className="mt-2 max-w-[540px] text-[12.5px] leading-[1.6] text-ink-faint">
          {isInsideFolder
            ? '输入公式或科学机理，将通过 Skill 优化生成 Canvas 绘图并归档至当前实验文件夹。'
            : '输入公式或科学机理，自动通过公式建模 Skill 优化生成交互式 Canvas 绘图，并自动新建文件夹归档。'}
        </p>
      </motion.div>

      {/* 居中底部输入卡片 */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={MEDIUM_TRANSITION}
        className="flex w-full max-w-[740px] flex-col gap-3"
      >
        <form
          onSubmit={handleSubmit}
          className={`flex flex-col overflow-hidden rounded-[20px] border bg-surface shadow-[0_10px_32px_rgba(58,51,43,0.07)] transition-all ${
            promptHighlighted
              ? 'border-mint ring-4 ring-mint/20'
              : 'border-line-strong/80 focus-within:border-accent-line focus-within:shadow-[0_12px_36px_rgba(79,114,146,0.12)]'
          }`}
        >
          {/* 顶部上下文栏：归档目标文件夹 + 自动匹配的 Skill 徽标 */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/70 bg-panel/70 px-4 py-2 text-[11px]">
            <div className="flex min-w-0 items-center gap-2">
              {isInsideFolder ? (
                <span className="inline-flex max-w-[260px] items-center gap-1.5 rounded-full border border-accent-line/70 bg-accent-soft/60 px-2.5 py-0.5 text-[11px] font-medium text-accent-strong">
                  <FolderIcon className="size-3 flex-none" />
                  <span className="truncate">归档至：{composerTarget.groupTitle ?? '当前实验'}</span>
                  <button
                    type="button"
                    onClick={() => openComposer({ groupId: null, groupTitle: null })}
                    title="改为自动新建文件夹归档"
                    className="ml-0.5 grid size-4 flex-none place-items-center rounded-full text-accent-strong/75 transition-colors hover:bg-accent-strong/15 hover:text-accent-strong"
                    aria-label="切换为自动新建文件夹"
                  >
                    <CloseIcon className="size-2.5" />
                  </button>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-ink-dim">
                  <FolderPlusIcon className="size-3.5 text-ink-faint" />
                  <span>生成后自动新建文件夹归档</span>
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-[10px] text-ink-dim"
                title="每次生成自动注入四步公式场景建模 Skill"
              >
                <SparklesIcon className="size-2.5 text-[#7a6394]" />
                <span>公式建模 Skill</span>
              </span>
              {matchedSkills.map((skill) => (
                <span
                  key={skill.id}
                  className="inline-flex items-center gap-1 rounded-full border border-[rgba(138,118,168,0.36)] bg-[rgba(138,118,168,0.1)] px-2 py-0.5 text-[10px] font-medium text-[#6d5a7d]"
                >
                  {skill.name}
                </span>
              ))}
            </div>
          </div>

          {/* 可选的公式截图预览条 */}
          <AnimatePresence>
            {image && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={FAST_TRANSITION}
                className="overflow-hidden border-b border-line/60 px-4 pt-3"
              >
                <div className="mb-2.5 flex items-center gap-2.5 rounded-[12px] border border-line bg-surface-soft/75 p-2">
                  <img
                    src={image.dataUrl}
                    alt="待识别的公式截图"
                    className="h-11 w-14 flex-none rounded-[7px] border border-line bg-canvas object-contain"
                  />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[11.5px] font-medium text-ink">{image.name}</span>
                    <span className="font-mono text-[10px] text-ink-faint">
                      {image.mime.replace('image/', '').toUpperCase()} · {formatBytes(image.size)}
                    </span>
                  </div>
                  <motion.button
                    whileTap={TAP_BUTTON}
                    type="button"
                    disabled={recognizing || loading}
                    onClick={() => void handleRecognizeImage()}
                    className="rounded-lg bg-[#6d5a7d] px-2.5 py-1 text-[11px] font-medium text-[#fbf7ef] transition-colors enabled:hover:bg-[#5d4b6c] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {recognizing ? '识别中…' : '识别公式'}
                  </motion.button>
                  <button
                    type="button"
                    disabled={recognizing || loading}
                    onClick={() => setImage(null)}
                    className="grid size-6 place-items-center rounded-md text-ink-faint transition-colors hover:bg-surface hover:text-ink"
                    aria-label="移除截图"
                  >
                    <CloseIcon className="size-3" />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* 主公式输入框 */}
          <textarea
            ref={textareaRef}
            value={prompt}
            maxLength={MAX_PROMPT_LENGTH}
            disabled={loading}
            onChange={(event) => {
              setPrompt(event.target.value)
              if (errorMessage) setErrorMessage(null)
            }}
            onKeyDown={handleKeyDown}
            rows={3}
            placeholder="输入公式（支持 LaTeX）或描述科学现象，按 Enter 生成 Canvas 绘图…"
            aria-label="公式与实验描述输入框"
            className="w-full resize-none bg-transparent px-4 pb-2 pt-3.5 text-[14px] leading-[1.6] text-ink placeholder:text-ink-faint focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          />

          {/* 隐藏的文件选择器 */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            aria-label="上传公式截图"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void loadFile(file)
            }}
          />

          {/* 底部工具栏：上传图片 + 当前模型 + 字符统计 + 圆形发送按钮 */}
          <div className="flex items-center justify-between gap-2 px-3 pb-3 pt-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <motion.button
                whileTap={TAP_BUTTON}
                type="button"
                disabled={loading || recognizing}
                onClick={() => fileInputRef.current?.click()}
                title="上传论文公式截图（也支持直接 ⌘V 粘贴）"
                aria-label="上传公式截图"
                className="grid size-8 flex-none place-items-center rounded-full text-ink-dim transition-colors enabled:hover:bg-surface-soft enabled:hover:text-ink disabled:cursor-not-allowed disabled:opacity-45"
              >
                <PlusIcon className="size-4" />
              </motion.button>

              <motion.button
                whileTap={TAP_BUTTON}
                type="button"
                onClick={() => onNavigate('models')}
                title="点击切换或配置大模型"
                className="flex max-w-[220px] items-center gap-1.5 rounded-full border border-transparent px-2.5 py-1 text-[11.5px] font-medium text-ink-dim transition-colors hover:border-line hover:bg-surface-soft hover:text-ink"
              >
                <ModelIcon className="size-3.5 flex-none text-ink-faint" />
                <span className="truncate">
                  {activeModelEndpoint ? activeModelEndpoint.name : '配置大模型'}
                </span>
                {activeModelEndpoint && activeModelEndpoint.apiKey.trim().length > 0 && (
                  <span className="size-1.5 flex-none rounded-full bg-mint" />
                )}
              </motion.button>
            </div>

            <div className="flex items-center gap-2.5">
              {loading && (
                <span className="text-[11px] text-accent-strong">
                  正在通过 Skill 优化并生成绘图…
                </span>
              )}
              {!loading && prompt.length > 0 && (
                <span className="font-mono text-[10.5px] tabular-nums text-ink-faint">
                  {prompt.length}/{MAX_PROMPT_LENGTH}
                </span>
              )}

              {loading ? (
                <motion.button
                  whileTap={TAP_BUTTON}
                  type="button"
                  onClick={handleCancel}
                  title="取消生成"
                  aria-label="取消生成"
                  className="grid size-8 flex-none place-items-center rounded-full bg-rose/85 text-[#fbf7ef] shadow-sm transition-colors hover:bg-rose"
                >
                  <StopIcon className="size-3.5" />
                </motion.button>
              ) : (
                <motion.button
                  whileTap={canSubmit ? TAP_BUTTON : undefined}
                  type="submit"
                  disabled={!canSubmit}
                  title="通过 Skill 优化生成 Canvas 绘图 (Enter)"
                  aria-label="生成 Canvas 绘图"
                  className={`grid size-8 flex-none place-items-center rounded-full transition-all ${
                    canSubmit
                      ? 'bg-accent-strong text-[#fbf7ef] shadow-[0_2px_8px_rgba(79,114,146,0.3)] hover:bg-accent'
                      : 'cursor-not-allowed bg-surface-soft text-ink-faint/60'
                  }`}
                >
                  <ArrowRightIcon className="size-4" />
                </motion.button>
              )}
            </div>
          </div>
        </form>

        {/* 错误提示 */}
        <AnimatePresence>
          {errorMessage && (
            <motion.p
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={FAST_TRANSITION}
              role="alert"
              className="m-0 rounded-[12px] border border-rose/35 bg-rose/[0.1] px-3.5 py-2 text-[11.5px] leading-[1.55] text-[#a9605f]"
            >
              {errorMessage}
            </motion.p>
          )}
        </AnimatePresence>

        {/* 快捷公式示例 */}
        <div className="flex flex-wrap items-center justify-center gap-1.5 pt-0.5">
          {QUICK_FORMULAS.map((item) => (
            <motion.button
              key={item.label}
              whileTap={loading ? undefined : TAP_BUTTON}
              type="button"
              disabled={loading}
              onClick={() => {
                setPrompt(item.prompt)
                setErrorMessage(null)
                focusInput()
              }}
              className="rounded-full border border-line bg-surface/80 px-3 py-1 text-[11px] text-ink-dim transition-colors enabled:hover:border-line-strong enabled:hover:bg-surface enabled:hover:text-ink disabled:cursor-not-allowed disabled:opacity-45"
            >
              {item.label}
            </motion.button>
          ))}
        </div>
      </motion.div>
    </section>
  )
}
