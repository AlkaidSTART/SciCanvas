// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { GeneratedExperimentSpec } from '../src/ai/schema.ts'
import { createSqliteSessionStore } from './sqliteStore.ts'

const SAMPLE_SPEC: GeneratedExperimentSpec = {
  title: '阻尼单摆能量衰减',
  domain: '经典力学',
  formulaLatex: '\\ddot{\\theta} + 2\\zeta\\omega_0\\dot{\\theta} + \\omega_0^2\\sin\\theta = 0',
  insight: '增大阻尼系数会使振幅指数衰减。',
  renderType: 'canvas2d',
  controls: [
    {
      type: 'slider',
      key: 'damping',
      label: '阻尼系数',
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.15,
    },
  ],
  legend: [{ label: '摆角 θ', color: '#c47b58' }],
  simulationCode:
    'return { createState: () => ({ t: 0 }), step: (s, dt) => ({ t: s.t + dt }), draw: () => {} };',
}

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('createSqliteSessionStore', () => {
  it('records sessions, messages, and generated experiment content in SQLite', () => {
    const store = createSqliteSessionStore(':memory:')
    try {
      const created = store.createSession({
        title: '阻尼单摆测试',
        source: 'text',
        initialPrompt: '模拟一个阻尼单摆',
        initialMode: 'create',
        createdAt: 1000,
      })

      expect(created.session.title).toBe('阻尼单摆测试')
      expect(created.session.messageCount).toBe(1)
      expect(created.session.generationCount).toBe(0)
      expect(created.messages).toHaveLength(1)
      expect(created.messages[0].content).toBe('模拟一个阻尼单摆')

      const saved = store.saveGeneration(created.session.id, {
        mode: 'create',
        prompt: '模拟一个阻尼单摆',
        spec: SAMPLE_SPEC,
        params: { damping: 0.15 },
        assistantSummary: '已生成实验「阻尼单摆能量衰减」',
        createdAt: 2000,
      })

      expect(saved).not.toBeNull()
      expect(saved!.generation.title).toBe(SAMPLE_SPEC.title)
      expect(saved!.generation.spec).toEqual(SAMPLE_SPEC)
      expect(saved!.generation.params).toEqual({ damping: 0.15 })
      expect(saved!.message?.role).toBe('assistant')
      expect(saved!.message?.generationId).toBe(saved!.generation.id)
      expect(saved!.session.title).toBe(SAMPLE_SPEC.title)
      expect(saved!.session.generationCount).toBe(1)
      expect(saved!.session.messageCount).toBe(2)

      // 增量微调追加消息与新版本
      const refineMsg = store.appendMessage(created.session.id, {
        role: 'user',
        mode: 'refine',
        content: '加入随机噪声',
        createdAt: 3000,
      })
      expect(refineMsg?.content).toBe('加入随机噪声')

      const refinedSpec: GeneratedExperimentSpec = {
        ...SAMPLE_SPEC,
        title: '阻尼单摆（含噪声）',
      }
      const savedRefine = store.saveGeneration(created.session.id, {
        mode: 'refine',
        prompt: '加入随机噪声',
        spec: refinedSpec,
        params: { damping: 0.2 },
        assistantSummary: '已微调更新「阻尼单摆（含噪声）」',
        createdAt: 4000,
      })
      expect(savedRefine?.session.generationCount).toBe(2)

      const detail = store.getSessionDetail(created.session.id)
      expect(detail).not.toBeNull()
      expect(detail!.messages).toHaveLength(4)
      expect(detail!.generations).toHaveLength(2)
      expect(detail!.generations[0].title).toBe('阻尼单摆（含噪声）')
      expect(detail!.generations[1].title).toBe('阻尼单摆能量衰减')

      const fetched = store.getGeneration(saved!.generation.id)
      expect(fetched?.spec).toEqual(SAMPLE_SPEC)
    } finally {
      store.close()
    }
  })

  it('persists data across SQLite re-opens and cascades deletes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scicanvas-sqlite-'))
    tempDirs.push(dir)
    const dbFile = join(dir, 'test.db')

    const store1 = createSqliteSessionStore(dbFile)
    const created = store1.createSession({
      title: '论文截图实验',
      source: 'image',
      initialPrompt: '识别洛伦兹系统',
      createdAt: 5000,
    })
    store1.saveGeneration(created.session.id, {
      mode: 'create',
      prompt: '识别洛伦兹系统',
      spec: SAMPLE_SPEC,
      assistantSummary: '已生成',
      createdAt: 6000,
    })
    store1.close()

    const store2 = createSqliteSessionStore(dbFile)
    try {
      const sessions = store2.listSessions()
      expect(sessions).toHaveLength(1)
      expect(sessions[0].source).toBe('image')
      expect(sessions[0].generationCount).toBe(1)

      const generations = store2.listGenerations()
      expect(generations).toHaveLength(1)
      expect(generations[0].spec).toEqual(SAMPLE_SPEC)

      expect(store2.deleteSession(created.session.id)).toBe(true)
      expect(store2.listSessions()).toHaveLength(0)
      expect(store2.listGenerations()).toHaveLength(0)
    } finally {
      store2.close()
    }
  })
})
