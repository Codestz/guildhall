/**
 * A repo's hall with no session still has its people (decisions.md "User review notes (10-14 evening)"):
 * its resident guild, the repo's busiest hands from its chronicle (hall.ts `RepoHand`), three to five of
 * them, living the island's everyday life. Nothing they do is a session's: no tool calls, no captions.
 * Each joins at the Guildhall's gathering (an `actor.join` the desk folds) and from then on the desk's
 * planner keeps them at rest (sim rest.ts: `LifePlanner.resident`): by day at work at their own places
 * (the units they touch most), between times at the gathering and the square, the tavern in the evening,
 * in at a door at night. A deterministic schedule: the same repo, island and hour give the same day.
 *
 *   `residentsOf`    the residents from a repo's hands and the island's places (pure)
 *   `residentAgents` an `AgentSource` on life's agent seconds, planned in the worker's desk as it goes
 */

import {
  type AgentPose,
  type ArchetypeId,
  type HeroStay,
  handColour,
  type Itinerary,
  poseAt,
  type WorldEvent,
} from "@guildhall/sim"
import type { ChipView } from "./chips.ts"
import type { RepoHand } from "./hall.ts"
import type { BuiltPlace } from "./job.ts"
import { type AgentSource, type HeroLook, recipeOf } from "./lifeAgents.ts"
import type { AgentDeskReply, AgentDeskRequest } from "./lifePlan.ts"

/** How many residents a hall keeps: its busiest hands up to `RESIDENTS_MAX` (a lone maintainer is a guild of one). */
export const RESIDENTS_MAX = 4
export const RESIDENTS_MIN = 1
/** The residents' clock starts here (ms): a fixed day, so their schedule is the same every visit. */
export const RESIDENT_EPOCH = Date.UTC(2026, 9, 13, 6)
/** The desk plans this far past where life looks (ms), and asks again halfway through it. */
const AHEAD = 30_000

/** The bodies residents are drawn with, picked by name. */
const BODIES = ["mage", "knight", "ranger", "barbarian", "rogue"] as const
/** The archetype each body reads as (sim roster). */
const ARCHETYPE: Readonly<Record<(typeof BODIES)[number], ArchetypeId>> = {
  mage: "scholar",
  knight: "warden",
  ranger: "scout",
  barbarian: "artisan",
  rogue: "wanderer",
}

/** A resident: how it is drawn, and its own places (zones) it works at by day. */
export interface Resident extends HeroLook {
  zones: number[]
  /** Its commits (the chip's rank). */
  commits: number
}

