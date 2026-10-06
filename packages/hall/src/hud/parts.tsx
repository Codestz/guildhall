import { type CSSProperties, type ReactNode, useId } from "react"
import { initials, type Tone } from "./format.ts"
import { Icon } from "./icons.tsx"

/** A role's mark: a diamond in its colour with two letters. The colour is identity, never status. */
export function Sigil({
  title,
  color,
  size = "md",
}: {
  title: string
  color: string
  size?: "sm" | "md" | "lg"
}) {
  return (
    <span className={`sigil sigil-${size}`} style={{ "--role": color } as CSSProperties} aria-hidden="true">
      <span>{initials(title)}</span>
    </span>
  )
}

/** Status as glyph + word. */
export function Status({ tone, label }: { tone: Tone; label: string }) {
  const Glyph = Icon[tone === "quest" ? "quest" : tone]
  return (
    <span className={`status tone-${tone}`}>
      <Glyph />
      {label}
    </span>
  )
}

/**
 * A framed plaque with a title bar that folds it away. `open` is owned by the caller so the HUD can
 * remember it; the body stays mounted only while open.
 */
export function Panel({
  label,
  meta,
  open,
  onToggle,
  className = "",
  compact = false,
  children,
}: {
  label: string
  meta?: ReactNode
  open: boolean
  onToggle: () => void
  className?: string
  /** Collapsing swaps the panel for a compact form elsewhere, rather than folding it shut. */
  compact?: boolean
  children: ReactNode
}) {
  const id = useId()
  return (
    <section className={`plaque panel ${className}`} data-open={open} aria-labelledby={`${id}-h`}>
      <h2 className="panel-head" id={`${id}-h`}>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-b`}
          onClick={onToggle}
          title={compact ? "Collapse" : undefined}
        >
          <span className="panel-label">{label}</span>
          {meta && <span className="panel-meta">{meta}</span>}
          <span className="fold" data-compact={compact}>
            {compact ? <Icon.collapse /> : <Icon.chevron />}
          </span>
        </button>
      </h2>
      <div className="panel-body" id={`${id}-b`} hidden={!open}>
        {children}
      </div>
    </section>
  )
}
