import { normalizeModelConfig } from './modelConfig'
import { normalizeStoredRecord } from './records'
import type { ModelConfig, WorkspaceEntry, WorkspaceRecord } from './types'

export const WORKSPACE_DB_NAME = 'scicanvas-workspace'
export const WORKSPACE_DB_VERSION = 1
export const WORKSPACE_RECORDS_STORE = 'experiments'
export const WORKSPACE_SETTINGS_STORE = 'settings'
export const MODEL_CONFIG_KEY = 'model-config'

export type WorkspaceStorageErrorCode = 'unavailable' | 'quota' | 'transaction' | 'blocked'

export class WorkspaceStorageError extends Error {
  readonly code: WorkspaceStorageErrorCode

  constructor(code: WorkspaceStorageErrorCode, message: string) {
    super(message)
    this.name = 'WorkspaceStorageError'
    this.code = code
  }
}

function errorName(error: unknown): string {
  return typeof error === 'object' && error !== null && 'name' in error
    ? String((error as { name: unknown }).name)
    : ''
}

/** 把浏览器抛出的 DOMException 转换为用户可理解、带稳定 code 的错误。 */
export function toWorkspaceStorageError(error: unknown): WorkspaceStorageError {
  if (error instanceof WorkspaceStorageError) return error
  const name = errorName(error)
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') {
    return new WorkspaceStorageError(
      'quota',
      '浏览器本地存储空间不足，本次修改未能保存；可删除部分记录后重试，当前实验不受影响。',
    )
  }
  if (name === 'VersionError' || name === 'InvalidStateError' || name === 'DataError') {
    return new WorkspaceStorageError(
      'transaction',
      '本地数据库操作失败，请刷新页面后重试；当前实验仍可正常使用。',
    )
  }
  return new WorkspaceStorageError(
    'unavailable',
    '本地数据库暂时不可用，记录可能无法保存；当前实验仍可正常使用。',
  )
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(toWorkspaceStorageError(request.error))
  })
}

function waitForTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(toWorkspaceStorageError(transaction.error))
    transaction.onabort = () => reject(toWorkspaceStorageError(transaction.error))
  })
}

export interface WorkspaceStorage {
  listRecords: () => Promise<WorkspaceEntry[]>
  saveRecord: (record: WorkspaceRecord) => Promise<void>
  deleteRecord: (id: string) => Promise<void>
  getModelConfig: () => Promise<ModelConfig | null>
  saveModelConfig: (config: ModelConfig) => Promise<void>
  clearModelConfig: () => Promise<void>
}

/**
 * 创建 IndexedDB 存储实例。传入 factory 便于测试；
 * 传 null 表示强制模拟浏览器不支持 IndexedDB。
 */
