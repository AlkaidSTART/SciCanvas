import { useEffect, useRef } from 'react'
import { MotionConfig } from 'motion/react'
import { CanvasStage } from './components/CanvasStage'
import { ControlBar } from './components/ControlBar'
import { InspectorPanel } from './components/InspectorPanel'
import { ModelConfigPage } from './components/ModelConfigPage'
import { SettingsPage } from './components/SettingsPage'
import { SidePanel } from './components/SidePanel'
import { TopBar } from './components/TopBar'
import { useAISandbox } from './hooks/useAISandbox'
import { useAppRoute } from './hooks/useAppRoute'
import { useAutoHeal } from './hooks/useAutoHeal'
import { useExperimentRuntime } from './hooks/useExperimentRuntime'
import { useFloatingBallListener } from './hooks/useFloatingBallListener'
import { useWorkspaceAutoSave } from './hooks/useWorkspaceAutoSave'
import { useModelConfigStore } from './store/useModelConfigStore'
import { useWorkbenchStore } from './store/useWorkbenchStore'
import { useWorkspaceStore } from './store/useWorkspaceStore'
import { useSessionStore } from './store/useSessionStore'

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const source = useWorkbenchStore((state) => state.source)
  const aiSpec = useWorkbenchStore((state) => state.aiSpec)
  const presentation = useWorkbenchStore((state) => state.presentation)
  const leftPanelOpen = useWorkbenchStore((state) => state.leftPanelOpen)
  const rightPanelOpen = useWorkbenchStore((state) => state.rightPanelOpen)
  const exitPresentation = useWorkbenchStore((state) => state.exitPresentation)
  const toggleLeftPanel = useWorkbenchStore((state) => state.toggleLeftPanel)
  const toggleRightPanel = useWorkbenchStore((state) => state.toggleRightPanel)
  const hydrateWorkspace = useWorkspaceStore((state) => state.hydrate)
  const loadSessions = useSessionStore((state) => state.loadSessions)
  const loadModelEndpoints = useModelConfigStore((state) => state.loadEndpoints)
  const runtime = useExperimentRuntime(canvasRef)
  const aiSandbox = useAISandbox(iframeRef)
  const usesSandbox = source === 'ai' && aiSpec?.renderType === 'canvas2d'
  const { route, navigate } = useAppRoute()
  const isSettings = route === 'settings'
  const isModels = route === 'models'
  const isSubPage = isSettings || isModels
  useAutoHeal()
  useWorkspaceAutoSave()
  useFloatingBallListener()

  const activeControls = usesSandbox ? aiSandbox : runtime

  useEffect(() => {
    void hydrateWorkspace()
    void loadSessions()
    void loadModelEndpoints()
  }, [hydrateWorkspace, loadSessions, loadModelEndpoints])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && presentation) {
        exitPresentation()
        return
      }

      if (event.key === 'Escape' && isSubPage) {
        navigate('workbench')
        return
      }

      if (isSubPage) return

      if (document.querySelector('[role="dialog"]')) return

      const mod = event.metaKey || event.ctrlKey
      if (mod && !event.altKey && !presentation) {
        const lower = event.key.toLowerCase()
        if (lower === 'b') {
          event.preventDefault()
          toggleLeftPanel()
          return
        }
        if (lower === 'i') {
          event.preventDefault()
          toggleRightPanel()
          return
        }
      }

      if (mod || event.altKey || isEditableTarget(event.target)) return

      if (event.code === 'Space' && !(event.target instanceof HTMLButtonElement)) {
        event.preventDefault()
        activeControls.toggle()
        return
      }

      if (event.key === 'r' || event.key === 'R') {
        event.preventDefault()
        activeControls.reset()
        return
      }

      if (event.key === '.') {
        event.preventDefault()
        activeControls.step()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [presentation, isSubPage, navigate, exitPresentation, toggleLeftPanel, toggleRightPanel, activeControls])

  const workspaceGridClass = presentation
    ? 'grid min-h-0 flex-1 grid-cols-1'
    : isSubPage
      ? leftPanelOpen
        ? 'grid min-h-0 flex-1 max-[959px]:grid-cols-1 max-[959px]:grid-rows-[auto_minmax(0,1fr)] min-[960px]:grid-cols-[248px_minmax(0,1fr)] min-[1280px]:grid-cols-[264px_minmax(0,1fr)]'
        : 'grid min-h-0 flex-1 grid-cols-1'
      : leftPanelOpen && rightPanelOpen
        ? 'grid min-h-0 flex-1 max-[959px]:grid-cols-1 max-[959px]:grid-rows-[auto_minmax(0,1fr)] min-[960px]:grid-cols-[248px_minmax(0,1fr)_276px] min-[1280px]:grid-cols-[264px_minmax(0,1fr)_296px]'
        : leftPanelOpen
          ? 'grid min-h-0 flex-1 max-[959px]:grid-cols-1 max-[959px]:grid-rows-[auto_minmax(0,1fr)] min-[960px]:grid-cols-[248px_minmax(0,1fr)] min-[1280px]:grid-cols-[264px_minmax(0,1fr)]'
          : rightPanelOpen
            ? 'grid min-h-0 flex-1 max-[959px]:grid-cols-1 max-[959px]:grid-rows-[auto_minmax(0,1fr)] min-[960px]:grid-cols-[minmax(0,1fr)_276px] min-[1280px]:grid-cols-[minmax(0,1fr)_296px]'
            : 'grid min-h-0 flex-1 max-[959px]:grid-cols-1 max-[959px]:grid-rows-[auto_minmax(0,1fr)] min-[960px]:grid-cols-1'

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex h-svh w-full flex-col overflow-hidden bg-canvas bg-[radial-gradient(900px_520px_at_82%_-10%,rgba(168,190,214,0.38),transparent_62%),radial-gradient(680px_460px_at_6%_106%,rgba(224,162,121,0.26),transparent_60%)]">
        <TopBar route={route} onNavigate={navigate} />
        <div className={workspaceGridClass}>
          <SidePanel route={route} onNavigate={navigate} />
          {isSettings && <SettingsPage onBack={() => navigate('workbench')} />}
          {isModels && <ModelConfigPage onBack={() => navigate('workbench')} />}
          <main
            className={isSubPage ? 'hidden' : 'flex min-h-0 min-w-0 flex-col overflow-hidden'}
            aria-hidden={isSubPage || undefined}
          >
            <CanvasStage
              canvasRef={canvasRef}
              iframeRef={iframeRef}
              onRetry={activeControls.retry}
            />
            <ControlBar
              onTogglePlay={activeControls.toggle}
              onStep={activeControls.step}
              onReset={activeControls.reset}
            />
          </main>
          {!isSubPage && <InspectorPanel />}
        </div>
      </div>
    </MotionConfig>
  )
}

export default App
