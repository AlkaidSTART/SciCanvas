import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import {
  WORKSPACE_DB_NAME,
  WORKSPACE_DB_VERSION,
  WORKSPACE_RECORDS_STORE,
  createWorkspaceStorage,
  toWorkspaceStorageError,
} from './db'
import type { WorkspaceRecord } from './types'

function presetRecord(overrides: Partial<WorkspaceRecord> = {}): WorkspaceRecord {
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

async function putRawRecord(factory: IDBFactory, raw: unknown): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(WORKSPACE_DB_NAME, WORKSPACE_DB_VERSION)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(WORKSPACE_RECORDS_STORE, 'readwrite')
    transaction.objectStore(WORKSPACE_RECORDS_STORE).put(raw)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
  db.close()
}

describe('M7 IndexedDB 存储层', () => {
  it('保存后由新实例重新读取，删除后不再返回', async () => {
    const factory = new IDBFactory()
    const storage = createWorkspaceStorage(factory)
    await storage.saveRecord(presetRecord())

    const reopened = createWorkspaceStorage(factory)
    const entries = await reopened.listRecords()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      id: 'record-1',
      title: '阻尼振动',
      status: 'ok',
      favorite: false,
    })
    expect(entries[0].params).toEqual({ damping: 0.2 })

    await reopened.deleteRecord('record-1')
    expect(await reopened.listRecords()).toHaveLength(0)
  })

  it('记录与模型配置使用独立分区，互不影响', async () => {
    const factory = new IDBFactory()
    const storage = createWorkspaceStorage(factory)
    await storage.saveRecord(presetRecord())
    await storage.saveModelConfig({
      version: 1,
      apiKey: 'sk-local',
      baseUrl: 'https://api.example.com/v1',
      model: 'demo',
      updatedAt: 2000,
    })

    expect((await storage.listRecords())).toHaveLength(1)
    expect(await storage.getModelConfig()).toMatchObject({
      apiKey: 'sk-local',
      baseUrl: 'https://api.example.com/v1',
      model: 'demo',
    })

    await storage.clearModelConfig()
    expect(await storage.getModelConfig()).toBeNull()
    expect((await storage.listRecords())).toHaveLength(1)
  })

  it('旧版本记录读取时迁移，并保留原始对象', async () => {
    const factory = new IDBFactory()
    const storage = createWorkspaceStorage(factory)
    await storage.listRecords()
    const legacy = {
      id: 'legacy-1',
      name: '旧版实验',
      experiment: 'sir-epidemic',
      source: 'preset',
      params: { beta: 0.4 },
      savedAt: 1234,
    }
    await putRawRecord(factory, legacy)

    const entries = await storage.listRecords()
    expect(entries[0]).toMatchObject({
      id: 'legacy-1',
      title: '旧版实验',
      experimentId: 'sir-epidemic',
      schemaVersion: 1,
      status: 'migrated',
    })
    expect(entries[0].raw).toEqual(legacy)
  })

  it('未来版本记录保持不可用状态且不丢字段', async () => {
    const factory = new IDBFactory()
    const storage = createWorkspaceStorage(factory)
    await storage.listRecords()
    const future = { ...presetRecord(), schemaVersion: 99, unknownPayload: { keep: true } }
    await putRawRecord(factory, future)

    const entries = await storage.listRecords()
    expect(entries[0].status).toBe('unsupported')
    expect(entries[0].issue).toContain('v99')
    expect(entries[0].raw).toEqual(future)
  })

  it('IndexedDB 不可用或打开失败时给出稳定错误码', async () => {
    await expect(createWorkspaceStorage(null).listRecords()).rejects.toMatchObject({
      code: 'unavailable',
    })

    const broken = {
      open: () => {
        throw new Error('boom')
      },
    } as unknown as IDBFactory
    await expect(createWorkspaceStorage(broken).listRecords()).rejects.toMatchObject({
      code: 'unavailable',
    })
  })

  it('配额与事务错误映射为可读提示', () => {
    expect(
      toWorkspaceStorageError(new DOMException('quota', 'QuotaExceededError')).code,
    ).toBe('quota')
    expect(
      toWorkspaceStorageError(new DOMException('bad', 'DataError')).code,
    ).toBe('transaction')
  })
})
