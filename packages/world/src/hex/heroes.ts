/**
 * The heroes' own spots (plan-hud-events.md §2–3, W2): a pool per place, set aside when the island is
 * built, where an agent works when its deeds lead to that place, and, at the Guildhall, where heroes
 * gather before the dispatcher's seat (the great hall's door) between quests.
 *
 * A hero spot is a new spot, never one of the tiles' own (spots.ts), so the townsfolk's book is the same
 * with or without the pool: nobody's day changes, and townsfolk never stand at a hero's spot. Each is
 *
 *   at work    beside something of its place (an anvil, a table, a sign, the quay's ropes and crates, a
 *              log pile, the hay, a practice shield), a body and an arm off it, facing it; its pose kind
 *              says what kind of work it reads as there (the hero's clip by craft is the caller's);
 *   reachable  from a walk node of the place over open ground in a straight line: on one terrace, not
 *              through a building, a wall or a fence, not over water or a flight of stairs; the node on
 *              the walk graph the Guildhall is on;
 *   clear      of every solid (props too), off every road strip (roads are sacred), out of every door's
 *              approach, a body's room from every townsfolk spot and meeting slot, and from each other.
 *
 * Stable: a place's pool reads only the pieces, spots, slots and walk nodes on and round it (and keeps
 * clear of the pools of the places set out before it, in zone order), in a fixed order, so a place that
 * stays as the island grows keeps its pool.
 */
import { BOARD_PIN } from "./board.ts"
import { DOOR_HALF, DOOR_RUN } from "./checks.ts"
import { type Solid, solidDistance } from "./collide.ts"
import { DUEL_APART } from "./drills.ts"
import { hexAt } from "./grid.ts"
import { type HexIsland, kindOf } from "./island.ts"
import type { LifeSpot, Vec3 } from "./life.ts"
import { roadStrips, StripGrid } from "./roads.ts"
import { HARD, type TileFurniture } from "./spots.ts"
import { HEX_TILE_SIZE } from "./tiles.ts"
import type { HexWalk } from "./walk.ts"
import type { HexWorld } from "./world.ts"
import { type HexZones, useOf, type ZoneKind } from "./zones.ts"

/**
 * What a hero spot reads as: the work there (at an anvil, a desk or a map table, a notice board or sign,
 * the dock, among crates and barrels, at the rock face, the log pile, in the hay, at the practice
 * targets), or `gather`: before the Guildhall's great hall, the dispatcher's seat.
 */
export type HeroPose =
  | "anvil"
  | "desk"
  | "board"
  | "dock"
  | "crates"
  | "dig"
  | "chop"
  | "field"
  | "drill"
  | "scaffold"
  | "gather"

/** A hero's spot: a stay on the walk graph (life.ts `LifeSpot`), of a place, as work or a gathering. */
export interface HeroSpot extends LifeSpot {
  /** Zone index of its place. */
  zone: number
  kind: "work" | "gather"
  pose: HeroPose
}

/**
 * The Guildhall's notice board (the game-feel plan's dispatch): where the board stands and faces (the
 * gathering), the spot the Guildmaster pins a quest at (facing the board, its back to the gathering),
 * and where a recruit stands for its briefing (before the pinning spot, facing it), one to three.
 */
export interface HeroBoard {
  /** The board's foot (its own ground's height). */
  at: Vec3
  /** Radians about +y the board's face looks along (towards the gathering). */
  facing: number
  /** Where one pins at it: a hero spot of the Guildhall, pose `board`. */
  spot: HeroSpot
  /** Where a recruit is briefed, nearest the gathering first. */
  brief: LifeSpot[]
}

/** A hero spot pool: a place's spots by zone, and the Guildhall's notice board (null where none fits). */
export interface HeroPool {
  (zone: number): HeroSpot[]
  board(): HeroBoard | null
}

/** Hero spots a place keeps when asked for some (`lifePlaces(..., {heroSpots})`): two at least. */
export const HERO_SPOTS_MIN = 2
/** The Guildhall's gathering keeps this many per place's spot (heroes rest there in numbers). */
export const GATHER_PER_SPOT = 2

