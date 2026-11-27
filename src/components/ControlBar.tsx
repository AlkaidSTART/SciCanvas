import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { describeControlValue, isCornerCaseActive } from '../runtime/params'
import { useWorkbenchStore } from '../store/useWorkbenchStore'
import type { ControlDefinition, ControlValue } from '../types/experiment'
import { PauseIcon, PlayIcon, ResetIcon, StepIcon } from './icons'
import { FAST_TRANSITION, SPRING_SNAPPY, TAP_BUTTON } from './motion'

interface ControlBarProps {
  onTogglePlay: () => void
  onStep: () => void
  onReset: () => void
}

const SPEED_OPTIONS = [0.5, 1, 2]

export function ControlBar({ onTogglePlay, onStep, onReset }: ControlBarProps) {
  const experiment = useWorkbenchStore((state) => state.experiment)
  const params = useWorkbenchStore((state) => state.params)
  const status = useWorkbenchStore((state) => state.status)
  const speed = useWorkbenchStore((state) => state.speed)
  const presentation = useWorkbenchStore((state) => state.presentation)
  const setSpeed = useWorkbenchStore((state) => state.setSpeed)
  const setParam = useWorkbenchStore((state) => state.setParam)
  const applyCornerCase = useWorkbenchStore((state) => state.applyCornerCase)

  const [resetSpin, setResetSpin] = useState(0)

  const running = status === 'running'
  const disabled = status === 'error'
  const cornerCases = experiment.cornerCases ?? []
  // 桌面工作台模式下参数与边界态停靠在右侧检查器，底部保持紧凑播放控制条；
  // 演示模式或窄屏（< 960px）保留完整底部参数区。
  const hideInlineControlsOnDesktop = !presentation

  const handleReset = () => {
    setResetSpin((count) => count + 1)
    onReset()
  }

  return (
    <footer
      className={`flex flex-none flex-col gap-3 border-t border-line bg-[linear-gradient(180deg,var(--color-panel),var(--color-canvas))] px-[18px] pb-[15px] pt-[13px] max-[640px]:px-3 max-[640px]:pb-[13px] max-[640px]:pt-[11px] ${
        hideInlineControlsOnDesktop
          ? 'max-[959px]:max-h-[42vh] max-[959px]:overflow-y-auto min-[960px]:gap-0 min-[960px]:px-3.5 min-[960px]:py-2'
          : 'max-h-[38vh] overflow-y-auto'
      }`}
    >
      <div className="flex flex-wrap items-center gap-3 max-[640px]:gap-2">
        <div className="flex items-center gap-1.5">
          <motion.button
            whileTap={disabled ? undefined : TAP_BUTTON}
            className="inline-flex items-center gap-1.5 rounded-lg border border-accent-line bg-accent-soft px-[11px] py-[6px] text-xs font-medium text-accent-strong transition-colors enabled:hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-45 max-[640px]:px-[9px] max-[640px]:py-1.5 max-[640px]:text-[11px]"
            type="button"
            onClick={onTogglePlay}
            disabled={disabled}
            aria-label={running ? '暂停仿真' : '播放仿真'}
            title="播放 / 暂停 (Space)"
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={running ? 'pause' : 'play'}
                initial={{ opacity: 0, scale: 0.75 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.75 }}
                transition={{ duration: 0.12 }}
                className="inline-flex items-center"
              >
                {running ? (
                  <PauseIcon className="size-[13px] flex-none" />
                ) : (
                  <PlayIcon className="size-[13px] flex-none" />
                )}
              </motion.span>
            </AnimatePresence>
            <span>{running ? '暂停' : '播放'}</span>
          </motion.button>
          <motion.button
            whileTap={disabled ? undefined : TAP_BUTTON}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-[10px] py-[6px] text-xs text-ink-dim transition-colors enabled:hover:border-line-strong enabled:hover:bg-surface-soft enabled:hover:text-ink disabled:cursor-not-allowed disabled:opacity-45 max-[640px]:px-[9px] max-[640px]:py-1.5 max-[640px]:text-[11px]"
            type="button"
            onClick={onStep}
            disabled={disabled}
            aria-label="单步推进一帧"
            title="单步推进 (.)"
          >
            <StepIcon className="size-[13px] flex-none" />
            <span>单步</span>
          </motion.button>
          <motion.button
            whileTap={TAP_BUTTON}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-[10px] py-[6px] text-xs text-ink-dim transition-colors enabled:hover:border-line-strong enabled:hover:bg-surface-soft enabled:hover:text-ink disabled:cursor-not-allowed disabled:opacity-45 max-[640px]:px-[9px] max-[640px]:py-1.5 max-[640px]:text-[11px]"
            type="button"
            onClick={handleReset}
            aria-label="重置仿真"
            title="重置仿真 (R)"
          >
            <motion.span
              animate={{ rotate: resetSpin * -360 }}
              transition={{ duration: 0.36, ease: [0.22, 1, 0.36, 1] }}
              className="inline-flex items-center"
            >
              <ResetIcon className="size-[13px] flex-none" />
            </motion.span>
            <span>重置</span>
          </motion.button>
        </div>

        <div
          className="inline-flex rounded-lg border border-line bg-surface-soft p-0.5"
          role="group"
          aria-label="仿真倍速"
        >
          {SPEED_OPTIONS.map((option) => (
            <button
              key={option}
              className={`relative rounded-md px-[8px] py-0.5 font-mono text-[11px] transition-colors ${
                speed === option ? 'text-accent-strong' : 'text-ink-faint hover:text-ink-dim'
              }`}
              type="button"
              onClick={() => setSpeed(option)}
              aria-pressed={speed === option}
            >
              {speed === option && (
                <motion.span
                  layoutId="speed-active-pill"
                  transition={SPRING_SNAPPY}
                  className="absolute inset-0 rounded-md bg-accent-soft"
                />
              )}
              <span className="relative z-[1]">{option}×</span>
            </button>
          ))}
        </div>

        <div className="ml-auto hidden items-center gap-3 font-mono text-[10px] text-ink-faint min-[720px]:flex">
          <span className="hidden items-center gap-1.5 min-[1180px]:inline-flex">
            <kbd className="rounded-[4px] border border-line bg-surface px-1 py-px text-[9px] text-ink-dim">
              Space
            </kbd>
            <span>播停</span>
            <kbd className="ml-1 rounded-[4px] border border-line bg-surface px-1 py-px text-[9px] text-ink-dim">
              R
            </kbd>
            <span>重置</span>
          </span>
          <span className="whitespace-nowrap">固定步长 1/120 s</span>
        </div>
      </div>

      {cornerCases.length > 0 && (
        <div
          className={`flex flex-wrap items-center gap-1.5 ${
            hideInlineControlsOnDesktop ? 'min-[960px]:hidden' : ''
          }`}
          role="group"
          aria-label="边界快捷态"
        >
          <span className="mr-0.5 font-mono text-[9.5px] uppercase tracking-[0.12em] text-ink-faint">
            边界快捷态
          </span>
          {cornerCases.map((cornerCase) => {
            const active = isCornerCaseActive(cornerCase, params)
            return (
              <motion.button
                key={cornerCase.id}
                whileTap={disabled ? undefined : TAP_BUTTON}
                transition={FAST_TRANSITION}
                className={`rounded-full border px-2.5 py-[4px] text-[10.5px] leading-none transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                  active
                    ? 'border-accent-line bg-accent-soft text-accent-strong'
                    : 'border-line bg-surface text-ink-dim enabled:hover:border-line-strong enabled:hover:bg-surface-soft enabled:hover:text-ink'
                }`}
                type="button"
                disabled={disabled}
                aria-pressed={active}
                title={cornerCase.description ?? '一键切换参数并重置仿真'}
                onClick={() => applyCornerCase(cornerCase.id)}
              >
                {cornerCase.label}
              </motion.button>
            )
          })}
        </div>
      )}

      <div
        className={`grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-x-5 gap-y-2.5 max-[640px]:grid-cols-2 max-[640px]:gap-x-3.5 ${
          hideInlineControlsOnDesktop ? 'min-[960px]:hidden' : ''
        }`}
      >
        {experiment.controls.map((control) => (
          <ControlField
            key={control.key}
            control={control}
            value={params[control.key]}
            disabled={disabled}
            onChange={setParam}
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
  idPrefix?: string
}

export function ControlField({
  control,
  value,
  disabled,
  onChange,
  idPrefix = 'control',
}: ControlFieldProps) {
  const inputId = `${idPrefix}-${control.key}`

  if (control.type === 'slider') {
    const numericValue = typeof value === 'number' ? value : control.default
    return (
      <div className="flex min-w-0 flex-col gap-[7px]">
        <div className="flex items-baseline justify-between gap-3 text-[11px] text-ink-dim">
          <label className="cursor-pointer" htmlFor={inputId}>
            {control.label}
          </label>
          <span className="whitespace-nowrap font-mono text-[10.5px] tabular-nums text-accent-strong">
            {describeControlValue(control, numericValue)}
          </span>
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
      <div className="flex min-w-0 flex-row items-center gap-3.5">
        <span className="flex flex-1 items-baseline justify-start gap-2.5 text-[11px] text-ink-dim">
          <label className="cursor-pointer" htmlFor={inputId}>
            {control.label}
          </label>
          <span className="ml-auto whitespace-nowrap font-mono text-[10.5px] tabular-nums text-ink-faint">
            {checked ? '开启' : '关闭'}
          </span>
        </span>
        <label className="relative inline-flex flex-none cursor-pointer items-center">
          <input
            id={inputId}
            className="peer sr-only"
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={(event) => onChange(control.key, event.target.checked)}
          />
          <span className="relative h-5 w-[38px] rounded-full border border-line bg-[rgba(34,55,84,0.14)] transition-colors peer-checked:border-accent-strong/50 peer-checked:bg-accent/40 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent peer-disabled:opacity-45" />
          <motion.span
            animate={{ x: checked ? 18 : 0 }}
            transition={SPRING_SNAPPY}
            className="pointer-events-none absolute left-0.5 top-0.5 size-3.5 rounded-full bg-surface shadow-[0_1px_3px_rgba(58,51,43,0.2)]"
          />
        </label>
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-[7px]">
      <div className="flex items-baseline justify-between gap-3 text-[11px] text-ink-dim">
        <label className="cursor-pointer" htmlFor={inputId}>
          {control.label}
        </label>
      </div>
      <select
        id={inputId}
        className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-xs"
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
