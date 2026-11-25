import type { RuntimeStatus } from '../runtime/CanvasRuntime'
import { describeControlValue } from '../runtime/params'
import type {
  ControlDefinition,
  ControlValue,
  ExperimentDefinition,
  ParamValues,
} from '../types/experiment'
import { PauseIcon, PlayIcon, ResetIcon, StepIcon } from './icons'

interface ControlBarProps {
  experiment: ExperimentDefinition
  params: ParamValues
  status: RuntimeStatus
  speed: number
  disabled: boolean
  onTogglePlay: () => void
  onStep: () => void
  onReset: () => void
  onSpeedChange: (speed: number) => void
  onParamChange: (key: string, value: ControlValue) => void
}

const SPEED_OPTIONS = [0.5, 1, 2]

export function ControlBar({
  experiment,
  params,
  status,
  speed,
  disabled,
  onTogglePlay,
  onStep,
  onReset,
  onSpeedChange,
  onParamChange,
}: ControlBarProps) {
  const running = status === 'running'

  return (
    <footer className="control-bar">
      <div className="transport-row">
        <div className="transport-group">
          <button
            className="transport-button is-primary"
            type="button"
            onClick={onTogglePlay}
            disabled={disabled}
            aria-label={running ? '暂停仿真' : '播放仿真'}
          >
            {running ? <PauseIcon className="transport-icon" /> : <PlayIcon className="transport-icon" />}
            <span>{running ? '暂停' : '播放'}</span>
          </button>
          <button
            className="transport-button"
            type="button"
            onClick={onStep}
            disabled={disabled}
            aria-label="单步推进一帧"
          >
            <StepIcon className="transport-icon" />
            <span>单步</span>
          </button>
          <button className="transport-button" type="button" onClick={onReset} aria-label="重置仿真">
            <ResetIcon className="transport-icon" />
            <span>重置</span>
          </button>
        </div>

        <div className="speed-group" role="group" aria-label="仿真倍速">
          {SPEED_OPTIONS.map((option) => (
            <button
              key={option}
              className={`speed-button${speed === option ? ' is-active' : ''}`}
              type="button"
              onClick={() => onSpeedChange(option)}
              aria-pressed={speed === option}
            >
              {option}×
            </button>
          ))}
        </div>

        <span className="runtime-hint">固定步长 1/120 s · 后台切换自动限幅</span>
      </div>

      <div className="control-grid">
        {experiment.controls.map((control) => (
          <ControlField
            key={control.key}
            control={control}
            value={params[control.key]}
            disabled={disabled}
            onChange={onParamChange}
          />
        ))}
      </div>
    </footer>
  )
}

interface ControlFieldProps {
  control: ControlDefinition
  value: ControlValue
  disabled: boolean
  onChange: (key: string, value: ControlValue) => void
}

function ControlField({ control, value, disabled, onChange }: ControlFieldProps) {
  const inputId = `control-${control.key}`

  if (control.type === 'slider') {
    const numericValue = typeof value === 'number' ? value : control.default
    return (
      <div className="control-field">
        <div className="control-head">
          <label htmlFor={inputId}>{control.label}</label>
          <span className="control-value">{describeControlValue(control, numericValue)}</span>
        </div>
        <input
          id={inputId}
          className="range-input"
          type="range"
          min={control.min}
          max={control.max}
          step={control.step}
          value={numericValue}
          disabled={disabled}
          onChange={(event) => onChange(control.key, Number(event.target.value))}
        />
      </div>
    )
  }

  if (control.type === 'toggle') {
    const checked = value === true
    return (
      <div className="control-field control-field-tight">
        <span className="control-head">
          <label htmlFor={inputId}>{control.label}</label>
          <span className="control-value">{checked ? '开启' : '关闭'}</span>
        </span>
        <label className="switch" htmlFor={inputId}>
          <input
            id={inputId}
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={(event) => onChange(control.key, event.target.checked)}
          />
          <span className="switch-track">
            <span className="switch-thumb" />
          </span>
        </label>
      </div>
    )
  }

  return (
    <div className="control-field">
      <div className="control-head">
        <label htmlFor={inputId}>{control.label}</label>
      </div>
      <select
        id={inputId}
        className="select-input"
        value={String(value)}
        disabled={disabled}
        onChange={(event) => onChange(control.key, event.target.value)}
      >
        {control.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}
