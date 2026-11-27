import { useEffect } from 'react'
import { motion } from 'motion/react'
import type { AppRoute } from '../hooks/useAppRoute'
import { useFloatingBallStore } from '../store/useFloatingBallStore'
import { useModelConfigStore } from '../store/useModelConfigStore'
import { useWorkbenchStore } from '../store/useWorkbenchStore'
import { ModelIcon, PlusIcon, SettingsIcon } from './icons'
import { TAP_BUTTON } from './motion'
import { WorkspaceSidebarTree } from './WorkspaceSidebarTree'

interface SidePanelProps {
  route: AppRoute
  onNavigate: (route: AppRoute) => void
}

export function SidePanel({ route, onNavigate }: SidePanelProps) {
  const isSettings = route === 'settings'
  const isModels = route === 'models'
  const isSubPage = isSettings || isModels

  const activeModelEndpoint = useModelConfigStore(
    (state) => state.endpoints.find((item) => item.isActive) ?? null,
  )
  const presentation = useWorkbenchStore((state) => state.presentation)
  const leftPanelOpen = useWorkbenchStore((state) => state.leftPanelOpen)
  const viewMode = useWorkbenchStore((state) => state.viewMode)
  const composerTarget = useWorkbenchStore((state) => state.composerTarget)
  const openComposer = useWorkbenchStore((state) => state.openComposer)

  // 悬浮球推送公式文本或截图时，自动切回公式新建页并聚焦输入框。
  useEffect(() => {
    const unsubscribe = useFloatingBallStore.subscribe((state, prevState) => {
      const promptFlashed = state.promptFlashKey !== prevState.promptFlashKey
      const imageArrived = Boolean(state.pendingImage && state.pendingImage !== prevState.pendingImage)
      if (!promptFlashed && !imageArrived) return

      const current = useWorkbenchStore.getState()
      if (current.viewMode !== 'composer') {
        current.openComposer()
      }
      onNavigate('workbench')
    })
    return unsubscribe
  }, [onNavigate])

  const isStandaloneComposerActive =
    !isSubPage && viewMode === 'composer' && composerTarget.groupId === null

  return (
    <aside
      className={`preset-scroll ${
        presentation
          ? 'hidden'
          : leftPanelOpen
            ? 'flex'
            : 'flex min-[960px]:hidden'
      } min-h-0 flex-col overflow-hidden border-r border-line bg-[linear-gradient(180deg,#fcf9f2,#f7f1e7)] max-[959px]:flex-row max-[959px]:items-stretch max-[959px]:gap-3.5 max-[959px]:overflow-x-auto max-[959px]:overflow-y-hidden max-[959px]:border-b max-[959px]:border-r-0 max-[959px]:px-3 max-[959px]:py-2.5`}
      aria-hidden={presentation || undefined}
      aria-label="实验导航栏"
    >
      {/* 顶部新建实验按钮（仿照第二张图的「+ 新建会话」入口） */}
      <div className="flex flex-none items-center px-2.5 pb-1 pt-2.5 max-[959px]:p-0">
        <motion.button
          whileTap={TAP_BUTTON}
          type="button"
          onClick={() => {
            openComposer()
            if (isSubPage) onNavigate('workbench')
          }}
          className={`flex w-full items-center gap-2 rounded-[10px] border px-3 py-2 text-[12.5px] font-medium transition-[background-color,border-color,color,box-shadow] duration-150 max-[959px]:w-auto max-[959px]:whitespace-nowrap ${
            isStandaloneComposerActive
              ? 'border-accent-line bg-surface text-ink shadow-[0_2px_6px_rgba(58,51,43,0.07)]'
              : 'border-line bg-surface/85 text-ink-dim shadow-[0_1px_2px_rgba(58,51,43,0.04)] hover:border-line-strong hover:bg-surface hover:text-ink'
          }`}
          title="输入公式生成新的 Canvas 绘图并自动新建文件夹归档"
        >
          <PlusIcon className="size-3.5 flex-none text-ink-dim" />
          <span>新建实验</span>
        </motion.button>
      </div>

      {/* 实验文件夹与绘图窗口列表 */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden max-[959px]:hidden">
        <WorkspaceSidebarTree
          onSelectWindow={() => {
            if (isSubPage) onNavigate('workbench')
          }}
        />
      </div>

      {/* 底部模型配置与设置入口 */}
      <div className="flex flex-none flex-col gap-1 border-t border-line px-2 py-2 max-[959px]:flex-row max-[959px]:items-center max-[959px]:border-l max-[959px]:border-t-0 max-[959px]:py-0 max-[959px]:pl-2.5">
        <motion.button
          whileTap={TAP_BUTTON}
          type="button"
          onClick={() => onNavigate(isModels ? 'workbench' : 'models')}
          aria-current={isModels ? 'page' : undefined}
          title={isModels ? '返回工作台' : '打开大模型配置 (/models)'}
          className={`flex w-full items-center justify-between gap-2 rounded-[8px] border px-2.5 py-1.5 text-[11.5px] font-medium transition-colors duration-150 max-[959px]:w-auto max-[959px]:whitespace-nowrap ${
            isModels
              ? 'border-accent-line bg-accent-soft text-accent-strong shadow-[0_1px_2px_rgba(58,51,43,0.05)]'
              : 'border-transparent bg-transparent text-ink-dim hover:bg-surface-soft hover:text-ink'
          }`}
        >
          <span className="flex items-center gap-2">
            <ModelIcon className="size-3.5 flex-none" />
            <span>模型配置</span>
          </span>
          <span className="flex items-center gap-1.5">
            {activeModelEndpoint && activeModelEndpoint.apiKey.trim().length > 0 && (
              <span
                className="size-1.5 rounded-full bg-mint shadow-[0_0_0_2px_rgba(127,175,148,0.28)]"
                title={`当前模型：${activeModelEndpoint.name}`}
              />
            )}
            <span className="hidden font-mono text-[9px] text-ink-faint min-[960px]:inline">
              /models
            </span>
          </span>
        </motion.button>
        <motion.button
          whileTap={TAP_BUTTON}
          type="button"
          onClick={() => onNavigate(isSettings ? 'workbench' : 'settings')}
          aria-current={isSettings ? 'page' : undefined}
          title={isSettings ? '返回工作台' : '打开设置 (/settings)'}
          className={`flex w-full items-center justify-between gap-2 rounded-[8px] border px-2.5 py-1.5 text-[11.5px] font-medium transition-colors duration-150 max-[959px]:w-auto max-[959px]:whitespace-nowrap ${
            isSettings
              ? 'border-accent-line bg-accent-soft text-accent-strong shadow-[0_1px_2px_rgba(58,51,43,0.05)]'
              : 'border-transparent bg-transparent text-ink-dim hover:bg-surface-soft hover:text-ink'
          }`}
        >
          <span className="flex items-center gap-2">
            <SettingsIcon className="size-3.5 flex-none" />
            <span>设置</span>
          </span>
          <span className="hidden font-mono text-[9px] text-ink-faint min-[960px]:inline">
            /settings
          </span>
        </motion.button>
      </div>
    </aside>
  )
}
