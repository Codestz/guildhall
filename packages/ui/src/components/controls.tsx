/**
 * The controls: buttons, chips, keys, slider, switch, select, segmented, stepper. Thin React wrappers
 * over the `ui-*` classes (theme/components.ts), so a vanilla screen can draw the same thing with the
 * class names alone. Every control is a native element with its label wired up.
 */
import { type ButtonHTMLAttributes, type ReactNode, useId } from "react"
import { ChevronIcon } from "./icons.tsx"

type Variant = "primary" | "secondary" | "outline" | "ghost"

export function Button({
  variant = "secondary",
  size,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" }) {
  return (
    <button
      type="button"
      className="ui-btn"
      data-variant={variant === "secondary" ? undefined : variant}
      data-size={size}
      {...rest}
    >
      {children}
    </button>
  )
}

/** A square icon button; the label is required (it is the button's only name). */
export function IconButton({
  label,
  plaque,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; plaque?: boolean }) {
  return (
    <button
      type="button"
      className="ui-icon-btn"
      aria-label={label}
      title={label}
      data-plaque={plaque ? "" : undefined}
      {...rest}
    >
      {children}
    </button>
  )
}

const NUMERALS: [number, string][] = [
  [1000, "M"],
  [900, "CM"],
  [500, "D"],
  [400, "CD"],
  [100, "C"],
  [90, "XC"],
  [50, "L"],
  [40, "XL"],
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
]

/** `n` in roman numerals (1–3999); anything else as plain digits. */
export function roman(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 3999) return String(n)
  let out = ""
  let rest = n
  for (const [value, glyph] of NUMERALS)
    while (rest >= value) {
      out += glyph
      rest -= value
    }
  return out
}

export type Tone = "ok" | "warn" | "fail" | "info" | "brass"

/**
 * A chip. With `numeral`, V1's chapter chip: a roman numeral in brass, then the label in small caps.
 * `kind="tag"`: a small mono tag (an id, a status), toned.
 */
export function Chip({
  numeral,
  kind,
  tone,
  children,
}: {
  numeral?: number
  kind?: "tag"
  tone?: Tone
  children: ReactNode
}) {
  return (
    <span className="ui-chip" data-kind={kind} data-tone={tone}>
      {numeral !== undefined && <span className="numeral">{roman(numeral)}</span>}
      {numeral !== undefined ? <span className="label">{children}</span> : children}
    </span>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="ui-kbd">{children}</kbd>
}

/** A labelled range: name and value above, V1's brass track below. */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  format = String,
  changed,
  hint,
  disabled,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  format?: (v: number) => string
  /** Differs from the default: the value reads in brass. */
  changed?: boolean
  hint?: string
  disabled?: boolean
  onChange(value: number): void
}) {
  const id = useId()
  const p = max > min ? (value - min) / (max - min) : 0
  return (
    <div className="ui-field">
      <div className="ui-field-head">
        <label className="ui-field-label" htmlFor={id}>
          {label}
        </label>
        <output className="ui-field-value" htmlFor={id} data-changed={changed ? "" : undefined}>
          {format(value)}
        </output>
      </div>
      <input
        id={id}
        className="ui-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-valuetext={format(value)}
        style={{ ["--p" as string]: String(Math.max(0, Math.min(1, p))) }}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
      />
      {hint && <p className="ui-hint">{hint}</p>}
    </div>
  )
}

/** A switch row (V1's Settings toggle): the label and its hint on the left, the switch on the right. */
export function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string
  hint?: string
  checked: boolean
  disabled?: boolean
  onChange(checked: boolean): void
}) {
  return (
    <button
      type="button"
      role="switch"
      className="ui-toggle"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="ui-toggle-text">
        <b>{label}</b>
        {hint && <span>{hint}</span>}
      </span>
      <span className="ui-switch" aria-hidden="true">
        <i />
      </span>
    </button>
  )
}

export interface Option {
  value: string
  label: string
}

/** A native select in the ink field, with its label above. */
export function Select({
  label,
  value,
  options,
  hint,
  onChange,
}: {
  label: string
  value: string
  options: readonly Option[]
  hint?: string
  onChange(value: string): void
}) {
  const id = useId()
  return (
    <div className="ui-field">
      <label className="ui-field-label" htmlFor={id}>
        {label}
      </label>
      <span className="ui-select">
        <select id={id} value={value} onChange={(e) => onChange(e.currentTarget.value)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronIcon />
      </span>
      {hint && <p className="ui-hint">{hint}</p>}
    </div>
  )
}

/** V1's segmented control: one of a few, the pressed one in brass. */
export function Segmented({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: readonly Option[]
  onChange(value: string): void
}) {
  return (
    <fieldset className="ui-field ui-fieldset">
      <legend className="ui-field-label">{label}</legend>
      <div className="ui-seg">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={o.value === value}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

/** A whole number with − and + (a seed): arrow keys step it too. */
export function Stepper({
  label,
  value,
  min = -Infinity,
  max = Infinity,
  step = 1,
  onChange,
}: {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  onChange(value: number): void
}) {
  const set = (v: number) => onChange(Math.max(min, Math.min(max, v)))
  return (
    <fieldset className="ui-field-head ui-fieldset">
      <legend className="ui-field-label">{label}</legend>
      <span className="ui-stepper">
        <button
          type="button"
          aria-label={`${label}: down`}
          disabled={value - step < min}
          onClick={() => set(value - step)}
        >
          −
        </button>
        <output aria-live="polite">{value}</output>
        <button
          type="button"
          aria-label={`${label}: up`}
          disabled={value + step > max}
          onClick={() => set(value + step)}
        >
          +
        </button>
      </span>
    </fieldset>
  )
}
