import { useEffect, useState } from 'react'
import { exportCurrentExperiment } from '../export/exporter'
import { useWorkbenchStore } from '../store/useWorkbenchStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { BoltIcon } from './icons'
import { WorkspaceDialog } from './WorkspaceDialog'

interface ExportToast {
  tone: 'success' | 'error'
  message: string
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

export function TopBar() {
  const title = useWorkbenchStore((state) => state.experiment.title)
  const presentation = useWorkbenchStore((state) => state.presentation)
  const enterPresentation = useWorkbenchStore((state) => state.enterPresentation)
  const exitPresentation = useWorkbenchStore((state) => state.exitPresentation)
  const saving = useWorkspaceStore((state) => state.saving)
  const lastSavedAt = useWorkspaceStore((state) => state.lastSavedAt)
  const storageError = useWorkspaceStore((state) => state.storageError)

  const [exporting, setExporting] = useState(false)
  const [toast, setToast] = useState<ExportToast | null>(null)
  const [workspaceOpen, setWorkspaceOpen] = useState(false)

  useEffect(() => {
    if (toast?.tone !== 'success') return undefined
    const timer = window.setTimeout(() => setToast(null), 4000)
    return () => window.clearTimeout(timer)
  }, [toast])

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

  if (presentation) {
    return (
      <header className="z-10 flex h-[46px] flex-none items-center gap-3 border-b border-line bg-panel/85 px-[18px] backdrop-blur-[10px] max-[640px]:px-3">
        <span className="flex-none rounded-[5px] border border-accent-line bg-accent-soft px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-accent-strong">
          演示模式
        </span>
        <span className="min-w-0 truncate text-[13px] text-ink">{title}</span>
        <span className="ml-auto hidden whitespace-nowrap text-[10.5px] text-ink-faint sm:block">
          按 Esc 可随时退出
        </span>
        <button
          className="flex flex-none items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-ink-dim transition-colors hover:border-line-strong hover:bg-surface-soft hover:text-ink"
          type="button"
          onClick={exitPresentation}
          aria-label="退出演示模式"
        >
          退出演示
          <kbd className="rounded-[4px] border border-line bg-surface-soft px-1 py-px font-mono text-[9px] text-ink-faint">
            Esc
          </kbd>
        </button>
      </header>
    )
  }

  return (
    <>
      <header className="z-10 flex h-[58px] flex-none items-center gap-6 border-b border-line bg-panel/85 px-[18px] backdrop-blur-[10px] max-[640px]:h-[54px] max-[640px]:gap-3 max-[640px]:px-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-[34px] flex-none place-items-center rounded-[10px] border border-[rgba(169,150,196,0.38)] bg-[radial-gradient(circle_at_30%_25%,rgba(195,178,218,0.48),rgba(224,162,121,0.22))] text-[#6d5a7d]">
            <BoltIcon className="size-5" />
          </span>
          <span className="flex flex-col leading-[1.15]">
            <span className="text-[15px] font-[650] tracking-[0.02em]">SciCanvas</span>
            <span className="text-[10px] tracking-[0.16em] text-ink-faint max-[640px]:hidden">
              智研活体沙盒
            </span>
          </span>
          <span className="rounded-[5px] border border-[rgba(230,197,127,0.5)] bg-butter/20 px-1.5 py-0.5 font-mono text-[10px] text-[#8a6a2f] max-[640px]:hidden">
            M7
          </span>
        </div>

        <div className="ml-auto flex min-w-0 items-center gap-2.5">
          <span className="whitespace-nowrap text-[10px] uppercase tracking-[0.12em] text-ink-faint max-[640px]:hidden">
            当前实验
          </span>
          <span className="max-w-[42vw] truncate text-[13px] max-[640px]:max-w-[48vw] max-[640px]:text-xs">
            {title}
          </span>
          <span
            className="hidden whitespace-nowrap text-[10px] text-ink-faint min-[1180px]:inline"
            title={storageError?.message}
          >
            {storageError
              ? '本地保存不可用'
              : saving
                ? '保存中…'
                : lastSavedAt
                  ? '已保存到本机'
                  : ''}
          </span>
        </div>

        <div className="flex flex-none gap-2 max-[640px]:hidden">
          <button
            className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-ink-dim transition-colors enabled:hover:border-line-strong enabled:hover:bg-surface-soft enabled:hover:text-ink disabled:cursor-not-allowed disabled:opacity-45"
            type="button"
            onClick={() => setWorkspaceOpen(true)}
          >
            工作区
          </button>
          <button
            className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-ink-dim transition-colors enabled:hover:border-line-strong enabled:hover:bg-surface-soft enabled:hover:text-ink disabled:cursor-not-allowed disabled:opacity-45"
            type="button"
            onClick={enterPresentation}
          >
            演示模式
          </button>
          <button
            className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-ink-dim transition-colors enabled:hover:border-line-strong enabled:hover:bg-surface-soft enabled:hover:text-ink disabled:cursor-not-allowed disabled:opacity-45"
            type="button"
            onClick={() => void handleExport()}
            disabled={exporting}
            aria-busy={exporting}
          >
            {exporting ? '导出中…' : '导出 HTML'}
          </button>
        </div>
      </header>

      {toast && (
        <div
          className={`fixed right-[18px] top-[68px] z-40 flex w-[min(380px,calc(100vw_-_32px))] items-start gap-2 rounded-[11px] border px-3.5 py-3 shadow-[0_16px_36px_rgba(58,51,43,0.16)] backdrop-blur-md max-[640px]:right-3 max-[640px]:top-[62px] ${
            toast.tone === 'error'
              ? 'border-rose/40 bg-[rgba(253,246,244,0.96)]'
              : 'border-line bg-panel/96'
          }`}
          role={toast.tone === 'error' ? 'alert' : 'status'}
        >
          <span
            className={`mt-1 size-1.5 flex-none rounded-full ${
              toast.tone === 'error' ? 'bg-danger' : 'bg-mint'
            }`}
          />
          <p className="m-0 flex-1 text-[11.5px] leading-[1.6] text-ink-dim">{toast.message}</p>
          <button
            className="flex-none rounded-md border border-line bg-surface px-1.5 py-0.5 text-[10px] text-ink-faint transition-colors hover:text-ink-dim"
            type="button"
            onClick={() => setToast(null)}
            aria-label="关闭导出提示"
          >
            关闭
          </button>
        </div>
      )}

      {workspaceOpen && <WorkspaceDialog onClose={() => setWorkspaceOpen(false)} />}
    </>
  )
}
