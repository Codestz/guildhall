/**
 * The Guildhall's notice board (the game-feel plan's dispatch: the Guildmaster pins quests on it and
 * briefs recruits before it), set up by the world with everything else, so it is in the batch and on the
 * collision layer like any piece: KayKit pieces made into one board, two timber posts, a cork panel in
 * a timber frame, papers pinned on it and a plank capping the posts.
 *
 * Where: on the Guildhall's own ground (the castle, else the town), before the door its gathering is
 * before (the great hall's, else the keep's), 3–6 m out, on that door's terrace; clear of every solid by
 * a body, well off every road strip (so no way narrows), out of every door's approach, a body's room
 * from every townsfolk spot; with room before it for the Guildmaster to pin (its `pin` spot) and a
 * recruit beyond him. Of the places that fit, the one the hall's opening view (`HALL_VIEW`) sees best: a
 * straight line from the board to that camera, and to one turned a little either way, that no building
 * or wall stands across, the board's face turned to the camera as much as to the gathering.
 *
 * Pure: a function of the built world (its tiles, pieces, doors, ways) and the island, in a fixed order.
 */
import { DOOR_HALF, DOOR_RUN } from "./checks.ts"
import { pieceOutline, pieceSolids, type Solid, SolidGrid, solidDistance, solidKind } from "./collide.ts"
import { hexAt } from "./grid.ts"
import { type HexIsland, kindOf } from "./island.ts"
import type { Vec3 } from "./life.ts"
import { roadStrips, StripGrid } from "./roads.ts"
import { tileFurniture } from "./spots.ts"
import { HEX_TILE_SIZE, type PlacedPiece } from "./tiles.ts"
import type { HexWorld } from "./world.ts"
import { type HexZones, useOf } from "./zones.ts"

/** Where the notice board stands: its foot (its ground's height) and the way its face looks (radians about +y). */
export interface NoticeBoardPlace {
  at: Vec3
  facing: number
}

/**
 * The hall's opening view (studio hexworld: `sideLit` at the hall's 15:30, elevation 38°): the board is
 * set where this camera sees it. Degrees; the camera stands at (sin az, cos az) from what it looks at.
 */
export const HALL_VIEW = { azimuth: 295, elevation: 38 } as const

/** The board's half-width (posts out) and half-depth, metres: what must stand clear. */
export const BOARD_HALF_W = 0.8
export const BOARD_HALF_D = 0.28
/** How far before the board's middle one pins at it, metres (a body and an arm off its face). */
export const BOARD_PIN = 0.9
/** How far beyond the pinning spot a recruit is briefed, metres. */
export const BOARD_BRIEF = 1.05
/** The board's height (to the cap), metres: a little over a hero's head. */
export const BOARD_TALL = 1.85

/**
 * The pieces' room: no solid (a soft blocker's round aside) nearer the footprint's samples, no road
 * strip nearer than a body (a way past it stays its width), metres.
 */
const ROOM = 0.12
const OFF_ROAD = 0.1
/** How far from the door the board is sought, metres (and what is round it read). */
const NEAR = 10
/** A townsfolk spot keeps this far from the board and its spots, metres. */
const FROM_FOLK = 0.6
/** The way from the pinning spot to the gathering is open ground this far at least, metres. */
const OPEN_RUN = 2.5
/** A body's room at a spot (the pin, a briefing). */
const BODY = 0.3
/** A body standing a while keeps this far from a townsfolk spot (heroes.ts FROM_SPOT). */
const FOLK_STANDING = 0.9
const WATER = new Set<string>(["sea", "shallows", "lake", "river"])

/** The timber the posts are re-tinted to (KayKit's stone pillar as a carved post: palette swatches). */
const POST_WOOD: Record<number, number> = { 12: 23, 15: 21, 16: 22, 18: 21, 19: 22, 20: 23, 61: 22 }
/** The frame's picture as cork, its frame as timber. */
const CORK: Record<number, number> = { 13: 25, 14: 26, 23: 23, 29: 22 }
/** Paper: white, and an older cream sheet. */
const PAPER: Record<number, number> = { 13: 14, 14: 14, 23: 14, 29: 14 }
const PAPER_OLD: Record<number, number> = { 13: 11, 14: 11, 23: 11, 29: 11 }

/**
 * The board's pieces about its foot (`x` right along its face, `y` up, `z` out of its face), each
 * KayKit's: posts, the panel, the papers (x, y their middle's), the cap.
 */
