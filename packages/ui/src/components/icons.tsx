/** The UI's glyphs: 16-unit line icons in `currentColor`, decorative unless a caller labels the control. */
import type { ReactNode } from "react"

function Icon({ size = 16, children }: { size?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export const PlayIcon = ({ size = 14 }: { size?: number }) => (
  <Icon size={size}>
    <path d="M5 3.2v9.6L12.6 8z" fill="currentColor" stroke="none" />
  </Icon>
)
export const PauseIcon = ({ size = 14 }: { size?: number }) => (
  <Icon size={size}>
    <path d="M5 3.5v9M11 3.5v9" strokeWidth="2.4" />
  </Icon>
)
/** A camera: the screenshot button. */
export const CameraIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M2.5 5.5h2.2l1.2-1.8h4.2l1.2 1.8h2.2v7h-11z" />
    <circle cx="8" cy="9" r="2.2" />
  </Icon>
)
/** Three sliders: the inspector toggle. */
export const SlidersIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M3 4h10M3 8h10M3 12h10" opacity="0.55" />
    <circle cx="6" cy="4" r="1.5" fill="currentColor" />
    <circle cx="10.5" cy="8" r="1.5" fill="currentColor" />
    <circle cx="5" cy="12" r="1.5" fill="currentColor" />
  </Icon>
)
export const CloseIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="m4 4 8 8M12 4l-8 8" />
  </Icon>
)
export const ChevronIcon = ({ size = 12 }: { size?: number }) => (
  <Icon size={size}>
    <path d="m4 6 4 4 4-4" />
  </Icon>
)
/** A keyboard: the camera help. */
export const KeysIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <rect x="1.8" y="4" width="12.4" height="8" rx="1.5" />
    <path d="M4.5 6.6h.01M7 6.6h.01M9.5 6.6h.01M12 6.6h.01M5.5 9.4h5" />
  </Icon>
)
export const ResetIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M3.2 8a4.8 4.8 0 1 0 1.5-3.5" />
    <path d="M3 2.8v2.6h2.6" />
  </Icon>
)
/** Guildhall's crest: a gabled hall with an arched door. */
export const CrestIcon = ({ size = 28 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M4.5 11.2 12 5l7.5 6.2" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M6.6 10v8.6h10.8V10" stroke="currentColor" strokeWidth="1.4" fill="rgba(220,182,98,0.16)" />
    <path d="M10.3 18.6v-3a1.7 1.7 0 0 1 3.4 0v3" stroke="currentColor" strokeWidth="1.2" />
    <path d="M4 18.6h16" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
)
