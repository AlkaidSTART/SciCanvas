import { describe, expect, it } from 'vitest'
import { parseAppRoute } from './useAppRoute'

describe('parseAppRoute', () => {
  it('resolves /settings and trailing slash to settings', () => {
    expect(parseAppRoute('/settings', '')).toBe('settings')
    expect(parseAppRoute('/settings/', '')).toBe('settings')
  })

  it('resolves hash #/settings for Tauri packaged builds', () => {
    expect(parseAppRoute('/index.html', '#/settings')).toBe('settings')
    expect(parseAppRoute('/', '#/settings/')).toBe('settings')
  })

  it('resolves /models and hash #/models to models', () => {
    expect(parseAppRoute('/models', '')).toBe('models')
    expect(parseAppRoute('/models/', '')).toBe('models')
    expect(parseAppRoute('/index.html', '#/models')).toBe('models')
    expect(parseAppRoute('/', '#/models/')).toBe('models')
  })

  it('defaults other routes to workbench', () => {
    expect(parseAppRoute('/', '')).toBe('workbench')
    expect(parseAppRoute('/index.html', '')).toBe('workbench')
    expect(parseAppRoute('/unknown', '#/other')).toBe('workbench')
  })
})
