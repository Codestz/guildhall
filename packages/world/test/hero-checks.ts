/**
 * What "a place's hero spots are good" means, as checks over a built island (hex-heroes.test.ts runs them
 * over seeds and sizes, apps/studio's hall-heroes.test.ts over the repo halls):
 *
 *   short      a place (a zone with tiles and a heart on the walk graph) with fewer than HERO_SPOTS_MIN;
 *   solid      a spot within a body's room (0.25 m) of any solid: a building, a wall, a fence, a prop, a seat;
 *   road       a spot on a road, street, square, stair or bridge strip (roads.ts), or on a flight of stairs;
 *   door       a spot in a door's approach (checks.ts DOOR_RUN × DOOR_HALF out from its front);
 *   folk       a spot within 0.5 m of a townsfolk spot or a meeting slot (nobody's spot is a hero's);
 *   unreached  a spot no body walks to over open ground (never through a building, a wall or a fence, a
 *              body's core clear of their outlines, not over water) from its walk node, flooded on a 0.1 m
 *              grid as hex-spots-reach.test.ts does;
 *   offGraph   a spot whose node the Guildhall's heart has no route to;
 *   crowd      two hero spots (of one place or of two) nearer than 1.2 m.
 */
import { roadStrips, StripGrid } from "../src/hex/roads.ts"
import {
  DOOR_HALF,
  DOOR_RUN,
  guildhallZone,
  HARD,
  HERO_SPOTS_MIN,
  HEX_TILE_SIZE,
  type HexIsland,
  type HexWalk,
  type HexWorld,
  type HexZones,
  hexAt,
  kindOf,
  type LifePlaces,
  solidDistance,
  useOf,
} from "../src/index.ts"

export interface HeroReport {
  places: number
  spots: number
  /** The fewest spots a place has (its gathering aside). */
  least: number
  short: number
  solid: number
  road: number
  door: number
  folk: number
  unreached: number
  offGraph: number
  crowd: number
  notes: string[]
}

const WATER = new Set(["sea", "shallows", "lake", "river"])
const CORE = 0.12
const BODY = 0.2
const CELL = 0.1

