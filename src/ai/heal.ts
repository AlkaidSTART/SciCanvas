import type { RuntimeErrorInfo } from '../runtime/CanvasRuntime'
import type { GeneratedExperimentSpec } from './schema'

export type RepairStage = 'init' | 'first-frame' | 'runtime'

/** 修复请求只携带阶段与截断后的错误信息。 */
export interface RepairDiagnostic {
  stage: RepairStage
  message: string
  attempt: number
}

export const MAX_HEAL_ATTEMPTS = 2
export const MAX_DIAGNOSTIC_MESSAGE_LENGTH = 500

export type HealAttemptStatus = 'requesting' | 'applied' | 'failed'

export interface HealAttemptEvent {
  attempt: number
  status: HealAttemptStatus
  diagnostic?: RepairDiagnostic
}

export interface HealRunOutcome {
  ok: boolean
  error?: RuntimeErrorInfo
}

export type RepairLoopResult =
  | { status: 'repaired'; attempts: number; spec: GeneratedExperimentSpec; message: string }
  | {
      status: 'failed'
      attempts: number
      /** 最后一次尝试的候选结果；用于失败后显式重试。 */
      lastSpec: GeneratedExperimentSpec
      message: string
      reason: 'request' | 'runtime' | 'cancelled'
      error: RuntimeErrorInfo | null
    }

export interface RepairLoopOptions {
  spec: GeneratedExperimentSpec
  error: RuntimeErrorInfo
  maxAttempts?: number
  /** 每次异步步骤后检查；用户切走实验时返回 false 终止循环。 */
  shouldContinue?: () => boolean
  requestRepair: (
    spec: GeneratedExperimentSpec,
    diagnostic: RepairDiagnostic,
  ) => Promise<GeneratedExperimentSpec>
  runCandidate: (spec: GeneratedExperimentSpec, attempt: number) => Promise<HealRunOutcome>
  onAttempt?: (event: HealAttemptEvent) => void
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/** 把运行时错误压缩成模型可用的最小诊断：首帧单独分类，推演/绘制统一为 runtime。 */
export function toDiagnostic(error: RuntimeErrorInfo, attempt: number): RepairDiagnostic {
  const stage: RepairStage =
    error.scope === 'step' || error.scope === 'draw' ? 'runtime' : error.scope
  const message = error.message.trim().slice(0, MAX_DIAGNOSTIC_MESSAGE_LENGTH)
  return { stage, message: message || '未知运行错误', attempt }
}

/**
 * 纯函数式自动修复循环：请求修复 → 应用并验证 → 失败则携带最新错误再试。
 * 循环本身不修改任何全局状态；调用方负责应用候选与保留旧版本。
 */
export async function runRepairLoop(options: RepairLoopOptions): Promise<RepairLoopResult> {
  const maxAttempts = Math.max(
    1,
    Math.min(MAX_HEAL_ATTEMPTS, Math.floor(options.maxAttempts ?? MAX_HEAL_ATTEMPTS)),
  )
  let candidate = options.spec
  let lastError = options.error
  const active = options.shouldContinue ?? (() => true)
  const cancelled = (attempt: number): RepairLoopResult => ({
    status: 'failed',
    attempts: attempt,
    lastSpec: candidate,
    message: '自动修复已取消',
    reason: 'cancelled',
    error: lastError,
  })

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (!active()) return cancelled(attempt - 1)
    const diagnostic = toDiagnostic(lastError, attempt)
    options.onAttempt?.({ attempt, status: 'requesting', diagnostic })

    let repaired: GeneratedExperimentSpec
    try {
      repaired = await options.requestRepair(candidate, diagnostic)
    } catch (error) {
      if (!active()) return cancelled(attempt - 1)
      return {
        status: 'failed',
        attempts: attempt,
        lastSpec: candidate,
        message: `第 ${attempt} 次修复请求失败：${errorMessage(error)}`,
        reason: 'request',
        error: lastError,
      }
    }

    if (!active()) return cancelled(attempt - 1)
    options.onAttempt?.({ attempt, status: 'applied' })
    let outcome: HealRunOutcome
    try {
      outcome = await options.runCandidate(repaired, attempt)
    } catch (error) {
      outcome = { ok: false, error: { scope: 'init', message: errorMessage(error) } }
    }

    if (!active()) return cancelled(attempt)
    if (outcome.ok) {
      return {
        status: 'repaired',
        attempts: attempt,
        spec: repaired,
        message: `第 ${attempt} 次自动修复已通过初始化`,
      }
    }

    lastError = outcome.error ?? { scope: 'init', message: '修复结果未能通过初始化' }
    options.onAttempt?.({ attempt, status: 'failed' })
    candidate = repaired
  }

  return {
    status: 'failed',
    attempts: maxAttempts,
    lastSpec: candidate,
    message: `自动修复 ${maxAttempts} 次仍未通过初始化：${lastError.message.slice(0, 120)}`,
    reason: 'runtime',
    error: lastError,
  }
}