/** What a piece (its catalog id's last part) is worked at as, first match wins. */
const PROP_POSES: readonly [RegExp, HeroPose][] = [
  [/anvil|forge|grindstone|iron-bars/, "anvil"],
  [/table|desk|^map|book|scroll|lectern/, "desk"],
  [/sign|board|notice/, "board"],
  [/rope|^planks$|oar|net|boat|fuel/, "dock"],
  [/shield|sword|spear|bow|quiver|arrow|dummy|target/, "drill"],
  [/wood-log|planks-stack|stump|axe/, "chop"],
  [/hay|shovel|wheat|crop|scarecrow|pitchfork/, "field"],
  [/stone-chunks|stone-bricks|pickaxe|ore|minecart/, "dig"],
  [/crate|barrel|cart|sack|box|textiles/, "crates"],
]

/** A place's work by kind: the poses it reads best at, in order (the first is its own when nothing stands there). */
const PLACE_POSES: Readonly<Record<ZoneKind, readonly HeroPose[]>> = {
  town: ["anvil", "desk", "board", "crates"],
  market: ["desk", "crates", "board"],
  harbour: ["dock", "crates"],
  fishing: ["dock", "crates"],
  castle: ["gather"],
  mine: ["dig", "anvil", "crates"],
  lumber: ["chop", "crates"],
  farm: ["field", "crates", "chop"],
  hamlet: ["field", "crates", "chop"],
  monastery: ["desk", "board"],
  camp: ["drill", "board"],
}

/** How far a hero stands off what it works at (its outline), metres: a body and an arm. */
const AT_ARM = 0.45
/** A hero's room: no solid nearer its middle, metres (a body's half-width and a little). */
const ROOM = 0.3
/**
 * No townsfolk spot nearer, metres (a slot's room: life.ts SLOT_GAP × 0.9; someone at work swings a
 * hammer), nor a meeting slot (someone standing for a chat: two bodies and a hand between).
 */
const FROM_SPOT = 0.9
const FROM_SLOT = 0.7
/**
 * A meeting slot's room a place's spots keep first (user, 10-13: a hero and someone at a chat never
 * closer than 0.9 m); a place with too few spots then takes FROM_SLOT.
 */
const FROM_SLOT_WIDE = 1
/** A meeting slot's room where a place has no other (a one-tile place among another's streets): bodies apart. */
const FROM_SLOT_TIGHT = 0.55
/** Hero spots of one place keep this far apart, metres; at the Guildhall, as far as agents rest apart. */
const APART = 1.2
const GATHER_APART = 1.3
/**
 * The gathering's spots come in pairs (heroes at rest sit two by two, facing each other): a pair's two
 * stand this far apart, metres (the pool's own floor between any two spots).
 */
const PAIR_APART = 1.25
/** The ways a pair may lie across its middle, radians from across the way it faces. */
const PAIR_TURNS = [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2]
/** Where a recruit may be briefed, radians off the pinning spot's way out and metres beyond it, in turn. */
const BRIEF_WAYS: readonly (readonly [number, number])[] = [0, 0.6, -0.6, 1.2, -1.2, 1.57, -1.57].flatMap(
  (t) => [1.05, 0.85, 1.3].map((m) => [t, m] as const),
)
/** A briefing spot keeps this far from the gathering's seats, metres (two bodies). */
const BRIEF_FREE = 0.9
/** Recruits briefed together stand this far apart at least, metres (two bodies). */
const BRIEF_APART = 0.8
/** A body's half-width on the way in: the straight way keeps it clear of buildings, walls and fences. */
const WAY_BODY = 0.2
/** The first stretch out of a node the way may pass through a solid (a node in a well's round). */
const NODE_SLACK = 0.45
/** The farthest a spot is from the node it is reached from, metres. */
const REACH = HEX_TILE_SIZE * 1.8
const WATER = new Set<string>(["sea", "shallows", "lake", "river"])

