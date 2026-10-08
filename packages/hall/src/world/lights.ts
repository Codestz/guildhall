import type { Placement } from "./furniture.ts"
import { GRAVEYARD } from "./graveyard.ts"
import { toPlot } from "./lands.ts"
import { ROOM, type Spot } from "./layout.ts"
import { handWorld, type World } from "./world.ts"

/**
 * The island's night lights (conductor; the user asked for "more lamps, torches, anything that
 * provides light in the night"): tall torches along the roads, lanterns at the well, markets, dock
 * and every job site, a pair of great torches at the gate. Placed from the map's data, never by
 * hand: one torch per road hex, alternating sides, skipped wherever it would stand in water, in
 * the keep or inside a building. Placed for a world (world/world.ts): the hand map's, or a repo
 * island's, whose roads and districts get the same treatment (the keep and its gate too; it has no
 * graveyard). Each
 * light has a flame (a halo in scene/atmosphere/Lamps) and a pool of light on the ground
 * (scene/lights/StreetLights).
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

/** What the lights keep clear of, from a world's data. */
interface Ground {
  hand: boolean
  water: readonly Spot[]
  buildings: readonly Spot[]
  roads: readonly (readonly [Spot, Spot])[]
  posts: readonly Spot[]
}

function groundOf(world: World): Ground {
  const { nodes, edges } = world.roads
  return {
    hand: world.kind === "hand",
    water: world.island.water,
    buildings: world.island.decor.filter((d) => d.piece.startsWith("building_")).map((d) => [d.x, d.z]),
    roads: edges.flatMap(([a, b]) => {
      const from = nodes[a]
      const to = nodes[b]
      return from && to ? [[from, to] as const] : []
    }),
    posts: world.sites.flatMap((site) => site.posts.map((p) => [p[0], p[1]] as Spot)),
  }
}

function clear(ground: Ground, [x, z]: Spot, spacing: Spot[], rules: Rules = TORCH_RULES): boolean {
  // Every world has the keep at the origin; only the hand map has the graveyard.
  if (Math.abs(x) < ROOM.width / 2 + KEEP_MARGIN && Math.abs(z) < ROOM.depth / 2 + KEEP_MARGIN) return false
  if (ground.water.some((w) => Math.hypot(w[0] - x, w[1] - z) < WATER_CLEARANCE)) return false
  if (ground.buildings.some((b) => Math.hypot(b[0] - x, b[1] - z) < rules.building)) return false
  if (ground.roads.some(([a, b]) => toSegment([x, z], a, b) < rules.road)) return false
  if (ground.posts.some((p) => Math.hypot(p[0] - x, p[1] - z) < POST_CLEARANCE)) return false
  if (ground.hand && toPlot(x, z) < GRAVEYARD_CLEARANCE) return false
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

function build(world: World): Light[] {
  const ground = groundOf(world)
  const { nodes, edges } = world.roads
  const out: Light[] = []
  const taken: Spot[] = []
  const add = (light: Light) => {
    out.push(light)
    taken.push([light.placement.x, light.placement.z])
  }

  // The keep's gate: two great torches flanking the road out.
  add(torch(-3.2, ROOM.depth / 2 + 3.4, 1.35))
  add(torch(3.2, ROOM.depth / 2 + 3.4, 1.35))

  // Roads: one torch per road hex, beside the road (perpendicular to it), alternating sides.
  const neighbours = new Map<string, string[]>()
  for (const [a, b] of edges) {
    neighbours.set(a, [...(neighbours.get(a) ?? []), b])
    neighbours.set(b, [...(neighbours.get(b) ?? []), a])
  }
  let side = 1
  for (const [name, at] of Object.entries(nodes)) {
    const next = neighbours.get(name)?.[0]
    const to = next ? nodes[next] : undefined
    const dx = to ? to[0] - at[0] : 1
    const dz = to ? to[1] - at[1] : 0
    const length = Math.hypot(dx, dz) || 1
    side = -side
    const candidates: Spot[] = [
      [at[0] + (-dz / length) * SIDE_OFFSET * side, at[1] + (dx / length) * SIDE_OFFSET * side],
      [at[0] - (-dz / length) * SIDE_OFFSET * side, at[1] - (dx / length) * SIDE_OFFSET * side],
    ]
    const spot = candidates.find((c) => clear(ground, c, taken))
    if (spot) add(torch(spot[0], spot[1]))
  }

  // Village landmarks people gather at, and every job site: lanterns, two each where they fit.
  const lanternsAround = (cx: number, cz: number, count: number) => {
    let placed = 0
    for (let ring = 3; ring <= 5.5 && placed < count; ring += 1.25) {
      for (let k = 0; k < 10 && placed < count; k++) {
        const angle = 0.4 + (k / 10) * Math.PI * 2
        const spot: Spot = [cx + Math.cos(angle) * ring, cz + Math.sin(angle) * ring]
        if (clear(ground, spot, taken, LANTERN_RULES)) {
          add(lantern(spot[0], spot[1]))
          placed++
        }
      }
    }
  }
  for (const l of world.island.landmarks)
    if (l.kind === "well" || l.kind === "market" || l.kind === "dock") lanternsAround(l.x, l.z, 2)
  for (const site of world.sites) lanternsAround(site.at[0], site.at[1], 2)
  return out
}

const lights = new WeakMap<World, readonly Light[]>()
/** A world's street lights (placed once per world). */
export function lightsOf(world: World): readonly Light[] {
  let known = lights.get(world)
  if (!known) {
    known = build(world)
    lights.set(world, known)
  }
  return known
}

const glows = new WeakMap<World, readonly Glow[]>()
/**
 * Every flame that glows at night in a world: its street lights, plus (the hand map's) the
 * graveyard's lanterns and candles (world/graveyard.ts; drawn by scene/Graveyard).
 */
export function glowsOf(world: World): readonly Glow[] {
  let known = glows.get(world)
  if (!known) {
    known = world.kind === "hand" ? [...lightsOf(world), ...GRAVEYARD.glows] : lightsOf(world)
    glows.set(world, known)
  }
  return known
}

/** The hand map's street lights. */
export const LIGHTS: readonly Light[] = lightsOf(handWorld())

/** The hand map's flames: its street lights and the graveyard's. */
export const GLOWS: readonly Glow[] = glowsOf(handWorld())
