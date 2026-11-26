import type { Canvas2DExperimentSpec, GeneratedExperimentSpec } from '../ai/schema'
import { EXPERIMENTS } from '../experiments'
import { CanvasRuntime } from '../runtime/CanvasRuntime'
import { compileScene2DExperiment } from '../runtime/scene2dRenderer'
import type {
  ProbeReadout,
  RuntimeErrorInfo,
  RuntimeStatus,
} from '../runtime/CanvasRuntime'
import { describeControlValue, sanitizeParams } from '../runtime/params'
import type {
  ControlDefinition,
  ControlValue,
  ExperimentDefinition,
  ParamValues,
  SimulationModel,
  TelemetryMetric,
  TelemetrySample,
} from '../types/experiment'
import { EXPORT_FORMAT_VERSION } from './types'
import type { ExportPayload } from './types'

declare global {
  interface Window {
    __SCICANVAS_EXPORT__?: ExportPayload
  }
}

const STATUS_LABEL: Record<RuntimeStatus, string> = {
  running: '运行中',
  paused: '已暂停',
  error: '模型异常',
}

const STATUS_DOT: Record<RuntimeStatus, string> = {
  running: 'sc-dot-running',
  paused: 'sc-dot-paused',
  error: 'sc-dot-error',
}

const SCOPE_LABEL: Record<RuntimeErrorInfo['scope'], string> = {
  init: '初始化阶段',
  'first-frame': '首帧绘制阶段',
  step: '推演阶段',
  draw: '绘制阶段',
}

const SPEED_OPTIONS = [0.5, 1, 2]
const FIXED_STEP_LABEL = '固定步长 1/120 s'

