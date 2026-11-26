import { beforeEach, describe, expect, it } from 'vitest'
import { useFloatingBallStore } from './useFloatingBallStore'

describe('useFloatingBallStore', () => {
  beforeEach(() => {
    useFloatingBallStore.setState({
      promptDraft: '',
      promptFlashKey: 0,
      pendingImage: null,
      floatingBallOpen: false,
      notice: null,
    })
  })

  it('appends captured formulas into promptDraft and increments flash key', () => {
    const first = useFloatingBallStore.getState().appendCapturedFormula('F = ma')
    expect(first).toEqual({ appended: true, truncated: false })
    expect(useFloatingBallStore.getState().promptDraft).toBe('F = ma')
    expect(useFloatingBallStore.getState().promptFlashKey).toBe(1)

    const second = useFloatingBallStore.getState().appendCapturedFormula('\\nabla \\cdot E = \\rho / \\varepsilon_0')
    expect(second).toEqual({ appended: true, truncated: false })
    expect(useFloatingBallStore.getState().promptDraft).toBe(
      'F = ma\n\\nabla \\cdot E = \\rho / \\varepsilon_0',
    )
    expect(useFloatingBallStore.getState().promptFlashKey).toBe(2)
  })

  it('stores and clears pending captured images and notices', () => {
    useFloatingBallStore.getState().setPendingImage({
      dataUrl: 'data:image/png;base64,abc',
      name: '悬浮球框选公式.png',
    })
    expect(useFloatingBallStore.getState().pendingImage?.name).toBe('悬浮球框选公式.png')

    useFloatingBallStore.getState().pushNotice('success', '已加入对话框')
    expect(useFloatingBallStore.getState().notice?.message).toBe('已加入对话框')

    useFloatingBallStore.getState().clearNotice()
    expect(useFloatingBallStore.getState().notice).toBeNull()
  })
})
