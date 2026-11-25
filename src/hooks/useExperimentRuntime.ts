import { useCallback, useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { CanvasRuntime } from '../runtime/CanvasRuntime'
import { useWorkbenchStore } from '../store/useWorkbenchStore'

export interface ExperimentRuntimeControls {
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
 * 参数、倍速与状态读写都走全局 store，组件无需层层传递。
 */
export function useExperimentRuntime(
  canvasRef: RefObject<HTMLCanvasElement | null>,
): ExperimentRuntimeControls {
  const experiment = useWorkbenchStore((state) => state.experiment)
  const params = useWorkbenchStore((state) => state.params)
  const speed = useWorkbenchStore((state) => state.speed)
  const reloadKey = useWorkbenchStore((state) => state.reloadKey)
  const restartKey = useWorkbenchStore((state) => state.restartKey)
  const syncStatus = useWorkbenchStore((state) => state.syncStatus)
  const syncError = useWorkbenchStore((state) => state.syncError)
  const syncTelemetry = useWorkbenchStore((state) => state.syncTelemetry)
  const syncProbe = useWorkbenchStore((state) => state.syncProbe)

  const runtimeRef = useRef<CanvasRuntime | null>(null)
  const paramsRef = useRef(params)
  const speedRef = useRef(speed)

  useEffect(() => {
    paramsRef.current = params
  }, [params])

  useEffect(() => {
    speedRef.current = speed
  }, [speed])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined

    syncError(null)
    syncStatus('running')
    syncTelemetry([])
    syncProbe(null)
    const runtime = new CanvasRuntime({
      canvas,
      experiment,
      params: paramsRef.current,
      speed: speedRef.current,
      onStatusChange: syncStatus,
      onError: (info) => {
        syncError(info)
        syncStatus('error')
      },
      onTelemetry: syncTelemetry,
      onProbe: syncProbe,
    })
    runtimeRef.current = runtime
    runtime.start()

    return () => {
      runtime.destroy()
      runtimeRef.current = null
      syncProbe(null)
    }
  }, [canvasRef, experiment, reloadKey, syncError, syncStatus, syncTelemetry, syncProbe])

  // 边界态应用：参数已通过 store 原子更新，这里只负责重置并继续播放。
  useEffect(() => {
    if (restartKey === 0) return
    const runtime = runtimeRef.current
    if (!runtime) return
    syncError(null)
    // 与参数同步解耦：先取最新参数再重建初始状态，避免用旧参数重置。
    runtime.setParams(useWorkbenchStore.getState().params)
    runtime.reset()
    runtime.start()
  }, [restartKey, syncError])

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
    syncError(null)
    runtimeRef.current?.reset()
  }, [syncError])

  const retry = useCallback(() => {
    syncError(null)
    const runtime = runtimeRef.current
    if (!runtime) return
    runtime.reset()
    runtime.start()
  }, [syncError])

  return { play, pause, toggle, step, reset, retry }
}
