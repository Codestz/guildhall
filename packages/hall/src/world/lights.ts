import type { Placement } from "./furniture.ts"
import { GRAVEYARD } from "./graveyard.ts"
import { island, ROAD_EDGES, ROAD_NODES, SITES, toPlot } from "./lands.ts"
import { ROOM, type Spot } from "./layout.ts"

/**
 * The island's night lights (conductor; the user asked for "more lamps, torches, anything that
 * provides light in the night"): tall torches along the roads, lanterns at the well, markets, dock
 * and every job site, a pair of great torches at the gate. Placed from the map's data, never by
 * hand: one torch per road hex, alternating sides, skipped wherever it would stand in water, in
 * the keep or inside a building. Each light has a flame (a halo in scene/atmosphere/Lamps) and a
 * pool of light on the ground (scene/lights/StreetLights).
 */

/** A flame that glows after dusk: a halo (scene/atmosphere/Lamps) and a pool on the ground (StreetLights). */
export interface Glow {
  /** Where the flame burns, world units. */
  flame: readonly [x: number, y: number, z: number]
  /** Halo size and ground-pool radius. */
  halo: number
  pool: number
}

export interface Light extends Glow {
  /** What stands there (a kit.glb piece). */
  placement: Placement
}

/** A street torch: the RPG torch scaled up to a post. Flame at the top. */
const TORCH_SCALE = 2.6
const TORCH_FLAME_Y = 0.92 * TORCH_SCALE
const LANTERN_FLAME_Y = 0.62

const SIDE_OFFSET = 3.6
/** Never on a road (any road, not just its own): torches stand on the verge. */
const ROAD_CLEARANCE = 2.8
/** Never where an adventurer stands to work. */
const POST_CLEARANCE = 1.8
const KEEP_MARGIN = 3
const WATER_CLEARANCE = 5.6
/** Off the graveyard's fence: its gate, path and own lanterns are in front of it. */
const GRAVEYARD_CLEARANCE = 3
const BUILDING_CLEARANCE = 4.2
const MIN_SPACING = 7.5

const land = island()
const buildings: Spot[] = land.decor.filter((d) => d.piece.startsWith("building_")).map((d) => [d.x, d.z])
const roads: (readonly [Spot, Spot])[] = ROAD_EDGES.flatMap(([a, b]) => {
  const from = ROAD_NODES[a]
  const to = ROAD_NODES[b]
  return from && to ? [[from, to] as const] : []
})
const posts: Spot[] = Object.values(SITES).flatMap((site) => site.posts.map((p) => [p[0], p[1]] as Spot))

/** Distance from a point to a segment. */
export function toSegment(p: Spot, a: Spot, b: Spot): number {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)))
  return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dz * t))
}

/** Lanterns are small: they may stand closer to roads and buildings than a torch post. */
interface Rules {
  road: number
  building: number
}
const TORCH_RULES: Rules = { road: ROAD_CLEARANCE, building: BUILDING_CLEARANCE }
const LANTERN_RULES: Rules = { road: 1.7, building: 3.2 }

function clear([x, z]: Spot, spacing: Spot[], rules: Rules = TORCH_RULES): boolean {
  if (Math.abs(x) < ROOM.width / 2 + KEEP_MARGIN && Math.abs(z) < ROOM.depth / 2 + KEEP_MARGIN) return false
  if (land.water.some((w) => Math.hypot(w[0] - x, w[1] - z) < WATER_CLEARANCE)) return false
  if (buildings.some((b) => Math.hypot(b[0] - x, b[1] - z) < rules.building)) return false
  if (roads.some(([a, b]) => toSegment([x, z], a, b) < rules.road)) return false
  if (posts.some((p) => Math.hypot(p[0] - x, p[1] - z) < POST_CLEARANCE)) return false
  if (toPlot(x, z) < GRAVEYARD_CLEARANCE) return false
  return !spacing.some((s) => Math.hypot(s[0] - x, s[1] - z) < MIN_SPACING)
}

function torch(x: number, z: number, scale = 1): Light {
  return {
    placement: { piece: "torch", x, z, scale: TORCH_SCALE * scale },
    flame: [x, TORCH_FLAME_Y * scale, z],
    halo: 4.2 * scale,
    pool: 6.5 * scale,
  }
}

function lantern(x: number, z: number): Light {
  return {
    placement: { piece: "lantern", x, z, scale: 1.3 },
    flame: [x, LANTERN_FLAME_Y * 1.3, z],
    halo: 3.4,
    pool: 4.8,
  }
}

function build(): Light[] {
  const out: Light[] = []
  const taken: Spot[] = []
  const add = (light: Light) => {
    out.push(light)
    taken.push([light.placement.x, light.placement.z])
  }

  // The gate: two great torches flanking the road out.
  add(torch(-3.2, ROOM.depth / 2 + 3.4, 1.35))
  add(torch(3.2, ROOM.depth / 2 + 3.4, 1.35))

  // Roads: one torch per road hex, beside the road (perpendicular to it), alternating sides.
  const neighbours = new Map<string, string[]>()
  for (const [a, b] of ROAD_EDGES) {
    neighbours.set(a, [...(neighbours.get(a) ?? []), b])
    neighbours.set(b, [...(neighbours.get(b) ?? []), a])
  }
  let side = 1
  for (const [name, at] of Object.entries(ROAD_NODES)) {
    const next = neighbours.get(name)?.[0]
    const to = next ? ROAD_NODES[next] : undefined
    const dx = to ? to[0] - at[0] : 1
    const dz = to ? to[1] - at[1] : 0
    const length = Math.hypot(dx, dz) || 1
    side = -side
    const candidates: Spot[] = [
      [at[0] + (-dz / length) * SIDE_OFFSET * side, at[1] + (dx / length) * SIDE_OFFSET * side],
      [at[0] - (-dz / length) * SIDE_OFFSET * side, at[1] - (dx / length) * SIDE_OFFSET * side],
    ]
    const spot = candidates.find((c) => clear(c, taken))
    if (spot) add(torch(spot[0], spot[1]))
  }

  // Village landmarks people gather at, and every job site: lanterns, two each where they fit.
  const lanternsAround = (cx: number, cz: number, count: number) => {
    let placed = 0
    for (let ring = 3; ring <= 5.5 && placed < count; ring += 1.25) {
      for (let k = 0; k < 10 && placed < count; k++) {
        const angle = 0.4 + (k / 10) * Math.PI * 2
        const spot: Spot = [cx + Math.cos(angle) * ring, cz + Math.sin(angle) * ring]
        if (clear(spot, taken, LANTERN_RULES)) {
          add(lantern(spot[0], spot[1]))
          placed++
        }
      }
    }
  }
  for (const l of land.landmarks)
    if (l.kind === "well" || l.kind === "market" || l.kind === "dock") lanternsAround(l.x, l.z, 2)
  for (const site of Object.values(SITES)) lanternsAround(site.at[0], site.at[1], 2)
  return out
}

export const LIGHTS: readonly Light[] = build()

/**
 * Every flame that glows at night: the street lights, plus the graveyard's lanterns and candles
 * (world/graveyard.ts; their models are the graveyard's own, drawn by scene/Graveyard).
 */
export const GLOWS: readonly Glow[] = [...LIGHTS, ...GRAVEYARD.glows]
