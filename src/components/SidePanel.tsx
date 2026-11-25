import type { RuntimeStatus } from '../runtime/CanvasRuntime'
import type { ExperimentDefinition } from '../types/experiment'

interface SidePanelProps {
  experiment: ExperimentDefinition
  status: RuntimeStatus
}

const STATUS_LABEL: Record<RuntimeStatus, string> = {
  running: '运行中',
  paused: '已暂停',
  error: '待恢复',
}

export function SidePanel({ experiment, status }: SidePanelProps) {
  return (
    <aside className="side-panel">
      <section className="side-section">
        <h2 className="side-heading">
          预设实验
          <span className="badge">M2 扩展</span>
        </h2>
        <button className="preset-item is-active" type="button" aria-current="true">
          <span className={`preset-dot preset-dot-${status}`} />
          <span className="preset-copy">
            <strong>{experiment.title}</strong>
            <small>{experiment.domain}</small>
          </span>
          <span className="preset-tag">{STATUS_LABEL[status]}</span>
        </button>
        <p className="side-note">更多跨学科案例将在 M2 解锁</p>
      </section>

      <section className="side-section">
        <h2 className="side-heading">
          AI 实验生成
          <span className="badge">M3</span>
        </h2>
        <div className="generator-placeholder">
          <textarea
            rows={3}
            disabled
            placeholder="描述想探索的科学机理，或粘贴论文公式…（M3 开放）"
          />
          <button className="primary-button" type="button" disabled>
            生成实验
          </button>
        </div>
      </section>

      <div className="side-foot">
        <span className="pulse-dot" />
        本地内置实验 · 无需登录 / API
      </div>
    </aside>
  )
}
