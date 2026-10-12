/** The studio's few glyphs, drawn in `currentColor` unless they carry the brass themselves. */

/** The Guildhall mark: a gabled hall with an arched door, in brass on a dark tile. */
export function Mark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="0.5" y="0.5" width="23" height="23" rx="5" fill="#241c14" stroke="rgba(220,182,98,0.45)" />
      <path
        d="M4.5 11.2 12 5l7.5 6.2"
        fill="none"
        stroke="#f1d590"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M6.6 10v8.6h10.8V10" fill="rgba(220,182,98,0.16)" stroke="#dcb662" strokeWidth="1.4" />
      <path d="M10.3 18.6v-3a1.7 1.7 0 0 1 3.4 0v3" fill="#15110d" stroke="#dcb662" strokeWidth="1.2" />
      <path d="M4 18.6h16" stroke="#dcb662" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

export function SearchIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="m10.5 10.5 3.6 3.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

export function Arrow({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      <path
        d="M2 6h7.5M6.5 2.8 9.7 6l-3.2 3.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** "⌘" on a Mac, "Ctrl" elsewhere: the quick switcher's modifier as the keyboard labels it. */
export const MOD_KEY = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? "") ? "⌘" : "Ctrl"
