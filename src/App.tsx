import { useRef } from 'react'
import { CanvasStage } from './components/CanvasStage'
import { ControlBar } from './components/ControlBar'
import { SidePanel } from './components/SidePanel'
import { TopBar } from './components/TopBar'
import { useAISandbox } from './hooks/useAISandbox'
import { useAutoHeal } from './hooks/useAutoHeal'
import { useExperimentRuntime } from './hooks/useExperimentRuntime'
import { useWorkbenchStore } from './store/useWorkbenchStore'

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const source = useWorkbenchStore((state) => state.source)
  const runtime = useExperimentRuntime(canvasRef)
  const aiSandbox = useAISandbox(iframeRef)
  const isAi = source === 'ai'
  useAutoHeal()

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-canvas bg-[radial-gradient(900px_520px_at_82%_-10%,rgba(168,190,214,0.38),transparent_62%),radial-gradient(680px_460px_at_6%_106%,rgba(224,162,121,0.26),transparent_60%)]">
      <TopBar />
      <div className="grid min-h-0 flex-1 grid-cols-[264px_minmax(0,1fr)] max-[980px]:grid-cols-1 max-[980px]:grid-rows-[auto_minmax(0,1fr)]">
        <SidePanel />
        <main className="flex min-h-0 min-w-0 flex-col">
          <CanvasStage
            canvasRef={canvasRef}
            iframeRef={iframeRef}
            onRetry={isAi ? aiSandbox.retry : runtime.retry}
          />
          <ControlBar
            onTogglePlay={isAi ? aiSandbox.toggle : runtime.toggle}
            onStep={isAi ? aiSandbox.step : runtime.step}
            onReset={isAi ? aiSandbox.reset : runtime.reset}
          />
        </main>
      </div>
    </div>
  )
}

export default App
