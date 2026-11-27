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
import { FORMULA_SKILLS, selectFormulaSkills } from '../ai/skills'
import type { FormulaSkillId } from '../ai/skills'
import type { AppRoute } from '../hooks/useAppRoute'
import { useFloatingBallStore } from '../store/useFloatingBallStore'
import { useModelConfigStore } from '../store/useModelConfigStore'
import { useSessionStore } from '../store/useSessionStore'
import { useWorkbenchStore } from '../store/useWorkbenchStore'
import { createExperimentGroupId } from '../workspace/records'
import {
  ArrowRightIcon,
  BoltIcon,
  CheckIcon,
  ChevronDownIcon,
  CloseIcon,
  FolderIcon,
  FolderPlusIcon,
  ModelIcon,
  PlusIcon,
  SparklesIcon,
  StopIcon,
} from './icons'
import {
  COLLAPSE_VARIANTS,
  EASE_OUT_QUART,
  FAST_TRANSITION,
  SPRING_GENTLE,
  SPRING_SNAPPY,
  TAP_BUTTON,
  TAP_ICON,
} from './motion'

interface FormulaComposerStageProps {
  onNavigate: (route: AppRoute) => void
}

interface AttachedImage {
  dataUrl: string
  mime: SupportedImageType
  name: string
  size: number
}

const SKILL_SHORT_META: Record<
  FormulaSkillId,
  { shortName: string; summary: string }
> = {
  'calculus-function': {
    shortName: '微积分与函数',
    summary: '切线、极值点、积分阴影与原函数对照',
  },
  'mechanics-kinematics': {
    shortName: '力学与波动',
    summary: '等比坐标系、运动质点、矢量与包络线',
  },
  'optics-geometry': {
    shortName: '几何与光学',
    summary: '光路折反射、法线、角度弧线与焦点标注',
  },
  'probability-stats': {
    shortName: '概率与统计',
    summary: 'PDF/CDF 曲线、置信区间阴影与均值标尺',
  },
  'dynamical-phase': {
    shortName: '动力与相空间',
    summary: '平衡点分类、零斜线与相轨线演化方向',
  },
}

