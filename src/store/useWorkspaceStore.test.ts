import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceEntry, WorkspaceRecord } from '../workspace/types'
import { useWorkspaceStore } from './useWorkspaceStore'

const storage = vi.hoisted(() => ({
  listRecords: vi.fn(),
  saveRecord: vi.fn(),
  deleteRecord: vi.fn(),
  getModelConfig: vi.fn(),
  saveModelConfig: vi.fn(),
  clearModelConfig: vi.fn(),
}))

vi.mock('../workspace/db', () => ({
  workspaceStorage: storage,
  toWorkspaceStorageError: (error: unknown) => error,
}))

function record(overrides: Partial<WorkspaceRecord> = {}): WorkspaceRecord {
  return {
    id: 'record-1',
    title: '阻尼振动',
    domain: 'Physics / Mechanics',
    source: 'preset',
    experimentId: 'damped-oscillator',
    schemaVersion: 1,
    codeVersion: 0,
    spec: null,
    params: { damping: 0.2 },
    speed: 1,
    favorite: false,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  }
}

function entry(overrides: Partial<WorkspaceEntry> = {}): WorkspaceEntry {
  return { ...record(), ...overrides, status: overrides.status ?? 'ok' }
}

beforeEach(() => {
  vi.clearAllMocks()
  storage.listRecords.mockResolvedValue([])
  storage.getModelConfig.mockResolvedValue(null)
  storage.saveRecord.mockResolvedValue(undefined)
  storage.deleteRecord.mockResolvedValue(undefined)
  storage.saveModelConfig.mockResolvedValue(undefined)
  storage.clearModelConfig.mockResolvedValue(undefined)
  useWorkspaceStore.setState({
    hydrated: false,
    hydrating: false,
    entries: [],
    openWindowIds: [],
    modelConfig: null,
    storageError: null,
    saving: false,
    lastSavedAt: null,
    feedback: null,
  })
})

describe('M7 工作区状态', () => {
  it('加载记录按收藏与更新时间排序，并读取模型配置', async () => {
    storage.listRecords.mockResolvedValue([
      entry({ id: 'old', favorite: false, updatedAt: 1000 }),
      entry({ id: 'fav', favorite: true, updatedAt: 500 }),
      entry({ id: 'new', favorite: false, updatedAt: 3000 }),
    ])
    storage.getModelConfig.mockResolvedValue({
      version: 1,
      apiKey: 'sk-local',
      baseUrl: '',
      model: '',
      updatedAt: 1,
    })

    await useWorkspaceStore.getState().hydrate()
    const state = useWorkspaceStore.getState()
    expect(state.hydrated).toBe(true)
    expect(state.entries.map((item) => item.id)).toEqual(['fav', 'new', 'old'])
    expect(state.modelConfig?.apiKey).toBe('sk-local')
  })

  it('重命名与收藏写回记录并给出反馈', async () => {
    useWorkspaceStore.setState({ entries: [entry()] })

    await useWorkspaceStore.getState().renameRecord('record-1', '  我的振动  ')
    expect(storage.saveRecord).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'record-1', title: '我的振动' }),
    )
    expect(useWorkspaceStore.getState().entries[0].title).toBe('我的振动')
    expect(useWorkspaceStore.getState().feedback).toMatchObject({ tone: 'success' })

    await useWorkspaceStore.getState().toggleFavorite('record-1')
    expect(storage.saveRecord).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'record-1', favorite: true }),
    )
    expect(useWorkspaceStore.getState().entries[0].favorite).toBe(true)
  })

  it('删除记录会从列表移除', async () => {
    useWorkspaceStore.setState({ entries: [entry(), entry({ id: 'record-2' })] })
    await useWorkspaceStore.getState().deleteRecord('record-1')
    expect(storage.deleteRecord).toHaveBeenCalledWith('record-1')
    expect(useWorkspaceStore.getState().entries.map((item) => item.id)).toEqual(['record-2'])
  })

  it('自动保存延迟快照不会覆盖已重命名与收藏状态', async () => {
    useWorkspaceStore.setState({
      entries: [entry({ title: '已重命名', favorite: true })],
    })
    await useWorkspaceStore
      .getState()
      .saveRecord(record({ title: '旧标题', favorite: false }), { keepEdits: true })

    expect(storage.saveRecord).toHaveBeenCalledWith(
      expect.objectContaining({ title: '已重命名', favorite: true }),
    )
  })

  it('模型配置校验、保存与一键清除', async () => {
    const invalid = await useWorkspaceStore
      .getState()
      .saveModelConfig({ apiKey: '', baseUrl: 'bad-url', model: '' })
    expect(invalid).toBe(false)
    expect(storage.saveModelConfig).not.toHaveBeenCalled()
    expect(useWorkspaceStore.getState().feedback?.tone).toBe('error')

    const valid = await useWorkspaceStore
      .getState()
      .saveModelConfig({ apiKey: 'sk-test', baseUrl: 'https://api.example.com/v1', model: 'demo' })
    expect(valid).toBe(true)
    expect(storage.saveModelConfig).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'sk-test', model: 'demo' }),
    )
    expect(useWorkspaceStore.getState().modelConfig?.apiKey).toBe('sk-test')

    await useWorkspaceStore.getState().clearModelConfig()
    expect(storage.clearModelConfig).toHaveBeenCalled()
    expect(useWorkspaceStore.getState().modelConfig).toBeNull()
  })

  it('写入失败时保留内存记录并暴露存储错误', async () => {
    useWorkspaceStore.setState({ entries: [entry()] })
    storage.saveRecord.mockRejectedValueOnce({
      code: 'quota',
      message: '空间不足',
    })

    await useWorkspaceStore.getState().renameRecord('record-1', '新名字')
    const state = useWorkspaceStore.getState()
    expect(state.entries[0].title).toBe('阻尼振动')
    expect(state.storageError).toMatchObject({ code: 'quota' })
    expect(state.feedback).toMatchObject({ tone: 'error' })
  })

  it('支持同实验内复制新绘画窗口、重命名实验组与关闭窗口标签', async () => {
    useWorkspaceStore.setState({
      entries: [entry({ id: 'win-1', groupId: 'exp-1', groupTitle: '振动实验', title: '窗口 1' })],
      openWindowIds: ['win-1'],
    })

    const dup = await useWorkspaceStore.getState().duplicateWindow('win-1')
    expect(dup).not.toBeNull()
    expect(dup?.groupId).toBe('exp-1')
    expect(dup?.groupTitle).toBe('振动实验')
    expect(useWorkspaceStore.getState().entries).toHaveLength(2)
    expect(useWorkspaceStore.getState().openWindowIds).toEqual(['win-1', dup!.id])

    await useWorkspaceStore.getState().renameGroup('exp-1', '受迫振动对比组')
    expect(
      useWorkspaceStore.getState().entries.every((item) => item.groupTitle === '受迫振动对比组'),
    ).toBe(true)

    useWorkspaceStore.getState().closeWindow(dup!.id)
    expect(useWorkspaceStore.getState().openWindowIds).toEqual(['win-1'])
    expect(useWorkspaceStore.getState().entries).toHaveLength(2)

    await useWorkspaceStore.getState().deleteGroup('exp-1')
    expect(useWorkspaceStore.getState().entries).toHaveLength(0)
    expect(useWorkspaceStore.getState().openWindowIds).toEqual([])
  })
})
