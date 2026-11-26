import type { Transition, Variants } from 'motion/react'

/** 利落的阻尼弹簧：适用于分段标签、开关、按钮等高频微交互 */
export const SPRING_SNAPPY: Transition = {
  type: 'spring',
  stiffness: 480,
  damping: 36,
  mass: 0.75,
}

/** 温润的阻尼弹簧：适用于面板、弹窗、提示条、浮层卡片 */
export const SPRING_GENTLE: Transition = {
  type: 'spring',
  stiffness: 340,
  damping: 32,
  mass: 0.9,
}

/** 平滑减速曲线：适用于淡入淡出与轻位移 */
export const EASE_OUT_QUART: [number, number, number, number] = [0.22, 1, 0.36, 1]

export const FAST_TRANSITION: Transition = {
  duration: 0.18,
  ease: EASE_OUT_QUART,
}

export const MEDIUM_TRANSITION: Transition = {
  duration: 0.24,
  ease: EASE_OUT_QUART,
}

/** 按钮按压缩放反馈 */
export const TAP_BUTTON = { scale: 0.97 }
export const TAP_ICON = { scale: 0.92 }

export const BACKDROP_VARIANTS: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.18, ease: 'easeOut' } },
  exit: { opacity: 0, transition: { duration: 0.15, ease: 'easeIn' } },
}

export const DIALOG_VARIANTS: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: 12 },
  visible: { opacity: 1, scale: 1, y: 0, transition: SPRING_GENTLE },
  exit: { opacity: 0, scale: 0.97, y: 8, transition: { duration: 0.15, ease: 'easeIn' } },
}

export const TOAST_VARIANTS: Variants = {
  hidden: { opacity: 0, y: -10, scale: 0.96 },
  visible: { opacity: 1, y: 0, scale: 1, transition: SPRING_GENTLE },
  exit: { opacity: 0, y: -8, scale: 0.96, transition: { duration: 0.15, ease: 'easeIn' } },
}

export const FLOAT_UP_VARIANTS: Variants = {
  hidden: { opacity: 0, y: 12, scale: 0.98 },
  visible: { opacity: 1, y: 0, scale: 1, transition: SPRING_GENTLE },
  exit: { opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.15, ease: 'easeIn' } },
}

export const COLLAPSE_VARIANTS: Variants = {
  hidden: { opacity: 0, height: 0, overflow: 'hidden' },
  visible: {
    opacity: 1,
    height: 'auto',
    overflow: 'hidden',
    transition: {
      height: { duration: 0.22, ease: EASE_OUT_QUART },
      opacity: { duration: 0.18, delay: 0.04 },
    },
  },
  exit: {
    opacity: 0,
    height: 0,
    overflow: 'hidden',
    transition: {
      height: { duration: 0.18, ease: EASE_OUT_QUART },
      opacity: { duration: 0.12 },
    },
  },
}
