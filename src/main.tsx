import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { FloatingBallApp } from './components/FloatingBallApp.tsx'
import { initTheme } from './store/useThemeStore.ts'

initTheme()

const isFloatingBallWindow =
  new URLSearchParams(window.location.search).get('window') === 'floating-ball'

if (isFloatingBallWindow) {
  document.documentElement.classList.add('floating-ball-window')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isFloatingBallWindow ? <FloatingBallApp /> : <App />}</StrictMode>,
)
