/**
 * The life plan of a hex island (track B), as pure data: everyone's day and the agents' errands on the
 * walk graph, with the collision layer's solids, the walkways and the doorways life and the doors read
 * on the main thread. Planned in the build worker (job.ts, its last stage), where its second or so of
 * path searches blocks nothing (perf2-contract §2: no main-thread task over 100 ms); the screen's life
 * (life.ts) only draws it. Pure: no DOM, no renderer, so the worker can import it.
 */
import {
  agentLoop,
  doorPasses,
  type Folk,
  type HexDoorway,
  type HexIsland,
  type HexWorld,
  type HexZones,
  hexWalk,
  type LifeStep,
  lifePlaces,
  planFolk,
  type Solid,
  type Walkway,
  workTiles,
} from "@guildhall/world"
import { DEMO_AGENTS } from "./lifeAgents.ts"

/** Day-hours per real hour. */
export const SPEEDUP = 20
/** Walking pace, metres a second: a toy-scale person's natural walk. */
export const LIFE_MPS = 0.8

export interface LifePlan {
  /** Every townsfolk's day (world `planFolk`). */
  folk: Folk[]
  /** The demo agents' rounds, in `DEMO_AGENTS` order (world `agentLoop`). */
  agents: { steps: LifeStep[]; period: number }[]
  /** The collision layer's solids: every piece's outline, the authored blockers, the cheeks and rails. */
  solids: Solid[]
  /** The stairs, the bridges' legs and the decks people walk on. */
  walkways: Walkway[]
  /** Where each building's door is, for the doors that open and the passes through them. */
  doorways: HexDoorway[]
  /** How many people pass a door over the day, in all. */
  passes: number
  stats: { nodes: number; edges: number; planMs: number }
}

/** Plans the island's life on its map; `now` is the clock for `planMs` (performance.now by default). */
export function planLife(
  h: HexIsland,
  z: HexZones,
  w: HexWorld,
  seed: number,
  now: () => number = () => performance.now(),
): LifePlan {
  const t0 = now()
  const walk = hexWalk(h, z, w, { reach: workTiles(h, z) })
  // one reservation book: the agents take their spots and slots first, then the townsfolk
  const places = lifePlaces(h, z, w, walk)
  const agents = DEMO_AGENTS.map((a, slot) =>
    agentLoop(walk, z, a.errands, { slot: slot * 2, mps: LIFE_MPS * 1.15, role: a.recipe, places }),
  )
  const folk = planFolk(h, z, w, walk, { seed, pace: (LIFE_MPS * 3600) / SPEEDUP, places })
  return {
    folk,
    agents,
    solids: [...places.furniture.solids],
    walkways: [...w.stairs, ...w.bridges.flatMap((b) => b.legs), ...w.decks],
    doorways: w.doorways,
    passes: folk.reduce((n, f) => n + doorPasses(f.day).length, 0),
    stats: { nodes: walk.nodes.length, edges: walk.edges.length, planMs: Math.round(now() - t0) },
  }
}
