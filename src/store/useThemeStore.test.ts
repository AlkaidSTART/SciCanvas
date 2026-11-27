import { beforeEach, describe, expect, it } from 'vitest'
import { CANVAS } from '../experiments/canvasKit'
import {
  DEFAULT_THEME_ID,
  THEME_PRESETS,
  getThemePreset,
  isThemePresetId,
} from '../theme/presets'
import {
  THEME_STORAGE_KEY,
  applyThemePreset,
  initTheme,
  readStoredThemeId,
  useThemeStore,
} from './useThemeStore'

describe('theme presets & useThemeStore', () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.removeAttribute('data-theme-mode')
    document.documentElement.style.cssText = ''
    useThemeStore.getState().resetTheme()
  })

  it('defines at least 6 unique theme presets including light and dark modes', () => {
    expect(THEME_PRESETS.length).toBeGreaterThanOrEqual(6)
    const ids = new Set(THEME_PRESETS.map((preset) => preset.id))
    expect(ids.size).toBe(THEME_PRESETS.length)
    expect(THEME_PRESETS.some((preset) => preset.mode === 'light')).toBe(true)
    expect(THEME_PRESETS.some((preset) => preset.mode === 'dark')).toBe(true)
  })

  it('validates theme ids and falls back to default preset when unknown', () => {
    expect(isThemePresetId('warm-paper')).toBe(true)
    expect(isThemePresetId('midnight-slate')).toBe(true)
    expect(isThemePresetId('non-existent')).toBe(false)
    expect(getThemePreset('warm-paper').id).toBe(DEFAULT_THEME_ID)
  })

  it('applies CSS tokens, dataset attributes, and canvas palette when switching theme', () => {
    const meta = document.createElement('meta')
    meta.name = 'theme-color'
    meta.content = '#f6f1e7'
    document.head.appendChild(meta)

    try {
      useThemeStore.getState().setTheme('midnight-slate')
      const darkPreset = getThemePreset('midnight-slate')

      expect(useThemeStore.getState().themeId).toBe('midnight-slate')
      expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('midnight-slate')
      expect(document.documentElement.dataset.theme).toBe('midnight-slate')
      expect(document.documentElement.dataset.themeMode).toBe('dark')
      expect(document.documentElement.style.colorScheme).toBe('dark')
      expect(document.documentElement.style.getPropertyValue('--color-canvas')).toBe(
        darkPreset.tokens['--color-canvas'],
      )
      expect(meta.content).toBe(darkPreset.tokens['--color-canvas'])
      expect(CANVAS.background).toBe(darkPreset.canvas.background)
      expect(CANVAS.textStrong).toBe(darkPreset.canvas.textStrong)
    } finally {
      meta.remove()
    }
  })

  it('restores persisted theme via initTheme and falls back safely on invalid storage', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'sage-botanical')
    const restored = initTheme()
    expect(restored.id).toBe('sage-botanical')
    expect(useThemeStore.getState().themeId).toBe('sage-botanical')

    window.localStorage.setItem(THEME_STORAGE_KEY, 'invalid-theme-id')
    expect(readStoredThemeId()).toBe(DEFAULT_THEME_ID)

    const applied = applyThemePreset(DEFAULT_THEME_ID)
    expect(applied.id).toBe(DEFAULT_THEME_ID)
    expect(CANVAS.background).toBe(getThemePreset(DEFAULT_THEME_ID).canvas.background)
  })
})