/** What the pool reads: the island, its places, the built tiles, the walk graph and the life book's parts. */
export interface HeroPoolInputs {
  h: HexIsland
  z: HexZones
  w: Pick<HexWorld, "tiles"> &
    Partial<Pick<HexWorld, "stairs" | "bridges" | "doorways" | "stairAt" | "pieces" | "board">>
  walk: HexWalk
  furniture: TileFurniture
  /** Every place's meeting slots (life.ts `LifePlaces.slots`). */
  slots(zone: number): readonly LifeSpot[]
  /** Where else townsfolk stand a while (life.ts: a castle's rounds, homes round a doorless heart). */
  stands?(): readonly { x: number; z: number }[]
  /** The Guildhall's zone (life.ts `guildhallZone`): its pool is the gathering. */
  home: number
}

/**
 * How far two hero spots keep apart: `base`, or DUEL_APART where either is a `drill` spot (a hero there
 * may spar, sword and shield: whoever stands near is squared up to, and must stand a duel's distance off).
 */
const roomOf = (p: HeroPose, q: HeroPose, base: number): number =>
  p === "drill" || q === "drill" ? Math.max(base, DUEL_APART) : base

const headingTo = (ax: number, az: number, bx: number, bz: number) => Math.atan2(bx - ax, bz - az)

/** A candidate: where, facing what, read as what, how wanted (lower first), and what it stands at. */
interface Candidate {
  x: number
  z: number
  facing: number
  pose: HeroPose
  rank: number
  anchor: number
}

/**
 * The pool: `of(zone)` gives a place's hero spots, all places' worked out the first time any is asked for:
 * `max(k, HERO_SPOTS_MIN)` of them where its ground has room (tested: every place on every island
 * swept), and at the Guildhall up to `GATHER_PER_SPOT` times as many as its courts have room for (two
 * at least). None when `k` is 0.
 */