const QUICK_FORMULAS = [
  {
    label: '阻尼受迫振动',
    tag: '力学',
    prompt:
      '模拟阻尼受迫振动 $m\\ddot{x} + c\\dot{x} + kx = F_0\\cos(\\omega t)$，可调阻尼系数与驱动频率，并展示位移随时间的变化与包络线。',
  },
  {
    label: '正态分布密度',
    tag: '统计',
    prompt:
      '绘制正态分布概率密度函数 $f(x)=\\frac{1}{\\sigma\\sqrt{2\\pi}}e^{-\\frac{(x-\\mu)^2}{2\\sigma^2}}$，可调均值 $\\mu$ 与标准差 $\\sigma$，高亮 $\\mu\\pm\\sigma$ 区间面积。',
  },
  {
    label: '斯涅尔光路折射',
    tag: '光学',
    prompt:
      '根据斯涅尔定律 $n_1\\sin\\theta_1 = n_2\\sin\\theta_2$ 绘制光路折射实验，展示入射光线、折射光线、法线与入射角/折射角。',
  },
  {
    label: '洛伦兹吸引子',
    tag: '混沌',
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
  const [isFocused, setIsFocused] = useState(false)
  const [skillDrawerOpen, setSkillDrawerOpen] = useState(false)
  const [pinnedSkillIds, setPinnedSkillIds] = useState<FormulaSkillId[]>([])

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const generateControllerRef = useRef<AbortController | null>(null)
  const recognizeControllerRef = useRef<AbortController | null>(null)

  const healing = healStatus === 'requesting' || healStatus === 'applied'
  const autoMatchedSkills = useMemo(() => selectFormulaSkills(prompt), [prompt])
  const autoMatchedIds = useMemo(
    () => new Set(autoMatchedSkills.map((skill) => skill.id)),
    [autoMatchedSkills],
  )
  const activeSkills = useMemo(() => {
    const seen = new Set<FormulaSkillId>()
    const list: { id: FormulaSkillId; shortName: string; mode: 'pinned' | 'auto' }[] = []
    for (const id of pinnedSkillIds) {
      seen.add(id)
      list.push({ id, shortName: SKILL_SHORT_META[id].shortName, mode: 'pinned' })
    }
    for (const skill of autoMatchedSkills) {
      if (seen.has(skill.id)) continue
      seen.add(skill.id)
      list.push({ id: skill.id, shortName: SKILL_SHORT_META[skill.id].shortName, mode: 'auto' })
    }
    return list
  }, [autoMatchedSkills, pinnedSkillIds])

  const isInsideFolder = composerTarget.groupId !== null

  const togglePinnedSkill = useCallback((id: FormulaSkillId) => {
    setPinnedSkillIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    )
  }, [])

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
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 84), 236)}px`
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
    setSkillDrawerOpen(false)

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
  const hasModelKey = Boolean(activeModelEndpoint && activeModelEndpoint.apiKey.trim().length > 0)

  return (
    <section
      className="workbench-scroll flex min-h-0 flex-1 flex-col items-center justify-between overflow-y-auto px-5 pb-9 pt-10 sm:px-8"
      aria-label="新建公式绘图"
    >
      {/* 顶部留白 + 居中徽章与欢迎标题 */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.42, ease: EASE_OUT_QUART }}
        className="my-auto flex w-full max-w-[720px] flex-col items-center pb-6 pt-4 text-center"
      >
        <motion.div
          whileHover={{ scale: 1.06, rotate: 4 }}
          transition={SPRING_SNAPPY}
          className="relative mb-5 grid size-[56px] place-items-center"
        >
          <span
            aria-hidden="true"
            className="animate-orbit-breathe pointer-events-none absolute -inset-2 rounded-[22px] bg-[radial-gradient(circle,color-mix(in_srgb,var(--color-lilac)_32%,transparent),color-mix(in_srgb,var(--color-accent)_16%,transparent)_55%,transparent_75%)] blur-md"
          />
          <div className="relative grid size-[54px] place-items-center rounded-[17px] border border-[color-mix(in_srgb,var(--color-accent)_30%,transparent)] bg-[radial-gradient(circle_at_30%_22%,color-mix(in_srgb,var(--color-lilac)_28%,var(--color-surface)),color-mix(in_srgb,var(--color-peach)_14%,var(--color-surface)))] text-accent-strong shadow-[0_10px_28px_rgba(58,51,43,0.08),inset_0_1px_0_rgba(255,255,255,0.55)]">
            <BoltIcon className="size-7" />
          </div>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.38, delay: 0.05, ease: EASE_OUT_QUART }}
          className="m-0 text-[24px] font-[600] tracking-[-0.02em] text-ink sm:text-[27px]"
        >
          {isInsideFolder
            ? `在「${composerTarget.groupTitle ?? '当前实验'}」中新建实验`
            : '欢迎回来，今天想探索哪个公式？'}
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.38, delay: 0.1, ease: EASE_OUT_QUART }}
          className="mt-2.5 max-w-[540px] text-[13px] leading-[1.65] text-ink-faint"
        >
          {isInsideFolder
            ? '输入公式或科学机理，将通过 Skill 优化生成 Canvas 绘图并归档至当前实验文件夹。'
            : '输入公式或科学机理，自动通过公式建模 Skill 优化生成交互式 Canvas 绘图，并自动新建文件夹归档。'}
        </motion.p>
      </motion.div>

      {/* 居中底部雕塑感输入工作区 */}
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.45, delay: 0.12, ease: EASE_OUT_QUART }}
        className="flex w-full max-w-[756px] flex-col gap-3"
      >
        {/* 悬浮于输入框上方的极简归档上下文胶囊 */}
        <div className="flex items-center justify-between px-2">
          <AnimatePresence mode="wait">
            {isInsideFolder ? (
              <motion.span
                key="inside-folder"
                initial={{ opacity: 0, y: 4, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.96 }}
                transition={FAST_TRANSITION}
                className="inline-flex max-w-[300px] items-center gap-1.5 rounded-full border border-accent-line/70 bg-accent-soft/75 px-3 py-1 text-[11px] font-medium text-accent-strong shadow-[0_2px_10px_rgba(58,51,43,0.04)] backdrop-blur-sm"
              >
                <FolderIcon className="size-3.5 flex-none" />
                <span className="truncate">归档至：{composerTarget.groupTitle ?? '当前实验'}</span>
                <motion.button
                  whileTap={TAP_ICON}
                  type="button"
                  onClick={() => openComposer({ groupId: null, groupTitle: null })}
                  title="改为自动新建文件夹归档"
                  className="ml-0.5 grid size-4 flex-none place-items-center rounded-full text-accent-strong/75 transition-colors hover:bg-accent-strong/15 hover:text-accent-strong"
                  aria-label="切换为自动新建文件夹"
                >
                  <CloseIcon className="size-2.5" />
                </motion.button>
              </motion.span>
            ) : (
              <motion.span
                key="auto-folder"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={FAST_TRANSITION}
                className="inline-flex items-center gap-1.5 rounded-full border border-line/70 bg-surface/65 px-2.5 py-0.5 text-[11px] text-ink-dim backdrop-blur-sm"
              >
                <FolderPlusIcon className="size-3.5 text-ink-faint" />
                <span>生成后自动新建文件夹归档</span>
              </motion.span>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {isFocused && !loading && (
              <motion.span
                initial={{ opacity: 0, x: 6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 6 }}
                transition={FAST_TRANSITION}
                className="hidden items-center gap-1.5 text-[10.5px] text-ink-faint sm:inline-flex"
              >
                <kbd className="rounded border border-line bg-surface/80 px-1.5 py-0.5 font-mono text-[9.5px] text-ink-dim">
                  Enter
                </kbd>
                <span>生成</span>
                <span className="opacity-40">·</span>
                <kbd className="rounded border border-line bg-surface/80 px-1.5 py-0.5 font-mono text-[9.5px] text-ink-dim">
                  ⇧Enter
                </kbd>
                <span>换行</span>
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        {/* 主输入卡片容器：包含背景光晕 + 顶边高光 + 流光进度条 */}
        <motion.div
          animate={{
            y: isFocused || loading ? -1.5 : 0,
          }}
          transition={SPRING_GENTLE}
          className="relative"
        >
          {/* 环境光晕层：聚焦 / 生成 / 高亮时柔和呼吸增强 */}
          <motion.div
            aria-hidden="true"
            animate={{
              opacity: promptHighlighted ? 0.95 : loading ? 0.9 : isFocused ? 0.72 : 0.28,
              scale: isFocused || loading ? 1.008 : 0.992,
            }}
            transition={{ duration: 0.4, ease: EASE_OUT_QUART }}
            className="pointer-events-none absolute -inset-[3px] -z-10 rounded-[26px] blur-[14px]"
            style={{
              background: promptHighlighted
                ? 'linear-gradient(120deg, color-mix(in srgb, var(--color-mint) 48%, transparent), color-mix(in srgb, var(--color-accent) 32%, transparent))'
                : 'linear-gradient(125deg, color-mix(in srgb, var(--color-accent) 32%, transparent) 0%, color-mix(in srgb, var(--color-lilac) 26%, transparent) 52%, color-mix(in srgb, var(--color-peach) 22%, transparent) 100%)',
            }}
          />

          <form
            onSubmit={handleSubmit}
            className={`relative flex flex-col overflow-hidden rounded-[24px] border bg-[color-mix(in_srgb,var(--color-surface)_94%,var(--color-panel))] backdrop-blur-xl transition-[border-color,box-shadow] duration-300 ${
              promptHighlighted
                ? 'border-mint shadow-[0_18px_46px_rgba(58,51,43,0.1),0_0_0_3px_color-mix(in_srgb,var(--color-mint)_22%,transparent)]'
                : isFocused
                  ? 'border-[color-mix(in_srgb,var(--color-accent)_52%,var(--color-line-strong))] shadow-[0_20px_52px_rgba(58,51,43,0.11),0_4px_14px_rgba(79,114,146,0.09),inset_0_1px_0_rgba(255,255,255,0.55)]'
                  : 'border-line-strong/75 shadow-[0_14px_38px_rgba(58,51,43,0.07),0_2px_8px_rgba(58,51,43,0.04),inset_0_1px_0_rgba(255,255,255,0.45)] hover:border-line-strong'
            }`}
          >
            {/* 顶部细腻高光镜面线 */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-6 top-0 h-px bg-[linear-gradient(90deg,transparent,color-mix(in_srgb,var(--color-accent)_35%,white),transparent)] opacity-75"
            />

            {/* 生成中顶部流光条 */}
            <AnimatePresence>
              {loading && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={FAST_TRANSITION}
                  className="pointer-events-none absolute inset-x-0 top-0 h-[2.5px] overflow-hidden bg-accent-soft/60"
                >
                  <div className="animate-shimmer-slide h-full w-1/2 rounded-full bg-[linear-gradient(90deg,transparent,var(--color-accent),var(--color-lilac),transparent)]" />
                </motion.div>
              )}
            </AnimatePresence>

            {/* 可选的公式截图预览条 */}
            <AnimatePresence>
              {image && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={FAST_TRANSITION}
                  className="overflow-hidden border-b border-line/60 px-4 pt-3.5"
                >
                  <div className="mb-3 flex items-center gap-3 rounded-[14px] border border-line bg-surface-soft/70 p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]">
                    <img
                      src={image.dataUrl}
                      alt="待识别的公式截图"
                      className="h-11 w-14 flex-none rounded-[8px] border border-line bg-canvas object-contain"
                    />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[12px] font-medium text-ink">{image.name}</span>
                      <span className="font-mono text-[10px] text-ink-faint">
                        {image.mime.replace('image/', '').toUpperCase()} · {formatBytes(image.size)}
                      </span>
                    </div>
                    <motion.button
                      whileHover={{ scale: 1.03 }}
                      whileTap={TAP_BUTTON}
                      type="button"
                      disabled={recognizing || loading}
                      onClick={() => void handleRecognizeImage()}
                      className="rounded-xl bg-accent-strong px-3 py-1.5 text-[11.5px] font-medium text-[#fbf7ef] shadow-sm transition-colors enabled:hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {recognizing ? '识别中…' : '识别公式'}
                    </motion.button>
                    <motion.button
                      whileTap={TAP_ICON}
                      type="button"
                      disabled={recognizing || loading}
                      onClick={() => setImage(null)}
                      className="grid size-7 place-items-center rounded-lg text-ink-faint transition-colors hover:bg-surface hover:text-ink"
                      aria-label="移除截图"
                    >
                      <CloseIcon className="size-3.5" />
                    </motion.button>
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
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              onChange={(event) => {
                setPrompt(event.target.value)
                if (errorMessage) setErrorMessage(null)
              }}
              onKeyDown={handleKeyDown}
              rows={3}
              placeholder="输入公式（支持 LaTeX）或描述科学现象，按 Enter 生成 Canvas 绘图…"
              aria-label="公式与实验描述输入框"
              className="w-full resize-none bg-transparent px-5 pb-3 pt-4.5 text-[15px] leading-[1.68] text-ink placeholder:text-ink-faint/85 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
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

            {/* 底部控制栏（下方侧边工具栏）：上传图片 + 模型配置 + Skill 配置 + 字符统计 + 发送按钮 */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/55 bg-[color-mix(in_srgb,var(--color-panel)_68%,transparent)] px-3.5 py-2.5">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                {/* 上传截图按钮 */}
                <motion.button
                  whileHover={{ scale: 1.06, rotate: 90 }}
                  whileTap={TAP_ICON}
                  transition={SPRING_SNAPPY}
                  type="button"
                  disabled={loading || recognizing}
                  onClick={() => fileInputRef.current?.click()}
                  title="上传论文公式截图（也支持直接 ⌘V 粘贴）"
                  aria-label="上传公式截图"
                  className="grid size-8 flex-none place-items-center rounded-full border border-transparent bg-surface/80 text-ink-dim shadow-[0_1px_2px_rgba(58,51,43,0.04)] transition-colors enabled:hover:border-line-strong enabled:hover:bg-surface enabled:hover:text-ink disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <PlusIcon className="size-4" />
                </motion.button>

                {/* 大模型配置按钮 */}
                <motion.button
                  whileHover={{ y: -0.5 }}
                  whileTap={TAP_BUTTON}
                  transition={SPRING_SNAPPY}
                  type="button"
                  onClick={() => onNavigate('models')}
                  title="点击切换或配置大模型"
                  className="flex max-w-[180px] items-center gap-1.5 rounded-full border border-line/75 bg-surface/80 px-2.5 py-1.5 text-[11.5px] font-medium text-ink-dim shadow-[0_1px_2px_rgba(58,51,43,0.03)] transition-colors hover:border-line-strong hover:bg-surface hover:text-ink"
                >
                  <ModelIcon className="size-3.5 flex-none text-ink-faint" />
                  <span className="truncate">
                    {activeModelEndpoint ? activeModelEndpoint.name : '配置大模型'}
                  </span>
                  {hasModelKey && (
                    <span className="animate-pulse-soft size-1.5 flex-none rounded-full bg-mint shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-mint)_28%,transparent)]" />
                  )}
                </motion.button>

                {/* 细竖分隔线 */}
                <span aria-hidden="true" className="mx-0.5 hidden h-4 w-px bg-line sm:inline-block" />

                {/* Skill 配置触发按钮（位于底部工具栏） */}
                <motion.button
                  whileHover={{ y: -0.5 }}
                  whileTap={TAP_BUTTON}
                  transition={SPRING_SNAPPY}
                  type="button"
                  aria-expanded={skillDrawerOpen}
                  aria-controls="formula-skill-drawer"
                  onClick={() => setSkillDrawerOpen((prev) => !prev)}
                  title="展开配置公式建模与学科专项 Skill"
                  className={`group flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11.5px] font-medium transition-all duration-200 ${
                    skillDrawerOpen || activeSkills.length > 0
                      ? 'border-[color-mix(in_srgb,var(--color-lilac)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-lilac)_14%,var(--color-surface))] text-ink shadow-[0_2px_8px_color-mix(in_srgb,var(--color-lilac)_14%,transparent)]'
                      : 'border-line/75 bg-surface/80 text-ink-dim shadow-[0_1px_2px_rgba(58,51,43,0.03)] hover:border-line-strong hover:bg-surface hover:text-ink'
                  }`}
                >
                  <motion.span
                    animate={{ rotate: skillDrawerOpen ? 45 : 0 }}
                    transition={SPRING_SNAPPY}
                    className="grid place-items-center text-lilac"
                  >
                    <SparklesIcon className="size-3.5" />
                  </motion.span>
                  <span>公式建模 Skill</span>
                  {activeSkills.length > 0 && (
                    <motion.span
                      key={activeSkills.length}
                      initial={{ scale: 0.7, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={SPRING_SNAPPY}
                      className="rounded-full bg-[color-mix(in_srgb,var(--color-lilac)_24%,transparent)] px-1.5 py-0.2 font-mono text-[10px] font-semibold text-ink"
                    >
                      +{activeSkills.length}
                    </motion.span>
                  )}
                  <motion.span
                    animate={{ rotate: skillDrawerOpen ? 180 : 0 }}
                    transition={SPRING_SNAPPY}
                    className="grid place-items-center text-ink-faint"
                  >
                    <ChevronDownIcon className="size-3" />
                  </motion.span>
                </motion.button>

                {/* 收起态时在底部工具栏实时展示已匹配 / 已固定的专项 Skill 胶囊 */}
                <AnimatePresence mode="popLayout">
                  {!skillDrawerOpen &&
                    activeSkills.map((skill) => (
                      <motion.span
                        layout
                        key={skill.id}
                        initial={{ opacity: 0, scale: 0.85, x: -6 }}
                        animate={{ opacity: 1, scale: 1, x: 0 }}
                        exit={{ opacity: 0, scale: 0.85, x: -6 }}
                        transition={SPRING_SNAPPY}
                        className="hidden items-center gap-1 rounded-full border border-[color-mix(in_srgb,var(--color-lilac)_36%,transparent)] bg-[color-mix(in_srgb,var(--color-lilac)_11%,transparent)] px-2 py-0.5 text-[10.5px] font-medium text-ink-dim md:inline-flex"
                      >
                        <span className="size-1.5 rounded-full bg-lilac" />
                        <span>{skill.shortName}</span>
                      </motion.span>
                    ))}
                </AnimatePresence>
              </div>

              {/* 右侧状态与发送按钮 */}
              <div className="flex items-center gap-2.5">
                <AnimatePresence mode="wait">
                  {loading ? (
                    <motion.span
                      key="loading-hint"
                      initial={{ opacity: 0, x: 6 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -6 }}
                      transition={FAST_TRANSITION}
                      className="inline-flex items-center gap-1.5 text-[11px] font-medium text-accent-strong"
                    >
                      <span className="animate-pulse-soft size-1.5 rounded-full bg-accent-strong" />
                      <span>正在通过 Skill 建模…</span>
                    </motion.span>
                  ) : (
                    prompt.length > 0 && (
                      <motion.span
                        key="char-count"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={FAST_TRANSITION}
                        className="font-mono text-[10.5px] tabular-nums text-ink-faint"
                      >
                        {prompt.length}/{MAX_PROMPT_LENGTH}
                      </motion.span>
                    )
                  )}
                </AnimatePresence>

                {loading ? (
                  <motion.button
                    whileHover={{ scale: 1.07 }}
                    whileTap={TAP_ICON}
                    transition={SPRING_SNAPPY}
                    type="button"
                    onClick={handleCancel}
                    title="取消生成"
                    aria-label="取消生成"
                    className="grid size-9 flex-none place-items-center rounded-full bg-rose/90 text-[#fbf7ef] shadow-[0_4px_14px_color-mix(in_srgb,var(--color-rose)_40%,transparent)] transition-colors hover:bg-rose"
                  >
                    <StopIcon className="size-3.5" />
                  </motion.button>
                ) : (
                  <motion.button
                    whileHover={canSubmit ? { scale: 1.07 } : undefined}
                    whileTap={canSubmit ? TAP_ICON : undefined}
                    transition={SPRING_SNAPPY}
                    type="submit"
                    disabled={!canSubmit}
                    title="通过 Skill 优化生成 Canvas 绘图 (Enter)"
                    aria-label="生成 Canvas 绘图"
                    className={`group grid size-9 flex-none place-items-center rounded-full transition-all duration-200 ${
                      canSubmit
                        ? 'bg-[linear-gradient(135deg,var(--color-accent-strong),var(--color-accent))] text-[#fbf7ef] shadow-[0_6px_18px_color-mix(in_srgb,var(--color-accent-strong)_38%,transparent),inset_0_1px_0_rgba(255,255,255,0.28)]'
                        : 'cursor-not-allowed bg-surface-soft text-ink-faint/55'
                    }`}
                  >
                    <ArrowRightIcon className="size-4 transition-transform duration-200 group-enabled:group-hover:translate-x-0.5" />
                  </motion.button>
                )}
              </div>
            </div>

            {/* 底部可展开的 Skill 配置抽屉 */}
            <AnimatePresence initial={false}>
              {skillDrawerOpen && (
                <motion.div
                  id="formula-skill-drawer"
                  variants={COLLAPSE_VARIANTS}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  className="border-t border-line/65 bg-[color-mix(in_srgb,var(--color-surface-soft)_52%,var(--color-panel))]"
                >
                  <div className="flex flex-col gap-3 px-4 py-3.5">
                    {/* 抽屉顶栏 */}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="grid size-5 place-items-center rounded-md bg-[color-mix(in_srgb,var(--color-lilac)_20%,transparent)] text-lilac">
                          <SparklesIcon className="size-3" />
                        </span>
                        <span className="text-[12px] font-semibold text-ink">
                          公式建模 Skill 管线
                        </span>
                        <span className="rounded-full border border-line bg-surface/80 px-2 py-0.5 text-[10px] text-ink-dim">
                          {pinnedSkillIds.length > 0
                            ? `核心 + 已固定 ${pinnedSkillIds.length} 项`
                            : '核心常驻 · 专项自动路由'}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        {pinnedSkillIds.length > 0 && (
                          <motion.button
                            whileTap={TAP_BUTTON}
                            type="button"
                            onClick={() => setPinnedSkillIds([])}
                            className="rounded-full border border-line bg-surface px-2.5 py-0.5 text-[10.5px] text-ink-dim transition-colors hover:border-line-strong hover:text-ink"
                          >
                            恢复自动路由
                          </motion.button>
                        )}
                        <motion.button
                          whileTap={TAP_ICON}
                          type="button"
                          onClick={() => setSkillDrawerOpen(false)}
                          aria-label="收起 Skill 配置"
                          className="grid size-6 place-items-center rounded-full text-ink-faint transition-colors hover:bg-surface hover:text-ink"
                        >
                          <CloseIcon className="size-3" />
                        </motion.button>
                      </div>
                    </div>

                    {/* 核心常驻 Skill 条 */}
                    <div className="flex items-center justify-between gap-3 rounded-[13px] border border-accent-line/55 bg-surface/85 px-3 py-2">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className="size-2 flex-none rounded-full bg-mint shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-mint)_22%,transparent)]" />
                        <div className="min-w-0">
                          <div className="text-[11.5px] font-semibold text-ink">
                            四步公式场景建模 Skill
                          </div>
                          <div className="truncate text-[10.5px] text-ink-faint">
                            量纲解析 · 视野反推 · 动静分离曲线标点 · 一致性自检
                          </div>
                        </div>
                      </div>
                      <span className="flex-none rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-medium text-accent-strong">
                        常驻启用
                      </span>
                    </div>

                    {/* 学科专项 Skill 交互卡片网格 */}
                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                      {FORMULA_SKILLS.map((skill, idx) => {
                        const meta = SKILL_SHORT_META[skill.id]
                        const isPinned = pinnedSkillIds.includes(skill.id)
                        const isAutoMatched = autoMatchedIds.has(skill.id)
                        const isActive = isPinned || isAutoMatched

                        return (
                          <motion.button
                            key={skill.id}
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{
                              duration: 0.22,
                              delay: idx * 0.03,
                              ease: EASE_OUT_QUART,
                            }}
                            whileHover={{ y: -1 }}
                            whileTap={TAP_BUTTON}
                            type="button"
                            onClick={() => togglePinnedSkill(skill.id)}
                            className={`flex flex-col items-start gap-1 rounded-[12px] border px-2.5 py-2 text-left transition-all duration-150 ${
                              isActive
                                ? 'border-[color-mix(in_srgb,var(--color-lilac)_48%,transparent)] bg-[color-mix(in_srgb,var(--color-lilac)_12%,var(--color-surface))] shadow-[0_2px_10px_color-mix(in_srgb,var(--color-lilac)_12%,transparent)]'
                                : 'border-line/75 bg-surface/75 hover:border-line-strong hover:bg-surface'
                            }`}
                          >
                            <div className="flex w-full items-center justify-between gap-1.5">
                              <span className="truncate text-[11.5px] font-medium text-ink">
                                {meta.shortName}
                              </span>
                              {isPinned ? (
                                <span className="inline-flex flex-none items-center gap-0.5 rounded-full bg-lilac/25 px-1.5 py-0.5 text-[9.5px] font-medium text-ink">
                                  <CheckIcon className="size-2.5 text-lilac" />
                                  已固定
                                </span>
                              ) : isAutoMatched ? (
                                <span className="inline-flex flex-none items-center gap-1 rounded-full bg-accent-soft px-1.5 py-0.5 text-[9.5px] font-medium text-accent-strong">
                                  <span className="size-1 rounded-full bg-accent-strong" />
                                  自动匹配
                                </span>
                              ) : (
                                <span className="text-[9.5px] text-ink-faint">点击固定</span>
                              )}
                            </div>
                            <span className="line-clamp-1 text-[10px] text-ink-faint">
                              {meta.summary}
                            </span>
                          </motion.button>
                        )
                      })}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </form>
        </motion.div>

        {/* 错误提示 */}
        <AnimatePresence>
          {errorMessage && (
            <motion.p
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98 }}
              transition={FAST_TRANSITION}
              role="alert"
              className="m-0 rounded-[14px] border border-rose/35 bg-rose/[0.1] px-4 py-2.5 text-[12px] leading-[1.55] text-rose"
            >
              {errorMessage}
            </motion.p>
          )}
        </AnimatePresence>

        {/* 快捷公式示例胶囊（错峰入场 + 悬浮抬升微动效） */}
        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
          {QUICK_FORMULAS.map((item, index) => (
            <motion.button
              key={item.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.34,
                delay: 0.18 + index * 0.045,
                ease: EASE_OUT_QUART,
              }}
              whileHover={loading ? undefined : { y: -2, scale: 1.02 }}
              whileTap={loading ? undefined : TAP_BUTTON}
              type="button"
              disabled={loading}
              onClick={() => {
                setPrompt(item.prompt)
                setErrorMessage(null)
                focusInput()
              }}
              className="group inline-flex items-center gap-1.5 rounded-full border border-line/85 bg-surface/80 px-3.5 py-1.5 text-[11.5px] text-ink-dim shadow-[0_2px_8px_rgba(58,51,43,0.03)] backdrop-blur-sm transition-[border-color,background-color,color,box-shadow] duration-200 enabled:hover:border-accent-line enabled:hover:bg-surface enabled:hover:text-ink enabled:hover:shadow-[0_6px_16px_rgba(58,51,43,0.07)] disabled:cursor-not-allowed disabled:opacity-45"
            >
              <span className="rounded-full bg-surface-soft px-1.5 py-0.2 text-[9.5px] font-medium text-ink-faint transition-colors group-hover:bg-accent-soft group-hover:text-accent-strong">
                {item.tag}
              </span>
              <span>{item.label}</span>
            </motion.button>
          ))}
        </div>
      </motion.div>
    </section>
  )
}
