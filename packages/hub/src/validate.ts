import type { Change } from "@guildhall/core"

/**
 * The hub's check of what a herald sends (its trust boundary): each `Change` must be one of the
 * union's types, with its fields of the right kind and within size. A bad change is dropped on its
 * own — the rest of the batch still counts. Fields the union doesn't name are let through (a newer
 * herald may add some); the request body cap bounds them.
 */

/** Ids, names, keys: one line, not a payload. */
export const MAX_NAME = 1024
/** Text, output, deltas: OpenCode truncates tool output well below this. */
export const MAX_TEXT = 1_000_000
/** A tool call's input, as JSON. */
export const MAX_INPUT = 1_000_000
export const MAX_GUILD = 200
/** Changes per dispatch: the courier never sends more in one POST. */
export const MAX_CHANGES = 500
/** One raw host event, as JSON: bigger ones are dropped (they are kept for tuning, not shown). */
export const MAX_RAW = 4_000_000
/** All the raw events of one dispatch, as JSON: more is a 413, which the courier answers by splitting. */
export const MAX_RAW_TOTAL = 12_000_000
/** Changes dated more than this ahead of the hub's clock are refused. */
const FUTURE_MS = 24 * 60 * 60 * 1000

type Fields = Record<string, unknown>
type Check = (value: unknown) => boolean

const name: Check = (v) => typeof v === "string" && v.length > 0 && v.length <= MAX_NAME
const text: Check = (v) => typeof v === "string" && v.length <= MAX_TEXT
const flag: Check = (v) => typeof v === "boolean"
const count: Check = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0
const oneOf =
  (...values: string[]): Check =>
  (v) =>
    typeof v === "string" && values.includes(v)
const names: Check = (v) => Array.isArray(v) && v.length <= 100 && v.every(name)
const input: Check = (v) => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false
  try {
    return JSON.stringify(v).length <= MAX_INPUT
  } catch {
    return false
  }
}

/** Per type: required fields, then optional ones (checked when present). `type`, `id`, `at` always. */
const SHAPES: Record<Change["type"], { required?: Record<string, Check>; optional?: Record<string, Check> }> =
  {
    session: {
      optional: { parentID: name, agent: name, title: text, model: name, background: flag, denied: names },
    },
    step: {},
    status: {
      required: { status: oneOf("busy", "idle", "failed", "waiting") },
      optional: { error: text, settled: flag },
    },
    prompt: { required: { key: name, text } },
    thinking: { required: { key: name }, optional: { text, delta: text, done: flag } },
    reply: { required: { key: name }, optional: { text, delta: text, done: flag } },
    tool: {
      required: { call: name },
      optional: {
        name,
        state: oneOf("pending", "running", "completed", "failed"),
        input,
        output: text,
        error: text,
        started: count,
        ended: count,
        summary: text,
      },
    },
    usage: { optional: { tokens: count, cost: count } },
  }

export function validChange(value: unknown, now = Date.now()): value is Change {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const change = value as Fields
  const shape = Object.hasOwn(SHAPES, String(change.type)) ? SHAPES[change.type as Change["type"]] : undefined
  if (!shape || !name(change.id)) return false
  // A time, so after the epoch: 0 is what a missing clock looks like.
  if (!count(change.at) || (change.at as number) <= 0 || (change.at as number) > now + FUTURE_MS) return false
  for (const [field, check] of Object.entries(shape.required ?? {})) if (!check(change[field])) return false
  for (const [field, check] of Object.entries(shape.optional ?? {}))
    if (change[field] !== undefined && !check(change[field])) return false
  return true
}

/**
 * A guild is named after its project directory, and names the directory its chronicles go to: no
 * path separators, no control characters, and no leading dot (".", "..", hidden files).
 */
export function validGuild(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_GUILD &&
    !value.startsWith(".") &&
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it refuses.
    !/[/\\\u0000-\u001f\u007f]/.test(value)
  )
}
