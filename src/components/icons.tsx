interface IconProps {
  className?: string
}

export function BoltIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" fill="currentColor" />
      <ellipse
        cx="12"
        cy="12"
        rx="9.4"
        ry="4.4"
        stroke="currentColor"
        strokeWidth="1.3"
        opacity="0.75"
        transform="rotate(-28 12 12)"
      />
      <ellipse
        cx="12"
        cy="12"
        rx="9.4"
        ry="4.4"
        stroke="currentColor"
        strokeWidth="1.3"
        opacity="0.4"
        transform="rotate(42 12 12)"
      />
    </svg>
  )
}

export function PlayIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4.6 2.7v10.6L13 8 4.6 2.7Z" fill="currentColor" />
    </svg>
  )
}

export function PauseIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="3.6" y="2.8" width="3.1" height="10.4" rx="1" fill="currentColor" />
      <rect x="9.3" y="2.8" width="3.1" height="10.4" rx="1" fill="currentColor" />
    </svg>
  )
}

export function StepIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3.4 3.1v9.8L10.4 8 3.4 3.1Z" fill="currentColor" />
      <rect x="11.2" y="3.1" width="1.7" height="9.8" rx="0.8" fill="currentColor" />
    </svg>
  )
}

export function ResetIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3.3 7.2a5 5 0 1 1 .5 3.1"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path d="M3.1 3.5v4h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function AlertIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 4.2 21 20H3L12 4.2Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M12 9.6v4.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="17.2" r="1" fill="currentColor" />
    </svg>
  )
}

export function PanelLeftIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.8" y="2.5" width="12.4" height="11" rx="2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5.6 2.8v10.4" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

export function PanelRightIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.8" y="2.5" width="12.4" height="11" rx="2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M10.4 2.8v10.4" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}
