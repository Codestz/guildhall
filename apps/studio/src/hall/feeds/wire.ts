/**
 * Reading the wire at the hall's edge (a trust boundary, as V1's live.ts `messageOf`): the hub's socket
 * messages, and the lines of a recorded `.jsonl`, checked before anything folds them. A stray peer or a
 * broken line is left out, never thrown. Pure.
 */
import {
  adaptV1,
  adaptV2,
  type Change,
  type GuildEvent,
  isSeaRecord,
  type SeaEvent,
  type SeaRecord,
} from "@guildhall/core"
import type { WireInput } from "@guildhall/sim"

/** A hub message (live/core/PROTOCOL.md §4), checked. */
export type HubMessage =
  | { type: "hello"; events: GuildEvent[]; sea: SeaRecord[] }
  | { type: "events"; events: GuildEvent[] }
  | { type: "sea"; sea: SeaRecord[] }

/** A hub message read off the socket, or undefined for anything that is not a hello, events or sea. */
export function hubMessage(raw: unknown): HubMessage | undefined {
  let data: unknown
  try {
    data = JSON.parse(String(raw))
  } catch {
    return undefined
  }
  if (typeof data !== "object" || data === null) return undefined
  const { type, events, sea } = data as { type?: unknown; events?: unknown; sea?: unknown }
  if (!Array.isArray(events)) return undefined
  if (type === "sea") return { type, sea: events.filter(isSeaRecord) }
  if (type === "events") return { type, events: events.filter(isGuildEvent) }
  if (type !== "hello") return undefined
  return {
    type,
    events: events.filter(isGuildEvent),
    sea: Array.isArray(sea) ? sea.filter(isSeaRecord) : [],
  }
}

export function isGuildEvent(value: unknown): value is GuildEvent {
  if (typeof value !== "object" || value === null) return false
  const { guild, seq, change } = value as Partial<Record<keyof GuildEvent, unknown>>
  if (typeof guild !== "string" || !Number.isInteger(seq) || typeof change !== "object" || change === null)
    return false
  const { type, id, at } = change as { type?: unknown; id?: unknown; at?: unknown }
  return typeof type === "string" && typeof id === "string" && typeof at === "number" && Number.isFinite(at)
}

/**
 * Which of the hub's guilds are this repo's: the hub names a guild after its project's folder, and a
 * second clone of the same name `name·2` (live/hub/src/projects.ts), so `guildhall` takes `guildhall`,
 * `guildhall·2`…, never `guildhall-site`. `want` is the repo's name (`Codestz/guildhall` → `guildhall`),
 * or the guild a link names exactly (`?guild=`).
 */
export function guildMatcher(want: string, exact = false): (guild: string) => boolean {
  const name = (want.split("/").pop() ?? want).toLowerCase()
  if (exact) return (guild) => guild === want
  return (guild) => {
    const g = guild.toLowerCase()
    return g === name || (g.startsWith(`${name}·`) && /^\d+$/.test(g.slice(name.length + 1)))
  }
}

/** What a recording holds, read: wire inputs in order, and the guilds they belong to. */
export interface Recording {
  inputs: WireInput[]
  guilds: string[]
  /** Lines left out (broken, or of no kind a hall reads). */
  skipped: number
}

/**
 * The lines of a recorded `.jsonl`, as wire inputs. Three shapes are read: a guild chronicle's lines
 * (the hub's `<boot>.jsonl`: a `GuildEvent` each), its sea records (`<boot>.sea.jsonl`), and V1's raw
 * OpenCode recordings (core's fixtures: `{kind: "event", at, event}`, translated by `adaptV1`/`adaptV2`
 * and numbered as guild `recorded`). Every guild in the file is kept unless `keep` says otherwise.
 */
export function readRecording(text: string, keep: (guild: string) => boolean = () => true): Recording {
  const inputs: WireInput[] = []
  const guilds = new Set<string>()
  let skipped = 0
  let raw: { v1: ReturnType<typeof adaptV1>; v2: ReturnType<typeof adaptV2>; seq: number } | null = null
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let data: unknown
    try {
      data = JSON.parse(trimmed)
    } catch {
      skipped++
      continue
    }
    if (isGuildEvent(data)) {
      if (!keep(data.guild)) continue
      guilds.add(data.guild)
      inputs.push(data)
    } else if (isSeaRecord(data)) {
      if (!keep(data.guild)) continue
      inputs.push(data.event as SeaEvent)
    } else if (isRawLine(data)) {
      raw ??= { v1: adaptV1(), v2: adaptV2(), seq: 0 }
      const v2 = isV2(data.event)
      const changes: Change[] = (v2 ? raw.v2 : raw.v1).event(data.event, data.at)
      if (changes.length) guilds.add("recorded")
      for (const change of changes) inputs.push({ v: 1, guild: "recorded", seq: ++raw.seq, change })
    } else skipped++
  }
  return { inputs, guilds: [...guilds], skipped }
}

function isRawLine(value: unknown): value is { kind: "event"; at: number; event: unknown } {
  if (typeof value !== "object" || value === null) return false
  const { kind, at, event } = value as { kind?: unknown; at?: unknown; event?: unknown }
  return kind === "event" && typeof at === "number" && typeof event === "object" && event !== null
}

/** OpenCode 2 wraps its events as `{name, details}`; OpenCode 1's are `{type, properties}`. */
const isV2 = (event: unknown): boolean =>
  typeof (event as { name?: unknown }).name === "string" && "details" in (event as object)
