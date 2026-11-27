import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  closeFloatingBall,
  getCapturePermissions,
  isDesktopApp,
  openFloatingBall,
  openPermissionSettings,
  requestCapturePermission,
} from '../floatingBall/bridge'
import type { PermissionStatus } from '../floatingBall/bridge'
import { useFloatingBallStore } from '../store/useFloatingBallStore'
import { useThemeStore } from '../store/useThemeStore'
import { DEFAULT_THEME_ID, THEME_PRESETS, getThemePreset } from '../theme/presets'
import type { ThemeMode, ThemePreset } from '../theme/presets'
import { BoltIcon, CheckIcon, PaletteIcon, SettingsIcon } from './icons'
import { FAST_TRANSITION, SPRING_SNAPPY, TAP_BUTTON } from './motion'

interface SettingsPageProps {
  onBack: () => void
}

interface FeedbackMessage {
  tone: 'success' | 'warning' | 'error'
  text: string
}

type ThemeFilter = 'all' | ThemeMode

function ThemePreviewMini({ preset }: { preset: ThemePreset }) {
  const { tokens, canvas } = preset
  return (
    <div
      className="relative h-[68px] w-full overflow-hidden rounded-[9px] border"
      style={{
        backgroundColor: tokens['--color-canvas'],
        borderColor: tokens['--color-line-strong'],
        backgroundImage: `radial-gradient(120px 64px at 85% 0%, ${tokens['--bg-glow-primary']}, transparent 70%), radial-gradient(90px 56px at 10% 100%, ${tokens['--bg-glow-secondary']}, transparent 70%)`,
      }}
      aria-hidden="true"
    >
      {/* 模拟顶栏 */}
      <div
        className="flex h-[15px] items-center justify-between border-b px-2"
        style={{
          backgroundColor: tokens['--color-panel'],
          borderColor: tokens['--color-line'],
        }}
      >
        <div className="flex items-center gap-1">
          <span
            className="size-[5px] rounded-full"
            style={{ backgroundColor: tokens['--color-accent-strong'] }}
          />
          <span
            className="h-[3px] w-7 rounded-full opacity-75"
            style={{ backgroundColor: tokens['--color-ink'] }}
          />
        </div>
        <span
          className="h-[5px] w-4 rounded-full"
          style={{ backgroundColor: tokens['--color-accent-soft'] }}
        />
      </div>

      {/* 模拟侧栏 + 画布区域 */}
      <div className="flex h-[53px] gap-1.5 p-1.5">
        <div
          className="flex w-[32%] flex-col gap-1 rounded-[5px] border p-1"
          style={{
            backgroundColor: tokens['--color-panel'],
            borderColor: tokens['--color-line'],
          }}
        >
          <span
            className="h-[4px] w-4/5 rounded-full"
            style={{ backgroundColor: tokens['--color-accent-strong'] }}
          />
          <span
            className="h-[3px] w-3/5 rounded-full opacity-45"
            style={{ backgroundColor: tokens['--color-ink-dim'] }}
          />
          <span
            className="mt-auto h-[3px] w-2/3 rounded-full opacity-35"
            style={{ backgroundColor: tokens['--color-ink-faint'] }}
          />
        </div>

        <div
          className="relative flex flex-1 flex-col justify-between overflow-hidden rounded-[5px] border p-1.5"
          style={{
            backgroundColor: canvas.background,
            borderColor: tokens['--color-line'],
          }}
        >
          <svg
            className="h-full w-full"
            viewBox="0 0 96 36"
            fill="none"
            preserveAspectRatio="none"
          >
            <path
              d="M2 27 C 16 8, 30 8, 44 20 S 74 30, 94 11"
              stroke={canvas.blue}
              strokeWidth="2.2"
              strokeLinecap="round"
            />
            <path
              d="M2 16 C 18 26, 36 28, 54 14 S 78 10, 94 22"
              stroke={canvas.mint}
              strokeWidth="1.7"
              strokeDasharray="3 3"
              strokeLinecap="round"
            />
            <circle cx="44" cy="20" r="2.8" fill={canvas.peach} />
          </svg>
        </div>
      </div>
    </div>
  )
}

