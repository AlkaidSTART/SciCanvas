import { useEffect } from 'react'
import {
  isDesktopApp,
  isFloatingBallOpen,
  listenFloatingBallVisibility,
  listenFormulaCaptured,
} from '../floatingBall/bridge'
import { useFloatingBallStore } from '../store/useFloatingBallStore'
import { useWorkbenchStore } from '../store/useWorkbenchStore'

/**
 * 在主窗口监听悬浮球发来的论文公式（选中文本或框选截图）与悬浮球开关状态。
 */
export function useFloatingBallListener() {
  useEffect(() => {
    if (!isDesktopApp()) return undefined

    let disposed = false
    let unlistenFormula: (() => void) | null = null
    let unlistenVisibility: (() => void) | null = null

    void isFloatingBallOpen()
      .then((open) => {
        if (!disposed) useFloatingBallStore.getState().setFloatingBallOpen(open)
      })
      .catch(() => {})

    void listenFormulaCaptured((payload) => {
      if (disposed) return
      const store = useFloatingBallStore.getState()
      const workbench = useWorkbenchStore.getState()
      if (workbench.presentation) {
        workbench.exitPresentation()
      }
      if ('leftPanelOpen' in workbench && !workbench.leftPanelOpen && 'toggleLeftPanel' in workbench) {
        ;(workbench as { toggleLeftPanel: () => void }).toggleLeftPanel()
      }

      if (payload.kind === 'text' && payload.content) {
        const { appended, truncated } = store.appendCapturedFormula(payload.content)
        if (appended) {
          const sourceHint =
            payload.source === 'clipboard' ? '（剪贴板已无损恢复）' : ''
          store.pushNotice(
            'success',
            truncated
              ? `已将选中的公式加入对话框${sourceHint}（超出字数上限的部分已截断）。`
              : `已将选中的公式加入对话框${sourceHint}。`,
          )
        }
      } else if (payload.kind === 'image' && payload.dataUrl) {
        store.setPendingImage({
          dataUrl: payload.dataUrl,
          name: payload.name || '悬浮球框选公式.png',
        })
        store.pushNotice('success', '已将框选的公式截图载入论文截图识别区。')
      }
    }).then((unlisten) => {
      if (disposed) {
        unlisten()
      } else {
        unlistenFormula = unlisten
      }
    })

    void listenFloatingBallVisibility((visible) => {
      if (!disposed) useFloatingBallStore.getState().setFloatingBallOpen(visible)
    }).then((unlisten) => {
      if (disposed) {
        unlisten()
      } else {
        unlistenVisibility = unlisten
      }
    })

    return () => {
      disposed = true
      unlistenFormula?.()
      unlistenVisibility?.()
    }
  }, [])
}
