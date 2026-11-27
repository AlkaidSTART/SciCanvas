export type ThemeMode = 'light' | 'dark'

export type ThemePresetId =
  | 'warm-paper'
  | 'blueprint-day'
  | 'sage-botanical'
  | 'lavender-mist'
  | 'midnight-slate'
  | 'obsidian-amber'

export interface ThemeCssTokens {
  '--color-canvas': string
  '--color-surface': string
  '--color-surface-soft': string
  '--color-panel': string
  '--color-panel-deep': string
  '--color-line': string
  '--color-line-strong': string
  '--color-ink': string
  '--color-ink-dim': string
  '--color-ink-faint': string
  '--color-accent': string
  '--color-accent-strong': string
  '--color-accent-soft': string
  '--color-accent-line': string
  '--color-mint': string
  '--color-peach': string
  '--color-rose': string
  '--color-lilac': string
  '--color-amber': string
  '--color-butter': string
  '--color-danger': string
  '--bg-glow-primary': string
  '--bg-glow-secondary': string
}

export interface CanvasThemePalette {
  background: string
  badge: string
  grid: string
  gridStrong: string
  axis: string
  frame: string
  text: string
  textStrong: string
  textFaint: string
  faint: string
  blue: string
  blueSoft: string
  peach: string
  mint: string
  rose: string
  lilac: string
  amber: string
  halo: string
}

export interface ThemePreset {
  id: ThemePresetId
  name: string
  tag: string
  description: string
  mode: ThemeMode
  tokens: ThemeCssTokens
  canvas: CanvasThemePalette
}

export const DEFAULT_THEME_ID: ThemePresetId = 'warm-paper'

