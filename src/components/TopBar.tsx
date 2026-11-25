import { BoltIcon } from './icons'

interface TopBarProps {
  title: string
}

export function TopBar({ title }: TopBarProps) {
  return (
    <header className="top-bar">
      <div className="brand">
        <span className="brand-mark">
          <BoltIcon className="brand-icon" />
        </span>
        <span className="brand-copy">
          <span className="brand-name">SciCanvas</span>
          <span className="brand-sub">智研活体沙盒</span>
        </span>
        <span className="stage-badge">M1</span>
      </div>

      <div className="current-experiment">
        <span className="current-label">当前实验</span>
        <span className="current-title">{title}</span>
      </div>

      <div className="top-actions">
        <button className="ghost-button" type="button" disabled title="M6 阶段开放">
          演示模式
        </button>
        <button className="ghost-button" type="button" disabled title="M6 阶段开放">
          导出 HTML
        </button>
      </div>
    </header>
  )
}
