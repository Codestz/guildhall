/** The read-outs: plaque, section head, stat rows, figures, legend, card, loader. */
import type { ReactNode } from "react"
import type { Tone } from "./controls.tsx"
import { CloseIcon, CrestIcon } from "./icons.tsx"

/** V1's plaque: an ink panel with brass corner brackets. */
export function Panel({
  as: Tag = "div",
  solid,
  className,
  label,
  children,
}: {
  as?: "div" | "section" | "aside"
  solid?: boolean
  className?: string
  /** The region's accessible name (sections and asides). */
  label?: string
  children: ReactNode
}) {
  return (
    <Tag
      className={className ? `ui-panel ${className}` : "ui-panel"}
      data-solid={solid ? "" : undefined}
      aria-label={label}
    >
      {children}
    </Tag>
  )
}

/** A section's heading in brass small caps, with an optional meta on the right. */
export function SectionHead({ children, meta, id }: { children: ReactNode; meta?: ReactNode; id?: string }) {
  return (
    <h3 className="ui-section-head" id={id}>
      {children}
      {meta !== undefined && <span className="meta">{meta}</span>}
    </h3>
  )
}

export interface Stat {
  label: string
  value: string | number
  unit?: string
  tone?: Tone
}

const show = (v: string | number) => (typeof v === "number" ? v.toLocaleString("en-US") : v)

/** Key/value rows: small-caps labels left, mono values right. */
export function StatRows({ rows }: { rows: readonly Stat[] }) {
  return (
    <dl className="ui-stats">
      {rows.map((r) => (
        <div key={r.label} style={{ display: "contents" }}>
          <dt title={r.label}>{r.label}</dt>
          <dd data-tone={r.tone}>
            {show(r.value)}
            {r.unit && <small>{r.unit}</small>}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** Headline numbers: a big mono value over its small-caps label, in a wrapping row. */
export function Figures({ rows }: { rows: readonly Stat[] }) {
  return (
    <dl className="ui-figures">
      {rows.map((r) => (
        <div key={r.label}>
          <dd>
            {show(r.value)}
            {r.unit && <small>{r.unit}</small>}
          </dd>
          <dt>{r.label}</dt>
        </div>
      ))}
    </dl>
  )
}

export interface LegendItem {
  /** A CSS colour for the key swatch. */
  colour: string
  label: string
  value?: string | number
  /** A small note after the value (units, a second count). */
  note?: string
}

/** A colour key: swatch, name, value. */
export function Legend({ items, label }: { items: readonly LegendItem[]; label?: string }) {
  return (
    <ul className="ui-legend" aria-label={label}>
      {items.map((it) => (
        <li key={`${it.label}-${it.colour}-${it.value ?? ""}`}>
          <i style={{ background: it.colour }} aria-hidden="true" />
          <span title={it.label}>{it.label}</span>
          {it.value !== undefined && (
            <b>
              {show(it.value)}
              {it.note && <small>{it.note}</small>}
            </b>
          )}
        </li>
      ))}
    </ul>
  )
}

/** A dismissible card (V1's toast): one line, a detail line in mono, a close button. */
export function Card({
  children,
  detail,
  onClose,
}: {
  children: ReactNode
  detail?: string
  onClose?: () => void
}) {
  return (
    <div className="ui-card" role="status">
      <div className="text">
        {children}
        {detail && <small>{detail}</small>}
      </div>
      {onClose && (
        <button type="button" className="ui-icon-btn" aria-label="Dismiss" onClick={onClose}>
          <CloseIcon size={14} />
        </button>
      )}
    </div>
  )
}

export interface LoaderState {
  title: string
  steps: readonly string[]
  /** The step being worked on (index into `steps`); `steps.length` once every step is done. */
  at: number
  /** Lifted: the veil fades out. */
  out?: boolean
  error?: string
}

/** V1's boot card as a veil over a stage: crest, name, bar, and the steps with now / done marks. */
export function Loader({ state }: { state: LoaderState }) {
  const { title, steps, at, out, error } = state
  const p = steps.length ? Math.min(1, (at + 0.35) / steps.length) : 0
  return (
    <div className="ui-loader" data-state={out ? "out" : "in"} aria-hidden={out ? true : undefined}>
      <div className="ui-loader-inner" role="status" aria-live="polite">
        <span className="ui-crest">
          <CrestIcon />
        </span>
        <p className="ui-loader-name">{title}</p>
        <span className="ui-loader-rule" />
        {error ? (
          <p className="ui-loader-error">{error}</p>
        ) : (
          <span className="ui-loader-bar">
            <i style={{ transform: `scaleX(${p})` }} />
          </span>
        )}
        <ol className="ui-loader-steps">
          {steps.map((s, k) => (
            <li key={s} data-step={k < at ? "done" : k === at ? "now" : undefined}>
              {s}
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
