/**
 * The life plan of a hex island (track B), as pure data: everyone's day and the agents' itineraries on
 * the walk graph, with the collision layer's solids, the walkways and the doorways life and the doors
 * read on the main thread. Planned in the build worker (job.ts, its last stage), where its second or
 * so of path searches blocks nothing (perf2-contract §2: no main-thread task over 100 ms); the screen's
 * life (life.ts) only draws it. Pure: no DOM, no renderer, so the worker can import it.
 *
 * The agents (L2): the heroes' spot pool is set aside here (world `lifePlaces(..., {heroSpots})`, which
 * changes nobody's day), and a guild's wire (the demo story, or a recorded run: lifeAgents.ts) goes
 * through the sim's pipe, normalize → EventLog → itineraries (sim `planAgents`), into plain data.
 */
import {
  type AgentInfo,
  agentsOf,
  bindPlaces,
  DWELL_MS,
  EventLog,
  flush,
  GONE_MS,
  type Itinerary,
  type LifeKit,
  LifePlanner,
  normalize,
  normalizer,
  planAgents,
  type WorldEvent,
} from "@guildhall/sim"
import {
  doorPasses,
  type Folk,
  guildhallZone,
  type HexDoorway,
  type HexIsland,
  type HexWalk,
  type HexWorld,
  type HexZones,
  hexWalk,
  type LifePlaces,
  lifePlaces,
  type PlaceSpec,
  planFolk,
  planStocks,
  type Solid,
  type Stock,
  type Walkway,
  workTiles,
} from "@guildhall/world"
import { type AgentFeed, type AgentPlan, demoPlaceOf, demoStory } from "./lifeAgents.ts"

/** Day-hours per real hour. */
export const SPEEDUP = 20
/** Screen seconds to a day hour: what work routines run on (world routines.ts). */
export const SEC_PER_HOUR = 3600 / SPEEDUP
/** Walking pace, metres a second: a toy-scale person's natural walk. */
export const LIFE_MPS = 0.8
/** Agents walk this much faster than the townsfolk (they are on an errand). */
export const AGENT_PACE = 1.15
/** Hero spots each place sets aside (world heroes.ts; the Guildhall's gathering has up to twice as many). */
export const HERO_SPOTS = 3
/** A round of agents ends this long after its last walk home (ms), before it plays again. */
const ROUND_REST = 15_000

export interface LifePlan {
  /** Every townsfolk's day (world `planFolk`). */
  folk: Folk[]
  /**
   * What their work leaves over the day (world `planStocks`): baskets, the ore carts and heaps, log
   * piles, planks, bars, crates, arrows, a stall's fish; levels by `stocksAt(stocks, hour, SEC_PER_HOUR)`.
   */
  stocks: Stock[]
  /** The agents' guild planned on the walk graph (none: `?agents=0`). */
  agents: AgentPlan | null
  /** The collision layer's solids: every piece's outline, the authored blockers, the cheeks and rails. */
  solids: Solid[]
  /** The stairs, the bridges' legs and the decks people walk on. */
  walkways: Walkway[]
  /** Where each building's door is, for the doors that open and the passes through them. */
  doorways: HexDoorway[]
  /**
   * A notice board for life.ts to draw: none now, the world sets it up with its pieces (world
   * `HexWorld.board`, drawn by the batch; `heroSpots.board()` is where the Guildmaster pins at it).
   */
  board: { at: [number, number, number]; facing: number } | null
  /** How many people pass a door over the day, in all. */
  passes: number
  stats: { nodes: number; edges: number; planMs: number; agentsMs: number; walks: number }
}

/** What else life plans with: the agents to show, and a hall's places (a recording's paths bind to them). */
export interface LifePlanOpts {
  agents?: AgentFeed | null
  places?: PlaceSpec[]
  /** The repo's name ("owner/name"): its folder in a recording's absolute paths. */
  repo?: string
}

/** Plans the island's life on its map; `now` is the clock for `planMs` (performance.now by default). */
export function planLife(
  h: HexIsland,
  z: HexZones,
  w: HexWorld,
  seed: number,
  now: () => number = () => performance.now(),
  opts: LifePlanOpts = {},
): LifePlan {
  return planLifeDesk(h, z, w, seed, now, opts).plan
}

/**
 * The life plan, and the desk the build worker keeps after it (`AgentDesk`): the walk graph and the
 * heroes' spots stay there, so a session's events (a hall's feed) are planned where the graph is.
 */
