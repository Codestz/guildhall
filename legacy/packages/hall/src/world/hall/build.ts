import { DMath } from "../dmath.ts"
import { type Piece, type Placement, topOf } from "../furniture.ts"
import type { Post, Spot } from "../layout.ts"
import { STYLES, type Station, type Style } from "./styles.ts"
import type { Hall, HallSpot, WallSide } from "./types.ts"

/**
 * A hall's floor plan, from its style and its size (world/hall/styles.ts). Built in the hall's own
 * frame (x across, z from its middle; the back wall, at -z, is the landmark's, with a doorway onto
 * it; the gate is in the front wall) and moved to the island's. Every plan has the same bones so
 * that no table or chair is ever walked through: a lane down the middle, rows of stations either
 * side of it (inner ones by the lane, outer ones by the walls, set between the inner rows), and a
 * row along the back wall; each spot's approach is the lane's point level with it, then straight
 * across.
 */

const TILE = 4
const INNER_X = 2.6
/** The back row's spots stand this far off the back wall; the side rows begin after them. */
const BACK_Z = 3
const FIRST_ROW = 6.8
/** Rows lie this far apart (inner ones every second slot, outer ones between them) and keep the gate's end clear. */
const ROW = 2.2
const GATE_ROOM = 4
/** Outer stations need a hall at least this wide. */
const WIDE = 20
/** The back row's spots are this far apart, outwards from the middle. */
const BACK_STEP = 3.2

const round = (value: number): number => Math.round(value * 100) / 100

/** A frame's point in the island's: the hall at `at`, turned by `rot`. */
export function toIsland(at: Spot, rot: number, x: number, z: number): Spot {
  const [sin, cos] = [DMath.sin(rot), DMath.cos(rot)]
  return [round(at[0] + x * cos + z * sin), round(at[1] - x * sin + z * cos)]
}

/** How wide and deep a hall is for an island of `files`, and no wider than its landmark's `rings` allow. */
export function sizeOf(files: number, rings: 0 | 1 | 2): { w: number; d: number } {
  const [w, d] =
    files < 25 ? [12, 12] : files < 70 ? [20, 12] : files < 200 ? [20, 16] : files < 600 ? [28, 16] : [28, 20]
  return { w: Math.min(w, 12 + 8 * rings), d }
}

export function buildHall(
  style: Style["id"],
  at: Spot,
  rot: number,
  w: number,
  d: number,
  entry: Spot,
): Hall {
  const spec = STYLES[style]
  const place = (x: number, z: number): Spot => toIsland(at, rot, x, z)
  const piece = (name: Piece, x: number, z: number, turn = 0, extra: Partial<Placement> = {}): Placement => {
    const [px, pz] = place(x, z)
    return { piece: name, x: px, z: pz, rot: round(rot + turn), ...extra }
  }
  const spots: HallSpot[] = []
  const props: Placement[] = []

  const furnish = (station: Station, x: number, z: number, heading: number): void => {
    const reach = station.reach ?? (station.seat ? 1.45 : 1.3)
    const [tx, tz] = [x + DMath.sin(heading) * reach, z + DMath.cos(heading) * reach]
    if (station.seat) props.push(piece(station.seat, x, z, heading))
    props.push(piece(station.table, tx, tz, heading + (station.turn ?? 0)))
    const top = topOf(station.table)
    for (const prop of station.props ?? []) {
      const [dx, dz] = [prop.dx ?? 0, prop.dz ?? 0]
      const px = tx + dx * DMath.cos(heading) + dz * DMath.sin(heading)
      const pz = tz - dx * DMath.sin(heading) + dz * DMath.cos(heading)
      props.push(piece(prop.piece, px, pz, prop.rot ?? 0, prop.top ? { y: round(top) } : {}))
    }
    const count = spots.filter((spot) => spot.kind === station.kind).length
    const [sx, sz] = place(x, z)
    spots.push({
      id: `${station.kind}.${count}`,
      kind: station.kind,
      seat: station.seat !== undefined,
      post: [sx, sz, round(rot + heading)],
      clip: station.clip,
      crafts: station.crafts,
    })
  }

  // The back row, outwards from the middle: right, left, right…
  const back = -d / 2 + BACK_Z
  let n = 0
  for (let i = 0; INNER_X + BACK_STEP * i <= w / 2 - 2; i++)
    for (const side of [1, -1]) {
      const station = spec.back[n++ % spec.back.length] as Station
      furnish(station, side * (INNER_X + BACK_STEP * i), back, Math.PI)
    }
  // The side rows: inner, outer, inner… down the hall from the back row to the gate.
  const first = -d / 2 + FIRST_ROW
  for (let j = 0; first + ROW * j <= d / 2 - GATE_ROOM; j++) {
    const inner = j % 2 === 0
    if (!inner && w < WIDE) continue
    const list = inner ? spec.inner : spec.outer
    const z = first + ROW * j
    for (const side of [1, -1]) {
      const station = list[(j + (side > 0 ? 0 : 1)) % list.length] as Station
      const x = side * (inner ? INNER_X : w / 2 - 2.5)
      furnish(station, x, z, (side * Math.PI) / 2)
    }
  }
  for (const item of spec.dress(w, d))
    props.push(piece(item.piece, item.x, item.z, item.rot ?? 0, item.y ? { y: item.y } : {}))

  const cols = w / TILE
  const rows = d / TILE
  const floor: Placement[] = []
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < rows; j++)
      floor.push(piece(spec.floor, -w / 2 + TILE / 2 + i * TILE, -d / 2 + TILE / 2 + j * TILE))

  const { fabric } = spec
  const walls = (["back", "front", "left", "right"] as const).map(
    (side): { side: WallSide; pieces: Placement[] } => {
      const across = side === "back" || side === "front"
      const count = across ? cols : rows
      const out: Placement[] = []
      for (let k = 0; k < count; k++) {
        const along = (across ? -w / 2 : -d / 2) + TILE / 2 + k * TILE
        const door = across && k === (count - 1) / 2
        const lit = k % 2 === 1
        if (fabric.open && lit && !door) continue
        const name = door ? "wall_doorway" : lit ? fabric.window : fabric.plain
        const [x, z, turn] =
          side === "back"
            ? [along, -d / 2 - 0.5, 0]
            : side === "front"
              ? [along, d / 2 + 0.5, Math.PI]
              : side === "left"
                ? [-w / 2 - 0.5, along, Math.PI / 2]
                : [w / 2 + 0.5, along, -Math.PI / 2]
        out.push(piece(name, x, z, turn, { mounted: true }))
      }
      return { side, pieces: out }
    },
  )
  // Posts at the corners and, by the style's rhythm, at the joints of the walls.
  for (const [x, z] of [
    [-w / 2 + 0.75, -d / 2 + 0.75],
    [w / 2 - 0.75, -d / 2 + 0.75],
    [-w / 2 + 0.75, d / 2 - 0.75],
    [w / 2 - 0.75, d / 2 - 0.75],
  ] as const)
    props.push(piece(fabric.post ?? "pillar", x, z))
  if (fabric.post && fabric.every)
    for (let k = 1; k < rows; k += fabric.every)
      for (const side of [-1, 1])
        props.push(piece(fabric.post, side * (w / 2 - 0.75), -d / 2 + k * TILE, (-side * Math.PI) / 2))
  const backWall = walls[0] as (typeof walls)[number]
  if (fabric.banner)
    for (const x of [-w / 4, w / 4])
      backWall.pieces = [...backWall.pieces, piece(fabric.banner, x, -d / 2 - 0.5, 0, { mounted: true })]
  if (fabric.torch)
    for (const x of [-w / 2 + 3, w / 2 - 3])
      backWall.pieces = [...backWall.pieces, piece("torch_mounted", x, -d / 2, 0, { y: 2.4, mounted: true })]

  const step = place(0, d / 2 + 2.2)
  const sill = place(0, d / 2 - 1.6)
  return {
    style,
    at,
    rot: round(rot),
    w,
    d,
    floor,
    walls,
    props,
    spots,
    door: { step, sill, y: 0, inward: round(rot + Math.PI) },
    entry,
  }
}