const PARTS: readonly {
  piece: string
  x: number
  y: number
  z: number
  turn: number
  scale: number
  swatchMap: Record<number, number>
}[] = [
  { piece: "kaykit-halloween/fence-pillar", x: -0.52, y: 0, z: 0, turn: 0, scale: 1.3, swatchMap: POST_WOOD },
  { piece: "kaykit-halloween/fence-pillar", x: 0.52, y: 0, z: 0, turn: 0, scale: 1.3, swatchMap: POST_WOOD },
  {
    piece: "kaykit-furniture/pictureframe-large-b",
    x: 0,
    y: 0.95,
    z: 0,
    turn: 0,
    scale: 0.52,
    swatchMap: CORK,
  },
  {
    piece: "kaykit-furniture/pictureframe-small-a",
    x: -0.26,
    y: 1.18,
    z: 0.09,
    turn: 0,
    scale: 0.36,
    swatchMap: PAPER,
  },
  {
    piece: "kaykit-furniture/pictureframe-small-a",
    x: 0,
    y: 1.03,
    z: 0.09,
    turn: 0,
    scale: 0.34,
    swatchMap: PAPER_OLD,
  },
  {
    piece: "kaykit-furniture/pictureframe-small-c",
    x: 0.25,
    y: 1.15,
    z: 0.09,
    turn: 0,
    scale: 0.38,
    swatchMap: PAPER,
  },
  {
    piece: "kaykit-resources/wood-plank-a",
    x: 0,
    y: 1.72,
    z: 0,
    turn: Math.PI / 2,
    scale: 0.85,
    swatchMap: {},
  },
]

/** The board as pieces, standing at `place` (its foot at `place.at`, its face along `place.facing`). */
export function boardPieces(place: NoticeBoardPlace): PlacedPiece[] {
  const [bx, by, bz] = place.at
  const c = Math.cos(place.facing)
  const s = Math.sin(place.facing)
  return PARTS.map((p) => ({
    piece: p.piece,
    // the frame's (x right, z out) turned by the facing as the render turns a piece (collide.ts `turn`)
    x: bx + p.x * c + p.z * s,
    y: by + p.y,
    z: bz - p.x * s + p.z * c,
    rot: place.facing + p.turn,
    scale: p.scale,
    ...(Object.keys(p.swatchMap).length ? { swatchMap: p.swatchMap } : {}),
  }))
}

/** What the board's place is worked out from: the island, its places and the world as built so far. */
export interface BoardInputs {
  h: HexIsland
  z: HexZones
  w: Pick<HexWorld, "tiles" | "pieces" | "doorways" | "stairs" | "bridges" | "decks" | "stairAt">
}

const headingTo = (ax: number, az: number, bx: number, bz: number) => Math.atan2(bx - ax, bz - az)

/**
 * The Guildhall's zone as the world sees it (life.ts `guildhallZone` without the walk graph): its castle,
 * else its town; −1 for none.
 */
export function boardZone(z: Pick<HexZones, "zones">): number {
  const castle = z.zones.findIndex((zz) => zz.kind === "castle")
  return castle >= 0 ? castle : z.zones.findIndex((zz) => zz.kind === "town")
}

