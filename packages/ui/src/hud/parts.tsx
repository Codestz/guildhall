/** The HUD's shared pieces: a hero's sigil, a status, the folding panel, the banner and family chips. */
import { type CSSProperties, type ReactNode, useId } from "react"
import { roman } from "../components/controls.tsx"
import { FAMILY_LABEL, type PhaseTone } from "./format.ts"
import { FAMILY_GLYPH, Glyphs } from "./glyphs.tsx"
import type { Family } from "./types.ts"

/**
 * A hero's mark: a diamond in their banner colour (identity, never status) with their family's glyph
 * in ink. The second and later of a name carry a small numeral (II, III) so two Wardens read apart.
 */
export function Sigil({
  family,
  banner,
  ordinal = 1,
  size = "md",
}: {
  family: Family
  banner: string
  ordinal?: number
  size?: "sm" | "md" | "lg"
}) {
  const Mark = FAMILY_GLYPH[family]
  return (
    <span
      className="hud-sigil"
      data-size={size}
      data-family={family}
      style={{ "--banner": banner } as CSSProperties}
      aria-hidden="true"
    >
      {size !== "sm" && <Mark size={size === "lg" ? 20 : 14} />}
      {ordinal > 1 && <i className="hud-sigil-num">{roman(ordinal)}</i>}
    </span>
  )
}

const TONE_GLYPH: Record<PhaseTone, (p: { size?: number }) => ReactNode> = {
  work: Glyphs.work,
  plea: Glyphs.plea,
  loot: Glyphs.loot,
  idle: Glyphs.idle,
  fail: Glyphs.fail,
}

/** Status as glyph + word. */
export function Status({ tone, label }: { tone: PhaseTone; label: string }) {
  const Glyph = TONE_GLYPH[tone]
  return (
    <span className="hud-status" data-tone={tone}>
      <Glyph size={14} />
      {label}
    </span>
  )
}

/** The family a hero is drawn as: its glyph and its name. */
export function FamilyChip({ family }: { family: Family }) {
  const Mark = FAMILY_GLYPH[family]
  return (
    <span className="hud-tag" data-kind="family">
      <Mark size={13} />
      {FAMILY_LABEL[family].one}
    </span>
  )
}

/** A banner: its colour as a swatch, and what it stands for (the role, the party). */
export function BannerChip({ colour, children }: { colour: string; children: ReactNode }) {
  return (
    <span className="hud-tag" data-kind="banner" style={{ "--banner": colour } as CSSProperties}>
      <i aria-hidden="true" />
      {children}
    </span>
  )
}

/**
 * V1's framed plaque with a title bar that folds it. `open` is the caller's, so the HUD remembers it.
 * `compact`: folding hands over to a compact form elsewhere (badges, toasts), so the head shows a
 * collapse mark instead of a chevron and the body unmounts.
 */
export function FoldPanel({
  label,
  meta,
  open,
  onToggle,
  compact = false,
  className,
  children,
}: {
  label: string
  meta?: ReactNode
  open: boolean
  onToggle?: () => void
  compact?: boolean
  className?: string
  children: ReactNode
}) {
  const id = useId()
  return (
    <section
      className={`ui-panel hud-panel${className ? ` ${className}` : ""}`}
      data-open={open}
      aria-labelledby={`${id}-h`}
    >
      <h2 className="hud-panel-head" id={`${id}-h`}>
        {onToggle ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={`${id}-b`}
            onClick={onToggle}
            title={compact ? "Collapse" : undefined}
          >
            <span className="hud-panel-label">{label}</span>
            {meta !== undefined && <span className="hud-panel-meta">{meta}</span>}
            <span className="hud-fold" data-compact={compact}>
              {compact ? <Glyphs.collapse size={14} /> : <Glyphs.chevron />}
            </span>
          </button>
        ) : (
          <span className="hud-panel-static">
            <span className="hud-panel-label">{label}</span>
            {meta !== undefined && <span className="hud-panel-meta">{meta}</span>}
          </span>
        )}
      </h2>
      <div className="hud-panel-body" id={`${id}-b`} hidden={!open}>
        {open && children}
      </div>
    </section>
  )
}

/** The words for a list that has nothing yet: one quiet line, never a blank box. */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="hud-empty">{children}</p>
}
