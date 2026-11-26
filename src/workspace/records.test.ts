import { describe, expect, it } from 'vitest'
import type { GeneratedExperimentSpec } from '../ai/schema'
import {
  buildWorkspaceRecord,
  normalizeStoredRecord,
  sanitizeRecordTitle,
  sortWorkspaceEntries,
} from './records'
import type { WorkspaceEntry, WorkspaceRecord } from './types'

const spec: GeneratedExperimentSpec = {
  title: 'AI 谐振子',
  domain: 'Physics / AI',
  formulaLatex: 'x(t) = A\\cos(\\omega t)',
  insight: '调节刚度观察振动周期变化。',
  renderType: 'canvas2d',
  controls: [
    { type: 'slider', key: 'stiffness', label: '刚度', min: 0.1, max: 2, step: 0.1, default: 1 },
  ],
  simulationCode: `return {
    createState: function () { return { x: 1 } },
    step: function (state, params, dt) { return { x: state.x - params.stiffness * dt } },
    draw: function () {}
  }`,
}

function baseRecord(overrides: Partial<WorkspaceRecord> = {}): WorkspaceRecord {
  return {
    id: 'record-1',
    title: '我的实验',
    domain: 'Physics',
    source: 'ai',
    experimentId: 'ai-generated',
    schemaVersion: 1,
    codeVersion: 1,
    spec,
    params: { stiffness: 1 },
    speed: 1,
    favorite: false,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  }
}

describe('M7 记录组装', () => {
  it('新建 AI 记录使用标题并标记首个代码版本', () => {
    const record = buildWorkspaceRecord({
      id: 'new',
      existing: null,
      source: 'ai',
      experimentId: 'ai-generated',
      title: '  新实验  ',
      domain: 'Physics',
      spec,
      params: { stiffness: 0.5 },
      speed: 2,
      now: 2000,
    })
    expect(record.title).toBe('新实验')
    expect(record.codeVersion).toBe(1)
    expect(record.favorite).toBe(false)
    expect(record.createdAt).toBe(2000)
    expect(record.schemaVersion).toBe(1)
    expect(record.params).toEqual({ stiffness: 0.5 })
  })

  it('更新参数时保留重命名、收藏与创建时间', () => {
    const existing = baseRecord({ title: '重命名后的实验', favorite: true })
    const record = buildWorkspaceRecord({
      id: existing.id,
      existing,
      source: 'ai',
      experimentId: existing.experimentId,
      title: spec.title,
      domain: 'Physics',
      spec,
      params: { stiffness: 1.8 },
      speed: 1,
      now: 3000,
    })
    expect(record.title).toBe('重命名后的实验')
    expect(record.favorite).toBe(true)
    expect(record.createdAt).toBe(1000)
    expect(record.updatedAt).toBe(3000)
    expect(record.codeVersion).toBe(1)
  })

  it('只有代码变化时才递增代码版本', () => {
    const existing = baseRecord()
    const changed = { ...spec, simulationCode: `${spec.simulationCode}\n// v2` }
    const record = buildWorkspaceRecord({
      id: existing.id,
      existing,
      source: 'ai',
      experimentId: existing.experimentId,
      title: spec.title,
      domain: 'Physics',
      spec: changed,
      params: existing.params,
      speed: 1,
      now: 4000,
    })
    expect(record.codeVersion).toBe(2)
  })

  it('预设记录不携带代码版本', () => {
    const record = buildWorkspaceRecord({
      id: 'preset-1',
      existing: null,
      source: 'preset',
      experimentId: 'damped-oscillator',
      title: '阻尼振动',
      domain: 'Physics',
      spec,
      params: {},
      speed: 1,
      now: 5000,
    })
    expect(record.spec).toBeNull()
    expect(record.codeVersion).toBe(0)
  })

  it('标题清洗会去掉控制字符并限制长度', () => {
    expect(sanitizeRecordTitle('  a\u0000b   c  ')).toBe('a b c')
    expect(sanitizeRecordTitle('   ', '兜底')).toBe('兜底')
    expect(sanitizeRecordTitle('x'.repeat(200)).length).toBe(80)
  })
})

describe('M7 读取兼容性', () => {
  it('当前版本记录正常读取', () => {
    const entry = normalizeStoredRecord(baseRecord(), 9000)
    expect(entry?.status).toBe('ok')
    expect(entry?.title).toBe('我的实验')
    expect(entry?.spec?.title).toBe(spec.title)
  })

  it('v0 旧记录迁移到当前结构并保留原始数据', () => {
    const legacy = {
      id: 'legacy-1',
      name: '旧记录',
      experiment: 'sir-epidemic',
      source: 'preset',
      params: { beta: 0.3 },
      speed: 2,
      savedAt: 1234,
    }
    const entry = normalizeStoredRecord(legacy, 9000)
    expect(entry).not.toBeNull()
    expect(entry).toMatchObject({
      id: 'legacy-1',
      title: '旧记录',
      source: 'preset',
      experimentId: 'sir-epidemic',
      schemaVersion: 1,
      favorite: false,
      createdAt: 1234,
      updatedAt: 1234,
      status: 'migrated',
    })
    expect(entry?.raw).toBe(legacy)
  })

  it('未来版本记录标记为不可用且不修改原始数据', () => {
    const future = { ...baseRecord(), schemaVersion: 99, extraField: 'keep-me' }
    const entry = normalizeStoredRecord(future, 9000)
    expect(entry?.status).toBe('unsupported')
    expect(entry?.issue).toContain('v99')
    expect(entry?.raw).toEqual(future)
  })

  it('代码版本无法通过校验时标记为不可用', () => {
    const broken = { ...baseRecord(), spec: { ...spec, simulationCode: 'return {' } }
    const entry = normalizeStoredRecord(broken, 9000)
    expect(entry?.status).toBe('unsupported')
    expect(entry?.issue).toContain('代码版本')
    expect(entry?.raw).toBe(broken)
  })

  it('缺少 ID 的脏数据直接跳过', () => {
    expect(normalizeStoredRecord({ title: '没有 ID' })).toBeNull()
    expect(normalizeStoredRecord(null)).toBeNull()
  })
})

describe('M7 列表排序', () => {
  it('收藏优先，其次按最近更新', () => {
    const make = (id: string, favorite: boolean, updatedAt: number): WorkspaceEntry => ({
      ...baseRecord({ id, favorite, updatedAt }),
      status: 'ok',
    })
    const sorted = sortWorkspaceEntries([
      make('a', false, 3000),
      make('b', true, 1000),
      make('c', false, 5000),
      make('d', true, 2000),
    ])
    expect(sorted.map((entry) => entry.id)).toEqual(['d', 'b', 'c', 'a'])
  })
})
