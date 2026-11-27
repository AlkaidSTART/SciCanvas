import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { exportCurrentExperiment } from '../export/exporter'
import { useFloatingBallStore } from '../store/useFloatingBallStore'
import { useWorkbenchStore } from '../store/useWorkbenchStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import type { AppRoute } from '../hooks/useAppRoute'
import { BoltIcon, PanelLeftIcon, PanelRightIcon } from './icons'
import { FAST_TRANSITION, TAP_BUTTON, TAP_ICON, TOAST_VARIANTS } from './motion'

interface TopBarProps {
  route: AppRoute
  onNavigate: (route: AppRoute) => void
}

interface ExportToast {
  tone: 'success' | 'error'
  message: string
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

export function TopBar({ route, onNavigate }: TopBarProps) {
  const isSubPage = route !== 'workbench'
  const title = useWorkbenchStore((state) => state.experiment.title)
  const domain = useWorkbenchStore((state) => state.experiment.domain)
  const activeGroupTitle = useWorkbenchStore((state) => state.activeGroupTitle)
  const presentation = useWorkbenchStore((state) => state.presentation)
  const leftPanelOpen = useWorkbenchStore((state) => state.leftPanelOpen)
  const rightPanelOpen = useWorkbenchStore((state) => state.rightPanelOpen)
  const enterPresentation = useWorkbenchStore((state) => state.enterPresentation)
  const exitPresentation = useWorkbenchStore((state) => state.exitPresentation)
  const toggleLeftPanel = useWorkbenchStore((state) => state.toggleLeftPanel)
  const toggleRightPanel = useWorkbenchStore((state) => state.toggleRightPanel)
  const saving = useWorkspaceStore((state) => state.saving)
  const lastSavedAt = useWorkspaceStore((state) => state.lastSavedAt)
  const storageError = useWorkspaceStore((state) => state.storageError)
  const floatingBallNotice = useFloatingBallStore((state) => state.notice)
  const clearFloatingBallNotice = useFloatingBallStore((state) => state.clearNotice)

  const [exporting, setExporting] = useState(false)
  const [toast, setToast] = useState<ExportToast | null>(null)

  const activeToast: ExportToast | null =
    toast ??
    (floatingBallNotice
      ? {
          tone: floatingBallNotice.tone === 'error' ? 'error' : 'success',
          message: floatingBallNotice.message,
        }
      : null)

  const activeToastTone = activeToast?.tone
  const activeToastMessage = activeToast?.message

  useEffect(() => {
    if (activeToastTone !== 'success') return undefined
    const timer = window.setTimeout(() => {
      setToast(null)
      clearFloatingBallNotice()
    }, 4000)
    return () => window.clearTimeout(timer)
  }, [activeToastTone, activeToastMessage, clearFloatingBallNotice])

  const handleExport = async () => {
    if (exporting) return
    setExporting(true)
    setToast(null)
    try {
      const result = await exportCurrentExperiment()
      setToast({
        tone: 'success',
        message: `已导出 ${result.fileName}（${formatBytes(result.bytes)}），可离线双击打开。`,
      })
    } catch (error) {
      setToast({
        tone: 'error',
        message: error instanceof Error ? error.message : '导出失败，请稍后重试',
      })
    } finally {
      setExporting(false)
    }
  }

  if (presentation && !isSubPage) {
    return (
      <motion.header
        key="presentation-header"
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={FAST_TRANSITION}
        className="z-10 flex h-[46px] flex-none items-center gap-3 border-b border-line bg-panel/85 px-[18px] backdrop-blur-[10px] max-[640px]:px-3"
      >
        <span className="flex-none rounded-[5px] border border-accent-line bg-accent-soft px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-accent-strong">
          演示模式
        </span>
        <span className="min-w-0 truncate text-[13px] text-ink">{title}</span>
        <span className="ml-auto hidden whitespace-nowrap text-[10.5px] text-ink-faint sm:block">
          按 Esc 可随时退出
        </span>
        <motion.button
          whileTap={TAP_BUTTON}
          className="flex flex-none items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-ink-dim transition-colors hover:border-line-strong hover:bg-surface-soft hover:text-ink"
          type="button"
          onClick={exitPresentation}
          aria-label="退出演示模式"
        >
          退出演示
          <kbd className="rounded-[4px] border border-line bg-surface-soft px-1 py-px font-mono text-[9px] text-ink-faint">
            Esc
          </kbd>
        </motion.button>
      </motion.header>
    )
  }

  const saveStateKey = storageError
    ? 'error'
    : saving
      ? 'saving'
      : lastSavedAt
        ? 'saved'
        : 'idle'

  return (
    <>
      <motion.header
        key="workbench-header"
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={FAST_TRANSITION}
        className="z-10 flex h-[48px] flex-none items-center gap-4 border-b border-line bg-panel/90 px-3.5 backdrop-blur-[10px] max-[640px]:h-[52px] max-[640px]:gap-2.5 max-[640px]:px-3"
      >
        <div className="flex flex-none items-center gap-2">
          <motion.button
            type="button"
            onClick={() => onNavigate('workbench')}
            whileHover={{ scale: 1.04 }}
            whileTap={TAP_ICON}
            transition={{ type: 'spring', stiffness: 450, damping: 24 }}
            className="flex flex-none items-center gap-2 rounded-lg text-left"
            title="返回工作台"
          >
            <span className="grid size-[28px] flex-none place-items-center rounded-[8px] border border-[rgba(169,150,196,0.38)] bg-[radial-gradient(circle_at_30%_25%,rgba(195,178,218,0.48),rgba(224,162,121,0.22))] text-[#6d5a7d]">
              <BoltIcon className="size-4" />
            </span>
            <span className="flex items-baseline gap-1.5 leading-none">
              <span className="text-[14px] font-[650] tracking-[0.02em] text-ink">SciCanvas</span>
              <span className="hidden text-[10px] tracking-[0.12em] text-ink-faint min-[1180px]:inline">
                科研工作台
              </span>
            </span>
          </motion.button>

          <div className="ml-1 hidden items-center border-l border-line pl-2.5 min-[960px]:flex">
            <motion.button
              whileTap={TAP_ICON}
              className={`grid size-[28px] place-items-center rounded-[7px] border transition-colors ${
                leftPanelOpen
                  ? 'border-accent-line bg-accent-soft text-accent-strong'
                  : 'border-transparent text-ink-faint hover:border-line hover:bg-surface-soft hover:text-ink-dim'
              }`}
              type="button"
              onClick={toggleLeftPanel}
              aria-pressed={leftPanelOpen}
              aria-label={leftPanelOpen ? '收起左侧实验栏' : '展开左侧实验栏'}
              title={leftPanelOpen ? '收起左侧实验栏 (⌘B)' : '展开左侧实验栏 (⌘B)'}
            >
              <PanelLeftIcon className="size-[15px]" />
            </motion.button>
          </div>
        </div>

        <div className="mx-auto flex min-w-0 items-center gap-2 rounded-lg border border-line/80 bg-surface/75 px-2.5 py-1 max-[640px]:ml-auto max-[640px]:mr-0">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={`${domain}-${title}`}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={FAST_TRANSITION}
              className="flex min-w-0 items-center gap-2"
            >
              <span className="hidden whitespace-nowrap font-mono text-[9.5px] uppercase tracking-[0.1em] text-accent-strong min-[1040px]:inline">
                {domain}
              </span>
              <span className="hidden text-line-strong min-[1040px]:inline">/</span>
              {activeGroupTitle && activeGroupTitle !== title && (
                <>
                  <span className="hidden max-w-[14vw] truncate text-[11.5px] text-ink-faint min-[1140px]:inline">
                    {activeGroupTitle}
                  </span>
                  <span className="hidden text-line-strong min-[1140px]:inline">·</span>
                </>
              )}
              <span className="min-w-0 max-w-[34vw] truncate text-[12.5px] font-medium text-ink max-[640px]:max-w-[46vw] max-[640px]:text-xs">
                {title}
              </span>
            </motion.div>
          </AnimatePresence>
          <AnimatePresence mode="wait" initial={false}>
            {saveStateKey !== 'idle' && (
              <motion.span
                key={saveStateKey}
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.94 }}
                transition={FAST_TRANSITION}
                className="hidden items-center gap-1 whitespace-nowrap border-l border-line pl-2 text-[10px] text-ink-faint min-[1200px]:inline-flex"
                title={storageError?.message}
              >
                {storageError
                  ? '本地保存不可用'
                  : saving
                    ? '保存中…'
                    : '已保存'}
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        <div className="flex flex-none items-center gap-1.5 max-[640px]:hidden">
          <motion.button
            whileTap={TAP_BUTTON}
            className="rounded-lg border border-line bg-surface px-2.5 py-1 text-[11.5px] text-ink-dim transition-colors enabled:hover:border-line-strong enabled:hover:bg-surface-soft enabled:hover:text-ink disabled:cursor-not-allowed disabled:opacity-45"
            type="button"
            onClick={() => {
              if (isSubPage) onNavigate('workbench')
              enterPresentation()
            }}
          >
            演示模式
          </motion.button>
          <motion.button
            whileTap={exporting ? undefined : TAP_BUTTON}
            className="rounded-lg border border-line bg-surface px-2.5 py-1 text-[11.5px] text-ink-dim transition-colors enabled:hover:border-line-strong enabled:hover:bg-surface-soft enabled:hover:text-ink disabled:cursor-not-allowed disabled:opacity-45"
            type="button"
            onClick={() => void handleExport()}
            disabled={exporting}
            aria-busy={exporting}
          >
            {exporting ? '导出中…' : '导出 HTML'}
          </motion.button>
          {!isSubPage && (
            <div className="ml-1 hidden items-center border-l border-line pl-2.5 min-[960px]:flex">
              <motion.button
                whileTap={TAP_ICON}
                className={`grid size-[28px] place-items-center rounded-[7px] border transition-colors ${
                  rightPanelOpen
                    ? 'border-accent-line bg-accent-soft text-accent-strong'
                    : 'border-transparent text-ink-faint hover:border-line hover:bg-surface-soft hover:text-ink-dim'
                }`}
                type="button"
                onClick={toggleRightPanel}
                aria-pressed={rightPanelOpen}
                aria-label={rightPanelOpen ? '收起右侧检查器' : '展开右侧检查器'}
                title={rightPanelOpen ? '收起右侧检查器 (⌘I)' : '展开右侧检查器 (⌘I)'}
              >
                <PanelRightIcon className="size-[15px]" />
              </motion.button>
            </div>
          )}
        </div>
      </motion.header>

      <AnimatePresence>
        {activeToast && (
          <motion.div
            key={`${activeToast.tone}-${activeToast.message}`}
            variants={TOAST_VARIANTS}
            initial="hidden"
            animate="visible"
            exit="exit"
            className={`fixed right-3.5 top-[56px] z-40 flex w-[min(380px,calc(100vw_-_32px))] items-start gap-2 rounded-[11px] border px-3.5 py-3 shadow-[0_16px_36px_rgba(58,51,43,0.16)] backdrop-blur-md max-[640px]:right-3 max-[640px]:top-[58px] ${
              activeToast.tone === 'error'
                ? 'border-rose/40 bg-[rgba(253,246,244,0.96)]'
                : 'border-line bg-panel/96'
            }`}
            role={activeToast.tone === 'error' ? 'alert' : 'status'}
          >
            <span
              className={`mt-1 size-1.5 flex-none rounded-full ${
                activeToast.tone === 'error' ? 'bg-danger' : 'bg-mint'
              }`}
            />
            <p className="m-0 flex-1 text-[11.5px] leading-[1.6] text-ink-dim">
              {activeToast.message}
            </p>
            <motion.button
              whileTap={TAP_BUTTON}
              className="flex-none rounded-md border border-line bg-surface px-1.5 py-0.5 text-[10px] text-ink-faint transition-colors hover:text-ink-dim"
              type="button"
              onClick={() => {
                setToast(null)
                clearFloatingBallNotice()
              }}
              aria-label="关闭提示"
            >
              关闭
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
