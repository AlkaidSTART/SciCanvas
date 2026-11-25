import type { RuntimeStatus } from '../runtime/CanvasRuntime'
import { useWorkbenchStore } from '../store/useWorkbenchStore'

const STATUS_LABEL: Record<RuntimeStatus, string> = {
  running: '运行中',
  paused: '已暂停',
  error: '待恢复',
}

const DOT_STYLE: Record<RuntimeStatus, string> = {
  running: 'bg-mint shadow-[0_0_0_3px_rgba(103,184,154,0.2)] animate-pulse-soft',
  paused: 'bg-amber',
  error: 'bg-danger',
}

export function SidePanel() {
  const experiment = useWorkbenchStore((state) => state.experiment)
  const status = useWorkbenchStore((state) => state.status)

  return (
    <aside className="flex flex-col gap-6 overflow-y-auto border-r border-line bg-[linear-gradient(180deg,#fcf9f2,#f7f1e7)] px-4 py-[18px] max-[980px]:flex-row max-[980px]:items-stretch max-[980px]:gap-3.5 max-[980px]:overflow-x-auto max-[980px]:overflow-y-hidden max-[980px]:border-b max-[980px]:border-r-0 max-[980px]:px-3 max-[980px]:py-2.5">
      <section className="flex flex-col gap-2.5 max-[980px]:min-w-[230px] max-[980px]:flex-none">
        <h2 className="m-0 flex items-center justify-between gap-2 text-[10.5px] font-semibold uppercase tracking-[0.13em] text-ink-faint">
          预设实验
          <span className="rounded-[5px] border border-line bg-ink-dim/10 px-1.5 py-0.5 font-mono text-[9px] normal-case tracking-normal text-ink-dim">
            M2 扩展
          </span>
        </h2>
        <button
          className="flex w-full items-center gap-2.5 rounded-[10px] border border-[rgba(224,162,121,0.42)] bg-[linear-gradient(135deg,rgba(240,205,178,0.42),rgba(240,205,178,0.12))] px-[11px] py-2.5 text-left shadow-[0_1px_2px_rgba(58,51,43,0.05)]"
          type="button"
          aria-current="true"
        >
          <span className={`size-[7px] flex-none rounded-full ${DOT_STYLE[status]}`} />
          <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
            <strong className="text-[12.5px] font-[550] leading-[1.35] text-ink">
              {experiment.title}
            </strong>
            <small className="text-[10px] text-ink-faint">{experiment.domain}</small>
          </span>
          <span className="whitespace-nowrap font-mono text-[9px] text-accent-strong">
            {STATUS_LABEL[status]}
          </span>
        </button>
        <p className="m-0 text-[10.5px] leading-[1.55] text-ink-faint">更多跨学科案例将在 M2 解锁</p>
      </section>

      <section className="flex flex-col gap-2.5 max-[980px]:hidden">
        <h2 className="m-0 flex items-center justify-between gap-2 text-[10.5px] font-semibold uppercase tracking-[0.13em] text-ink-faint">
          AI 实验生成
          <span className="rounded-[5px] border border-line bg-ink-dim/10 px-1.5 py-0.5 font-mono text-[9px] normal-case tracking-normal text-ink-dim">
            M3
          </span>
        </h2>
        <div className="flex flex-col gap-2">
          <textarea
            className="resize-none rounded-[9px] border border-line bg-surface-soft px-2.5 py-[9px] text-[11.5px] leading-[1.55] text-ink-faint disabled:cursor-not-allowed"
            rows={3}
            disabled
            placeholder="描述想探索的科学机理，或粘贴论文公式…（M3 开放）"
          />
          <button
            className="rounded-lg border border-transparent bg-accent-strong px-3.5 py-[7px] text-xs font-semibold text-[#fbf7ef] transition-colors enabled:hover:bg-accent disabled:cursor-not-allowed disabled:opacity-45"
            type="button"
            disabled
          >
            生成实验
          </button>
        </div>
      </section>

      <div className="mt-auto flex items-center gap-2 border-t border-line pt-3.5 text-[10.5px] text-ink-faint max-[980px]:hidden">
        <span className="size-1.5 flex-none rounded-full bg-mint shadow-[0_0_0_3px_rgba(103,184,154,0.18)]" />
        本地内置实验 · 无需登录 / API
      </div>
    </aside>
  )
}
