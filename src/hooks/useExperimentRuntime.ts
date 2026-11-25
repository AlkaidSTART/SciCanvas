import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { CanvasRuntime } from '../runtime/CanvasRuntime'
import type { RuntimeErrorInfo, RuntimeStatus } from '../runtime/CanvasRuntime'
import type { ExperimentDefinition, ParamValues } from '../types/experiment'

interface UseExperimentRuntimeOptions {
  canvasRef: RefObject<HTMLCanvasElement | null>
  experiment: ExperimentDefinition
  params: ParamValues
  speed: number
  reloadKey: number
}

export interface ExperimentRuntimeControls {
  status: RuntimeStatus
  error: RuntimeErrorInfo | null
  play: () => void
  pause: () => void
  toggle: () => void
  step: () => void
  reset: () => void
  retry: () => void
}

/**
 * 把仿真运行时的生命周期绑定到 React 组件：
 * 画布卸载或实验切换时销毁实例，确保不会叠加动画循环。
 */
export function useExperimentRuntime(options: UseExperimentRuntimeOptions): ExperimentRuntimeControls {
  const { canvasRef, experiment, params, speed, reloadKey } = options
  const runtimeRef = useRef<CanvasRuntime | null>(null)
  const paramsRef = useRef(params)
  const speedRef = useRef(speed)

  const [status, setStatus] = useState<RuntimeStatus>('running')
  const [error, setError] = useState<RuntimeErrorInfo | null>(null)

  useEffect(() => {
    paramsRef.current = params
  }, [params])

  useEffect(() => {
    speedRef.current = speed
  }, [speed])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined

    setError(null)
    setStatus('running')
    const runtime = new CanvasRuntime({
      canvas,
      experiment,
      params: paramsRef.current,
      speed: speedRef.current,
      onStatusChange: setStatus,
      onError: (info) => {
        setError(info)
        setStatus('error')
      },
    })
    runtimeRef.current = runtime
    runtime.start()

    return () => {
      runtime.destroy()
      runtimeRef.current = null
    }
  }, [canvasRef, experiment, reloadKey])

  useEffect(() => {
    runtimeRef.current?.setParams(params)
  }, [params])

  useEffect(() => {
    runtimeRef.current?.setSpeed(speed)
  }, [speed])

  const play = useCallback(() => {
    runtimeRef.current?.start()
  }, [])

  const pause = useCallback(() => {
    runtimeRef.current?.pause()
  }, [])

  const toggle = useCallback(() => {
    runtimeRef.current?.toggle()
  }, [])

  const step = useCallback(() => {
    runtimeRef.current?.stepOnce()
  }, [])

  const reset = useCallback(() => {
    setError(null)
    runtimeRef.current?.reset()
  }, [])

  const retry = useCallback(() => {
    setError(null)
    const runtime = runtimeRef.current
    if (!runtime) return
    runtime.reset()
    runtime.start()
  }, [])

  return { status, error, play, pause, toggle, step, reset, retry }
}