export function planLifeDesk(
  h: HexIsland,
  z: HexZones,
  w: HexWorld,
  seed: number,
  now: () => number = () => performance.now(),
  opts: LifePlanOpts = {},
): { plan: LifePlan; desk: AgentDesk } {
  const t0 = now()
  const walk = hexWalk(h, z, w, { reach: workTiles(h, z) })
  // one reservation book for the townsfolk; the heroes' spots are a pool of their own beside it (set
  // aside when first asked for, and changing nobody's day)
  const places = lifePlaces(h, z, w, walk, { heroSpots: HERO_SPOTS })
  const kit = kitOf(h, z, walk, places)
  const t1 = now()
  const agents = opts.agents ? planGuild(z, walk, kit, opts.agents, opts) : null
  const agentsMs = now() - t1
  const folk = planFolk(h, z, w, walk, {
    seed,
    pace: (LIFE_MPS * 3600) / SPEEDUP,
    places,
    secPerHour: SEC_PER_HOUR,
  })
  const plan: LifePlan = {
    folk,
    stocks: planStocks(folk),
    agents,
    // (the notice board is the world's now: its pieces are in the batch and their outlines among these)
    solids: [...places.furniture.solids],
    walkways: [...w.stairs, ...w.bridges.flatMap((b) => b.legs), ...w.decks],
    doorways: w.doorways,
    board: null,
    passes: folk.reduce((n, f) => n + doorPasses(f.day).length, 0),
    stats: {
      nodes: walk.nodes.length,
      edges: walk.edges.length,
      planMs: Math.round(now() - t0),
      agentsMs: Math.round(agentsMs),
      walks:
        agents?.itineraries.reduce((n, it) => n + it.steps.filter((s) => s.kind === "walk").length, 0) ?? 0,
    },
  }
  return { plan, desk: agentDesk(kit) }
}

/** What the heroes' planner walks on an island (sim `LifeKit`). */
export function kitOf(
  h: HexIsland,
  z: HexZones,
  walk: HexWalk,
  places: Pick<LifePlaces, "heroSpots" | "walkNear">,
): LifeKit {
  return {
    walk,
    spots: (zi) => places.heroSpots(zi),
    home: guildhallZone(walk, z),
    near: places.walkNear,
    island: h,
    board: places.heroSpots.board(),
  }
}

/**
 * How the heroes are planned in life: a little quicker than the townsfolk (they are on an errand), and a
 * way that would take over 30 s to walk is run, at up to 3.5 m/s (sim `hurry`).
 */
export const AGENT_OPTS = { mps: LIFE_MPS * AGENT_PACE, hurry: { within: 30, mps: 3.5 } } as const

/** A session's world events in, its heroes' itineraries out (plain data, as the worker posts them). */
export interface AgentDeskRequest {
  /** Start again: a new log (a feed that started over). */
  reset?: boolean
  /** The log's events after those already sent, in order. */
  events: WorldEvent[]
  /** Plan the moves due by then too (a dwell that ran out with no event after it). */
  until: number
}

export interface AgentDeskReply {
  cast: AgentInfo[]
  itineraries: Itinerary[]
  /** ms the planning took (in the worker). */
  ms: number
}

/** The planner the worker keeps for a session (sim `LifePlanner`), fed as the session's log grows. */
export interface AgentDesk {
  plan(req: AgentDeskRequest): AgentDeskReply
}

export function agentDesk(kit: LifeKit): AgentDesk {
  let planner = new LifePlanner(kit, AGENT_OPTS)
  return {
    plan(req) {
      const t0 = performance.now()
      if (req.reset) planner = new LifePlanner(kit, AGENT_OPTS)
      for (const ev of req.events) planner.push(ev)
      if (req.until > planner.at) planner.advance(req.until)
      return {
        cast: agentsOf(planner.world),
        itineraries: [...planner.itineraries.values()],
        ms: performance.now() - t0,
      }
    },
  }
}

/**
 * A guild's wire planned for life: normalised with the island's binding (a hall's places, or the demo's
 * folders), folded into a log (every leave due included), and its heroes' itineraries planned on the
 * walk graph from their hero spots. A round lasts until the last of them is home and still, and a rest.
 */
export function planGuild(
  z: HexZones,
  walk: HexWalk,
  kit: LifeKit,
  feed: AgentFeed,
  opts: Pick<LifePlanOpts, "places" | "repo"> = {},
): AgentPlan {
  const placeOf =
    feed.kind === "story"
      ? demoPlaceOf(z, walk)
      : opts.places
        ? bindPlaces(opts.places, z, opts.repo ? { repo: opts.repo } : {}).placeOf
        : undefined
  const ctx = normalizer(placeOf ? { placeOf } : {})
  const log = new EventLog()
  for (const ev of feed.kind === "story" ? demoStory() : feed.wire) log.append(...normalize(ev, ctx))
  log.append(...flush(ctx, log.head.at + GONE_MS + 1))
  const planned = planAgents(log, kit, { ...AGENT_OPTS, until: log.head.at + DWELL_MS })
  // the round: until the last walk ends or the last hero fades, whichever is later
  let end = planned.span[1]
  for (const it of planned.itineraries) {
    const last = it.steps[it.steps.length - 1]
    if (last) end = Math.max(end, last.from)
    for (const [, to] of it.shown) if (Number.isFinite(to)) end = Math.max(end, to)
  }
  return { ...planned, feed: feed.kind, period: end - planned.span[0] + ROUND_REST, events: [...log.events] }
}
