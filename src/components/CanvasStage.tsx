import { useMemo } from 'react'
import type { RefObject } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import type { RuntimeErrorInfo, RuntimeStatus } from '../runtime/CanvasRuntime'
import type { ExperimentDefinition } from '../types/experiment'
import { AlertIcon } from './icons'

interface CanvasStageProps {
  experiment: ExperimentDefinition
  canvasRef: RefObject<HTMLCanvasElement | null>
  status: RuntimeStatus
  error: RuntimeErrorInfo | null
  onRetry: () => void
  onResetToDefault: () => void
}

const STATUS_LABEL: Record<RuntimeStatus, string> = {
  running: '运行中',
  paused: '已暂停',
  error: '模型异常',
}

const SCOPE_LABEL: Record<RuntimeErrorInfo['scope'], string> = {
  init: '初始化阶段',
  step: '推演阶段',
  draw: '绘制阶段',
}

export function CanvasStage({
  experiment,
  canvasRef,
  status,
  error,
  onRetry,
  onResetToDefault,
}: CanvasStageProps) {
  const formulaHtml = useMemo(
    () =>
      katex.renderToString(experiment.formulaLatex, {
        throwOnError: false,
        displayMode: true,
        strict: false,
      }),
    [experiment.formulaLatex],
  )

  return (
    <section className="stage" aria-label="实验画布">
      <canvas ref={canvasRef} className="sim-canvas" />

      <div className="formula-card">
        <div className="formula-meta">
          <span className="formula-domain">{experiment.domain}</span>
          <span className="formula-title">{experiment.title}</span>
        </div>
        <div
          className="formula-math"
          // KaTeX 输出的 HTML 由本地库生成，不包含外部输入脚本
          dangerouslySetInnerHTML={{ __html: formulaHtml }}
        />
        <p className="formula-insight">{experiment.insight}</p>
      </div>

      <div className={`stage-status stage-status-${status}`}>
        <span className="status-dot" />
        {STATUS_LABEL[status]}
      </div>

      {error && (
        <div className="stage-error" role="alert">
          <div className="error-card">
            <div className="error-icon">
              <AlertIcon className="error-icon-svg" />
            </div>
            <div>
              <h2 className="error-title">模型运行异常</h2>
              <p className="error-meta">
                {SCOPE_LABEL[error.scope]} · 已隔离，不影响工作台其他区域
              </p>
            </div>
            <pre className="error-message">{error.message}</pre>
            <div className="error-actions">
              <button className="primary-button" type="button" onClick={onRetry}>
                重新初始化
              </button>
              <button className="ghost-button" type="button" onClick={onResetToDefault}>
                回到默认实验
              </button>
            </div>
            <p className="error-hint">M4 将在此基础上接入自动修复。</p>
          </div>
        </div>
      )}
    </section>
  )
}
