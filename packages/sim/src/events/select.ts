import type { Craft } from "@guildhall/core"
import type { ArchetypeId } from "../roster/archetypes.ts"
import type { Body } from "../roster/bodies.ts"
import type { Rank } from "../roster/ranks.ts"
import { type ActorStatus, type Ci, type GuildWorld, type Pr, placeAt, type WorldActor } from "./reduce.ts"
import type { WorldEvent } from "./world.ts"

/**
 * What the HUD reads off a world (the app maps these to the ui's own props). Pure. `t` is the clock's
 * time, at or after the world's last event: a pending move whose dwell ran out by then has happened.
 */

export interface HeroView {
  id: string
  name: string
  agent: string
  archetype: ArchetypeId
  body: Body
  color: string
  rank: Rank
  /** Where it stands: a zone index, or undefined for the hall. */
  place: number | undefined
  /** Where its work is taking it, while that is not yet settled. */
  heading: number | undefined
  status: ActorStatus
  since: number
  /** What it is doing (its latest call), if anything. */
  intent: { craft: Craft; tool: string; target: string; running: boolean; failed: boolean } | undefined
  parent: string | undefined
  /** A guildmaster: a session with no parent. */
  root: boolean
  task: string | undefined
  deeds: number
}

function heroOf(a: WorldActor, t: number): HeroView {
  const place = placeAt(a, t)
  const heading = a.pending && a.pending.place !== place ? a.pending.place : undefined
  return {
    id: a.id,
    name: a.name,
    agent: a.agent,
    archetype: a.archetype,
    body: a.body,
    color: a.color,
    rank: a.rank,
    place,
    heading,
    status: a.status,
    since: a.since,
    intent: a.intent && {
      craft: a.intent.craft,
      tool: a.intent.tool,
      target: a.intent.target,
      running: a.intent.ended === undefined,
      failed: a.intent.failed === true,
    },
    parent: a.parent,
    root: a.parent === undefined,
    task: a.task,
    deeds: a.deeds,
  }
}

/** The heroes on the island (those who left are not, unless `gone`), in join order. */
export function heroes(world: GuildWorld, t: number = world.at, opts: { gone?: boolean } = {}): HeroView[] {
  const out: HeroView[] = []
  for (const a of world.actors.values()) if (opts.gone || a.gone === undefined) out.push(heroOf(a, t))
  const joined = (h: HeroView) => world.actors.get(h.id)?.joined ?? 0
  return out.sort((a, b) => joined(a) - joined(b) || (a.id < b.id ? -1 : 1))
}

export interface Plea {
  id: string
  name: string
  color: string
  since: number
}

/** Who waits on a human, longest first. */
export function pleas(world: GuildWorld): Plea[] {
  const out: Plea[] = []
  for (const a of world.actors.values())
    if (a.plea !== undefined) out.push({ id: a.id, name: a.name, color: a.color, since: a.plea })
  return out.sort((a, b) => a.since - b.since || (a.id < b.id ? -1 : 1))
}

/** The latest `n` events worth telling, oldest first. */
export function recent(world: GuildWorld, n = 8): readonly WorldEvent[] {
  return world.recent.slice(-n)
}

/** CI as weather: a storm while any branch's latest run failed, clouds while one runs, else clear. */
export type Weather = "clear" | "cloudy" | "storm"

export function weatherOf(world: GuildWorld): Weather {
  let cloudy = false
  for (const run of world.sea.ci.values()) {
    if (run.state === "failed") return "storm"
    if (run.state === "queued" || run.state === "running") cloudy = true
  }
  return cloudy ? "cloudy" : "clear"
}

export interface Harbour {
  /** Open pull requests, oldest first. */
  prs: Pr[]
  /** The latest run per branch, newest first. */
  ci: Ci[]
  weather: Weather
  pushes: number
  merged: number
  release: GuildWorld["sea"]["lastRelease"]
}

export function harbourOf(world: GuildWorld): Harbour {
  return {
    prs: [...world.sea.prs.values()].sort((a, b) => a.opened - b.opened || a.n - b.n),
    ci: [...world.sea.ci.values()].sort((a, b) => b.at - a.at),
    weather: weatherOf(world),
    pushes: world.sea.pushes,
    merged: world.sea.merged,
    release: world.sea.lastRelease,
  }
}
