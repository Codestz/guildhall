/**
 * The pull-request fleet as a pure function of what happened and when (plan-hud-events §2 "PRs"): a
 * ship per open pull request sails in along its berth's lane and docks; merged, it dips its pennant and
 * a gold flare bursts over its masthead at the berth, then it turns and sails out with its pennant
 * glinting; closed, it lists, settles and sinks at its berth (or sails off, `close: "sail"`; closed
 * before it docked, it turns back).
 * At most one ship per berth (six at most): a pull request opened while every berth is taken waits,
 * unseen, until one is free again, and ships set out at least `GAP_S` apart, so two never share the
 * lane in. Everything is a plan of times (`planFleet`) and a pose sampled from it (`voyagePose`), so
 * the same history and the same time always give the same picture.
 */
import { clamp01, easeIn, easeOut, smooth01 } from "./ease.ts"

export type ShipEnd = "merged" | "closed"

/** One pull request's life as the fleet saw it (FX clock, seconds). */
export interface ShipLog {
  key: string
  opened: number
  ended?: { at: number; how: ShipEnd }
  /** Already open when the fleet first saw it: it is at its berth from the start, no sail in. */
  docked?: boolean
}

export const FLEET = {
  /** Berths a harbour gives the fleet at most (and so ships on the water). */
  MAX: 6,
  /** Sailing in, docking, from the open sea. */
  ARRIVE_S: 14,
  /** A merged ship's stay at the berth before it casts off, at least. */
  STAY_S: 2.5,
  /** A merged ship stays at its berth this long after its merge (its flare and its pennant's dip). */
  SALUTE_S: 1.8,
  /** The gold flare over the masthead at the merge. */
  FLARE_S: 1.2,
  /** The pennant's dip at the merge: down and up again. */
  DIP_S: 1.6,
  /** Turning about and sailing out. */
  LEAVE_S: 16,
  /** Sinking at the berth: it lists, settles, then goes down (slow enough to read). */
  SINK_S: 21,
  /** Ships set out at least this far apart (the lane in is one). */
  GAP_S: 4,
  /** How long the merged pennant glints as it casts off. */
  GLINT_S: 2.4,
} as const

export interface Voyage {
  key: string
  berth: number
  /** Sets out from the open sea (or, `docked`, is there from) this time. */
  start: number
  /** At the berth from this time. */
  arrive: number
  /** Casts off, sinks or turns back from this time (Infinity while open). */
  leave: number
  how?: ShipEnd
  /** Merged: when it salutes at its berth (its flare and its pennant's dip). */
  salute?: number
  /** Turned back before it docked: how far along the lane it had come (0 … 1). */
  back?: number
  /** Closed at its berth: it sinks there (else it sails off as a merged one does, without the glint). */
  sinks?: boolean
  /** Gone from the water from this time (Infinity while open). */
  gone: number
}

/**
 * The voyages for a history of pull requests over `berths` berths: each takes the berth that is free
 * soonest (lowest first on a tie), once its last ship has gone. Logs closed before their ship could set
 * out never sail.
 */