export function SettingsPage({ onBack }: SettingsPageProps) {
  const floatingBallOpen = useFloatingBallStore((state) => state.floatingBallOpen)
  const setFloatingBallOpen = useFloatingBallStore((state) => state.setFloatingBallOpen)
  const themeId = useThemeStore((state) => state.themeId)
  const setTheme = useThemeStore((state) => state.setTheme)
  const resetTheme = useThemeStore((state) => state.resetTheme)

  const desktop = isDesktopApp()
  const [themeFilter, setThemeFilter] = useState<ThemeFilter>('all')
  const [toggling, setToggling] = useState(false)
  const [feedback, setFeedback] = useState<FeedbackMessage | null>(null)
  const [permissions, setPermissions] = useState<PermissionStatus>({
    accessibility: false,
    screenRecording: false,
    supported: desktop,
  })

  const activeTheme = getThemePreset(themeId)
  const visibleThemes =
    themeFilter === 'all'
      ? THEME_PRESETS
      : THEME_PRESETS.filter((preset) => preset.mode === themeFilter)

  useEffect(() => {
    if (!desktop) return undefined
    let disposed = false
    void getCapturePermissions()
      .then((status) => {
        if (!disposed) setPermissions(status)
      })
      .catch(() => {})
    return () => {
      disposed = true
    }
  }, [desktop])

  const handleSetFloatingBall = async (nextOpen: boolean) => {
    if (toggling) return
    if (!desktop) {
      setFeedback({
        tone: 'warning',
        text: '悬浮球依赖桌面端系统置顶窗口，请使用 SciCanvas 桌面端打开此开关。',
      })
      return
    }

    setToggling(true)
    setFeedback(null)
    try {
      if (nextOpen) {
        const status = await openFloatingBall()
        setFloatingBallOpen(true)
        setPermissions(status)
        if (status.supported && !status.accessibility) {
          const updated = await requestCapturePermission('accessibility')
          setPermissions(updated)
          setFeedback({
            tone: updated.accessibility ? 'success' : 'warning',
            text: updated.accessibility
              ? '悬浮球已打开：在论文中选中公式后单击悬浮球即可加入对话框。'
              : '悬浮球已打开，并已向系统请求「辅助功能」权限；允许后即可一键读取选中公式。',
          })
        } else {
          setFeedback({
            tone: 'success',
            text: '悬浮球已打开：在论文中选中公式后单击悬浮球即可加入对话框。',
          })
        }
      } else {
        await closeFloatingBall()
        setFloatingBallOpen(false)
        setFeedback({
          tone: 'success',
          text: '悬浮球已关闭，可随时在此重新开启。',
        })
      }
    } catch (error) {
      setFeedback({
        tone: 'error',
        text: error instanceof Error ? error.message : '悬浮球状态切换失败，请稍后重试',
      })
    } finally {
      setToggling(false)
    }
  }

  const handleRequestPermission = async (kind: 'accessibility' | 'screen_recording') => {
    if (!desktop) return
    try {
      const next = await requestCapturePermission(kind)
      setPermissions(next)
      const granted = kind === 'accessibility' ? next.accessibility : next.screenRecording
      setFeedback({
        tone: granted ? 'success' : 'warning',
        text: granted
          ? kind === 'accessibility'
            ? '「辅助功能」权限已就绪。'
            : '「屏幕录制」权限已就绪。'
          : '已触发系统授权请求；若未生效请点击「系统设置」手动勾选 SciCanvas。',
      })
    } catch {
      setFeedback({
        tone: 'error',
        text: '请求系统权限失败，请手动打开系统设置进行授权。',
      })
    }
  }

  return (
    <motion.div
      key="settings-page"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={FAST_TRANSITION}
      className="workbench-scroll flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-6 max-[640px]:px-3.5 max-[640px]:py-4"
    >
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-[10px] border border-accent-line bg-accent-soft text-accent-strong">
              <SettingsIcon className="size-[18px]" />
            </span>
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <h1 className="m-0 text-[16px] font-semibold tracking-[0.01em] text-ink">
                  应用设置
                </h1>
                <span className="rounded-[5px] border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px] text-ink-faint">
                  /settings
                </span>
              </div>
              <p className="m-0 text-[11.5px] text-ink-faint">
                管理界面主题预设、桌面悬浮球开关与系统捕获权限
              </p>
            </div>
          </div>

          <motion.button
            whileTap={TAP_BUTTON}
            type="button"
            onClick={onBack}
            className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink-dim transition-colors hover:border-line-strong hover:bg-surface-soft hover:text-ink"
          >
            ← 返回工作台
          </motion.button>
        </div>

        <section
          aria-labelledby="theme-preset-setting-title"
          className="flex flex-col gap-4 rounded-[14px] border border-line bg-panel/92 p-5 shadow-[0_8px_24px_rgba(0,0,0,0.06)]"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <span className="mt-0.5 grid size-9 flex-none place-items-center rounded-[10px] border border-accent-line bg-accent-soft text-accent-strong">
                <PaletteIcon className="size-[18px]" />
              </span>
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2
                    id="theme-preset-setting-title"
                    className="m-0 text-[14px] font-semibold text-ink"
                  >
                    主题预设
                  </h2>
                  <span className="inline-flex items-center gap-1 rounded-full border border-accent-line bg-accent-soft px-2 py-0.5 text-[10px] font-medium text-accent-strong">
                    当前：{activeTheme.name}
                  </span>
                </div>
                <p className="m-0 text-[12px] leading-[1.6] text-ink-dim">
                  切换工作台界面与实验画布配色，点击即刻生效并自动保存到本地。
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div
                className="inline-flex rounded-lg border border-line bg-surface-soft p-0.5"
                role="group"
                aria-label="按明暗筛选主题"
              >
                {(
                  [
                    { id: 'all', label: '全部' },
                    { id: 'light', label: '浅色' },
                    { id: 'dark', label: '深色' },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={themeFilter === option.id}
                    onClick={() => setThemeFilter(option.id)}
                    className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                      themeFilter === option.id
                        ? 'bg-panel text-accent-strong shadow-[0_1px_2px_rgba(0,0,0,0.08)]'
                        : 'text-ink-faint hover:text-ink-dim'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              {themeId !== DEFAULT_THEME_ID && (
                <motion.button
                  whileTap={TAP_BUTTON}
                  type="button"
                  onClick={resetTheme}
                  className="rounded-lg border border-line bg-surface px-2.5 py-1 text-[11px] font-medium text-ink-dim transition-colors hover:border-line-strong hover:bg-surface-soft hover:text-ink"
                >
                  恢复默认
                </motion.button>
              )}
            </div>
          </div>

          <div
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3"
            role="radiogroup"
            aria-label="选择应用主题预设"
          >
            {visibleThemes.map((preset) => {
              const selected = preset.id === themeId
              return (
                <motion.button
                  key={preset.id}
                  whileTap={TAP_BUTTON}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setTheme(preset.id)}
                  className={`group flex flex-col gap-2.5 rounded-[12px] border p-3 text-left transition-all ${
                    selected
                      ? 'border-accent-strong bg-accent-soft/55 ring-1 ring-accent-line'
                      : 'border-line bg-surface/80 hover:border-line-strong hover:bg-surface'
                  }`}
                >
                  <ThemePreviewMini preset={preset} />

                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-[12.5px] font-semibold text-ink">
                        {preset.name}
                      </span>
                      <span className="rounded-[4px] border border-line bg-surface-soft px-1.5 py-px text-[9.5px] font-medium text-ink-faint">
                        {preset.tag}
                      </span>
                    </div>
                    <span
                      className={`grid size-[18px] flex-none place-items-center rounded-full border transition-colors ${
                        selected
                          ? 'border-accent-strong bg-accent-strong text-panel'
                          : 'border-line-strong bg-transparent text-transparent group-hover:border-accent-line'
                      }`}
                    >
                      <CheckIcon className="size-3" />
                    </span>
                  </div>

                  <p className="m-0 line-clamp-2 text-[11px] leading-[1.5] text-ink-faint">
                    {preset.description}
                  </p>

                  <div className="mt-auto flex items-center justify-between pt-0.5">
                    <div className="flex items-center gap-1.5" aria-hidden="true">
                      {[
                        preset.tokens['--color-canvas'],
                        preset.tokens['--color-accent-strong'],
                        preset.tokens['--color-mint'],
                        preset.tokens['--color-peach'],
                      ].map((swatch, index) => (
                        <span
                          key={`${preset.id}-swatch-${index}`}
                          className="size-3 rounded-full border border-line-strong/60"
                          style={{ backgroundColor: swatch }}
                        />
                      ))}
                    </div>
                    <span className="font-mono text-[9.5px] text-ink-faint">
                      {preset.mode === 'dark' ? 'DARK' : 'LIGHT'}
                    </span>
                  </div>
                </motion.button>
              )
            })}
          </div>
        </section>

        <section
          aria-labelledby="floating-ball-setting-title"
          className="flex flex-col gap-4 rounded-[14px] border border-line bg-panel/92 p-5 shadow-[0_8px_24px_rgba(0,0,0,0.06)]"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="mt-0.5 grid size-9 flex-none place-items-center rounded-[10px] border border-accent-line bg-accent-soft text-accent-strong">
                <BoltIcon className="size-[18px]" />
              </span>
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2
                    id="floating-ball-setting-title"
                    className="m-0 text-[14px] font-semibold text-ink"
                  >
                    论文公式悬浮球
                  </h2>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                      !desktop
                        ? 'border-line bg-surface text-ink-faint'
                        : floatingBallOpen
                          ? 'border-mint/45 bg-mint/14 text-[#2f6b4b]'
                          : 'border-line bg-surface text-ink-dim'
                    }`}
                  >
                    <span
                      className={`size-1.5 rounded-full ${
                        !desktop
                          ? 'bg-ink-faint/60'
                          : floatingBallOpen
                            ? 'bg-mint'
                            : 'bg-ink-faint/70'
                      }`}
                    />
                    {!desktop ? '仅桌面端可用' : floatingBallOpen ? '已打开' : '已关闭'}
                  </span>
                </div>
                <p className="m-0 text-[12px] leading-[1.6] text-ink-dim">
                  开启后会在桌面置顶显示悬浮球，阅读论文时单击即可把选中的公式发送到 AI
                  对话框，或右键展开框选公式截图。
                </p>
              </div>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={floatingBallOpen}
              aria-label={floatingBallOpen ? '关闭论文公式悬浮球' : '打开论文公式悬浮球'}
              disabled={toggling}
              onClick={() => void handleSetFloatingBall(!floatingBallOpen)}
              className={`relative mt-1 inline-flex h-[26px] w-[46px] flex-none items-center rounded-full border p-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong disabled:cursor-not-allowed disabled:opacity-55 ${
                floatingBallOpen
                  ? 'border-accent-strong bg-accent-strong'
                  : 'border-line-strong bg-surface-soft'
              }`}
            >
              <motion.span
                layout
                transition={SPRING_SNAPPY}
                className={`block size-5 rounded-full bg-[#fffdf8] shadow-[0_1px_3px_rgba(58,51,43,0.28)] ${
                  floatingBallOpen ? 'ml-auto' : 'mr-auto'
                }`}
              />
            </button>
          </div>

          <AnimatePresence>
            {feedback && (
              <motion.div
                key={`${feedback.tone}-${feedback.text}`}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={FAST_TRANSITION}
                role={feedback.tone === 'error' ? 'alert' : 'status'}
                className={`rounded-[10px] border px-3 py-2 text-[11.5px] leading-[1.55] ${
                  feedback.tone === 'success'
                    ? 'border-mint/40 bg-mint/12 text-[#2f6b4b]'
                    : feedback.tone === 'warning'
                      ? 'border-amber/40 bg-amber/12 text-[#82611f]'
                      : 'border-rose/40 bg-rose/12 text-[#a9605f]'
                }`}
              >
                {feedback.text}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="grid grid-cols-1 gap-2.5 border-t border-line pt-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2 rounded-[10px] border border-line bg-surface/75 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-medium text-ink">辅助功能权限</span>
                <span
                  className={`inline-flex items-center gap-1 text-[10.5px] ${
                    permissions.accessibility ? 'text-[#2f6b4b]' : 'text-ink-faint'
                  }`}
                >
                  <span
                    className={`size-1.5 rounded-full ${
                      permissions.accessibility ? 'bg-mint' : 'bg-amber'
                    }`}
                  />
                  {desktop ? (permissions.accessibility ? '已授权' : '未授权') : '需桌面端'}
                </span>
              </div>
              <p className="m-0 text-[11px] leading-[1.5] text-ink-faint">
                用于直接读取 PDF / 浏览器中选中的公式文本并加入对话框。
              </p>
              {desktop && (
                <div className="mt-auto flex items-center gap-1.5 pt-1">
                  {!permissions.accessibility && (
                    <motion.button
                      whileTap={TAP_BUTTON}
                      type="button"
                      onClick={() => void handleRequestPermission('accessibility')}
                      className="rounded-md border border-accent-line bg-accent-soft px-2 py-1 text-[10.5px] font-medium text-accent-strong transition-colors hover:bg-accent-soft/80"
                    >
                      请求授权
                    </motion.button>
                  )}
                  <motion.button
                    whileTap={TAP_BUTTON}
                    type="button"
                    onClick={() => void openPermissionSettings('accessibility')}
                    className="rounded-md border border-line bg-surface px-2 py-1 text-[10.5px] text-ink-dim transition-colors hover:border-line-strong hover:text-ink"
                  >
                    系统设置
                  </motion.button>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2 rounded-[10px] border border-line bg-surface/75 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-medium text-ink">屏幕录制权限</span>
                <span
                  className={`inline-flex items-center gap-1 text-[10.5px] ${
                    permissions.screenRecording ? 'text-[#2f6b4b]' : 'text-ink-faint'
                  }`}
                >
                  <span
                    className={`size-1.5 rounded-full ${
                      permissions.screenRecording ? 'bg-mint' : 'bg-ink-faint/70'
                    }`}
                  />
                  {desktop ? (permissions.screenRecording ? '已授权' : '未授权') : '需桌面端'}
                </span>
              </div>
              <p className="m-0 text-[11px] leading-[1.5] text-ink-faint">
                用于在论文页面上框选图片公式并自动送入多模态识别区。
              </p>
              {desktop && (
                <div className="mt-auto flex items-center gap-1.5 pt-1">
                  {!permissions.screenRecording && (
                    <motion.button
                      whileTap={TAP_BUTTON}
                      type="button"
                      onClick={() => void handleRequestPermission('screen_recording')}
                      className="rounded-md border border-accent-line bg-accent-soft px-2 py-1 text-[10.5px] font-medium text-accent-strong transition-colors hover:bg-accent-soft/80"
                    >
                      请求授权
                    </motion.button>
                  )}
                  <motion.button
                    whileTap={TAP_BUTTON}
                    type="button"
                    onClick={() => void openPermissionSettings('screen_recording')}
                    className="rounded-md border border-line bg-surface px-2 py-1 text-[10.5px] text-ink-dim transition-colors hover:border-line-strong hover:text-ink"
                  >
                    系统设置
                  </motion.button>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-[10px] border border-line/80 bg-surface-soft/75 px-3.5 py-2.5 text-[11px] leading-[1.6] text-ink-dim">
            <strong className="font-semibold text-ink">操作说明：</strong>
            单击悬浮球可直接把外部应用里选中的公式发送到对话框；拖动悬浮球可移动位置；右键或点击右下角「⋯」可展开菜单进行框选公式截图。
          </div>
        </section>
      </div>
    </motion.div>
  )
}
