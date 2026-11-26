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

export function SettingsIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M8 2.1v1.4M8 12.5v1.4M2.1 8h1.4M12.5 8h1.4M3.8 3.8l1 1M11.2 11.2l1 1M12.2 3.8l-1 1M4.8 11.2l-1 1"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function ModelIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="4.2" y="4.2" width="7.6" height="7.6" rx="1.8" stroke="currentColor" strokeWidth="1.3" />
      <rect x="6.5" y="6.5" width="3" height="3" rx="0.6" fill="currentColor" />
      <path
        d="M6.2 2v2.2M9.8 2v2.2M6.2 11.8V14M9.8 11.8V14M2 6.2h2.2M2 9.8h2.2M11.8 6.2H14M11.8 9.8H14"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function WorkspaceIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="2.4" width="5.2" height="4.8" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
      <rect x="8.8" y="2.4" width="5.2" height="4.8" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
      <rect x="2" y="8.8" width="12" height="4.8" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

export function PlusIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 3.2v9.6M3.2 8h9.6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function CloseIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function DuplicateIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="5.2" y="5.2" width="8.2" height="8.2" rx="1.6" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M10.8 5.2V3.8A1.4 1.4 0 0 0 9.4 2.4H3.8A1.4 1.4 0 0 0 2.4 3.8v5.6a1.4 1.4 0 0 0 1.4 1.4h1.4"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  )
}
