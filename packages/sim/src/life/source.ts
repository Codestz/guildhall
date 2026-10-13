import type { LifePose } from "@guildhall/world"
import type { EventLog } from "../events/log.ts"
import type { GuildWorld } from "../events/reduce.ts"
import { heroes } from "../events/select.ts"
import type { ArchetypeId } from "../roster/archetypes.ts"
import type { Body } from "../roster/bodies.ts"
import { type Itinerary, type ItineraryOptions, itineraries, type LifeKit, poseAt } from "./itineraries.ts"

/**
 * What draws the heroes reads (plan-hud-events.md L2): who they are, and where each is at a time on the
 * events' clock (ms). A source made from a log plans it whole (a replay, a story); a live feed keeps a
 * `LifePlanner` and answers from it the same way.
 */
export interface AgentInfo {
  id: string
  /** The hall's name for them (`Guildmaster`, `Scout`). */
  name: string
  archetype: ArchetypeId
  /** The KayKit adventurer that draws them. */
  body: Body
  /** Their banner's colour. */
  color: string
  /** A guildmaster (a root session). */
  root: boolean
}

export interface AgentSource {
  /** The heroes, in join order. */
  list(): readonly AgentInfo[]
  /** Where hero `id` is at `t` (ms on the events' clock); null while it is not on the island. */
  poseAt(id: string, t: number): LifePose | null
}

/** A planned source: the cast and their itineraries (plain data: what a worker posts). */
export interface PlannedAgents {
  cast: AgentInfo[]
  itineraries: Itinerary[]
  /** The events' first and last times (ms): the span a replay plays. */
  span: [number, number]
}

/** A world's cast: everyone who has been on the island (those who left too), in join order. */
export function agentsOf(world: GuildWorld): AgentInfo[] {
  return heroes(world, world.at, { gone: true }).map((h) => ({
    id: h.id,
    name: h.name,
    archetype: h.archetype,
    body: h.body,
    color: h.color,
    root: h.root,
  }))
}

/** Plans a whole log for drawing: its cast, every hero's itinerary and the span it covers. */
export function planAgents(
  log: EventLog,
  kit: LifeKit,
  opts: ItineraryOptions & { until?: number } = {},
): PlannedAgents {
  const its = itineraries(log, kit, opts)
  const first = log.events[0]?.at ?? 0
  const last = log.events[log.events.length - 1]?.at ?? first
  return { cast: agentsOf(log.head), itineraries: [...its.values()], span: [first, last] }
}

/** A source over planned agents (from `planAgents`, here or posted by a worker). */
export function plannedSource(planned: PlannedAgents): AgentSource {
  const byId = new Map(planned.itineraries.map((it) => [it.id, it]))
  return {
    list: () => planned.cast,
    poseAt(id, t) {
      const it = byId.get(id)
      return it ? poseAt(it, t) : null
    },
  }
}

/** A log as a source: planned whole, now (`planAgents` + `plannedSource`). */
export function agentSourceFromLog(
  log: EventLog,
  kit: LifeKit,
  opts: ItineraryOptions & { until?: number } = {},
): AgentSource {
  return plannedSource(planAgents(log, kit, opts))
}
