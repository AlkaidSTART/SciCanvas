import { create } from 'zustand'
import { applyCanvasTheme } from '../experiments/canvasKit'
import {
  DEFAULT_THEME_ID,
  getThemePreset,
  isThemePresetId,
  type ThemePreset,
  type ThemePresetId,
} from '../theme/presets'

export const THEME_STORAGE_KEY = 'scicanvas.theme.v1'

export function readStoredThemeId(): ThemePresetId {
  if (typeof window === 'undefined') return DEFAULT_THEME_ID
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (isThemePresetId(raw)) return raw
  } catch {
    // 隐私模式或存储受限时回退默认主题
  }
  return DEFAULT_THEME_ID
}

function writeStoredThemeId(themeId: ThemePresetId): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, themeId)
  } catch {
    // 忽略持久化失败，保持本次会话主题生效
  }
}

export function applyThemePreset(themeId: ThemePresetId): ThemePreset {
  const preset = getThemePreset(themeId)
  applyCanvasTheme(preset.canvas)

  if (typeof document !== 'undefined') {
    const root = document.documentElement
    root.dataset.theme = preset.id
    root.dataset.themeMode = preset.mode
    root.style.colorScheme = preset.mode

    for (const [token, value] of Object.entries(preset.tokens)) {
      root.style.setProperty(token, value)
    }

    const themeColorMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    if (themeColorMeta) {
      themeColorMeta.content = preset.tokens['--color-canvas']
    }
  }

  return preset
}

interface ThemeState {
  themeId: ThemePresetId
  setTheme: (themeId: ThemePresetId) => void
  resetTheme: () => void
}

const initialThemeId = readStoredThemeId()

export const useThemeStore = create<ThemeState>()((set) => ({
  themeId: initialThemeId,

  setTheme: (themeId) => {
    const preset = applyThemePreset(themeId)
    writeStoredThemeId(preset.id)
    set({ themeId: preset.id })
  },

  resetTheme: () => {
    const preset = applyThemePreset(DEFAULT_THEME_ID)
    writeStoredThemeId(preset.id)
    set({ themeId: preset.id })
  },
}))

export function initTheme(): ThemePreset {
  const themeId = readStoredThemeId()
  useThemeStore.setState({ themeId })
  return applyThemePreset(themeId)
}