/** FNV-1a, for picking a resident's body by name. */
function fnv(text: string): number {
  let h = 0x811c9dc5
  for (const ch of text) {
    h ^= ch.codePointAt(0) ?? 0
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

/** A display name kept short for a chip: the first two words. */
const short = (name: string) => name.trim().split(/\s+/).slice(0, 2).join(" ")

/**
 * The residents of a hall: its busiest hands (at most `RESIDENTS_MAX`), each drawn by its name's body and
 * colour, each working at the places of the units it touches most (else the biggest places, by its
 * name). None for an island with no places, or a repo with no hands. Pure.
 */
export function residentsOf(
  hands: readonly RepoHand[],
  places: readonly Pick<BuiltPlace, "id" | "zone" | "files">[],
  /** The repo's places as specs (their pooled units), to find a unit pooled into a hamlet. */
  pooled: readonly { id: string; pooled?: readonly string[] }[] = [],
): Resident[] {
  if (hands.length < RESIDENTS_MIN || places.length === 0) return []
  const byUnit = new Map<string, number>()
  for (const p of places) byUnit.set(p.id, p.zone)
  for (const spec of pooled) {
    const zone = byUnit.get(spec.id)
    if (zone !== undefined) for (const u of spec.pooled ?? []) byUnit.set(u, zone)
  }
  const biggest = [...places].sort((a, b) => b.files - a.files || a.zone - b.zone).map((p) => p.zone)
  return hands.slice(0, RESIDENTS_MAX).map((hand, k) => {
    const body = BODIES[fnv(hand.name) % BODIES.length]!
    const own = [...new Set(hand.units.flatMap((u) => byUnit.get(u.replace(/\/$/, "")) ?? []))]
    const zones = own.length
      ? own.slice(0, 3)
      : [biggest[(fnv(hand.name) + k) % biggest.length]!, biggest[(fnv(hand.name) + k + 1) % biggest.length]!]
    return {
      id: `resident:${k}:${hand.name}`,
      name: short(hand.name),
      hero: `kaykit-adventurers/${body}`,
      recipe: recipeOf(body),
      colour: handColour(hand.name),
      zones: [...new Set(zones)],
      commits: hand.commits,
    }
  })
}

/** Each resident's join, at the epoch: who it is, as the planner's world folds it. */
export function residentJoins(residents: readonly Resident[]): WorldEvent[] {
  return residents.map((r, k) => {
    const body = r.hero.split("/").pop() as (typeof BODIES)[number]
    return {
      kind: "actor.join",
      at: RESIDENT_EPOCH,
      seq: k + 1,
      src: `resident#${k + 1}`,
      id: r.id,
      agent: "resident",
      archetype: ARCHETYPE[body] ?? "wanderer",
      body,
      name: r.name,
      color: r.colour,
      title: "",
    }
  })
}

/** The step of an itinerary going on at `t`. */
function stepAt(it: Itinerary, t: number) {
  let lo = 0
  let hi = it.steps.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if ((it.steps[mid] as { from: number }).from <= t) lo = mid
    else hi = mid - 1
  }
  return it.steps[lo]
}

/** A resident's chip line at `t`: where it is in its day, in a word or two (never a tool call). */
export function residentVerb(
  it: Itinerary,
  pose: AgentPose | null,
  t: number,
): Pick<ChipView, "verb" | "glyph"> {
  if (!pose) return { verb: "at home", glyph: "idle" }
  if (pose.act === "walk") return { verb: "strolling", glyph: "walk" }
  const step = stepAt(it, t) as HeroStay | undefined
  if (step?.kind === "stay" && step.rest === "toast") return { verb: "at the tavern", glyph: "idle" }
  if (step?.kind === "stay" && step.rest === "chat") return { verb: "chatting", glyph: "idle" }
  if (pose.act === "work") return { verb: "at work", glyph: "work" }
  return { verb: "resting", glyph: "idle" }
}

/** The residents as life's agents, on life's agent seconds from `RESIDENT_EPOCH`. */
export interface ResidentAgents extends AgentSource {
  dispose(): void
}

export function residentAgents(
  residents: readonly Resident[],
  plan: (req: AgentDeskRequest) => Promise<AgentDeskReply | null>,
  /** The hour the island shows now (life's day clock). */
  hour: () => number,
): ResidentAgents {
  const at = (secs: number) => RESIDENT_EPOCH + secs * 1000
  const looks: HeroLook[] = residents.map(({ zones: _, commits: __, ...look }) => look)
  let byId = new Map<string, Itinerary>()
  let planned = Number.NEGATIVE_INFINITY
  let asking = false
  let first = true
  let secsNow = 0
  let gone = false
  return {
    list: () => looks,
    ownNames: true,
    poseAt(id, secs) {
      secsNow = secs
      const it = byId.get(id)
      return it ? poseAt(it, at(secs)) : null
    },
    itinerary: (id) => byId.get(id),
    chipViews(secs, walking) {
      const t = at(secs)
      const out = new Map<string, ChipView>()
      for (const r of residents) {
        const it = byId.get(r.id)
        if (!it) continue
        const pose = poseAt(it, t)
        const v = residentVerb(it, pose, t)
        out.set(r.id, {
          id: r.id,
          name: r.name,
          colour: r.colour,
          pips: 0,
          tone: v.glyph === "work" ? "work" : "idle",
          glyph: walking(r.id) ? "walk" : v.glyph,
          verb: v.verb,
          target: "",
          sigil: null,
          quiet: true,
          plea: false,
          speech: "",
        })
      }
      return out
    },
    tick() {
      if (asking || gone || !residents.length) return
      const now = at(secsNow)
      const until = now + AHEAD
      if (!first && until <= planned + AHEAD / 2) return
      const req: AgentDeskRequest = {
        events: first ? residentJoins(residents) : [],
        until,
        day: { at: now, hour: hour() },
        ...(first ? { reset: true, residents: residents.map((r) => ({ id: r.id, zones: r.zones })) } : {}),
      }
      first = false
      planned = until
      asking = true
      void plan(req).then((reply) => {
        asking = false
        if (!reply || gone) return
        byId = new Map(reply.itineraries.map((it) => [it.id, it]))
      })
    },
    dispose() {
      gone = true
    },
  }
}