export function heroSpotPool(inp: HeroPoolInputs, k: number): HeroPool {
  const { h, z, w, walk, furniture } = inp
  const g = h.grid
  const tileOf = new Map(w.tiles.map((t) => [t.i, t]))
  const strips = new StripGrid(
    roadStrips(h, { tiles: w.tiles, stairs: w.stairs ?? [], bridges: w.bridges ?? [] }),
  )
  const doorways = w.doorways ?? []
  const homeHeart = walk.hearts[inp.home] ?? -1
  /** Whether a node is on the walk graph the Guildhall is on (cached). */
  const linked = new Map<number, boolean>()
  const onGraph = (n: number) => {
    let v = linked.get(n)
    if (v === undefined) {
      v = homeHeart < 0 ? true : walk.route(homeHeart, n) !== null
      linked.set(n, v)
    }
    return v
  }
  const tileAt = (x: number, zz: number) => {
    const { q, r } = hexAt(x / HEX_TILE_SIZE, zz / HEX_TILE_SIZE)
    return g.index(q, r)
  }
  /** Ground a hero may stand or walk on: a dry land tile's top (not a cliff), else NaN. */
  const floor = (i: number): number => {
    if (i < 0) return Number.NaN
    const t = tileOf.get(i)
    if (!t || t.ground === "cliff" || WATER.has(kindOf(h, i)) || kindOf(h, i) === "cliff") return Number.NaN
    const u = useOf(z, i)
    if (u === "dock" || u === "bridge") return Number.NaN
    return t.top
  }
  // ---- what nobody's spot may stand on: the townsfolk's spots and slots ----
  const FOLK_CELL = 4
  const folkKey = (cx: number, cz: number) => (cx + 4096) * 8192 + cz + 4096
  /** The room kept from a meeting slot now (FROM_SLOT_WIDE first, FROM_SLOT where that leaves too few). */
  let slotRoom = FROM_SLOT_WIDE
  let folkCells: Map<number, { x: number; z: number; r: number }[]> | null = null
  const nearFolk = (x: number, zz: number, tight: boolean, room = 0): boolean => {
    if (!folkCells) {
      const cells = new Map<number, { x: number; z: number; r: number }[]>()
      const add = (p: { x: number; z: number; r: number }) => {
        const key = folkKey(Math.floor(p.x / FOLK_CELL), Math.floor(p.z / FOLK_CELL))
        const cell = cells.get(key)
        if (cell) cell.push(p)
        else cells.set(key, [p])
      }
      for (const s of furniture.spots) add({ x: s.x, z: s.z, r: FROM_SPOT })
      for (const zi of z.zones.keys())
        for (const s of inp.slots(zi)) add({ x: s.at[0], z: s.at[2], r: FROM_SLOT })
      for (const s of inp.stands?.() ?? []) add({ ...s, r: FROM_SPOT })
      folkCells = cells
    }
    const cx = Math.floor(x / FOLK_CELL)
    const cz = Math.floor(zz / FOLK_CELL)
    for (let a = cx - 1; a <= cx + 1; a++)
      for (let b = cz - 1; b <= cz + 1; b++)
        for (const p of folkCells.get(folkKey(a, b)) ?? [])
          if (
            Math.hypot(p.x - x, p.z - zz) <
            Math.max(room, p.r === FROM_SLOT ? (tight ? FROM_SLOT_TIGHT : slotRoom) : p.r)
          )
            return true
    return false
  }
  /** Whether a point is in a door's approach (checks.ts DOOR_RUN × DOOR_HALF out from its front), with a shoulder. */
  const inDoorway = (x: number, zz: number): boolean =>
    doorways.some((d) => {
      const ux = Math.sin(d.facing)
      const uz = Math.cos(d.facing)
      const dx = x - d.x
      const dz = zz - d.z
      const u = dx * ux + dz * uz
      const v = Math.abs(-dx * uz + dz * ux)
      return u > -0.3 && u < DOOR_RUN + 0.5 && v < Math.max(DOOR_HALF, d.w / 2) + 0.3
    })
  /** Whether the straight way from a node to a point stays on its terrace, on dry land, off the stairs, out of the hard solids. */
  const wayClear = (nx: number, nz: number, x: number, zz: number, top: number): boolean => {
    const len = Math.hypot(x - nx, zz - nz)
    const n = Math.max(1, Math.ceil(len / 0.1))
    for (let s = 1; s <= n; s++) {
      const px = nx + ((x - nx) * s) / n
      const pz = nz + ((zz - nz) * s) / n
      const off = (len * s) / n
      if (Math.abs(floor(tileAt(px, pz)) - top) > 0.05) return false
      if (w.stairAt?.(px, pz) != null) return false
      if (off > NODE_SLACK && furniture.blocked(px, pz, WAY_BODY, HARD)) return false
    }
    return true
  }
  /**
   * The tiles a place's spots may stand on: its own, and the unplaced ground beside them; `wide`, any
   * ground beside them (a one-tile place squeezed in among another's streets).
   */
  const groundOf = (zi: number, wide = false): Set<number> => {
    const out = new Set<number>()
    for (const i of z.zones[zi]!.tiles) {
      out.add(i)
      for (const j of g.neighbours(i)) if (j >= 0 && (wide || !z.zoneOf[j])) out.add(j)
    }
    return out
  }
  /** The node a hero walks in from to a point (nearest with a clear straight way), −1 for none. */
  const nodeFor = (x: number, zz: number, top: number): number => {
    const i = tileAt(x, zz)
    const round = new Set<number>([i])
    for (const j of g.neighbours(i)) if (j >= 0) round.add(j)
    let best = -1
    let bestD = Number.POSITIVE_INFINITY
    for (const j of [...round].sort((a, b) => a - b))
      for (const c of [walk.at(j), walk.door(j)]) {
        if (c < 0) continue
        const n = walk.nodes[c]!
        if (n.kind === "dock" || n.kind === "bridge") continue
        const d = Math.hypot(n.x - x, n.z - zz)
        if (d >= bestD || d > REACH) continue
        if (Math.abs(floor(tileAt(n.x, n.z)) - top) > 0.05) continue
        if (!wayClear(n.x, n.z, x, zz, top) || !onGraph(c)) continue
        best = c
        bestD = d
      }
    return best
  }
  /** The candidate as a hero spot, or null when it is in something, on a road, in a doorway, or out of reach. */
  const spotOf = (
    zi: number,
    c: Candidate,
    ground: Set<number>,
    kind: HeroSpot["kind"],
    tight: boolean,
  ): HeroSpot | null => {
    const i = tileAt(c.x, c.z)
    if (!ground.has(i)) return null
    const top = floor(i)
    if (Number.isNaN(top) || w.stairAt?.(c.x, c.z) != null) return null
    if (furniture.blocked(c.x, c.z, ROOM) || strips.on(c.x, c.z, ROOM)) return null
    if (inDoorway(c.x, c.z) || nearFolk(c.x, c.z, tight, c.pose === "drill" ? DUEL_APART : 0)) return null
    const node = nodeFor(c.x, c.z, top)
    if (node < 0) return null
    const at: Vec3 = [c.x, walk.nodes[node]!.y, c.z]
    return { node, at, facing: c.facing, ground: true, zone: zi, kind, pose: c.pose }
  }
  /** Points round a solid, a body and an arm off its outline, facing it: 8 ways round, from its +x. */
  const roundSolid = (s: Solid): { x: number; z: number; facing: number }[] => {
    const out: { x: number; z: number; facing: number }[] = []
    for (let a = 0; a < 8; a++) {
      const ang = (a * Math.PI) / 4
      const ux = Math.cos(ang)
      const uz = Math.sin(ang)
      for (let d = 0.15; d <= s.r + AT_ARM + 0.2; d += 0.05) {
        const x = s.cx + ux * d
        const zz = s.cz + uz * d
        if (solidDistance(s, x, zz) < AT_ARM) continue
        out.push({ x, z: zz, facing: headingTo(x, zz, s.cx, s.cz) })
        break
      }
    }
    return out
  }
  /** Every place's spots so far (places are set out in zone order): no two places' stand together. */
  const placed: HeroSpot[] = []
  const pick = (
    zi: number,
    found: Candidate[],
    want: number,
    apart: number,
    kind: HeroSpot["kind"],
    ground = groundOf(zi),
    tight = false,
  ): HeroSpot[] => {
    found.sort((a, b) => a.rank - b.rank || a.x - b.x || a.z - b.z)
    const out: HeroSpot[] = []
    const used = new Set<number>()
    const clear = (c: Candidate) =>
      out.every((s) => Math.hypot(s.at[0] - c.x, s.at[2] - c.z) >= roomOf(s.pose, c.pose, apart)) &&
      placed.every((s) => Math.hypot(s.at[0] - c.x, s.at[2] - c.z) >= roomOf(s.pose, c.pose, APART))
    // one spot to a thing worked at first, then a second at the same where there is room
    for (const pass of [0, 1])
      for (const c of found) {
        if (out.length >= want) return out
        if ((pass === 0 && used.has(c.anchor)) || !clear(c)) continue
        const s = spotOf(zi, c, ground, kind, tight)
        if (!s) continue
        out.push(s)
        used.add(c.anchor)
      }
    return out
  }
  /** Rings round a point facing it (the fallback: a place's heart, its nodes), as candidates of one pose. */
  const ring = (
    cx: number,
    cz: number,
    radii: readonly number[],
    pose: HeroPose,
    rank: number,
    anchor: number,
  ): Candidate[] => {
    const out: Candidate[] = []
    for (const [m, r] of radii.entries()) {
      const n = 12
      for (let a = 0; a < n; a++) {
        const ang = ((a + (m % 2) * 0.5) / n) * Math.PI * 2
        const x = cx + Math.cos(ang) * r
        const zz = cz + Math.sin(ang) * r
        out.push({ x, z: zz, facing: headingTo(x, zz, cx, cz), pose, rank: rank + m * 0.01, anchor })
      }
    }
    return out
  }
  const workSpots = (zi: number): HeroSpot[] => {
    const zone = z.zones[zi]!
    const heartNode = walk.hearts[zi] ?? -1
    if (heartNode < 0 || !zone.tiles.length) return []
    const heart = walk.nodes[heartNode]!
    const own = new Set(zone.tiles)
    const prefer = PLACE_POSES[zone.kind]
    const wet = zone.kind === "harbour" || zone.kind === "fishing"
    const found: Candidate[] = []
    // things worked at on the place's tiles, the place's own kinds of work first, nearest its heart first
    for (const [si, s] of furniture.solids.entries()) {
      if (!s.piece || s.kind === "building" || s.kind === "wall" || s.kind === "seat" || s.kind === "trunk")
        continue
      if (!own.has(tileAt(s.cx, s.cz))) continue
      const name = s.piece.split("/").pop() ?? s.piece
      let pose = PROP_POSES.find(([re]) => re.test(name))?.[1]
      if (!pose) continue
      // on the waterfront, its crates and barrels are the quay's
      if (wet && pose === "crates") pose = "dock"
      const pref = prefer.indexOf(pose)
      const rank = (pref < 0 ? prefer.length : pref) * 1000 + Math.hypot(s.cx - heart.x, s.cz - heart.z)
      for (const p of roundSolid(s)) found.push({ ...p, pose, rank, anchor: si })
    }
    const want = Math.max(k, HERO_SPOTS_MIN)
    const out = pick(zi, found, want, APART, "work")
    if (out.length >= want) return out
    // too few things to work at (a monastery's cloister, a bare hamlet): round its heart, then round its
    // other nodes, at the place's own work
    const rest: Candidate[] = ring(heart.x, heart.z, [2.4, 3.2, 4, 4.8, 5.6], prefer[0]!, 1e6, -1)
    for (const i of [...zone.tiles].sort((a, b) => a - b))
      for (const c of [walk.at(i), walk.door(i)]) {
        if (c < 0 || c === heartNode) continue
        const n = walk.nodes[c]!
        rest.push(
          ...ring(n.x, n.z, [1.6, 2.4], prefer[0]!, 2e6 + Math.hypot(n.x - heart.x, n.z - heart.z), -2 - c),
        )
      }
    const more = pick(zi, [...found, ...rest], want, APART, "work")
    if (more.length >= want) return more
    // still too few: on any ground beside it, closer to the meeting slots
    return pick(zi, [...found, ...rest], want, APART, "work", groundOf(zi, true), true)
  }
  const gatherSpots = (zi: number): HeroSpot[] => {
    const zone = z.zones[zi]!
    const heartNode = walk.hearts[zi] ?? -1
    if (heartNode < 0 || !zone.tiles.length) return []
    const own = new Set(zone.tiles)
    const want = Math.max(k, HERO_SPOTS_MIN) * GATHER_PER_SPOT
    // before the great hall's door (the dispatcher's seat), else the keep's (or any of the castle's), else its heart
    const doors = doorways.filter((d) => own.has(d.tile))
    const hall =
      doors.find((d) => tileOf.get(d.tile)?.prefab === "great-hall") ??
      doors.find((d) => d.tile === zone.tile) ??
      doors[0]
    const found: Candidate[] = []
    if (hall) {
      for (const [m, r] of [2.2, 2.9, 3.6, 4.3, 5].entries())
        for (let a = -6; a <= 6; a++) {
          const ang = hall.facing + (a + (m % 2) * 0.5) * (Math.PI / 14)
          const x = hall.x + Math.sin(ang) * r
          const zz = hall.z + Math.cos(ang) * r
          // a half-ring before the door, facing it, nearest the door's line first (its approach is left
          // clear by spotOf)
          found.push({
            x,
            z: zz,
            facing: headingTo(x, zz, hall.x, hall.z),
            pose: "gather",
            rank: m * 100 + Math.abs(a + (m % 2) * 0.5),
            anchor: -1,
          })
        }
    }
    // else round the castle's heart (its yard), then round its other ways in, nearest the heart first
    const heart = walk.nodes[heartNode]!
    found.push(...ring(heart.x, heart.z, [1.6, 2.2, 3, 3.8, 4.6, 5.4], "gather", 1e6, -1))
    for (const i of [...zone.tiles].sort((a, b) => a - b))
      for (const c of [walk.at(i), walk.door(i)]) {
        if (c < 0 || c === heartNode) continue
        const n = walk.nodes[c]!
        found.push(
          ...ring(n.x, n.z, [1.4, 2.2], "gather", 2e6 + Math.hypot(n.x - heart.x, n.z - heart.z), -1),
        )
      }
    // on the castle's own ground: its wards and courts, inside the curtain wall, two by two; a keep too
    // small for that (a young island's) gathers one by one, then at its foot
    const pairs = pickPairs(zi, found, want, own)
    const inside = pick(zi, found, want, GATHER_APART, "gather", own)
    if (pairs.length >= HERO_SPOTS_MIN && pairs.length >= inside.length) return pairs
    if (inside.length >= HERO_SPOTS_MIN) return inside
    return pick(zi, found, want, GATHER_APART, "gather", groundOf(zi, true), true)
  }
  /**
   * The gathering two by two: each candidate is a pair's middle, its two spots PAIR_APART across the way
   * the candidate faces, each facing the other; a pair is taken whole or not at all.
   */
  const pickPairs = (zi: number, found: Candidate[], want: number, ground: Set<number>): HeroSpot[] => {
    const sorted = [...found].sort((a, b) => a.rank - b.rank || a.x - b.x || a.z - b.z)
    const out: HeroSpot[] = []
    const clear = (x: number, zz: number) =>
      out.every((s) => Math.hypot(s.at[0] - x, s.at[2] - zz) >= GATHER_APART) &&
      placed.every((s) => Math.hypot(s.at[0] - x, s.at[2] - zz) >= roomOf(s.pose, "gather", APART))
    for (const c of sorted) {
      if (out.length + 2 > want) break
      // across the way it faces first, then turned a quarter at a time
      for (const turn of PAIR_TURNS) {
        const ux = Math.cos(c.facing + turn) * (PAIR_APART / 2)
        const uz = -Math.sin(c.facing + turn) * (PAIR_APART / 2)
        const ax = c.x + ux
        const az = c.z + uz
        const bx = c.x - ux
        const bz = c.z - uz
        if (!clear(ax, az) || !clear(bx, bz)) continue
        const a = spotOf(
          zi,
          { ...c, x: ax, z: az, facing: headingTo(ax, az, bx, bz) },
          ground,
          "gather",
          false,
        )
        const b =
          a && spotOf(zi, { ...c, x: bx, z: bz, facing: headingTo(bx, bz, ax, az) }, ground, "gather", false)
        if (!a || !b) continue
        out.push(a, b)
        break
      }
    }
    // where no more pairs fit, the rest one by one (facing the hall, as before)
    for (const c of sorted) {
      if (out.length >= want) break
      if (!clear(c.x, c.z)) continue
      const s = spotOf(zi, c, ground, "gather", false)
      if (s) out.push(s)
    }
    return out
  }
  /**
   * The notice board the world set up (world.ts `board`, board.ts), when it stands on the Guildhall's
   * ground: the pinning spot BOARD_PIN before it (a hero spot, reachable, facing it; a little further or
   * to a side if a body has no room there), and the briefing spots BRIEF_AT beyond it, the straight one
   * first (one at least). None where the world set none.
   */
  const boardOf = (zi: number): HeroBoard | null => {
    const placedBoard = w.board
    const zone = z.zones[zi]
    if (!placedBoard || !zone?.tiles.length || (walk.hearts[zi] ?? -1) < 0) return null
    // (on its ground, or beside it where a young keep's gathering stands too)
    const own = groundOf(zi, true)
    const [bx, top, bz] = placedBoard.at
    if (!own.has(tileAt(bx, bz))) return null
    const ux = Math.sin(placedBoard.facing)
    const uz = Math.cos(placedBoard.facing)
    /** The briefing spots beyond a pinning spot (none where a body has no room). */
    const briefsOf = (spot: HeroSpot): LifeSpot[] => {
      const [sx, , sz] = spot.at
      const out: LifeSpot[] = []
      for (const [turn, at] of BRIEF_WAYS) {
        const c = Math.cos(turn)
        const sn = Math.sin(turn)
        const px = sx + (ux * c - uz * sn) * at
        const pz = sz + (ux * sn + uz * c) * at
        if (Math.abs(floor(tileAt(px, pz)) - top) > 0.05) continue
        if (furniture.blocked(px, pz, ROOM) || strips.on(px, pz, ROOM) || inDoorway(px, pz)) continue
        out.push({
          node: spot.node,
          at: [px, spot.at[1], pz],
          facing: headingTo(px, pz, sx, sz),
          ground: true,
        })
      }
      return out
    }
    const tries = [0, 0.15, 0.3, 0.45].flatMap((out) =>
      [0, 0.3, -0.3, 0.6, -0.6].map((side) => [
        bx + ux * (BOARD_PIN + out) + uz * side,
        bz + uz * (BOARD_PIN + out) - ux * side,
      ]),
    )
    /** A pinning spot at (x, z), clear of the townsfolk's chats too (`strict`) or of their work spots only. */
    const pinAt = (x: number, zz: number, strict: boolean): HeroSpot | null => {
      const facing = headingTo(x, zz, bx, bz)
      if (strict)
        return spotOf(zi, { x, z: zz, facing, pose: "board", rank: 0, anchor: -1 }, own, "work", true)
      const i = tileAt(x, zz)
      if (!own.has(i) || Math.abs(floor(i) - top) > 0.05 || w.stairAt?.(x, zz) != null) return null
      if (furniture.blocked(x, zz, ROOM) || strips.on(x, zz, ROOM) || inDoorway(x, zz)) return null
      if (furniture.spots.some((s) => Math.hypot(s.x - x, s.z - zz) < FROM_SPOT)) return null
      const node = nodeFor(x, zz, top)
      if (node < 0) return null
      return {
        node,
        at: [x, walk.nodes[node]!.y, zz],
        facing,
        ground: true,
        zone: zi,
        kind: "work",
        pose: "board",
      }
    }
    // clear of everyone first; else (the townsfolk's slots and stands the world cannot see when it sets
    // the board up) clear of their work spots: a moment's stand while he pins
    for (const strict of [true, false])
      for (const [x, zz] of tries) {
        if (Math.abs(floor(tileAt(x!, zz!)) - top) > 0.05) continue
        const spot = pinAt(x!, zz!, strict)
        const brief = spot ? briefsOf(spot) : []
        if (spot && brief.length) return { at: [bx, top, bz], facing: placedBoard.facing, spot, brief }
      }
    return null
  }
  // every place's at once, the first time any is asked for: the Guildhall's gathering first, then the
  // places in zone order (the capital first), each keeping clear of those set out before it
  let all: HeroSpot[][] | null = null
  let board: HeroBoard | null = null
  const make = () => {
    if (!all) {
      const lists: HeroSpot[][] = z.zones.map(() => [])
      const order = [inp.home, ...z.zones.keys()].filter((i, n) => n === 0 || i !== inp.home)
      // the notice board's spots first: the gathering keeps clear of the Guildmaster and his recruits
      board = z.zones[inp.home] ? boardOf(inp.home) : null
      if (board) placed.push(board.spot)
      for (const i of order) {
        if (!z.zones[i]) continue
        const of = i === inp.home ? gatherSpots : workSpots
        const want = Math.max(k, HERO_SPOTS_MIN) * (i === inp.home ? GATHER_PER_SPOT : 1)
        slotRoom = FROM_SLOT_WIDE
        lists[i] = of(i)
        if (lists[i]!.length < want) {
          slotRoom = FROM_SLOT
          const near = of(i)
          if (near.length > lists[i]!.length) lists[i] = near
        }
        placed.push(...lists[i]!)
        // the briefing spots the gathering leaves free (a seated hero is never stood on), three at most,
        // a body apart
        if (i === inp.home && board) {
          const seats = lists[i]!
          const apart = (a: LifeSpot, b: LifeSpot, m: number) =>
            Math.hypot(a.at[0] - b.at[0], a.at[2] - b.at[2]) >= m
          const brief: LifeSpot[] = []
          for (const b of board.brief)
            if (
              brief.length < 3 &&
              seats.every((g) => apart(g, b, BRIEF_FREE)) &&
              brief.every((o) => apart(o, b, BRIEF_APART))
            )
              brief.push(b)
          board = brief.length ? { ...board, brief } : null
        }
      }
      all = lists
    }
    return all
  }
  const pool = (zi: number): HeroSpot[] => (k <= 0 || !z.zones[zi] ? [] : (make()[zi] ?? []))
  pool.board = (): HeroBoard | null => {
    if (k <= 0) return null
    make()
    return board
  }
  return pool
}