export const THEME_PRESETS: readonly ThemePreset[] = [
  {
    id: 'warm-paper',
    name: '暖纸手札',
    tag: '默认',
    description: '米白纸感与雾霾蓝，柔和耐看，适合长时间研读公式。',
    mode: 'light',
    tokens: {
      '--color-canvas': '#f6f1e7',
      '--color-surface': '#fbf7ef',
      '--color-surface-soft': '#f1ebdf',
      '--color-panel': '#fcf9f2',
      '--color-panel-deep': '#fcf9f2',
      '--color-line': 'rgb(92 74 54 / 0.1)',
      '--color-line-strong': 'rgb(92 74 54 / 0.2)',
      '--color-ink': '#3a332b',
      '--color-ink-dim': '#6d6154',
      '--color-ink-faint': '#9b8f81',
      '--color-accent': '#7c9dbb',
      '--color-accent-strong': '#4f7292',
      '--color-accent-soft': 'rgb(154 180 204 / 0.2)',
      '--color-accent-line': 'rgb(124 157 187 / 0.34)',
      '--color-mint': '#7faf94',
      '--color-peach': '#e0a279',
      '--color-rose': '#d98e8e',
      '--color-lilac': '#a996c4',
      '--color-amber': '#d9a24a',
      '--color-butter': '#e6c57f',
      '--color-danger': '#d98e8e',
      '--bg-glow-primary': 'rgba(168, 190, 214, 0.38)',
      '--bg-glow-secondary': 'rgba(224, 162, 121, 0.26)',
    },
    canvas: {
      background: '#FBF7EF',
      badge: 'rgba(252, 249, 242, 0.92)',
      grid: 'rgba(120, 100, 78, 0.055)',
      gridStrong: 'rgba(120, 100, 78, 0.11)',
      axis: 'rgba(120, 100, 78, 0.28)',
      frame: 'rgba(120, 100, 78, 0.14)',
      text: '#7D7062',
      textStrong: '#3A332B',
      textFaint: '#9B8F81',
      faint: 'rgba(120, 100, 78, 0.3)',
      blue: '#4F7292',
      blueSoft: 'rgba(79, 114, 146, 0.5)',
      peach: '#C97A45',
      mint: '#5F9377',
      rose: '#C06F6F',
      lilac: '#8A76A8',
      amber: '#C08A3A',
      halo: 'rgba(124, 157, 187, 0.18)',
    },
  },
  {
    id: 'blueprint-day',
    name: '晴空蓝图',
    tag: '清爽',
    description: '冷白底色搭配工程钴蓝，线条清晰锐利，偏向现代实验报告风格。',
    mode: 'light',
    tokens: {
      '--color-canvas': '#eff4f9',
      '--color-surface': '#f8fbfe',
      '--color-surface-soft': '#e7eff7',
      '--color-panel': '#fbfdff',
      '--color-panel-deep': '#f4f8fc',
      '--color-line': 'rgb(30 58 95 / 0.1)',
      '--color-line-strong': 'rgb(30 58 95 / 0.2)',
      '--color-ink': '#1e293b',
      '--color-ink-dim': '#475569',
      '--color-ink-faint': '#7c8ea3',
      '--color-accent': '#4b83c3',
      '--color-accent-strong': '#255da0',
      '--color-accent-soft': 'rgb(75 131 195 / 0.16)',
      '--color-accent-line': 'rgb(75 131 195 / 0.35)',
      '--color-mint': '#3e9c82',
      '--color-peach': '#db8856',
      '--color-rose': '#d4747e',
      '--color-lilac': '#8778be',
      '--color-amber': '#d09438',
      '--color-butter': '#e4c26d',
      '--color-danger': '#d4747e',
      '--bg-glow-primary': 'rgba(116, 170, 232, 0.3)',
      '--bg-glow-secondary': 'rgba(126, 204, 196, 0.22)',
    },
    canvas: {
      background: '#F8FBFE',
      badge: 'rgba(248, 251, 254, 0.92)',
      grid: 'rgba(37, 93, 160, 0.055)',
      gridStrong: 'rgba(37, 93, 160, 0.11)',
      axis: 'rgba(30, 58, 95, 0.28)',
      frame: 'rgba(30, 58, 95, 0.14)',
      text: '#475569',
      textStrong: '#1E293B',
      textFaint: '#7C8EA3',
      faint: 'rgba(30, 58, 95, 0.28)',
      blue: '#255DA0',
      blueSoft: 'rgba(37, 93, 160, 0.48)',
      peach: '#C96D3B',
      mint: '#2F856E',
      rose: '#BE5B66',
      lilac: '#7060AC',
      amber: '#B97E24',
      halo: 'rgba(75, 131, 195, 0.18)',
    },
  },
  {
    id: 'sage-botanical',
    name: '林间苔藓',
    tag: '护眼',
    description: '淡雅植物纸与松柏青绿，低对比度舒缓视觉，适合生物与生态建模。',
    mode: 'light',
    tokens: {
      '--color-canvas': '#eef3ee',
      '--color-surface': '#f6faf6',
      '--color-surface-soft': '#e5ede5',
      '--color-panel': '#fafcfa',
      '--color-panel-deep': '#f2f7f2',
      '--color-line': 'rgb(45 72 56 / 0.1)',
      '--color-line-strong': 'rgb(45 72 56 / 0.2)',
      '--color-ink': '#233329',
      '--color-ink-dim': '#4e6356',
      '--color-ink-faint': '#7e9385',
      '--color-accent': '#5a9474',
      '--color-accent-strong': '#366e50',
      '--color-accent-soft': 'rgb(90 148 116 / 0.18)',
      '--color-accent-line': 'rgb(90 148 116 / 0.36)',
      '--color-mint': '#589c7c',
      '--color-peach': '#d68f63',
      '--color-rose': '#cc7f7f',
      '--color-lilac': '#9282b5',
      '--color-amber': '#cc9942',
      '--color-butter': '#dfc074',
      '--color-danger': '#cc7f7f',
      '--bg-glow-primary': 'rgba(130, 186, 152, 0.3)',
      '--bg-glow-secondary': 'rgba(214, 184, 122, 0.22)',
    },
    canvas: {
      background: '#F6FAF6',
      badge: 'rgba(246, 250, 246, 0.92)',
      grid: 'rgba(45, 72, 56, 0.055)',
      gridStrong: 'rgba(45, 72, 56, 0.11)',
      axis: 'rgba(45, 72, 56, 0.28)',
      frame: 'rgba(45, 72, 56, 0.14)',
      text: '#4E6356',
      textStrong: '#233329',
      textFaint: '#7E9385',
      faint: 'rgba(45, 72, 56, 0.28)',
      blue: '#366E50',
      blueSoft: 'rgba(54, 110, 80, 0.48)',
      peach: '#C27446',
      mint: '#3F8666',
      rose: '#B86666',
      lilac: '#7B6AA0',
      amber: '#B5812B',
      halo: 'rgba(90, 148, 116, 0.18)',
    },
  },
  {
    id: 'lavender-mist',
    name: '樱雾紫韵',
    tag: '雅致',
    description: '柔雾丁香底色与暮紫靛蓝，典雅轻盈，适合展示与教学演示。',
    mode: 'light',
    tokens: {
      '--color-canvas': '#f4f0f8',
      '--color-surface': '#faf8fd',
      '--color-surface-soft': '#ece6f3',
      '--color-panel': '#fdfbfe',
      '--color-panel-deep': '#f6f2fa',
      '--color-line': 'rgb(76 58 104 / 0.1)',
      '--color-line-strong': 'rgb(76 58 104 / 0.2)',
      '--color-ink': '#2e2639',
      '--color-ink-dim': '#615572',
      '--color-ink-faint': '#9184a3',
      '--color-accent': '#8d74b8',
      '--color-accent-strong': '#644b91',
      '--color-accent-soft': 'rgb(141 116 184 / 0.18)',
      '--color-accent-line': 'rgb(141 116 184 / 0.36)',
      '--color-mint': '#6aa38d',
      '--color-peach': '#df9678',
      '--color-rose': '#d48194',
      '--color-lilac': '#9b7ec4',
      '--color-amber': '#d49d4c',
      '--color-butter': '#e4c27f',
      '--color-danger': '#d48194',
      '--bg-glow-primary': 'rgba(176, 152, 218, 0.32)',
      '--bg-glow-secondary': 'rgba(226, 166, 186, 0.24)',
    },
    canvas: {
      background: '#FAF8FD',
      badge: 'rgba(250, 248, 253, 0.92)',
      grid: 'rgba(76, 58, 104, 0.055)',
      gridStrong: 'rgba(76, 58, 104, 0.11)',
      axis: 'rgba(76, 58, 104, 0.28)',
      frame: 'rgba(76, 58, 104, 0.14)',
      text: '#615572',
      textStrong: '#2E2639',
      textFaint: '#9184A3',
      faint: 'rgba(76, 58, 104, 0.28)',
      blue: '#644B91',
      blueSoft: 'rgba(100, 75, 145, 0.48)',
      peach: '#C97756',
      mint: '#4F8B74',
      rose: '#BF677C',
      lilac: '#8363B0',
      amber: '#BA8332',
      halo: 'rgba(141, 116, 184, 0.18)',
    },
  },
  {
    id: 'midnight-slate',
    name: '深空黑板',
    tag: '深色',
    description: '深海石板与冰川青蓝，夜间专注科研仿真与暗室演示不刺眼。',
    mode: 'dark',
    tokens: {
      '--color-canvas': '#131922',
      '--color-surface': '#1a222e',
      '--color-surface-soft': '#222c3b',
      '--color-panel': '#171f2a',
      '--color-panel-deep': '#131922',
      '--color-line': 'rgb(186 206 232 / 0.12)',
      '--color-line-strong': 'rgb(186 206 232 / 0.24)',
      '--color-ink': '#e6edf6',
      '--color-ink-dim': '#a5b4c8',
      '--color-ink-faint': '#72839b',
      '--color-accent': '#7ab0e0',
      '--color-accent-strong': '#9bc7ee',
      '--color-accent-soft': 'rgb(122 176 224 / 0.18)',
      '--color-accent-line': 'rgb(122 176 224 / 0.38)',
      '--color-mint': '#6cc49e',
      '--color-peach': '#e8a478',
      '--color-rose': '#e68c94',
      '--color-lilac': '#b7a1dc',
      '--color-amber': '#e6b25c',
      '--color-butter': '#edd089',
      '--color-danger': '#e68c94',
      '--bg-glow-primary': 'rgba(84, 142, 206, 0.22)',
      '--bg-glow-secondary': 'rgba(108, 196, 158, 0.14)',
    },
    canvas: {
      background: '#161E29',
      badge: 'rgba(23, 31, 42, 0.92)',
      grid: 'rgba(186, 206, 232, 0.065)',
      gridStrong: 'rgba(186, 206, 232, 0.13)',
      axis: 'rgba(186, 206, 232, 0.34)',
      frame: 'rgba(186, 206, 232, 0.18)',
      text: '#A5B4C8',
      textStrong: '#E6EDF6',
      textFaint: '#72839B',
      faint: 'rgba(186, 206, 232, 0.3)',
      blue: '#7AB0E0',
      blueSoft: 'rgba(122, 176, 224, 0.52)',
      peach: '#E8A478',
      mint: '#6CC49E',
      rose: '#E68C94',
      lilac: '#B7A1DC',
      amber: '#E6B25C',
      halo: 'rgba(122, 176, 224, 0.24)',
    },
  },
  {
    id: 'obsidian-amber',
    name: '暗夜黑曜',
    tag: '深色',
    description: '暖炭黑曜底色搭配琥珀鎏金，低蓝光暖调暗黑，深夜推演更舒适。',
    mode: 'dark',
    tokens: {
      '--color-canvas': '#181512',
      '--color-surface': '#221e1a',
      '--color-surface-soft': '#2c2722',
      '--color-panel': '#1d1a16',
      '--color-panel-deep': '#161310',
      '--color-line': 'rgb(232 214 190 / 0.12)',
      '--color-line-strong': 'rgb(232 214 190 / 0.24)',
      '--color-ink': '#efe7dc',
      '--color-ink-dim': '#b9ab9a',
      '--color-ink-faint': '#857768',
      '--color-accent': '#d9a452',
      '--color-accent-strong': '#ecc074',
      '--color-accent-soft': 'rgb(217 164 82 / 0.18)',
      '--color-accent-line': 'rgb(217 164 82 / 0.4)',
      '--color-mint': '#7cc49b',
      '--color-peach': '#eb9e70',
      '--color-rose': '#e68c8c',
      '--color-lilac': '#bea6db',
      '--color-amber': '#e8b65e',
      '--color-butter': '#f0d48d',
      '--color-danger': '#e68c8c',
      '--bg-glow-primary': 'rgba(217, 164, 82, 0.18)',
      '--bg-glow-secondary': 'rgba(212, 128, 92, 0.14)',
    },
    canvas: {
      background: '#1E1A16',
      badge: 'rgba(29, 26, 22, 0.92)',
      grid: 'rgba(232, 214, 190, 0.06)',
      gridStrong: 'rgba(232, 214, 190, 0.12)',
      axis: 'rgba(232, 214, 190, 0.34)',
      frame: 'rgba(232, 214, 190, 0.18)',
      text: '#B9AB9A',
      textStrong: '#EFE7DC',
      textFaint: '#857768',
      faint: 'rgba(232, 214, 190, 0.3)',
      blue: '#E0AF5F',
      blueSoft: 'rgba(224, 175, 95, 0.5)',
      peach: '#EB9E70',
      mint: '#7CC49B',
      rose: '#E68C8C',
      lilac: '#BEA6DB',
      amber: '#E8B65E',
      halo: 'rgba(217, 164, 82, 0.24)',
    },
  },
]

const THEME_BY_ID = new Map<ThemePresetId, ThemePreset>(
  THEME_PRESETS.map((preset) => [preset.id, preset]),
)

export function isThemePresetId(value: unknown): value is ThemePresetId {
  return typeof value === 'string' && THEME_BY_ID.has(value as ThemePresetId)
}

export function getThemePreset(id: ThemePresetId): ThemePreset {
  return THEME_BY_ID.get(id) ?? THEME_PRESETS[0]
}
