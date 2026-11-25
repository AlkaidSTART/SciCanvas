import { useEffect, useRef } from 'react'
import { generateExperiment } from '../ai/client'
import { runRepairLoop } from '../ai/heal'
import { waitForSessionOutcome } from '../runtime/aiSessionBus'
import { useWorkbenchStore } from '../store/useWorkbenchStore'

const SESSION_TIMEOUT_MS = 8_000
const SUCCESS_BANNER_MS = 4_000
const REPAIR_INSTRUCTION =
  '请修复当前实验在当前沙盒中的运行错误，保持原有教学意图、控件与视觉风格。'

/**
 * AI 实验运行出错时自动修复：最多两次，失败后恢复上一可用版本，
 * 并把失败原因与显式重试入口留给用户。
 */
export function useAutoHeal(): void {
  const source = useWorkbenchStore((state) => state.source)
  const aiSpec = useWorkbenchStore((state) => state.aiSpec)
  const error = useWorkbenchStore((state) => state.error)
  const healStatus = useWorkbenchStore((state) => state.heal.status)
  const runningRef = useRef(false)
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (successTimerRef.current) clearTimeout(successTimerRef.current)
    },
    [],
  )

  useEffect(() => {
    if (source !== 'ai' || !aiSpec || !error) return
    if (healStatus !== 'idle' || runningRef.current) return
    runningRef.current = true

    void (async () => {
      try {
        const result = await runRepairLoop({
          spec: aiSpec,
          error,
          shouldContinue: () => useWorkbenchStore.getState().source === 'ai',
          requestRepair: (current, diagnostic) =>
            generateExperiment(
              {
                prompt: REPAIR_INSTRUCTION,
                mode: 'repair',
                currentSpec: current,
                diagnostic,
              },
              { timeoutMs: 90_000 },
            ),
          runCandidate: async (candidate, attempt) => {
            const outcome = waitForSessionOutcome(SESSION_TIMEOUT_MS)
            useWorkbenchStore.getState().applyGeneratedExperiment(candidate)
            useWorkbenchStore.getState().setHealApplied(attempt)
            const settled = await outcome
            if (settled.ok) return { ok: true }
            return {
              ok: false,
              error: settled.error ?? { scope: 'init', message: '修复结果未能初始化' },
            }
          },
          onAttempt: (event) => {
            if (event.status !== 'requesting') return
            useWorkbenchStore.getState().setHealRequesting(event.attempt)
          },
        })

        if (result.status === 'repaired') {
          useWorkbenchStore.getState().setHealSucceeded(result.attempts, result.message)
          if (successTimerRef.current) clearTimeout(successTimerRef.current)
          successTimerRef.current = setTimeout(() => {
            const current = useWorkbenchStore.getState()
            if (current.heal.status === 'succeeded') current.resetHeal()
          }, SUCCESS_BANNER_MS)
          return
        }

        // 用户已切走实验：不覆盖当前选择，也不再展示修复状态。
        if (result.reason === 'cancelled') return

        // 失败：先恢复上一可用版本，保持画布可继续交互，再展示失败信息。
        const failedParams = { ...useWorkbenchStore.getState().params }
        useWorkbenchStore.getState().restoreLastGoodAi()
        useWorkbenchStore.getState().setHealFailed(result.attempts, result.message, {
          spec: result.lastSpec,
          params: failedParams,
          error: result.error ?? error,
        })
      } finally {
        runningRef.current = false
      }
    })()
  }, [source, aiSpec, error, healStatus])
}