export function planFleet(
  logs: readonly ShipLog[],
  berths: number,
  opts: { close?: "sink" | "sail" } = {},
): Voyage[] {
  const sinking = opts.close !== "sail"
  const n = Math.min(berths, FLEET.MAX)
  if (n <= 0) return []
  const free = new Array<number>(n).fill(Number.NEGATIVE_INFINITY)
  const out: Voyage[] = []
  let lastStart = Number.NEGATIVE_INFINITY
  const order = [...logs].sort((a, b) => a.opened - b.opened || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  for (const log of order) {
    let berth = 0
    for (let b = 1; b < n; b++) if ((free[b] as number) < (free[berth] as number)) berth = b
    const freeAt = free[berth] as number
    if (freeAt === Number.POSITIVE_INFINITY) continue
    const docked = log.docked === true && freeAt === Number.NEGATIVE_INFINITY
    const start = docked ? log.opened : Math.max(log.opened, freeAt, lastStart + FLEET.GAP_S)
    if (log.ended && log.ended.at <= start) continue
    if (!docked) lastStart = start
    const arrive = docked ? start : start + FLEET.ARRIVE_S
    const v: Voyage = {
      key: log.key,
      berth,
      start,
      arrive,
      leave: Number.POSITIVE_INFINITY,
      gone: Number.POSITIVE_INFINITY,
    }
    if (log.ended) {
      const { at, how } = log.ended
      v.how = how
      if (how === "closed" && at < arrive) {
        v.leave = at
        v.back = easeOut((at - start) / FLEET.ARRIVE_S)
        v.gone = at + FLEET.LEAVE_S * Math.max(0.3, v.back)
      } else if (how === "closed" && sinking) {
        v.leave = at
        v.sinks = true
        v.gone = at + FLEET.SINK_S
      } else if (how === "closed") {
        v.leave = at
        v.gone = at + FLEET.LEAVE_S
      } else {
        // merged: it salutes at its berth (once there), then casts off
        v.salute = Math.max(at, arrive)
        v.leave = Math.max(v.salute + FLEET.SALUTE_S, arrive + FLEET.STAY_S)
        v.gone = v.leave + FLEET.LEAVE_S
      }
    }
    free[berth] = v.gone
    out.push(v)
  }
  return out
}

/** A ship's pose in its lane's terms: how far along the lane (0 the open sea … 1 the berth), which way it points, and its state. */
export interface VoyagePose {
  /** 0 at the lane's start (the open sea) … 1 at the berth. */
  along: number
  /** 0 bow toward the berth (sailing in) … 1 turned about (sailing out). */
  turn: number
  /** How far down it has gone, sinking, 0 … 1. */
  sink: number
  /** Its list (roll) as it sinks, 0 … 1. */
  list: number
  /** Seen, 0 … 1 (fades in from and out to the open sea, and as it sinks). */
  seen: number
  /** The pennant's glint, 0 … 1 (merged: from its salute, fading as it casts off). */
  glint: number
  /** The merge's flare over the masthead: its progress 0 … 1 while it bursts, else 0. */
  flare: number
  /** The pennant dipped, 0 … 1 (the merge's salute). */
  dip: number
  /** Moving on the water (a wake), m/s-ish 0 … 1. */
  way: number
  phase: "waiting" | "arriving" | "docked" | "leaving" | "sinking" | "turning-back" | "gone"
}

const fadeEnds = (along: number) => smooth01(along / 0.12)

/** A merged ship's salute at `t`: the pennant's glint, the flare's progress and the dip. */
export function salute(v: Voyage, t: number): { glint: number; flare: number; dip: number } {
  if (v.salute === undefined || t < v.salute) return { glint: 0, flare: 0, dip: 0 }
  const s = t - v.salute
  return {
    glint: clamp01(1 - s / FLEET.GLINT_S),
    flare: s < FLEET.FLARE_S ? s / FLEET.FLARE_S : 0,
    dip: s < FLEET.DIP_S ? Math.sin((Math.PI * s) / FLEET.DIP_S) : 0,
  }
}

/** A sinking ship at `u` (0 … 1 of `SINK_S`): it lists, settles low, then goes down and fades. */
export function sinkPose(u: number): { sink: number; list: number; seen: number } {
  const list = smooth01(u / 0.3)
  const sink = 0.12 * list + 0.88 * easeIn(clamp01((u - 0.3) / 0.7))
  return { sink, list, seen: 1 - smooth01((u - 0.82) / 0.18) }
}

export function voyagePose(v: Voyage, t: number): VoyagePose {
  const still = { along: 1, turn: 0, sink: 0, list: 0, seen: 1, glint: 0, flare: 0, dip: 0, way: 0 }
  if (t < v.start) return { ...still, seen: 0, along: 0, phase: "waiting" }
  if (t >= v.gone) return { ...still, seen: 0, phase: "gone" }
  if (t < v.arrive && t < v.leave) {
    const u = (t - v.start) / (v.arrive - v.start)
    const along = easeOut(u)
    return { ...still, along, seen: fadeEnds(along), way: 1 - u, phase: "arriving" }
  }
  if (t < v.leave) return { ...still, ...salute(v, t), phase: "docked" }
  const u = clamp01((t - v.leave) / (v.gone - v.leave))
  if (v.sinks) return { ...still, ...sinkPose(u), phase: "sinking" }
  // turning about where it lies, then out along the lane
  const from = v.back ?? 1
  const turn = smooth01(u / 0.3)
  const along = from * (1 - easeIn(u))
  return {
    ...still,
    ...salute(v, t),
    along,
    turn,
    seen: fadeEnds(along),
    way: Math.min(1, u * 2),
    phase: v.back !== undefined ? "turning-back" : "leaving",
  }
}

/** The voyages seen at `t` (on the water at all). */
export function afloat(voyages: readonly Voyage[], t: number): Voyage[] {
  return voyages.filter((v) => t >= v.start && t < v.gone)
}

/** What a harbour reading (sim `harbourOf`) says has changed since the last one: opened keys, ended ones and how. */
export interface HarbourReading {
  prs: readonly { repo?: string; n: number }[]
  merged: number
}

export const prKey = (pr: { repo?: string; n: number }): string => `${pr.repo ?? ""}#${pr.n}`

/**
 * The changes from the open set `before` (and merged count `mergedBefore`) to `now`: new keys opened,
 * vanished keys ended, merged as many as the merged count rose by (the oldest vanished first), the
 * rest closed.
 */
export function harbourChanges(
  before: readonly string[],
  mergedBefore: number,
  now: HarbourReading,
): { opened: string[]; ended: { key: string; how: ShipEnd }[] } {
  const keys = now.prs.map(prKey)
  const open = new Set(keys)
  const was = new Set(before)
  const opened = keys.filter((k) => !was.has(k))
  const gone = before.filter((k) => !open.has(k))
  let merges = Math.max(0, now.merged - mergedBefore)
  const ended = gone.map((key) => {
    const how: ShipEnd = merges > 0 ? "merged" : "closed"
    if (merges > 0) merges--
    return { key, how }
  })
  return { opened, ended }
}
