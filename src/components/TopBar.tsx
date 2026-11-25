import { useWorkbenchStore } from '../store/useWorkbenchStore'
import { BoltIcon } from './icons'

export function TopBar() {
  const title = useWorkbenchStore((state) => state.experiment.title)

  return (
    <header className="z-10 flex h-[58px] flex-none items-center gap-6 border-b border-line bg-white/80 px-[18px] backdrop-blur-[10px] max-[640px]:h-[54px] max-[640px]:gap-3 max-[640px]:px-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="grid size-[34px] flex-none place-items-center rounded-[10px] border border-accent-line bg-[radial-gradient(circle_at_30%_25%,rgba(168,198,234,0.42),rgba(168,198,234,0.12))] text-accent-strong">
          <BoltIcon className="size-5" />
        </span>
        <span className="flex flex-col leading-[1.15]">
          <span className="text-[15px] font-[650] tracking-[0.02em]">SciCanvas</span>
          <span className="text-[10px] tracking-[0.16em] text-ink-faint max-[640px]:hidden">
            智研活体沙盒
          </span>
        </span>
        <span className="rounded-[5px] border border-accent-line bg-accent-soft px-1.5 py-0.5 font-mono text-[10px] text-accent-strong max-[640px]:hidden">
          M1
        </span>
      </div>

      <div className="ml-auto flex min-w-0 items-center gap-2.5">
        <span className="whitespace-nowrap text-[10px] uppercase tracking-[0.12em] text-ink-faint max-[640px]:hidden">
          当前实验
        </span>
        <span className="max-w-[42vw] truncate text-[13px] max-[640px]:max-w-[48vw] max-[640px]:text-xs">
          {title}
        </span>
      </div>

      <div className="flex flex-none gap-2 max-[640px]:hidden">
        <button
          className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs text-ink-dim transition-colors enabled:hover:border-line-strong enabled:hover:bg-surface-soft enabled:hover:text-ink disabled:cursor-not-allowed disabled:opacity-45"
          type="button"
          disabled
          title="M6 阶段开放"
        >
          演示模式
        </button>
        <button
          className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs text-ink-dim transition-colors enabled:hover:border-line-strong enabled:hover:bg-surface-soft enabled:hover:text-ink disabled:cursor-not-allowed disabled:opacity-45"
          type="button"
          disabled
          title="M6 阶段开放"
        >
          导出 HTML
        </button>
      </div>
    </header>
  )
}
