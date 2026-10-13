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
      {rows.map((r, k) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and labels may repeat
        <div key={k} style={{ display: "contents" }}>
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
      {items.map((it, k) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and may repeat (two hamlets)
        <li key={k}>
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
  /**
   * The bar's target, 0..1, and the ms it takes to get there: the bar is a CSS transition, so it keeps
   * moving (compositor-side) while the main thread is busy building. Without it, the bar follows `at`.
   */
  progress?: number
  eta?: number
  /** The flavour line under the title, and the brand line at the foot. */
  line?: string
  pitch?: string
}

/** V1's boot card as a veil over a stage: crest, name, a line of flavour, bar, and the steps with now / done marks. */
export function Loader({ state }: { state: LoaderState }) {
  const { title, steps, at, out, error, line, pitch } = state
  const p = state.progress ?? (steps.length ? Math.min(1, (at + 0.35) / steps.length) : 0)
  const eta = state.eta ?? 300
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
          <>
            <p className="ui-loader-line" key={line ?? at}>
              {line ?? steps[at] ?? ""}
            </p>
            <span className="ui-loader-bar">
              <i style={{ transform: `scaleX(${p})`, transitionDuration: `${eta}ms` }} />
            </span>
          </>
        )}
        <ol className="ui-loader-steps">
          {steps.map((s, k) => (
            <li key={s} data-step={k < at ? "done" : k === at ? "now" : undefined}>
              {s}
            </li>
          ))}
        </ol>
        {pitch && <p className="ui-loader-pitch">{pitch}</p>}
      </div>
    </div>
  )
}
