import { invoke } from '@tauri-apps/api/core'
import { isDesktopApp } from '../floatingBall/bridge'
import type { LlmEndpointConfig, UpsertLlmEndpointInput } from './types'

export interface ListLlmEndpointsResult {
  endpoints: LlmEndpointConfig[]
  dbPath: string | null
}

export interface LlmEndpointStorageClient {
  listEndpoints: () => Promise<ListLlmEndpointsResult>
  upsertEndpoint: (input: UpsertLlmEndpointInput) => Promise<LlmEndpointConfig>
  setActiveEndpoint: (id: string) => Promise<LlmEndpointConfig>
  deleteEndpoint: (id: string) => Promise<void>
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  let data: unknown = null
  try {
    data = await response.json()
  } catch {
    data = null
  }
  if (!response.ok) {
    const errorMessage =
      typeof data === 'object' &&
      data !== null &&
      'error' in data &&
      typeof (data as { error?: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `SQLite 模型配置请求失败 (${response.status})`
    throw new Error(errorMessage)
  }
  return data as T
}

export function createHttpLlmEndpointClient(
  fetchImpl: typeof fetch = fetch,
): LlmEndpointStorageClient {
  return {
    listEndpoints: async () => {
      const response = await fetchImpl('/api/llm-endpoints', { method: 'GET' })
      const payload = await parseJsonResponse<{
        ok: true
        endpoints: LlmEndpointConfig[]
        dbPath?: string
      }>(response)
      return {
        endpoints: payload.endpoints ?? [],
        dbPath: payload.dbPath ?? null,
      }
    },

    upsertEndpoint: async (input) => {
      const response = await fetchImpl('/api/llm-endpoints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      const payload = await parseJsonResponse<{ ok: true; endpoint: LlmEndpointConfig }>(response)
      return payload.endpoint
    },

    setActiveEndpoint: async (id) => {
      const response = await fetchImpl(
        `/api/llm-endpoints/${encodeURIComponent(id)}/activate`,
        { method: 'POST' },
      )
      const payload = await parseJsonResponse<{ ok: true; endpoint: LlmEndpointConfig }>(response)
      return payload.endpoint
    },

    deleteEndpoint: async (id) => {
      const response = await fetchImpl(`/api/llm-endpoints/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      if (response.status === 404) return
      await parseJsonResponse<{ ok: true }>(response)
    },
  }
}

export function createTauriLlmEndpointClient(): LlmEndpointStorageClient {
  return {
    listEndpoints: async () => {
      const result = await invoke<{ endpoints: LlmEndpointConfig[]; dbPath: string }>(
        'sqlite_list_llm_endpoints',
      )
      return {
        endpoints: result.endpoints ?? [],
        dbPath: result.dbPath ?? null,
      }
    },

    upsertEndpoint: async (input) => {
      return invoke<LlmEndpointConfig>('sqlite_upsert_llm_endpoint', { input })
    },

    setActiveEndpoint: async (id) => {
      return invoke<LlmEndpointConfig>('sqlite_set_active_llm_endpoint', { endpointId: id })
    },

    deleteEndpoint: async (id) => {
      await invoke<boolean>('sqlite_delete_llm_endpoint', { endpointId: id })
    },
  }
}

const httpClient = createHttpLlmEndpointClient()
const tauriClient = createTauriLlmEndpointClient()

export const llmEndpointClient: LlmEndpointStorageClient = {
  listEndpoints: () =>
    isDesktopApp() ? tauriClient.listEndpoints() : httpClient.listEndpoints(),
  upsertEndpoint: (input) =>
    isDesktopApp() ? tauriClient.upsertEndpoint(input) : httpClient.upsertEndpoint(input),
  setActiveEndpoint: (id) =>
    isDesktopApp() ? tauriClient.setActiveEndpoint(id) : httpClient.setActiveEndpoint(id),
  deleteEndpoint: (id) =>
    isDesktopApp() ? tauriClient.deleteEndpoint(id) : httpClient.deleteEndpoint(id),
}