const PLAYER_STYLES = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body {
  overflow: hidden;
  background: #f6f1e7;
  color: #3a332b;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
#scicanvas-root { height: 100%; }
button { font-family: inherit; cursor: pointer; }
button:disabled { cursor: not-allowed; opacity: 0.45; }
[hidden] { display: none !important; }
.sc-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background:
    radial-gradient(900px 520px at 82% -10%, rgba(168, 190, 214, 0.34), transparent 62%),
    radial-gradient(680px 460px at 6% 106%, rgba(224, 162, 121, 0.22), transparent 60%),
    #f6f1e7;
}
.sc-stage { position: relative; flex: 1; min-height: 0; overflow: hidden; background: #fbf7ef; }
.sc-stage canvas { display: block; width: 100%; height: 100%; }
.sc-formula {
  position: absolute;
  left: 18px;
  top: 18px;
  width: min(430px, calc(100% - 150px));
  padding: 12px 16px 13px;
  border: 1px solid rgba(92, 74, 54, 0.1);
  border-radius: 12px;
  background: rgba(252, 249, 242, 0.9);
  box-shadow: 0 16px 36px rgba(58, 51, 43, 0.1);
  backdrop-filter: blur(8px);
  pointer-events: none;
}
.sc-domain {
  display: block;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9.5px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #4f7292;
}
.sc-formula h1 { margin: 3px 0 8px; font-size: 13px; font-weight: 600; line-height: 1.35; }
.sc-formula-body { overflow-x: auto; padding-bottom: 4px; }
.sc-formula-body math { font-size: 1.06em; }
.sc-insight {
  margin: 8px 0 0;
  padding-top: 8px;
  border-top: 1px solid rgba(92, 74, 54, 0.1);
  font-size: 11.5px;
  line-height: 1.65;
  color: #6d6154;
}
.sc-status {
  position: absolute;
  right: 18px;
  top: 18px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 5px 10px;
  border: 1px solid rgba(92, 74, 54, 0.12);
  border-radius: 999px;
  background: rgba(252, 249, 242, 0.86);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  color: #6d6154;
}
.sc-dot { width: 6px; height: 6px; border-radius: 50%; background: #9b8f81; }
.sc-dot-running { background: #7faf94; box-shadow: 0 0 0 3px rgba(103, 184, 154, 0.2); }
.sc-dot-paused { background: #d9a24a; }
.sc-dot-error { background: #d98e8e; }
.sc-telemetry {
  position: absolute;
  right: 18px;
  bottom: 18px;
  width: 200px;
  padding: 9px 12px 10px;
  border: 1px solid rgba(92, 74, 54, 0.12);
  border-radius: 12px;
  background: rgba(252, 249, 242, 0.9);
  box-shadow: 0 12px 28px rgba(58, 51, 43, 0.1);
  backdrop-filter: blur(8px);
  pointer-events: none;
}
.sc-telemetry-head {
  display: flex;
  justify-content: space-between;
  margin-bottom: 5px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #9b8f81;
}
.sc-metric { margin-bottom: 6px; }
.sc-metric-row { display: flex; justify-content: space-between; gap: 8px; font-size: 10px; color: #6d6154; }
.sc-metric-row strong {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 500;
  color: #3a332b;
  font-variant-numeric: tabular-nums;
}
.sc-metric-dot { display: inline-block; width: 6px; height: 6px; margin-right: 6px; border-radius: 50%; }
.sc-spark { display: block; width: 100%; height: 22px; }
.sc-probe {
  position: absolute;
  z-index: 6;
  width: 202px;
  padding: 7px 11px;
  border: 1px solid rgba(92, 74, 54, 0.12);
  border-radius: 10px;
  background: rgba(252, 249, 242, 0.96);
  box-shadow: 0 10px 24px rgba(58, 51, 43, 0.14);
  pointer-events: none;
}
.sc-probe-position { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 9.5px; color: #9b8f81; }
.sc-probe-row { display: flex; justify-content: space-between; gap: 8px; font-size: 10.5px; color: #6d6154; }
.sc-probe-row strong {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  color: #3a332b;
  font-variant-numeric: tabular-nums;
}
.sc-probe-detail {
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px solid rgba(92, 74, 54, 0.1);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9.5px;
  color: #9b8f81;
}
.sc-hint-pill {
  position: absolute;
  left: 18px;
  bottom: 12px;
  padding: 5px 10px;
  border: 1px solid rgba(92, 74, 54, 0.12);
  border-radius: 999px;
  background: rgba(252, 249, 242, 0.82);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9.5px;
  color: #9b8f81;
  pointer-events: none;
}
.sc-error {
  position: absolute;
  inset: 0;
  z-index: 7;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(246, 241, 231, 0.9);
  backdrop-filter: blur(4px);
}
.sc-error-box {
  width: min(470px, 100%);
  padding: 20px;
  border: 1px solid rgba(217, 142, 142, 0.35);
  border-radius: 14px;
  background: linear-gradient(160deg, #fdfaf3, #fbf0ea);
  box-shadow: 0 16px 36px rgba(58, 51, 43, 0.12);
}
.sc-error-box h2 { margin: 0 0 4px; font-size: 14px; }
.sc-error-box p { margin: 0 0 10px; font-size: 11px; color: #6d6154; }
.sc-error-box pre {
  max-height: 150px;
  margin: 0 0 12px;
  padding: 10px 12px;
  overflow: auto;
  border: 1px solid rgba(92, 74, 54, 0.12);
  border-radius: 9px;
  background: #fbeeea;
  color: #a9605f;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}
.sc-footer {
  flex: none;
  max-height: 48vh;
  overflow-y: auto;
  padding: 12px 18px 14px;
  border-top: 1px solid rgba(92, 74, 54, 0.12);
  background: linear-gradient(180deg, #fcf9f2, #f8f2e8);
}
.sc-row { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
.sc-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 11px;
  border: 1px solid rgba(92, 74, 54, 0.14);
  border-radius: 8px;
  background: #fbf7ef;
  color: #6d6154;
  font-size: 12px;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}
.sc-btn:hover:not(:disabled) { border-color: rgba(92, 74, 54, 0.24); background: #f1ebdf; color: #3a332b; }
.sc-btn-primary {
  border-color: rgba(124, 157, 187, 0.34);
  background: rgba(154, 180, 204, 0.2);
  color: #4f7292;
}
.sc-btn-primary:hover:not(:disabled) { background: rgba(124, 157, 187, 0.28); }
.sc-speeds { display: inline-flex; padding: 2px; border: 1px solid rgba(92, 74, 54, 0.12); border-radius: 8px; background: #f1ebdf; }
.sc-speed {
  padding: 4px 9px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #9b8f81;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
}
.sc-speed-active { background: rgba(154, 180, 204, 0.2); color: #4f7292; }
.sc-brand { margin-left: auto; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 10px; color: #9b8f81; }
.sc-corners { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 10px; }
.sc-corners-label {
  margin-right: 2px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9.5px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #9b8f81;
}
.sc-corner {
  padding: 4px 10px;
  border: 1px solid rgba(92, 74, 54, 0.14);
  border-radius: 999px;
  background: #fbf7ef;
  color: #6d6154;
  font-size: 10.5px;
  line-height: 1;
}
.sc-corner:hover:not(:disabled) { border-color: rgba(92, 74, 54, 0.26); background: #f1ebdf; color: #3a332b; }
.sc-corner-active { border-color: rgba(124, 157, 187, 0.34); background: rgba(154, 180, 204, 0.2); color: #4f7292; }
.sc-fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 10px 20px;
  margin-top: 12px;
}
.sc-field { display: flex; min-width: 0; flex-direction: column; gap: 7px; }
.sc-field-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; font-size: 11px; color: #6d6154; }
.sc-field-value {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  color: #4f7292;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.sc-field-toggle { flex-direction: row; align-items: center; gap: 14px; }
.sc-field-toggle .sc-field-head { flex: 1; }
.sc-range { -webkit-appearance: none; appearance: none; width: 100%; height: 18px; margin: 0; background: transparent; cursor: pointer; }
.sc-range::-webkit-slider-runnable-track { height: 4px; border-radius: 999px; background: linear-gradient(90deg, rgba(124, 157, 187, 0.55), rgba(124, 157, 187, 0.16)); }
.sc-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  margin-top: -5px;
  border: 2px solid #4f7292;
  border-radius: 50%;
  background: #fcf9f2;
  box-shadow: 0 0 0 4px rgba(124, 157, 187, 0.14);
}
.sc-range::-moz-range-track { height: 4px; border-radius: 999px; background: linear-gradient(90deg, rgba(124, 157, 187, 0.55), rgba(124, 157, 187, 0.16)); }
.sc-range::-moz-range-thumb { width: 10px; height: 10px; border: 2px solid #4f7292; border-radius: 50%; background: #fcf9f2; }
.sc-range:disabled { opacity: 0.45; cursor: not-allowed; }
.sc-check { width: 16px; height: 16px; accent-color: #4f7292; }
.sc-select {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid rgba(92, 74, 54, 0.14);
  border-radius: 8px;
  background: #fbf7ef;
  color: #3a332b;
  font-size: 12px;
}
.sc-fatal { display: grid; height: 100%; place-items: center; padding: 24px; }
.sc-fatal-box {
  width: min(460px, 100%);
  padding: 20px;
  border: 1px solid rgba(217, 142, 142, 0.35);
  border-radius: 14px;
  background: #fdfaf3;
}
.sc-fatal-box h1 { margin: 0 0 6px; font-size: 15px; }
.sc-fatal-box p { margin: 0; font-size: 12px; color: #6d6154; }
@media (max-width: 640px) {
  .sc-formula { left: 12px; top: 12px; width: calc(100% - 24px); }
  .sc-status { right: 12px; top: auto; bottom: 12px; }
  .sc-telemetry { display: none; }
  .sc-footer { padding: 10px 12px 12px; }
  .sc-brand { display: none; }
  .sc-fields { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px 14px; }
}
@media (max-height: 620px) {
  .sc-insight { display: none; }
}
`

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function injectStyles(): void {
  const style = document.createElement('style')
  style.textContent = PLAYER_STYLES
  document.head.append(style)
}

/** 生成自包含的模型定义；AI 代码只获得画布与数学等基础能力。 */
function modelFromSpec(spec: Canvas2DExperimentSpec): SimulationModel {
  const factory = new Function(
    'window',
    'document',
    'globalThis',
    'self',
    'top',
    'parent',
    'frames',
    'fetch',
    'XMLHttpRequest',
    'WebSocket',
    'EventSource',
    'localStorage',
    'sessionStorage',
    'indexedDB',
    'navigator',
    'location',
    'history',
    'opener',
    'React',
    `"use strict";\n${spec.simulationCode}`,
  ) as () => SimulationModel
  const model = factory.call(undefined)
  if (
    !model ||
    typeof model.createState !== 'function' ||
    typeof model.step !== 'function' ||
    typeof model.draw !== 'function'
  ) {
    throw new Error('AI 实验代码缺少 createState / step / draw')
  }
  return model
}

function definitionFromSpec(spec: GeneratedExperimentSpec): ExperimentDefinition {
  if (spec.renderType === 'scene2d') {
    return compileScene2DExperiment(spec, 'ai-export')
  }
  return {
    id: 'ai-export',
    title: spec.title,
    domain: spec.domain,
    formulaLatex: spec.formulaLatex,
    insight: spec.insight,
    renderType: 'canvas2d',
    controls: spec.controls,
    ...(spec.legend ? { legend: spec.legend } : {}),
    model: modelFromSpec(spec),
  }
}

function resolveExperiment(payload: ExportPayload): ExperimentDefinition {
  if (payload.kind === 'ai') {
    if (!payload.spec) throw new Error('导出文件缺少 AI 实验定义')
    return definitionFromSpec(payload.spec)
  }
  const experiment = EXPERIMENTS.find((item) => item.id === payload.experimentId)
  if (!experiment) {
    throw new Error('导出文件引用的内置实验不存在，可能来自更新版本')
  }
  return experiment
}

interface Sparkline {
  svg: SVGSVGElement
  update: (samples: TelemetrySample[]) => void
}

function createSparkline(metric: TelemetryMetric): Sparkline {
  const NS = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('class', 'sc-spark')
  svg.setAttribute('viewBox', '0 0 100 24')
  svg.setAttribute('preserveAspectRatio', 'none')
  svg.setAttribute('aria-hidden', 'true')
  const line = document.createElementNS(NS, 'polyline')
  line.setAttribute('fill', 'none')
  line.setAttribute('stroke', metric.color)
  line.setAttribute('stroke-width', '1.4')
  line.setAttribute('stroke-linecap', 'round')
  line.setAttribute('stroke-linejoin', 'round')
  line.setAttribute('vector-effect', 'non-scaling-stroke')
  svg.append(line)

  return {
    svg,
    update: (samples) => {
      const values: number[] = []
      for (const sample of samples) {
        const value = sample.values[metric.key]
        if (typeof value === 'number' && Number.isFinite(value)) values.push(value)
      }
      if (values.length < 2) {
        line.setAttribute('points', '')
        return
      }
      const min = Math.min(...values)
      const max = Math.max(...values)
      const span = max - min || 1
      const stepX = 100 / (values.length - 1)
      line.setAttribute(
        'points',
        values
          .map(
            (value, index) =>
              `${(index * stepX).toFixed(2)},${(24 - ((value - min) / span) * 20).toFixed(2)}`,
          )
          .join(' '),
      )
    },
  }
}

function formatMetric(metric: TelemetryMetric, value: number): string {
  const text = value.toFixed(metric.precision ?? 2)
  return metric.unit ? `${text} ${metric.unit}` : text
}

function mountPlayer(root: HTMLElement, payload: ExportPayload | undefined): void {
  injectStyles()

  if (!payload) {
    throw new Error('未找到实验数据，文件可能已损坏')
  }
  if (payload.version !== EXPORT_FORMAT_VERSION) {
    throw new Error(`导出文件版本 ${payload.version} 与当前播放器不兼容，请重新导出`)
  }

  const experiment = resolveExperiment(payload)
  let params = sanitizeParams(experiment, payload.params)
  const initialSpeed = SPEED_OPTIONS.includes(payload.speed) ? payload.speed : 1

  root.textContent = ''
  const shell = el('div', 'sc-shell')
  const stage = el('section', 'sc-stage')
  const canvas = document.createElement('canvas')
  stage.append(canvas)

  const formula = el('div', 'sc-formula')
  const domain = el('span', 'sc-domain', experiment.domain)
  const heading = el('h1', '', experiment.title)
  const formulaBody = el('div', 'sc-formula-body')
  formulaBody.innerHTML = payload.formulaHtml
  formula.append(domain, heading, formulaBody)
  if (experiment.insight) {
    formula.append(el('p', 'sc-insight', experiment.insight))
  }
  stage.append(formula)

  const status = el('div', 'sc-status')
  const statusDot = el('span', 'sc-dot')
  const statusText = el('span', '', STATUS_LABEL.paused)
  status.append(statusDot, statusText)
  stage.append(status)

  const errorPanel = el('div', 'sc-error')
  errorPanel.hidden = true
  const errorBox = el('div', 'sc-error-box')
  const errorHeading = el('h2', '', '模型运行异常')
  const errorScope = el('p', '', '')
  const errorDetail = el('pre', '', '')
  const retryButton = el('button', 'sc-btn sc-btn-primary', '重新初始化')
  retryButton.type = 'button'
  errorBox.append(errorHeading, errorScope, errorDetail, retryButton)
  errorPanel.append(errorBox)
  stage.append(errorPanel)

  const footer = el('footer', 'sc-footer')
  const controlsRow = el('div', 'sc-row')
  const playButton = el('button', 'sc-btn sc-btn-primary', '暂停')
  playButton.type = 'button'
  const stepButton = el('button', 'sc-btn', '单步')
  stepButton.type = 'button'
  const resetButton = el('button', 'sc-btn', '重置')
  resetButton.type = 'button'
  const speedGroup = el('div', 'sc-speeds')
  speedGroup.setAttribute('role', 'group')
  speedGroup.setAttribute('aria-label', '仿真倍速')
  const speedButtons = SPEED_OPTIONS.map((speed) => {
    const button = el('button', 'sc-speed', `${speed}×`)
    button.type = 'button'
    button.dataset.speed = String(speed)
    button.classList.toggle('sc-speed-active', speed === initialSpeed)
    button.addEventListener('click', () => {
      runtime.setSpeed(speed)
      speedButtons.forEach((item) => {
        item.classList.toggle('sc-speed-active', item === button)
      })
    })
    speedGroup.append(button)
    return button
  })
  const brand = el('span', 'sc-brand', `SciCanvas · 离线导出 · ${FIXED_STEP_LABEL}`)
  controlsRow.append(playButton, stepButton, resetButton, speedGroup, brand)
  footer.append(controlsRow)

  const cornerCases = experiment.cornerCases ?? []
  if (cornerCases.length > 0) {
    const cornerRow = el('div', 'sc-corners')
    cornerRow.append(el('span', 'sc-corners-label', '边界快捷态'))
    for (const cornerCase of cornerCases) {
      const button = el('button', 'sc-corner', cornerCase.label)
      button.type = 'button'
      button.title = cornerCase.description ?? '一键切换参数并重置仿真'
      button.addEventListener('click', () => {
        params = sanitizeParams(experiment, { ...params, ...cornerCase.params })
        runtime.setParams(params)
        runtime.reset()
        runtime.start()
        refreshFields()
        updateCornerStates()
      })
      button.dataset.corner = cornerCase.id
      cornerRow.append(button)
    }
    footer.append(cornerRow)
  }

  const fields = el('div', 'sc-fields')
  footer.append(fields)

  const fieldSyncs: Array<() => void> = []

  function updateCornerStates(): void {
    for (const button of footer.querySelectorAll<HTMLButtonElement>('.sc-corner')) {
      const cornerCase = cornerCases.find((item) => item.id === button.dataset.corner)
      if (!cornerCase) continue
      const active = Object.entries(cornerCase.params).every(
        ([key, value]) => params[key] === value,
      )
      button.classList.toggle('sc-corner-active', active)
      button.setAttribute('aria-pressed', String(active))
    }
  }

  function refreshFields(): void {
    for (const sync of fieldSyncs) sync()
    updateCornerStates()
  }

  for (const control of experiment.controls) {
    fields.append(createControlField(control, () => params, (key, value) => {
      params = sanitizeParams(experiment, { ...params, [key]: value })
      runtime.setParams(params)
      updateCornerStates()
    }, fieldSyncs))
  }

  shell.append(stage, footer)
  root.append(shell)

  // 遥测与探针仅在实验声明时出现，未声明的能力不渲染空占位。
  let onTelemetry: ((samples: TelemetrySample[]) => void) | undefined
  if (experiment.telemetry) {
    const telemetry = experiment.telemetry
    const panel = el('div', 'sc-telemetry')
    const head = el('div', 'sc-telemetry-head')
    head.append(el('span', '', '实时遥测'), el('span', '', '0 点'))
    panel.append(head)
    const countLabel = head.lastElementChild as HTMLElement
    const values = new Map<string, HTMLElement>()
    const sparks = new Map<string, Sparkline>()

    for (const metric of telemetry.metrics) {
      const block = el('div', 'sc-metric')
      const row = el('div', 'sc-metric-row')
      const label = el('span', '', '')
      const dot = el('span', 'sc-metric-dot')
      dot.style.backgroundColor = metric.color
      label.append(dot, document.createTextNode(metric.label))
      const value = el('strong', '', '—')
      row.append(label, value)
      const spark = createSparkline(metric)
      block.append(row, spark.svg)
      panel.append(block)
      values.set(metric.key, value)
      sparks.set(metric.key, spark)
    }
    stage.append(panel)

    onTelemetry = (samples) => {
      countLabel.textContent = `${samples.length} 点`
      const latest = samples.length > 0 ? samples[samples.length - 1] : null
      for (const metric of telemetry.metrics) {
        const value = latest?.values[metric.key]
        const node = values.get(metric.key)
        if (node) {
          node.textContent =
            typeof value === 'number' ? formatMetric(metric, value) : '—'
        }
        sparks.get(metric.key)?.update(samples)
      }
    }
  }

  let onProbe: ((readout: ProbeReadout | null) => void) | undefined
  if (experiment.probe) {
    const probeDefinition = experiment.probe
    const hint = el('div', 'sc-hint-pill', probeDefinition.hint ?? '悬停画布查看局部值')
    stage.append(hint)
    const tooltip = el('div', 'sc-probe')
    tooltip.hidden = true
    const position = el('div', 'sc-probe-position')
    const row = el('div', 'sc-probe-row')
    const label = el('span')
    const value = el('strong')
    row.append(label, value)
    const detail = el('div', 'sc-probe-detail')
    tooltip.append(position, row, detail)
    stage.append(tooltip)

    onProbe = (readout) => {
      hint.hidden = Boolean(readout)
      tooltip.hidden = !readout
      if (!readout) return
      position.textContent = readout.reading.position
      label.textContent = readout.reading.label
      value.textContent = readout.reading.value
      detail.textContent = readout.reading.detail ?? ''
      detail.hidden = !readout.reading.detail
      const maxLeft = Math.max(8, stage.clientWidth - 218)
      const maxTop = Math.max(8, stage.clientHeight - 108)
      tooltip.style.left = `${Math.max(8, Math.min(readout.point.x + 16, maxLeft))}px`
      tooltip.style.top = `${Math.max(8, Math.min(readout.point.y + 16, maxTop))}px`
    }
  }

  function syncStatus(next: RuntimeStatus): void {
    statusText.textContent = STATUS_LABEL[next]
    statusDot.className = `sc-dot ${STATUS_DOT[next]}`
    playButton.textContent = next === 'running' ? '暂停' : '播放'
    const disabled = next === 'error'
    playButton.disabled = disabled
    stepButton.disabled = disabled
    resetButton.disabled = disabled
    for (const button of speedButtons) button.disabled = disabled
    for (const input of fields.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      'input, select',
    )) {
      input.disabled = disabled
    }
  }

  function showError(info: RuntimeErrorInfo): void {
    errorScope.textContent = `${SCOPE_LABEL[info.scope]} · 已隔离，不影响其他区域`
    errorDetail.textContent = info.message
    errorPanel.hidden = false
  }

  const runtime = new CanvasRuntime({
    canvas,
    experiment,
    params,
    speed: initialSpeed,
    onStatusChange: syncStatus,
    onError: showError,
    ...(onTelemetry ? { onTelemetry } : {}),
    ...(onProbe ? { onProbe } : {}),
  })

  playButton.addEventListener('click', () => runtime.toggle())
  stepButton.addEventListener('click', () => runtime.stepOnce())
  resetButton.addEventListener('click', () => {
    errorPanel.hidden = true
    runtime.reset()
  })
  retryButton.addEventListener('click', () => {
    errorPanel.hidden = true
    runtime.reset()
    runtime.start()
  })

  syncStatus(runtime.getStatus())
  updateCornerStates()
  runtime.start()
}

function createControlField(
  control: ControlDefinition,
  readParams: () => ParamValues,
  onChange: (key: string, value: ControlValue) => void,
  syncs: Array<() => void>,
): HTMLElement {
  const wrapper = el('div', control.type === 'toggle' ? 'sc-field sc-field-toggle' : 'sc-field')
  const head = el('div', 'sc-field-head')
  const label = el('label', '', control.label)
  head.append(label)
  let valueLabel: HTMLElement | null = null

  if (control.type === 'slider') {
    valueLabel = el('span', 'sc-field-value')
    head.append(valueLabel)
    wrapper.append(head)
    const range = document.createElement('input')
    range.type = 'range'
    range.className = 'sc-range'
    range.min = String(control.min)
    range.max = String(control.max)
    range.step = String(control.step)
    range.id = `sc-control-${control.key}`
    label.htmlFor = range.id
    const sync = () => {
      const value = readParams()[control.key]
      const numeric = typeof value === 'number' ? value : control.default
      range.value = String(numeric)
      if (valueLabel) valueLabel.textContent = describeControlValue(control, numeric)
    }
    range.addEventListener('input', () => {
      onChange(control.key, Number(range.value))
      sync()
    })
    syncs.push(sync)
    sync()
    wrapper.append(range)
    return wrapper
  }

  if (control.type === 'toggle') {
    valueLabel = el('span', 'sc-field-value')
    head.append(valueLabel)
    wrapper.append(head)
    const check = document.createElement('input')
    check.type = 'checkbox'
    check.className = 'sc-check'
    check.id = `sc-control-${control.key}`
    label.htmlFor = check.id
    const sync = () => {
      const checked = readParams()[control.key] === true
      check.checked = checked
      if (valueLabel) valueLabel.textContent = checked ? '开启' : '关闭'
    }
    check.addEventListener('change', () => {
      onChange(control.key, check.checked)
      sync()
    })
    syncs.push(sync)
    sync()
    wrapper.append(check)
    return wrapper
  }

  wrapper.append(head)
  const select = document.createElement('select')
  select.className = 'sc-select'
  select.id = `sc-control-${control.key}`
  label.htmlFor = select.id
  for (const option of control.options) {
    const node = document.createElement('option')
    node.value = option.value
    node.textContent = option.label
    select.append(node)
  }
  const sync = () => {
    const value = readParams()[control.key]
    select.value = typeof value === 'string' ? value : control.default
  }
  select.addEventListener('change', () => {
    onChange(control.key, select.value)
    sync()
  })
  syncs.push(sync)
  sync()
  wrapper.append(select)
  return wrapper
}

function renderFatal(root: HTMLElement, error: unknown): void {
  injectStyles()
  root.textContent = ''
  const box = el('div', 'sc-fatal')
  const card = el('div', 'sc-fatal-box')
  card.append(
    el('h1', '', '无法打开离线实验'),
    el('p', '', `${errorMessage(error)}。请重新从 SciCanvas 导出。`),
  )
  box.append(card)
  root.append(box)
}

function main(): void {
  const root = document.getElementById('scicanvas-root')
  if (!root) return
  try {
    mountPlayer(root, window.__SCICANVAS_EXPORT__)
  } catch (error) {
    renderFatal(root, error)
  }
}

main()
