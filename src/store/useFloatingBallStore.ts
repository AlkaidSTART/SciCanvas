import { create } from 'zustand'
import { MAX_PROMPT_LENGTH } from '../ai/prompt'
import { formatCapturedFormulaAppend } from '../floatingBall/bridge'

export interface PendingCapturedImage {
  dataUrl: string
  name: string
}

export interface CaptureNotice {
  id: number
  tone: 'success' | 'info' | 'error'
  message: string
}

interface FloatingBallState {
  promptDraft: string
  promptFlashKey: number
  pendingImage: PendingCapturedImage | null
  floatingBallOpen: boolean
  notice: CaptureNotice | null
  setPromptDraft: (value: string) => void
  appendCapturedFormula: (formula: string) => { appended: boolean; truncated: boolean }
  setPendingImage: (image: PendingCapturedImage | null) => void
  setFloatingBallOpen: (open: boolean) => void
  pushNotice: (tone: CaptureNotice['tone'], message: string) => void
  clearNotice: () => void
}

let noticeCounter = 0

export const useFloatingBallStore = create<FloatingBallState>()((set, get) => ({
  promptDraft: '',
  promptFlashKey: 0,
  pendingImage: null,
  floatingBallOpen: false,
  notice: null,

  setPromptDraft: (value) => set({ promptDraft: value }),

  appendCapturedFormula: (formula) => {
    const { promptDraft, promptFlashKey } = get()
    const result = formatCapturedFormulaAppend(promptDraft, formula, MAX_PROMPT_LENGTH)
    if (result.appended) {
      set({
        promptDraft: result.nextPrompt,
        promptFlashKey: promptFlashKey + 1,
      })
    }
    return { appended: result.appended, truncated: result.truncated }
  },

  setPendingImage: (image) => set({ pendingImage: image }),

  setFloatingBallOpen: (open) => set({ floatingBallOpen: open }),

  pushNotice: (tone, message) => {
    noticeCounter += 1
    set({ notice: { id: noticeCounter, tone, message } })
  },

  clearNotice: () => set({ notice: null }),
}))
