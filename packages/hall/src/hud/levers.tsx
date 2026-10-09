import { type ReactNode, useId } from "react"

/**
 * Settings' controls (hud/Settings.tsx, hud/DirectorControls.tsx): a titled section, a labelled
 * group of choices, and an on/off switch.
 */

/** One titled section of Settings; `value` says what is in effect now. `sub`: inside a group (h4). */
export function Section({
  title,
  value,
  sub = false,
  children,
}: {
  title: string
  value?: string
  sub?: boolean
  children: ReactNode
}) {
  const id = useId()
  const Heading = sub ? "h4" : "h3"
  return (
    <section className="set-section" aria-labelledby={id}>
      <Heading id={id}>
        {title}
        <LeverValue value={value} />
      </Heading>
      {children}
    </section>
  )
}

/** A labelled group of choices; `value` says what is in effect now. */
export function Lever({
  label,
  value,
  quiet = false,
  children,
}: {
  label: string
  value?: string
  /** The section heading already names it: keep the legend for screen readers only. */
  quiet?: boolean
  children: ReactNode
}) {
  return (
    <fieldset className="lever">
      <legend className={quiet ? "visually-hidden" : undefined}>
        {label}
        <LeverValue value={value} />
      </legend>
      {children}
    </fieldset>
  )
}

/**
 * What is in effect now, after a label. The comma is for screen readers only: without it a legend
 * reads as one word ("MoodMorning Keep"); the gap you see is CSS.
 */
export function LeverValue({ value }: { value: string | undefined }) {
  if (!value) return null
  return (
    <>
      <span className="visually-hidden">, </span>
      <span className="lever-value">{value}</span>
    </>
  )
}

/** An on/off choice with its hint. */
export function Switch({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (on: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      className="toggle"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle-text">
        <b>{label}</b>
        <span>{hint}</span>
      </span>
      <span className="switch" aria-hidden="true">
        <i />
      </span>
    </button>
  )
}
