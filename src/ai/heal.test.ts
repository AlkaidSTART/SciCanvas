import { describe, expect, it, vi } from 'vitest'
import type { GeneratedExperimentSpec } from './schema'
import type { RepairDiagnostic } from './heal'
import { MAX_DIAGNOSTIC_MESSAGE_LENGTH, runRepairLoop, toDiagnostic } from './heal'

function makeSpec(title: string): GeneratedExperimentSpec {
  return {
    title,
    domain: 'Physics / Test',
    formulaLatex: 'x(t) = A\\cos(\\omega t)',
    insight: '测试自动修复流程。',
    renderType: 'canvas2d',
    controls: [
      { type: 'slider', key: 'stiffness', label: '刚度', min: 0.1, max: 2, step: 0.1, default: 1 },
    ],
    simulationCode: `return {
      createState: function () { return { x: 1 } },
      step: function (state) { return state },
      draw: function () {}
    }`,
  }
}

const initError = { scope: 'init' as const, message: 'ReferenceError: x is not defined' }

describe('runRepairLoop', () => {
  it('第一次修复即通过初始化', async () => {
    const original = makeSpec('原始版本')
    const repaired = makeSpec('修复版本')
    const requestRepair = vi.fn(
      async (_spec: GeneratedExperimentSpec, _diagnostic: RepairDiagnostic) => repaired,
    )
    const runCandidate = vi.fn(async () => ({ ok: true as const }))

    const result = await runRepairLoop({
      spec: original,
      error: initError,
      requestRepair,
      runCandidate,
    })

    expect(result).toMatchObject({ status: 'repaired', attempts: 1, spec: repaired })
    expect(requestRepair).toHaveBeenCalledTimes(1)
    expect(runCandidate).toHaveBeenCalledTimes(1)
    expect(requestRepair.mock.calls[0][1]).toMatchObject({
      stage: 'init',
      attempt: 1,
      message: initError.message,
    })
  })

  it('第二次修复成功会携带上一次的运行时错误', async () => {
    const original = makeSpec('原始版本')
    const first = makeSpec('第一次候选')
    const second = makeSpec('第二次候选')
    const requestRepair = vi.fn(
      async (_spec: GeneratedExperimentSpec, _diagnostic: RepairDiagnostic) =>
        requestRepair.mock.calls.length === 1 ? first : second,
    )
    const secondError = { scope: 'step' as const, message: 'TypeError: state is undefined' }
    const runCandidate = vi.fn(async (spec: GeneratedExperimentSpec) =>
      spec === first ? { ok: false as const, error: secondError } : { ok: true as const },
    )
    const onAttempt = vi.fn()

    const result = await runRepairLoop({
      spec: original,
      error: initError,
      requestRepair,
      runCandidate,
      onAttempt,
    })

    expect(result).toMatchObject({ status: 'repaired', attempts: 2, spec: second })
    expect(requestRepair).toHaveBeenCalledTimes(2)
    expect(requestRepair.mock.calls[1][0]).toBe(first)
    expect(requestRepair.mock.calls[1][1]).toMatchObject({
      stage: 'runtime',
      attempt: 2,
      message: secondError.message,
    })
    expect(onAttempt.mock.calls.map(([event]) => event.status)).toEqual([
      'requesting',
      'applied',
      'failed',
      'requesting',
      'applied',
    ])
  })

  it('两次都失败时返回最后候选与失败原因', async () => {
    const original = makeSpec('原始版本')
    const first = makeSpec('第一次候选')
    const second = makeSpec('第二次候选')
    const requestRepair = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second)
    const runCandidate = vi.fn(async () => ({
      ok: false as const,
      error: { scope: 'draw' as const, message: '绘制失败' },
    }))

    const result = await runRepairLoop({
      spec: original,
      error: initError,
      requestRepair,
      runCandidate,
    })

    expect(result.status).toBe('failed')
    if (result.status === 'failed') {
      expect(result.attempts).toBe(2)
      expect(result.reason).toBe('runtime')
      expect(result.lastSpec).toBe(second)
      expect(result.message).toContain('自动修复 2 次')
    }
    expect(requestRepair).toHaveBeenCalledTimes(2)
  })

  it('修复请求失败时立即停止且不应用候选', async () => {
    const original = makeSpec('原始版本')
    const requestRepair = vi.fn(async () => {
      throw new Error('无法连接生成服务')
    })
    const runCandidate = vi.fn(async () => ({ ok: true as const }))

    const result = await runRepairLoop({
      spec: original,
      error: initError,
      requestRepair,
      runCandidate,
    })

    expect(result.status).toBe('failed')
    if (result.status === 'failed') {
      expect(result.reason).toBe('request')
      expect(result.attempts).toBe(1)
      expect(result.lastSpec).toBe(original)
      expect(result.message).toContain('无法连接生成服务')
    }
    expect(runCandidate).not.toHaveBeenCalled()
  })

  it('无效 Schema 的修复结果不会被视为成功，原版本保持不变', async () => {
    const original = makeSpec('原始版本')
    const snapshot = JSON.parse(JSON.stringify(original)) as GeneratedExperimentSpec
    const requestRepair = vi.fn(async () => {
      throw new Error('模型输出未通过校验：simulationCode 必须是非空字符串')
    })

    const result = await runRepairLoop({
      spec: original,
      error: initError,
      requestRepair,
      runCandidate: async () => ({ ok: true as const }),
    })

    expect(result).toMatchObject({ status: 'failed', attempts: 1 })
    expect('spec' in result).toBe(false)
    expect(original).toEqual(snapshot)
  })

  it('修复结果运行异常会进入下一次尝试而非直接成功', async () => {
    const original = makeSpec('原始版本')
    const candidate = makeSpec('候选')
    const runCandidate = vi.fn(async () => ({
      ok: false as const,
      error: { scope: 'init' as const, message: '未定义' },
    }))

    const result = await runRepairLoop({
      spec: original,
      error: initError,
      maxAttempts: 1,
      requestRepair: async () => candidate,
      runCandidate,
    })

    expect(result.status).toBe('failed')
    expect(result.attempts).toBe(1)
    expect(runCandidate).toHaveBeenCalledTimes(1)
  })

  it('用户切走实验后不再发起修复请求', async () => {
    const original = makeSpec('原始版本')
    const requestRepair = vi.fn(async () => makeSpec('候选'))
    const runCandidate = vi.fn(async () => ({ ok: true as const }))

    const result = await runRepairLoop({
      spec: original,
      error: initError,
      shouldContinue: () => false,
      requestRepair,
      runCandidate,
    })

    expect(result.status).toBe('failed')
    if (result.status === 'failed') expect(result.reason).toBe('cancelled')
    expect(requestRepair).not.toHaveBeenCalled()
    expect(runCandidate).not.toHaveBeenCalled()
  })
})

describe('toDiagnostic', () => {
  it('把推演与绘制错误归为 runtime，并保留首帧分类', () => {
    expect(toDiagnostic({ scope: 'step', message: 'step 错误' }, 1).stage).toBe('runtime')
    expect(toDiagnostic({ scope: 'draw', message: 'draw 错误' }, 1).stage).toBe('runtime')
    expect(toDiagnostic({ scope: 'init', message: 'init 错误' }, 1).stage).toBe('init')
    expect(toDiagnostic({ scope: 'first-frame', message: '首帧错误' }, 1).stage).toBe('first-frame')
  })

  it('截断过长错误信息', () => {
    const diagnostic = toDiagnostic({ scope: 'init', message: 'x'.repeat(2000) }, 2)
    expect(diagnostic.message).toHaveLength(MAX_DIAGNOSTIC_MESSAGE_LENGTH)
    expect(diagnostic.attempt).toBe(2)
  })
})