export function heroReport(
  h: HexIsland,
  z: HexZones,
  w: HexWorld,
  walk: HexWalk,
  places: LifePlaces,
): HeroReport {
  const g = h.grid
  const f = places.furniture
  const strips = new StripGrid(roadStrips(h, w))
  const home = guildhallZone(walk, z)
  const r: HeroReport = {
    places: 0,
    spots: 0,
    least: Number.POSITIVE_INFINITY,
    short: 0,
    solid: 0,
    road: 0,
    door: 0,
    folk: 0,
    unreached: 0,
    offGraph: 0,
    crowd: 0,
    notes: [],
  }
  const folk: [number, number][] = f.spots.map((s) => [s.x, s.z])
  for (const zi of z.zones.keys()) for (const s of places.slots(zi)) folk.push([s.at[0], s.at[2]])
  const overWater = (x: number, zz: number) => {
    const { q, r: rr } = hexAt(x / HEX_TILE_SIZE, zz / HEX_TILE_SIZE)
    const i = g.index(q, rr)
    if (i < 0) return true
    const u = useOf(z, i)
    return WATER.has(kindOf(h, i)) && u !== "dock" && u !== "bridge" && w.stairAt(x, zz) === null
  }
  const reached = (node: { x: number; z: number }, s: { x: number; z: number }): boolean => {
    const room = 4
    const x0 = Math.floor((Math.min(node.x, s.x) - room) / CELL) * CELL
    const z0 = Math.floor((Math.min(node.z, s.z) - room) / CELL) * CELL
    const nx = Math.ceil((Math.max(node.x, s.x) + room - x0) / CELL)
    const nz = Math.ceil((Math.max(node.z, s.z) + room - z0) / CELL)
    const at = (a: number, b: number): [number, number] => [x0 + (a + 0.5) * CELL, z0 + (b + 0.5) * CELL]
    const open = new Uint8Array(nx * nz)
    for (let a = 0; a < nx; a++)
      for (let b = 0; b < nz; b++) {
        const [x, zz] = at(a, b)
        open[a * nz + b] = f.blocked(x, zz, CORE, HARD) || overWater(x, zz) ? 0 : 1
      }
    const seen = new Uint8Array(nx * nz)
    const queue: number[] = []
    for (let a = 0; a < nx; a++)
      for (let b = 0; b < nz; b++) {
        const [x, zz] = at(a, b)
        if (open[a * nz + b] && Math.hypot(x - node.x, zz - node.z) <= 1.6) {
          seen[a * nz + b] = 1
          queue.push(a * nz + b)
        }
      }
    while (queue.length) {
      const c = queue.pop()!
      const a = Math.floor(c / nz)
      const b = c % nz
      const [x, zz] = at(a, b)
      if (Math.hypot(x - s.x, zz - s.z) <= BODY + 0.25) return true
      for (const [A, B] of [
        [a + 1, b],
        [a - 1, b],
        [a, b + 1],
        [a, b - 1],
      ] as const) {
        if (A < 0 || B < 0 || A >= nx || B >= nz) continue
        const id = A * nz + B
        if (seen[id] || !open[id]) continue
        seen[id] = 1
        queue.push(id)
      }
    }
    return false
  }
  const homeHeart = walk.hearts[home]!
  for (const [zi, zone] of z.zones.entries()) {
    if (!zone.tiles.length || walk.hearts[zi]! < 0 || !walk.route(homeHeart, walk.hearts[zi]!)) continue
    r.places++
    const spots = places.heroSpots(zi)
    r.spots += spots.length
    if (zi !== home) r.least = Math.min(r.least, spots.length)
    if (spots.length < HERO_SPOTS_MIN) {
      r.short++
      r.notes.push(`zone ${zi} (${zone.kind}, ${zone.tiles.length} tiles): ${spots.length} spots`)
    }
    for (const s of spots) {
      const [x, , zz] = s.at
      const where = `zone ${zi} (${zone.kind}) ${s.pose} at ${x.toFixed(1)},${zz.toFixed(1)}`
      if (f.solidsNear(x, zz, 0.25).some((o) => solidDistance(o, x, zz) < 0.25)) {
        r.solid++
        r.notes.push(`${where}: in a solid`)
      }
      if (strips.on(x, zz, 0) || w.stairAt(x, zz) !== null) {
        r.road++
        r.notes.push(`${where}: on a road`)
      }
      const inDoor = w.doorways.some((d) => {
        const ux = Math.sin(d.facing)
        const uz = Math.cos(d.facing)
        const u = (x - d.x) * ux + (zz - d.z) * uz
        const v = Math.abs(-(x - d.x) * uz + (zz - d.z) * ux)
        return u >= 0 && u <= DOOR_RUN && v <= DOOR_HALF
      })
      if (inDoor) {
        r.door++
        r.notes.push(`${where}: in a door's approach`)
      }
      if (folk.some(([fx, fz]) => Math.hypot(fx - x, fz - zz) < 0.5)) {
        r.folk++
        r.notes.push(`${where}: on a townsfolk spot or slot`)
      }
      const node = walk.nodes[s.node]
      if (!node || !reached(node, { x, z: zz })) {
        r.unreached++
        r.notes.push(`${where}: not walked to from its node`)
      }
      if (!node || !walk.route(homeHeart, s.node)) {
        r.offGraph++
        r.notes.push(`${where}: its node is off the Guildhall's walk graph`)
      }
    }
  }
  const every = [...z.zones.keys()].flatMap((zi) => places.heroSpots(zi))
  for (let a = 0; a < every.length; a++)
    for (let b = a + 1; b < every.length; b++) {
      const p = every[a]!
      const q = every[b]!
      if (Math.hypot(p.at[0] - q.at[0], p.at[2] - q.at[2]) >= 1.2 - 1e-9) continue
      r.crowd++
      r.notes.push(
        `zones ${p.zone} and ${q.zone}: spots at ${p.at[0].toFixed(1)},${p.at[2].toFixed(1)} too close`,
      )
    }
  return r
}