/** How far behind a spot (the way it faces) the way to it turns off the lane. */
const BEHIND = 1.5

/**
 * The way from the hall's lane to a spot, and back: the lane's point level with the spot's approach (a
 * point `BEHIND` it, away from what it faces, so no neighbour's seat on the same row is crossed), then
 * that point. The spot itself is the last step.
 */
export function approachOf(hall: Pick<Hall, "at" | "rot">, post: Post): [lane: Spot, pre: Spot] {
  const pre: Spot = [post[0] - DMath.sin(post[2]) * BEHIND, post[1] - DMath.cos(post[2]) * BEHIND]
  return [laneAt(hall, pre), pre]
}

/** The spot of a hall that stands at `p` (a figure at its post), if any. */
const spotNear = (hall: Pick<Hall, "spots">, p: Spot): HallSpot | undefined =>
  hall.spots.find((spot) => DMath.hypot(spot.post[0] - p[0], spot.post[1] - p[1]) < 0.3)

/** The steps from a point of the floor to the lane and from the lane to it (a spot's own approach, else straight across). */
function lanesOf(hall: Hall, p: Spot): { leaving: Spot[]; entering: Spot[] } {
  const spot = spotNear(hall, p)
  if (!spot) return { leaving: [laneAt(hall, p)], entering: [laneAt(hall, p), p] }
  const [lane, pre] = approachOf(hall, spot.post)
  return { leaving: [pre, lane], entering: [lane, pre, p] }
}

/** The way from a point of a hall's floor out to its gate's step, never across furniture. */
export const wayOut = (hall: Hall, from: Spot): Spot[] => [
  ...lanesOf(hall, from).leaving,
  hall.door.sill,
  hall.door.step,
]

/** The way in from the gate's step to a point of the floor (a spot, last). */
export const wayIn = (hall: Hall, to: Spot): Spot[] => [hall.door.sill, ...lanesOf(hall, to).entering]

/** The way from one point of the floor to another: out to the lane, along it, in. */
export const wayAcross = (hall: Hall, from: Spot, to: Spot): Spot[] => [
  ...lanesOf(hall, from).leaving,
  ...lanesOf(hall, to).entering,
]

/**
 * The point of a hall's middle lane level with `at` (a spot on its floor): where one walks out to, or
 * in from, so no table or chair is crossed on the way to a spot.
 */
export function laneAt(hall: Pick<Hall, "at" | "rot">, at: Spot): Spot {
  const [dx, dz] = [at[0] - hall.at[0], at[1] - hall.at[1]]
  return toIsland(hall.at, hall.rot, 0, dx * DMath.sin(hall.rot) + dz * DMath.cos(hall.rot))
}

/** A hall's four corners, in the island's frame (its footprint, for the generator's clearances). */
export function cornersOf(hall: Pick<Hall, "at" | "rot" | "w" | "d">, margin = 0): Spot[] {
  const [hx, hz] = [hall.w / 2 + margin, hall.d / 2 + margin]
  return [
    toIsland(hall.at, hall.rot, -hx, -hz),
    toIsland(hall.at, hall.rot, hx, -hz),
    toIsland(hall.at, hall.rot, hx, hz),
    toIsland(hall.at, hall.rot, -hx, hz),
  ]
}