export function createWorkspaceStorage(factory?: IDBFactory | null): WorkspaceStorage {
  let cached: Promise<IDBDatabase> | null = null

  const resolveFactory = (): IDBFactory => {
    if (factory === null) {
      throw new WorkspaceStorageError(
        'unavailable',
        '当前浏览器不支持 IndexedDB，本地工作区不可用；实验仍可正常使用。',
      )
    }
    if (factory) return factory
    try {
      if (typeof indexedDB !== 'undefined' && indexedDB) return indexedDB
    } catch {
      // Safari 隐私模式等场景访问 indexedDB 会直接抛错。
    }
    throw new WorkspaceStorageError(
      'unavailable',
      '当前浏览器不支持 IndexedDB，本地工作区不可用；实验仍可正常使用。',
    )
  }

  const open = (): Promise<IDBDatabase> => {
    if (cached) return cached

    const pending = new Promise<IDBDatabase>((resolve, reject) => {
      let request: IDBOpenDBRequest
      try {
        request = resolveFactory().open(WORKSPACE_DB_NAME, WORKSPACE_DB_VERSION)
      } catch (error) {
        reject(toWorkspaceStorageError(error))
        return
      }

      let settled = false
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(WORKSPACE_RECORDS_STORE)) {
          db.createObjectStore(WORKSPACE_RECORDS_STORE, { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains(WORKSPACE_SETTINGS_STORE)) {
          db.createObjectStore(WORKSPACE_SETTINGS_STORE)
        }
      }
      request.onsuccess = () => {
        const db = request.result
        if (settled) {
          db.close()
          return
        }
        settled = true
        db.onversionchange = () => db.close()
        resolve(db)
      }
      request.onerror = () => {
        if (settled) return
        settled = true
        reject(toWorkspaceStorageError(request.error))
      }
      request.onblocked = () => {
        if (settled) return
        settled = true
        reject(
          new WorkspaceStorageError(
            'blocked',
            '本地数据库正被其他页面占用，请关闭其他标签页后刷新重试；当前实验仍可使用。',
          ),
        )
      }
    })

    cached = pending.catch((error: unknown) => {
      cached = null
      throw toWorkspaceStorageError(error)
    })
    return cached
  }

  const withDb = async <T>(action: (db: IDBDatabase) => Promise<T>): Promise<T> => {
    try {
      const db = await open()
      return await action(db)
    } catch (error) {
      throw toWorkspaceStorageError(error)
    }
  }

  return {
    listRecords: () =>
      withDb(async (db) => {
        const transaction = db.transaction(WORKSPACE_RECORDS_STORE, 'readonly')
        const completed = waitForTransaction(transaction)
        const request = transaction.objectStore(WORKSPACE_RECORDS_STORE).getAll()
        const raw = (await requestResult(request)) as unknown[]
        await completed
        return raw
          .map((item) => normalizeStoredRecord(item))
          .filter((entry): entry is WorkspaceEntry => entry !== null)
      }),

    saveRecord: (record) =>
      withDb(async (db) => {
        const transaction = db.transaction(WORKSPACE_RECORDS_STORE, 'readwrite')
        const completed = waitForTransaction(transaction)
        try {
          transaction.objectStore(WORKSPACE_RECORDS_STORE).put(record)
        } catch (error) {
          completed.catch(() => {})
          throw toWorkspaceStorageError(error)
        }
        await completed
      }),

    deleteRecord: (id) =>
      withDb(async (db) => {
        const transaction = db.transaction(WORKSPACE_RECORDS_STORE, 'readwrite')
        const completed = waitForTransaction(transaction)
        try {
          transaction.objectStore(WORKSPACE_RECORDS_STORE).delete(id)
        } catch (error) {
          completed.catch(() => {})
          throw toWorkspaceStorageError(error)
        }
        await completed
      }),

    getModelConfig: () =>
      withDb(async (db) => {
        const transaction = db.transaction(WORKSPACE_SETTINGS_STORE, 'readonly')
        const completed = waitForTransaction(transaction)
        const request = transaction.objectStore(WORKSPACE_SETTINGS_STORE).get(MODEL_CONFIG_KEY)
        const raw = await requestResult(request)
        await completed
        return normalizeModelConfig(raw)
      }),

    saveModelConfig: (config) =>
      withDb(async (db) => {
        const transaction = db.transaction(WORKSPACE_SETTINGS_STORE, 'readwrite')
        const completed = waitForTransaction(transaction)
        try {
          transaction.objectStore(WORKSPACE_SETTINGS_STORE).put(config, MODEL_CONFIG_KEY)
        } catch (error) {
          completed.catch(() => {})
          throw toWorkspaceStorageError(error)
        }
        await completed
      }),

    clearModelConfig: () =>
      withDb(async (db) => {
        const transaction = db.transaction(WORKSPACE_SETTINGS_STORE, 'readwrite')
        const completed = waitForTransaction(transaction)
        try {
          transaction.objectStore(WORKSPACE_SETTINGS_STORE).delete(MODEL_CONFIG_KEY)
        } catch (error) {
          completed.catch(() => {})
          throw toWorkspaceStorageError(error)
        }
        await completed
      }),
  }
}

/** 应用内共享的默认存储实例；首次调用时才接触 indexedDB。 */
export const workspaceStorage = createWorkspaceStorage()
