import { type Behaviour, legOf, type Place, type Step, spotsOf } from "../../src/world/behaviours.ts"
import { box, circle, islandObstacles, keepObstacles, type Obstacle } from "../../src/world/clearance.ts"
import { plant } from "../../src/world/fields.ts"
import GRAVE_BOUNDS from "../../src/world/graveyard.json"
import { GRAVEYARD } from "../../src/world/graveyard.ts"
import LANDS from "../../src/world/lands.json"
import { HEX_SCALE, island } from "../../src/world/lands.ts"
import type { Spot } from "../../src/world/layout.ts"

export { BODY, blocker, type Obstacle } from "../../src/world/clearance.ts"

/** Everything standing on the island, and in the keep (src/world/clearance.ts: the crowds read them too). */
export const ISLAND_OBSTACLES: Obstacle[] = [...islandObstacles()]
export const KEEP_OBSTACLES: Obstacle[] = [...keepObstacles()]

type Bounds = { min: number[]; max: number[] }

/** Every walk one worker makes running `steps` from `from`, as router paths. */
export function walks(place: Place, steps: readonly Step[], from: Spot): { to: string; path: Spot[] }[] {
  const out: { to: string; path: Spot[] }[] = []
  let at = from
  for (const step of steps) {
    if (!("walk" in step)) continue
    const to = place.spots[step.walk]
    if (!to) throw new Error(`no spot ${step.walk}`)
    out.push({ to: step.walk, path: [at, ...legOf(at, to)] })
    at = to
  }
  return out
}

/** Points every `every` along a path, ends included. */
export function along(path: readonly Spot[], every = 0.25): Spot[] {
  const out: Spot[] = []
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1] as Spot
    const b = path[i] as Spot
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / every))
    for (let k = 0; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n])
  }
  return out
}

export function placeFor(
  key: string,
  behaviour: Behaviour,
  post: readonly [number, number, number],
  berth: number,
): Place {
  return { key, behaviour, berth, post, spots: spotsOf(behaviour, post, berth) }
}

/** The festival's bunting poles (scene/events/Festival.tsx POLES): up only during a festival. */
const FESTIVAL_POLES: readonly Spot[] = [
  [-4.6, 17.5],
  [4.6, 17.5],
  [-3.6, 24],
  [3.8, 23.5],
  [-3.8, 30.5],
  [3.4, 29],
  [-3.6, 41],
  [3.6, 41],
  [-12.5, 21],
  [12.5, 27],
]

/**
 * The townsfolk's ground (scene/life/rounds.ts): the island's obstacles, plus what only people
 * walking about the village and farms run into: the graveyard's fence, graves and crypt, the farm
 * plots' crops and fences, the keep's walls, and the festival's bunting poles on the square.
 */
export const TOWN_OBSTACLES: Obstacle[] = (() => {
  const out: Obstacle[] = [...ISLAND_OBSTACLES]
  for (const p of GRAVEYARD.pieces) {
    if (/^(floor_|path_|bone_)/.test(p.piece)) continue
    // The arch is open underneath: only its two posts stand in the way.
    if (p.piece === "arch_gate") {
      for (const side of [-1.9, 1.9]) out.push(circle("graveyard arch post", p.x, p.z + side, 0.3))
      continue
    }
    const bounds = (GRAVE_BOUNDS as Record<string, Bounds>)[p.piece] as Bounds
    // A stretched fence is longer along its own x: widen the box rather than the scale.
    const stretch = p.stretch ?? 1
    const wide: Bounds = {
      min: [(bounds.min[0] ?? 0) * stretch, 0, bounds.min[2] ?? 0],
      max: [(bounds.max[0] ?? 0) * stretch, 0, bounds.max[2] ?? 0],
    }
    out.push(box(`graveyard ${p.piece}`, wide, p.x, p.z, p.rot ?? 0, p.scale ?? 1))
  }
  for (const crop of plant().crops) out.push(circle(`crop ${crop.piece}`, crop.x, crop.z, 0.25))
  for (const piece of island().decor)
    if (piece.piece.startsWith("fence_"))
      out.push(
        box(
          piece.piece,
          (LANDS as Record<string, Bounds>)[piece.piece] as Bounds,
          piece.x,
          piece.z,
          piece.rot ?? 0,
          HEX_SCALE * (piece.scale ?? 1),
        ),
      )
  out.push(box("keep", { min: [-18.5, 0, -12.5], max: [18.5, 0, 12.5] }, 0, 0, 0, 1))
  for (const [x, z] of FESTIVAL_POLES) out.push(circle("festival pole", x, z, 0.2))
  return out
})()
