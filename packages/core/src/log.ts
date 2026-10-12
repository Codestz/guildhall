/**
 * Channel logging: `log("import:palette").info(...)`. Every record that passes its channel's level goes
 * into a ring buffer (read with `logRecords`) and to the sink (the console unless replaced). Levels come
 * from a spec like `"import:*=debug,render=warn,*=info"`; apps pass `?log=`, tools pass `$GUILDHALL_LOG`.
 */

export type Level = "trace" | "debug" | "info" | "warn" | "error"

export interface LogRecord {
  seq: number
  t: number
  level: Level
  channel: string
  msg: string
  data?: unknown
}

export interface Logger {
  trace(msg: string, data?: unknown): void
  debug(msg: string, data?: unknown): void
  info(msg: string, data?: unknown): void
  warn(msg: string, data?: unknown): void
  error(msg: string, data?: unknown): void
  /** The logger for `<channel>:<sub>`. */
  child(sub: string): Logger
}

const LEVELS: readonly Level[] = ["trace", "debug", "info", "warn", "error"]
const rank = (level: Level): number => LEVELS.indexOf(level)
const isLevel = (text: string): text is Level => (LEVELS as readonly string[]).includes(text)

/** The level a channel matched by no rule logs at. */
const DEFAULT_LEVEL: Level = "info"
const CAPACITY = 2000

interface Rule {
  matches(channel: string): boolean
  /** The pattern's literal characters: the rule with more of them is the more specific one. */
  weight: number
  level: Level
}

/**
 * A channel pattern: `*` stands for any run of characters (`import:*`, `*`); a plain name matches that
 * channel and its children (`render` matches `render` and `render:stage`).
 */
function matcher(pattern: string): (channel: string) => boolean {
  if (!pattern.includes("*")) return (channel) => channel === pattern || channel.startsWith(`${pattern}:`)
  const escaped = pattern.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
  const re = new RegExp(`^${escaped.join(".*")}$`)
  return (channel) => re.test(channel)
}

/** The rules of a spec, or the reason it is not one. */
function parse(spec: string): Rule[] | string {
  const rules: Rule[] = []
  for (const raw of spec.split(",")) {
    const entry = raw.trim()
    if (entry === "") continue
    const [pattern, level, extra] = entry.split("=").map((s) => s.trim())
    if (!pattern || level === undefined || extra !== undefined) return `"${entry}" is not channel=level`
    if (!isLevel(level)) return `"${level}" is not a level (${LEVELS.join(", ")})`
    rules.push({ matches: matcher(pattern), weight: pattern.replaceAll("*", "").length, level })
  }
  return rules
}

let rules: Rule[] = []
const thresholds = new Map<string, number>()
let ring: LogRecord[] = []
let seq = 0
let sink: ((r: LogRecord) => void) | null = consoleSink

function consoleSink(r: LogRecord): void {
  const line = `[${r.channel}] ${r.msg}`
  const write =
    r.level === "error"
      ? console.error
      : r.level === "warn"
        ? console.warn
        : r.level === "info"
          ? console.info
          : console.debug
  if (r.data === undefined) write(line)
  else write(line, r.data)
}

/** The lowest level rank a channel records: the most specific matching rule's, later rules winning ties. */
function threshold(channel: string): number {
  const cached = thresholds.get(channel)
  if (cached !== undefined) return cached
  let best: Rule | undefined
  for (const rule of rules) if (rule.matches(channel) && (!best || rule.weight >= best.weight)) best = rule
  const value = rank(best?.level ?? DEFAULT_LEVEL)
  thresholds.set(channel, value)
  return value
}

function emit(channel: string, level: Level, msg: string, data: unknown): void {
  if (rank(level) < threshold(channel)) return
  const record: LogRecord = { seq: seq++, t: globalThis.performance?.now() ?? 0, level, channel, msg }
  if (data !== undefined) record.data = data
  ring.push(record)
  if (ring.length > CAPACITY) ring.shift()
  sink?.(record)
}

/** The logger for a channel, e.g. `"import:palette"` or `"render:stage"`. */
export function log(channel: string): Logger {
  return {
    trace: (msg, data) => emit(channel, "trace", msg, data),
    debug: (msg, data) => emit(channel, "debug", msg, data),
    info: (msg, data) => emit(channel, "info", msg, data),
    warn: (msg, data) => emit(channel, "warn", msg, data),
    error: (msg, data) => emit(channel, "error", msg, data),
    child: (sub) => log(`${channel}:${sub}`),
  }
}

/**
 * Sets the levels from a spec such as `"import:*=debug,render=warn,*=info"`. Channels no rule matches log at
 * `info`; an empty spec restores that for every channel. A malformed spec is reported on the `log` channel
 * and the previous spec stays in force.
 */
export function configureLog(spec: string): void {
  const parsed = parse(spec)
  if (typeof parsed === "string") {
    log("log").warn(`bad log spec, keeping the previous one: ${parsed}`, { spec })
    return
  }
  rules = parsed
  thresholds.clear()
}

/**
 * The buffered records (the last 2000), oldest first. `channel` keeps a channel and its children (or a
 * `*` pattern's matches); `level` keeps that level and above.
 */
export function logRecords(filter?: { channel?: string; level?: Level }): readonly LogRecord[] {
  const channel = filter?.channel === undefined ? undefined : matcher(filter.channel)
  const min = filter?.level === undefined ? 0 : rank(filter.level)
  return ring.filter((r) => rank(r.level) >= min && (!channel || channel(r.channel)))
}

/** Empties the buffer. */
export function clearLog(): void {
  ring = []
}

/** Where each record goes besides the buffer; `null` silences output (records are still buffered). */
export function setLogSink(fn: ((r: LogRecord) => void) | null): void {
  sink = fn
}
