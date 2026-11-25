import { useCallback, useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { notifySessionOutcome } from '../runtime/aiSessionBus'
import type { RuntimeErrorInfo, RuntimeStatus } from '../runtime/CanvasRuntime'
import { useWorkbenchStore } from '../store/useWorkbenchStore'

export interface AISandboxControls {
  play: () => void
  pause: () => void
  toggle: () => void
  step: () => void
  reset: () => void
  retry: () => void
}

const INIT_TIMEOUT_MS = 6_000
const PING_INTERVAL_MS = 200

const STATUS_VALUES: RuntimeStatus[] = ['running', 'paused', 'error']

function readScope(value: unknown): RuntimeErrorInfo['scope'] {
  return value === 'step' || value === 'draw' || value === 'first-frame' ? value : 'init'
}

/**
 * 把隔离 iframe 的握手、初始化、参数同步与控制指令封装成与
 * useExperimentRuntime 同形的接口，供 App 按实验来源路由。
 */
export function useAISandbox(
  iframeRef: RefObject<HTMLIFrameElement | null>,
): AISandboxControls {
  const source = useWorkbenchStore((state) => state.source)
  const aiSpec = useWorkbenchStore((state) => state.aiSpec)
  const params = useWorkbenchStore((state) => state.params)
  const speed = useWorkbenchStore((state) => state.speed)
  const status = useWorkbenchStore((state) => state.status)
  const reloadKey = useWorkbenchStore((state) => state.reloadKey)
  const syncStatus = useWorkbenchStore((state) => state.syncStatus)
  const syncError = useWorkbenchStore((state) => state.syncError)
  const markAiVersionGood = useWorkbenchStore((state) => state.markAiVersionGood)

  const paramsRef = useRef(params)
  const speedRef = useRef(speed)
  const sendRef = useRef<(message: Record<string, unknown>) => void>(() => {})
  const retryRef = useRef<() => void>(() => {})

  useEffect(() => {
    paramsRef.current = params
  }, [params])

  useEffect(() => {
    speedRef.current = speed
  }, [speed])

  useEffect(() => {
    if (source !== 'ai' || !aiSpec) return undefined
    const iframe = iframeRef.current
    if (!iframe) return undefined

    let disposed = false
    let started = false
    let settled = false
    let token = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let ping: ReturnType<typeof setInterval> | undefined

    const post = (message: Record<string, unknown>) => {
      if (disposed) return
      iframe.contentWindow?.postMessage(message, '*')
    }

    const settle = (outcome: Parameters<typeof notifySessionOutcome>[0]) => {
      if (settled) return
      settled = true
      notifySessionOutcome(outcome)
    }

    const armTimeout = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        if (disposed) return
        const info: RuntimeErrorInfo = {
          scope: 'init',
          message: '隔离沙盒初始化超时，请重试',
        }
        syncError(info)
        syncStatus('error')
        settle({ ok: false, error: info })
      }, INIT_TIMEOUT_MS)
    }

    const start = () => {
      if (disposed || started) return
      started = true
      settled = false
      token += 1
      syncError(null)
      syncStatus('running')
      post({
        type: 'init',
        token,
        code: aiSpec.simulationCode,
        params: paramsRef.current,
        speed: speedRef.current,
        playing: true,
      })
      armTimeout()
      if (ping) {
        clearInterval(ping)
        ping = undefined
      }
    }

    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return
      const data = event.data as Record<string, unknown> | null
      if (!data || typeof data !== 'object') return
      if (data.type === 'ready') {
        if (!started) start()
        return
      }
      if (data.type !== 'status' && data.type !== 'error') return
      if (data.token !== token) return
      if (timer) {
        clearTimeout(timer)
        timer = undefined
      }
      if (data.type === 'status') {
        if (STATUS_VALUES.includes(data.status as RuntimeStatus)) {
          const nextStatus = data.status as RuntimeStatus
          syncStatus(nextStatus)
          // 首帧初始化成功：记录可用版本并结束本次修复会话的等待。
          if (nextStatus !== 'error') {
            markAiVersionGood()
            settle({ ok: true })
          }
        }
        return
      }
      const info: RuntimeErrorInfo = {
        scope: readScope(data.scope),
        message:
          typeof data.message === 'string' && data.message.length > 0
            ? data.message
            : '生成代码执行失败',
      }
      syncError(info)
      syncStatus('error')
      settle({ ok: false, error: info })
    }

    window.addEventListener('message', handleMessage)
    post({ type: 'ping' })
    ping = setInterval(() => {
      if (!started) post({ type: 'ping' })
    }, PING_INTERVAL_MS)
    armTimeout()

    sendRef.current = (message) => post({ ...message, token })
    retryRef.current = () => {
      started = false
      start()
    }

    return () => {
      disposed = true
      if (timer) clearTimeout(timer)
      if (ping) clearInterval(ping)
      window.removeEventListener('message', handleMessage)
      iframe.contentWindow?.postMessage({ type: 'destroy', token }, '*')
      sendRef.current = () => {}
      retryRef.current = () => {}
    }
  }, [aiSpec, iframeRef, markAiVersionGood, reloadKey, source, syncError, syncStatus])

  useEffect(() => {
    if (source === 'ai') sendRef.current({ type: 'params', params })
  }, [params, source])

  useEffect(() => {
    if (source === 'ai') sendRef.current({ type: 'speed', speed })
  }, [speed, source])

  useEffect(() => {
    if (source !== 'ai' || status === 'error') return
    sendRef.current({ type: status === 'running' ? 'play' : 'pause' })
  }, [status, source])

  const play = useCallback(() => {
    sendRef.current({ type: 'play' })
  }, [])

  const pause = useCallback(() => {
    sendRef.current({ type: 'pause' })
  }, [])

  const toggle = useCallback(() => {
    const current = useWorkbenchStore.getState().status
    if (current === 'error') return
    sendRef.current({ type: current === 'running' ? 'pause' : 'play' })
  }, [])

  const step = useCallback(() => {
    if (useWorkbenchStore.getState().status === 'error') return
    sendRef.current({ type: 'step' })
  }, [])

  const reset = useCallback(() => {
    const current = useWorkbenchStore.getState()
    if (current.status === 'error') {
      retryRef.current()
      return
    }
    current.syncError(null)
    sendRef.current({ type: 'reset' })
  }, [])

  const retry = useCallback(() => {
    retryRef.current()
  }, [])

  return { play, pause, toggle, step, reset, retry }
}
