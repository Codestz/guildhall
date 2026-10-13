/**
 * A screen's knobs, declared once: the Viewer draws them in its Inspector and keeps them in the URL. A
 * knob's value lives in the query under its `key`, written only when it differs from the default, so a
 * link carries exactly what was changed. `live` knobs reach the screen at once; `reload` knobs (a value
 * the screen reads only when it builds) are staged and applied together by a rebuild.
 */

export type Apply = "live" | "reload"

interface Base {
  /** The query key. */
  key: string
  label: string
  hint?: string
  /** Default `live`. */
  apply?: Apply
}

export interface RangeKnob extends Base {
  kind: "range"
  min: number
  max: number
  step: number
  default: number
  /** How the value reads (default: as typed). */
  format?: (v: number) => string
}

export interface StepperKnob extends Base {
  kind: "stepper"
  min?: number
  max?: number
  step?: number
  default: number
}

export interface ToggleKnob extends Base {
  kind: "toggle"
  default: boolean
}

export interface ChoiceKnob extends Base {
  /** `select` draws a dropdown, `segment` V1's segmented control (for two to four short options). */
  kind: "select" | "segment"
  options: readonly { value: string; label: string }[]
  default: string
}

export type Knob = RangeKnob | StepperKnob | ToggleKnob | ChoiceKnob

export type KnobValue = number | boolean | string
export type KnobValues = Record<string, KnobValue>

export interface KnobSection {
  title: string
  knobs: readonly Knob[]
  /** Closed sections show their title only (default open). */
  open?: boolean
}

export const applyOf = (k: Knob): Apply => k.apply ?? "live"

/** The knob's value in `query`, or its default when the query has none or an unreadable one. */
export function readKnob(k: Knob, query: URLSearchParams): KnobValue {
  const raw = query.get(k.key)
  if (raw === null) return k.default
  switch (k.kind) {
    case "range":
    case "stepper": {
      const v = Number(raw)
      if (raw.trim() === "" || !Number.isFinite(v)) return k.default
      const min = k.min ?? -Infinity
      const max = k.max ?? Infinity
      return Math.max(min, Math.min(max, v))
    }
    case "toggle":
      if (raw === "1" || raw === "true" || raw === "") return true
      if (raw === "0" || raw === "false") return false
      return k.default
    default:
      return k.options.some((o) => o.value === raw) ? raw : k.default
  }
}

export function readKnobs(knobs: readonly Knob[], query: URLSearchParams): KnobValues {
  const out: KnobValues = {}
  for (const k of knobs) out[k.key] = readKnob(k, query)
  return out
}

/** `value` as the query writes it; null when it is the default (the key is left out). */
export function writeKnob(k: Knob, value: KnobValue): string | null {
  if (value === k.default) return null
  if (k.kind === "toggle") return value ? "1" : "0"
  return String(value)
}

/** `query` with every knob's value in it (defaults removed), every other key left as it was. */
export function withKnobs(
  query: URLSearchParams,
  knobs: readonly Knob[],
  values: KnobValues,
): URLSearchParams {
  const out = new URLSearchParams(query)
  for (const k of knobs) {
    const v = writeKnob(k, values[k.key] ?? k.default)
    if (v === null) out.delete(k.key)
    else out.set(k.key, v)
  }
  return out
}

/** The knobs whose value in `next` differs from `from`. */
export function changed(knobs: readonly Knob[], from: KnobValues, next: KnobValues): Knob[] {
  return knobs.filter((k) => from[k.key] !== next[k.key])
}

/** Every knob of every section, in order. */
export const allKnobs = (sections: readonly KnobSection[]): Knob[] => sections.flatMap((s) => s.knobs)

/** A number as a slider shows it: the step's decimals, no more. */
export function formatStep(v: number, step: number): string {
  if (step >= 1) return Math.round(v).toLocaleString("en-US")
  const decimals = Math.min(4, String(step).split(".")[1]?.length ?? 2)
  return v.toFixed(decimals)
}
