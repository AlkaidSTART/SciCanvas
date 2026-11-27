import { create } from 'zustand'
import { llmEndpointClient } from '../models/client'
import type { LlmEndpointStorageClient } from '../models/client'
import type { LlmEndpointConfig, UpsertLlmEndpointInput } from '../models/types'

let activeClient: LlmEndpointStorageClient = llmEndpointClient

/** 测试辅助：注入自定义客户端。 */
export function setLlmEndpointClientForTests(client: LlmEndpointStorageClient | null): void {
  activeClient = client ?? llmEndpointClient
}

interface ModelConfigState {
  endpoints: LlmEndpointConfig[]
  dbPath: string | null
  loading: boolean
  saving: boolean
  loaded: boolean
  error: string | null
  loadEndpoints: () => Promise<void>
  saveEndpoint: (input: UpsertLlmEndpointInput) => Promise<LlmEndpointConfig | null>
  activateEndpoint: (id: string) => Promise<LlmEndpointConfig | null>
  deleteEndpoint: (id: string) => Promise<boolean>
  clearError: () => void
}

function mergeEndpointList(
  list: LlmEndpointConfig[],
  saved: LlmEndpointConfig,
): LlmEndpointConfig[] {
  const exists = list.some((item) => item.id === saved.id)
  const next = exists
    ? list.map((item) =>
        item.id === saved.id
          ? saved
          : saved.isActive
            ? { ...item, isActive: false }
            : item,
      )
    : [
        ...list.map((item) => (saved.isActive ? { ...item, isActive: false } : item)),
        saved,
      ]
  return next.sort((a, b) => b.updatedAt - a.updatedAt)
}

export const useModelConfigStore = create<ModelConfigState>((set) => ({
  endpoints: [],
  dbPath: null,
  loading: false,
  saving: false,
  loaded: false,
  error: null,

  loadEndpoints: async () => {
    set({ loading: true, error: null })
    try {
      const { endpoints, dbPath } = await activeClient.listEndpoints()
      set({ endpoints, dbPath, loading: false, loaded: true })
    } catch (error) {
      set({
        loading: false,
        loaded: true,
        error: error instanceof Error ? error.message : '读取 SQLite 大模型配置失败',
      })
    }
  },

  saveEndpoint: async (input) => {
    set({ saving: true, error: null })
    try {
      const saved = await activeClient.upsertEndpoint(input)
      set((state) => ({
        endpoints: mergeEndpointList(state.endpoints, saved),
        saving: false,
      }))
      return saved
    } catch (error) {
      set({
        saving: false,
        error: error instanceof Error ? error.message : '保存大模型配置失败',
      })
      return null
    }
  },

  activateEndpoint: async (id) => {
    set({ saving: true, error: null })
    try {
      const activated = await activeClient.setActiveEndpoint(id)
      set((state) => ({
        endpoints: mergeEndpointList(state.endpoints, activated),
        saving: false,
      }))
      return activated
    } catch (error) {
      set({
        saving: false,
        error: error instanceof Error ? error.message : '切换当前模型端点失败',
      })
      return null
    }
  },

  deleteEndpoint: async (id) => {
    set({ saving: true, error: null })
    try {
      await activeClient.deleteEndpoint(id)
      set((state) => ({
        endpoints: state.endpoints.filter((item) => item.id !== id),
        saving: false,
      }))
      return true
    } catch (error) {
      set({
        saving: false,
        error: error instanceof Error ? error.message : '删除模型端点失败',
      })
      return false
    }
  },

  clearError: () => set({ error: null }),
}))
