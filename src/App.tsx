import { useCallback, useRef, useState } from 'react'
import './App.css'
import { CanvasStage } from './components/CanvasStage'
import { ControlBar } from './components/ControlBar'
import { SidePanel } from './components/SidePanel'
import { TopBar } from './components/TopBar'
import { DEFAULT_EXPERIMENT } from './experiments'
import { useExperimentRuntime } from './hooks/useExperimentRuntime'
import { createDefaultParams, sanitizeParams } from './runtime/params'
import type { ControlValue, ParamValues } from './types/experiment'

function App() {
  const experiment = DEFAULT_EXPERIMENT
  const [params, setParams] = useState<ParamValues>(() => createDefaultParams(experiment))
  const [speed, setSpeed] = useState(1)
  const [reloadKey, setReloadKey] = useState(0)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const runtime = useExperimentRuntime({
    canvasRef,
    experiment,
    params,
    speed,
    reloadKey,
  })

  const handleParamChange = useCallback(
    (key: string, value: ControlValue) => {
      setParams((previous) => sanitizeParams(experiment, { ...previous, [key]: value }))
    },
    [experiment],
  )

  const handleResetToDefault = useCallback(() => {
    setParams(createDefaultParams(experiment))
    setSpeed(1)
    setReloadKey((key) => key + 1)
  }, [experiment])

  return (
    <div className="app-shell">
      <TopBar title={experiment.title} />
      <div className="workbench">
        <SidePanel experiment={experiment} status={runtime.status} />
        <main className="main-column">
          <CanvasStage
            experiment={experiment}
            canvasRef={canvasRef}
            status={runtime.status}
            error={runtime.error}
            onRetry={runtime.retry}
            onResetToDefault={handleResetToDefault}
          />
          <ControlBar
            experiment={experiment}
            params={params}
            status={runtime.status}
            speed={speed}
            disabled={runtime.status === 'error'}
            onTogglePlay={runtime.toggle}
            onStep={runtime.step}
            onReset={runtime.reset}
            onSpeedChange={setSpeed}
            onParamChange={handleParamChange}
          />
        </main>
      </div>
    </div>
  )
}

export default App