/** The notice board's place (module doc), or null where nothing fits (a keep too small, no Guildhall). */
export function noticeBoard(inp: BoardInputs): NoticeBoardPlace | null {
  const { h, z, w } = inp
  const g = h.grid
  const zi = boardZone(z)
  const zone = zi >= 0 ? z.zones[zi] : undefined
  if (!zone?.tiles.length) return null
  // its own ground, and the open ground round it no other place has (a young keep's foot)
  const own = new Set(zone.tiles)
  for (const i of zone.tiles) for (const j of g.neighbours(i)) if (j >= 0 && !z.zoneOf[j]) own.add(j)
  const tileOf = new Map(w.tiles.map((t) => [t.i, t]))
  const tileAt = (x: number, zz: number) => {
    const { q, r } = hexAt(x / HEX_TILE_SIZE, zz / HEX_TILE_SIZE)
    return g.index(q, r)
  }
  /** A dry land tile's top (not a cliff, a dock or a bridge), else NaN. */
  const floor = (i: number): number => {
    if (i < 0) return Number.NaN
    const t = tileOf.get(i)
    if (!t || t.ground === "cliff" || WATER.has(kindOf(h, i)) || kindOf(h, i) === "cliff") return Number.NaN
    const u = useOf(z, i)
    if (u === "dock" || u === "bridge") return Number.NaN
    return t.top
  }
  // the door its gathering is before (heroes.ts `gatherSpots`): the great hall's, the keep's, any
  const doors = w.doorways.filter((d) => zone.tiles.includes(d.tile))
  const hall =
    doors.find((d) => tileOf.get(d.tile)?.prefab === "great-hall") ??
    doors.find((d) => d.tile === zone.tile) ??
    doors[0]
  const heart = tileOf.get(zone.tile)
  const door = hall
    ? { x: hall.x, z: hall.z, facing: hall.facing }
    : heart
      ? { x: heart.x, z: heart.z, facing: 0 }
      : null
  if (!door) return null
  const level = floor(tileAt(door.x + Math.sin(door.facing) * 1.5, door.z + Math.cos(door.facing) * 1.5))
  if (Number.isNaN(level)) return null
  // what stands round the door (the board is sought within `NEAR` of it; tall things a little further)
  const near = (x: number, zz: number, r: number) => Math.hypot(x - door.x, zz - door.z) < r
  const tiles = w.tiles.filter((t) => near(t.x, t.z, NEAR + HEX_TILE_SIZE * 2))
  const furniture = tileFurniture(g, {
    ...w,
    tiles,
    pieces: w.pieces.filter((p) => near(p.x, p.z, NEAR + 6)),
  })
  const strips = new StripGrid(roadStrips(h, { ...w, tiles }))
  const approaches = w.doorways
    .filter((d) => near(d.x, d.z, NEAR + 4))
    .map((d) => ({ d, ux: Math.sin(d.facing), uz: Math.cos(d.facing) }))
  const inDoorway = (x: number, zz: number): boolean =>
    approaches.some(({ d, ux, uz }) => {
      const dx = x - d.x
      const dz = zz - d.z
      const u = dx * ux + dz * uz
      const v = Math.abs(-dx * uz + dz * ux)
      return u > -0.3 && u < DOOR_RUN + 0.6 && v < Math.max(DOOR_HALF, d.w / 2) + 0.35
    })
  /** Whether a solid stands within `r` of a point (a soft blocker's round is only kept clear where there is room). */
  const hit = (x: number, zz: number, r: number) =>
    furniture.solidsNear(x, zz, r).some((o) => !o.soft && solidDistance(o, x, zz) < r)
  const folk = furniture.spots
  const nearFolk = (x: number, zz: number, r = FROM_FOLK) =>
    folk.some((s) => Math.hypot(s.x - x, s.z - zz) < r)
  /** Ground the board (or a body) stands on: the Guildhall's own, on the door's terrace, off the stairs. */
  const ground = (x: number, zz: number) => {
    const i = tileAt(x, zz)
    return own.has(i) && Math.abs(floor(i) - level) <= 0.05 && w.stairAt(x, zz) == null
  }
  /** Where a body stands a while (the pin, a briefing): its ground, a body's room, no road, no door's way. */
  const standing = (x: number, zz: number) =>
    ground(x, zz) &&
    !furniture.blocked(x, zz, BODY) &&
    !strips.on(x, zz, BODY) &&
    !inDoorway(x, zz) &&
    !nearFolk(x, zz, FOLK_STANDING)
  // what hides the board from the camera: buildings and walls, as tall as they stand
  const tall: (Solid & { top: number })[] = []
  let highest = Number.NEGATIVE_INFINITY
  for (const p of w.pieces) {
    if (!near(p.x, p.z, 60)) continue
    const kind = solidKind(p.piece)
    if (kind !== "building" && kind !== "wall") continue
    const o = pieceOutline(p.piece)
    if (!o) continue
    const top = p.y + o.top * p.scale
    highest = Math.max(highest, top)
    for (const s of pieceSolids(p)) tall.push({ ...s, top })
  }
  const tallGrid = new SolidGrid(tall)
  const el = (HALL_VIEW.elevation * Math.PI) / 180
  const views = [-25, 0, 25].map((d) => {
    const a = ((HALL_VIEW.azimuth + d) * Math.PI) / 180
    return [Math.sin(a) * Math.cos(el), Math.sin(el), Math.cos(a) * Math.cos(el)] as const
  })
  /** How many of the views see the point (x, y, z): no tall solid across the line to the camera. */
  const seen = (x: number, y: number, zz: number): number => {
    let n = 0
    // (over the tallest roof the line is clear)
    const reach = Math.max(0, (highest - y) / Math.sin(el))
    for (const [dx, dy, dz] of views) {
      let hidden = false
      for (let d = 0.6; d < reach && !hidden; d += 0.3) {
        const px = x + dx * d
        const py = y + dy * d
        const pz = zz + dz * d
        for (const s of tallGrid.near(px, pz, 0) as (Solid & { top: number })[])
          if (py < s.top && solidDistance(s, px, pz) <= 0) {
            hidden = true
            break
          }
      }
      if (!hidden) n++
    }
    return n
  }
  const camX = Math.sin((HALL_VIEW.azimuth * Math.PI) / 180)
  const camZ = Math.cos((HALL_VIEW.azimuth * Math.PI) / 180)
  const toCam = Math.atan2(camX, camZ)
  // the gathering's middle: before the door, where its half-ring of seats is
  const gx = door.x + Math.sin(door.facing) * 3.2
  const gz = door.z + Math.cos(door.facing) * 3.2
  /**
   * Whether the way from the pinning spot towards the gathering's middle is open ground for its first
   * metres (the Guildmaster and his recruits come that way: a few steps, not round the court).
   */
  const openTo = (sx: number, sz: number, tx: number, tz: number): boolean => {
    const len = Math.hypot(tx - sx, tz - sz)
    const run = Math.min(len, OPEN_RUN)
    for (let d = 0.2; d <= run; d += 0.2) {
      const x = sx + ((tx - sx) * d) / len
      const zz = sz + ((tz - sz) * d) / len
      if (hit(x, zz, BODY - 0.05) || !ground(x, zz)) return false
    }
    return true
  }
  /** Whether the board's footprint at (bx, bz), facing `facing`, stands clear, its spots before it too. */
  const fits = (bx: number, bz: number, facing: number): boolean => {
    const nx = Math.sin(facing)
    const nz = Math.cos(facing)
    const rx = Math.cos(facing)
    const rz = -Math.sin(facing)
    for (let u = -BOARD_HALF_W; u <= BOARD_HALF_W + 1e-9; u += BOARD_HALF_W / 4)
      for (const v of [-BOARD_HALF_D, 0, BOARD_HALF_D]) {
        const x = bx + rx * u + nx * v
        const zz = bz + rz * u + nz * v
        if (
          !ground(x, zz) ||
          hit(x, zz, ROOM) ||
          strips.on(x, zz, OFF_ROAD) ||
          inDoorway(x, zz) ||
          nearFolk(x, zz)
        )
          return false
      }
    // the Guildmaster's spot before it, a recruit's beyond him, and open ground to the gathering
    const sx = bx + nx * BOARD_PIN
    const sz = bz + nz * BOARD_PIN
    return (
      standing(sx, sz) &&
      [0, 0.6, -0.6].some((t) => {
        const ux = nx * Math.cos(t) - nz * Math.sin(t)
        const uz = nx * Math.sin(t) + nz * Math.cos(t)
        return standing(sx + ux * BOARD_BRIEF, sz + uz * BOARD_BRIEF)
      })
    )
  }
  // every place that fits, ranked by how near the gathering it is, how open the way to it, how its face
  // turns to the camera; then the best the camera sees (each view seen outweighs the rest)
  const fit: { score: number; place: NoticeBoardPlace }[] = []
  for (let ri = 0; ri <= 24; ri++) {
    const r = 3 + ri * 0.25
    for (let ai = -36; ai < 36; ai++) {
      const off = (ai * 5 * Math.PI) / 180
      const bx = door.x + Math.sin(door.facing + off) * r
      const bz = door.z + Math.cos(door.facing + off) * r
      const toG = headingTo(bx, bz, gx, gz)
      // its face to the gathering, to the camera, or halfway (the shorter way round)
      const half = toG + Math.atan2(Math.sin(toCam - toG), Math.cos(toCam - toG)) / 2
      for (const facing of [toG, half, toCam, ...[1, 2, 3, 4, 5].map((k) => toG + (k * Math.PI) / 3)]) {
        const nx = Math.sin(facing)
        const nz = Math.cos(facing)
        // the pin spot on the gathering's side
        if ((gx - bx) * nx + (gz - bz) * nz < 0.5 * Math.hypot(gx - bx, gz - bz)) continue
        const face = nx * camX + nz * camZ
        // near the gathering (a short errand), its face turned to the camera
        const score = -Math.abs(Math.hypot(gx - bx, gz - bz) - 2.8) * 1.2 + Math.max(0, face) * 3
        // on the Guildhall's own ground (inside its wall) before anywhere beside it
        const inside = zone.tiles.includes(tileAt(bx, bz)) ? 40 : 0
        if (!fits(bx, bz, facing)) continue
        // open ground from its pinning spot to the gathering (a few steps for him and his recruits)
        const open = openTo(bx + nx * BOARD_PIN, bz + nz * BOARD_PIN, gx, gz) ? 6 : 0
        fit.push({ score: score + inside + open, place: { at: [bx, level, bz], facing } })
      }
    }
  }
  // (a stable order: the best first, ties as found)
  const order = fit.map((f, k) => ({ ...f, k })).sort((a, b) => b.score - a.score || a.k - b.k)
  let best: { score: number; place: NoticeBoardPlace } | null = null
  for (const f of order) {
    if (best && f.score + views.length * 10 <= best.score) break
    const score = f.score + seen(f.place.at[0], level + 1.3, f.place.at[2]) * 10
    if (!best || score > best.score + 1e-9) best = { score, place: f.place }
  }
  return best?.place ?? null
}
