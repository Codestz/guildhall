import { closeSync, fstatSync, openSync, readdirSync, readSync, statSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import { type GuildEvent, WIRE_VERSION } from "@guildhall/core"
import { validChange, validGuild } from "./validate.ts"

/**
 * The chronicles on disk (ADR 0003): `<home>/chronicles/<guild>/<boot>.jsonl` holds a boot's events,
 * `<boot>.raw.jsonl` the raw host events behind them. Reading them back on start, and keeping them
 * from growing without end.
 */

/** Chronicles older than this aren't read back on start: those sessions are long over. */
export const HISTORY_MS = 24 * 60 * 60 * 1000

/**
 * Retention, per guild. Event chronicles are what replay mode plays, so they are kept a month; raw
 * logs are kept for re-translation and tuning only, and a dispatch may carry 12 MB of them
 * (MAX_RAW_TOTAL), so they go after a few days or once a guild's raw logs pass their size cap,
 * oldest boot first. The newest event chronicle of a guild is never removed by size, so a hub restart
 * always has the last boot to read back; a raw log may be (it is recreated on the next write).
 */
export const EVENTS_KEEP_MS = 30 * 24 * 60 * 60 * 1000
export const EVENTS_MAX_BYTES = 256 * 1024 * 1024
export const RAW_KEEP_MS = 3 * 24 * 60 * 60 * 1000
export const RAW_MAX_BYTES = 64 * 1024 * 1024
/** How often a running hub applies retention again (it also does on start). */
export const PRUNE_EVERY_MS = 60 * 60 * 1000

/** How much of a chronicle is read at a time when reading it back from its end. */
const CHUNK = 1024 * 1024

/**
 * Each guild's recent events from earlier boots: its chronicles of the last HISTORY_MS, newest
 * first, for as long as their seqs run on from each other (a boot that started over at 1 ends it),
 * up to `keep`. Each file is read from its end, and only as far back as `keep` still needs. Lines
 * that don't parse or check out — a half-written last line — are skipped.
 */
export function loadHistory(root: string, keep: number, now = Date.now()): Map<string, GuildEvent[]> {
  const loaded = new Map<string, GuildEvent[]>()
  const since = now - HISTORY_MS
  for (const dir of list(root)) {
    const files = list(join(root, dir))
      .filter((file) => file.endsWith(".jsonl") && !file.endsWith(".raw.jsonl"))
      .filter((file) => sized(join(root, dir, file)).mtime >= since)
      .sort()
      .reverse()
    let history: GuildEvent[] = []
    for (const file of files) {
      const older = readTail(join(root, dir, file), keep - history.length)
      const first = history[0]
      if (first && older.some((event) => event.guild !== first.guild || event.seq >= first.seq)) break
      history = [...older, ...history]
      if (history.length >= keep) break
    }
    const guild = history[0]?.guild
    if (guild && !loaded.has(guild)) loaded.set(guild, history.slice(-keep))
  }
  return loaded
}

/** A chronicle's last `max` good events, in order, reading back from its end a chunk at a time. */
export function readTail(file: string, max: number): GuildEvent[] {
  const newest: GuildEvent[] = []
  if (max <= 0) return newest
  let fd: number
  try {
    fd = openSync(file, "r")
  } catch {
    return newest
  }
  try {
    let position = fstatSync(fd).size
    let rest = Buffer.alloc(0)
    while (newest.length < max) {
      const cut = rest.lastIndexOf(10)
      if (cut === -1 && position > 0) {
        const size = Math.min(CHUNK, position)
        position -= size
        const chunk = Buffer.alloc(size)
        readSync(fd, chunk, 0, size, position)
        rest = Buffer.concat([chunk, rest])
        continue
      }
      const line = rest.subarray(cut + 1)
      rest = rest.subarray(0, Math.max(cut, 0))
      const event = line.length > 0 ? parse(line.toString("utf8")) : undefined
      const later = newest.at(-1)
      if (event && (!later || (event.guild === later.guild && event.seq < later.seq))) newest.push(event)
      if (cut === -1) break
    }
  } catch {
    // An unreadable chronicle gives what was read of it.
  } finally {
    closeSync(fd)
  }
  return newest.reverse()
}

function parse(line: string): GuildEvent | undefined {
  try {
    const event = JSON.parse(line) as GuildEvent
    if (
      event?.v === WIRE_VERSION &&
      validGuild(event.guild) &&
      Number.isInteger(event.seq) &&
      validChange(event.change)
    )
      return event
  } catch {
    // A line cut short when the last hub stopped.
  }
  return undefined
}

/**
 * Applies retention to every guild's chronicles under `root`: removes event chronicles older than
 * EVENTS_KEEP_MS and raw logs older than RAW_KEEP_MS, then the oldest boots of each kind while a
 * guild's total is over EVENTS_MAX_BYTES / RAW_MAX_BYTES. Never throws; a file it can't remove stays.
 */
export function pruneChronicles(root: string, now = Date.now()): void {
  for (const dir of list(root)) {
    const files = list(join(root, dir))
      .filter((file) => file.endsWith(".jsonl"))
      .sort()
      .map((file) => ({ file, path: join(root, dir, file), ...sized(join(root, dir, file)) }))
    const raw = files.filter(({ file }) => file.endsWith(".raw.jsonl"))
    const events = files.filter(({ file }) => !file.endsWith(".raw.jsonl"))
    prune(raw, now - RAW_KEEP_MS, RAW_MAX_BYTES, false)
    prune(events, now - EVENTS_KEEP_MS, EVENTS_MAX_BYTES, true)
  }
}

interface Chronicle {
  path: string
  size: number
  mtime: number
}

/** `files` oldest boot first: drops those modified before `since`, then the oldest while over `max`. */
function prune(files: Chronicle[], since: number, max: number, keepNewest: boolean): void {
  const kept = files.filter((file) => file.mtime >= since || !remove(file.path))
  let total = kept.reduce((sum, file) => sum + file.size, 0)
  const removable = keepNewest ? kept.slice(0, -1) : kept
  for (const file of removable) {
    if (total <= max) break
    if (remove(file.path)) total -= file.size
  }
}

function remove(path: string): boolean {
  try {
    unlinkSync(path)
    return true
  } catch {
    return false
  }
}

function sized(file: string): { size: number; mtime: number } {
  try {
    const stat = statSync(file)
    return { size: stat.size, mtime: stat.mtimeMs }
  } catch {
    return { size: 0, mtime: 0 }
  }
}

export function list(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}
