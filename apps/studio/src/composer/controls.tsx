/** Small form controls the tile composer and the NPC builder share (styled by composer/style.ts). */
import type { ReactNode } from "react"

/** A catalog id without its pack: `kenney-town/cart` → `cart`. */
export const short = (piece: string | null): string =>
  piece === null ? "empty" : piece.slice(piece.indexOf("/") + 1)

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="gh-field">
      <span className="gh-field-label">{label}</span>
      <div className="gh-field-body">{children}</div>
    </div>
  )
}

export function Segments<T extends string>({
  options,
  value,
  onPick,
  label = (o) => o,
  name,
}: {
  options: readonly T[]
  value: T | null
  onPick: (option: T) => void
  label?: (option: T) => string
  /** What the group chooses, for assistive tech. */
  name?: string
}) {
  return (
    <fieldset className="gh-seg" aria-label={name}>
      {options.map((o) => (
        <button key={o} type="button" aria-pressed={o === value} onClick={() => onPick(o)}>
          {label(o)}
        </button>
      ))}
    </fieldset>
  )
}

export function Stepper({
  value,
  min,
  max,
  onStep,
  unit,
}: {
  value: number
  min: number
  max: number
  onStep: (next: number) => void
  unit?: string
}) {
  return (
    <div className="gh-step">
      <button type="button" disabled={value <= min} onClick={() => onStep(value - 1)} aria-label="less">
        −
      </button>
      <span className="num">
        {value}
        {unit && <small>{unit}</small>}
      </span>
      <button type="button" disabled={value >= max} onClick={() => onStep(value + 1)} aria-label="more">
        +
      </button>
    </div>
  )
}

/**
 * A number field that commits on Enter, blur or the arrow keys (shift: ×10), so typing "-0." never
 * lands half a number in the document.
 */
export function NumberField({
  label,
  value,
  step,
  onChange,
  unit,
  min,
  max,
}: {
  label: string
  value: number
  step: number
  onChange: (next: number) => void
  unit?: string
  min?: number
  max?: number
}) {
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v))
  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3
  const shown = value.toFixed(decimals)
  return (
    <label className="gh-num">
      <span className="gh-num-label">{label}</span>
      <input
        key={shown}
        type="text"
        inputMode="decimal"
        defaultValue={shown}
        spellCheck={false}
        onBlur={(e) => {
          const v = Number(e.currentTarget.value)
          if (Number.isFinite(v) && v !== value) onChange(clamp(v))
          else e.currentTarget.value = shown
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur()
          if (e.key === "Escape") {
            e.currentTarget.value = shown
            e.currentTarget.blur()
          }
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault()
            const d = (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1)
            onChange(clamp(Math.round((value + d) / step) * step))
          }
        }}
      />
      {unit && <span className="gh-num-unit">{unit}</span>}
    </label>
  )
}
