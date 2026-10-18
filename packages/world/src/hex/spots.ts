/**
 * What people do things at and walk round on the hex island (decisions.md "Polish round": activity
 * spots), in world space: every tile's spots and blockers.
 *
 *   authored   a prefab's own `spots` / `blockers` (the tile composer's), turned with the tile;
 *   fallback   until a prefab carries them: spots and blockers read off the pieces that stand in the
 *              world (a bench is a seat, an anvil a smith's place, a stall a merchant's, a tree a
 *              woodcutter's, the archery range's line faces its targets), plus a few per prefab
 *              (rows of a field, the end of a pier). Pieces stand where world.ts put them, so a
 *              stall that is packed away on a tile has no merchant.
 *
 * Every building also blocks its footprint, authored or not, so nobody cuts through a house.
 */
import { blockerShapes, isBlockerOf, pieceBlockerShapes, shapeSolid } from "./blockers.ts"
import {
  discSolid,
  pieceOutline,
  pieceSolids,
  type Solid,
  SolidGrid,
  type SolidKind,
  solidDistance,
  solidKind,
  type Walkway,
  walkwayAt,
  walkwaySolids,
} from "./collide.ts"
import { type HexGrid, hexAt } from "./grid.ts"
import {
  HEX_TILE_SIZE,
  mirrorPrefab,
  type PlacedPiece,
  type TileSpot,
  tilePrefab,
  tileVariant,
} from "./tiles.ts"
import type { HexWorld } from "./world.ts"

/** A spot in the world (facing in world radians, 0 = +z). */
export interface PlacedSpot extends TileSpot {
  /** The tile it is on. */
  tile: number
}

/**
 * Something nobody walks through, world metres: a disc round it, and (a tile's authored blocker,
 * blockers.ts) its real shape, a box or a circle, as a solid.
 */
export interface Disc {
  x: number
  z: number
  r: number
  solid?: Solid
}

export interface TileFurniture {
  spots: PlacedSpot[]
  blockers: Disc[]
  /** Indices of the spots on a tile. */
  on(tile: number): readonly number[]
  /** The blockers within `r` of a point. */
  near(x: number, z: number, r: number): Disc[]
  /**
   * The collision layer's solids (collide.ts): every piece's real outline, the authored blockers, the
   * stairs' cheeks and the bridges' rails. Walks keep clear of these.
   */
  solids: readonly Solid[]
  /** The solids near a point (their round within `r`). */
  solidsNear(x: number, z: number, r: number): Solid[]
  /** Whether a body of radius `r` at (x, z) stands in a solid (of the kinds `kinds` lets in). */
  blocked(x: number, z: number, r: number, kinds?: (k: SolidKind) => boolean): boolean
  /** A stair's tread, a bridge's or a deck's planks at a point (its height), or null off every walkway. */
  walkwayAt(x: number, z: number): number | null
  /** Spots left out: set inside a building, a wall or a fence too deep to move out of. */
  dropped: PlacedSpot[]
}

/** How far from where its prefab writes it a piece may have been put and still be the one a blocker covers, metres. */
const OF_REACH = 0.35
/** A body's half-width at a spot, metres: no spot stands nearer a building, a wall or a fence. */
export const SPOT_CLEAR = 0.22
/** A body's core: nearer a wall than this a spot is moved (and no gap narrower lets a body through). */
export const BODY_CORE = 0.12
/** A work spot's (a body at arm's length from what it works at, chest to the wall). */
export const WORK_CLEAR = 0.1
/**
 * A spot whose middle is nearer a prop's outline than PROP_IN (a crate, a cart, a stall's table) steps
 * out to PROP_OUT from it, at most PROP_STEP from where it was written, metres.
 */
const PROP_IN = 0.04
const PROP_OUT = 0.08
const PROP_STEP = 0.45
/** What no spot stands in: buildings, walls, towers, fences. */
export const HARD = (k: SolidKind): boolean => k === "building" || k === "wall"

/** A spot in a piece's (or a tile's) own frame: metres at the reference scale, facing relative to it. */
type LocalSpot = Omit<TileSpot, "kind"> & { kind?: TileSpot["kind"] }

interface PieceRule {
  test: RegExp
  /** Blocker radius at scale 1 (0: none); `at` moves its centre in the piece's frame (scale 1). */
  r: number
  at?: [number, number]
  /** Spots in the piece's frame at scale `ref` (scaled with the piece). */
  spots?: LocalSpot[]
  ref?: number
}

const SIT = "Sit_Chair_Idle"
/** A bench's seat over the ground, metres, as the rig's sitting pose wants it (the hips' drop). */
const BENCH_LIFT = -0.06

/** The fallback, by piece: first match wins. */
const PIECE_RULES: PieceRule[] = [
  // ---- KayKit buildings: the footprint, and the work a few of them have out front (+z is the front) ----
  { test: /^kaykit-hexagon\/building-well/, r: 2.3 },
  {
    test: /^kaykit-hexagon\/building-archeryrange/,
    r: 3.2,
    at: [1.2, -2.6],
    ref: 0.4,
    // the shooting line, facing the targets standing out on the left of the yard
    spots: [
      { x: 0.55, z: 1.35, facing: -Math.PI / 2 - 0.25, roles: ["archer"] },
      { x: 0.75, z: 2.1, facing: -Math.PI / 2 - 0.15, roles: ["archer"] },
      { x: 1.6, z: 1.7, facing: -Math.PI / 2 - 0.15, roles: ["archer"] },
    ],
  },
  {
    test: /^kaykit-hexagon\/building-market/,
    r: 3.4,
    ref: 0.4,
    spots: [
      { x: -1.2, z: 2.0, facing: 0, roles: ["merchant"] },
      { x: 1.2, z: 2.0, facing: 0, roles: ["merchant"] },
    ],
  },
  {
    test: /^kaykit-hexagon\/building-blacksmith/,
    r: 3.2,
    ref: 0.5,
    spots: [{ x: 1.55, z: 1.55, facing: -0.6, roles: ["smith"], clip: "Hammering" }],
  },
  {
    test: /^kaykit-hexagon\/building-tavern/,
    r: 3,
    ref: 0.5,
    spots: [{ x: 1.3, z: 1.75, facing: 0.5, roles: ["tavern-keeper"] }],
  },
  {
    test: /^kaykit-hexagon\/building-church/,
    r: 3,
    ref: 0.5,
    spots: [{ kind: "stand", x: -1.2, z: 1.8, facing: Math.PI, roles: ["monk"] }],
  },
  {
    test: /^kaykit-hexagon\/building-barracks/,
    r: 3.6,
    ref: 0.44,
    // standing guard either side of the door, looking out
    spots: [
      { kind: "stand", x: -1.1, z: 2.1, facing: 0, roles: ["guard"] },
      { kind: "stand", x: 1.1, z: 2.1, facing: 0, roles: ["guard"] },
    ],
  },
  {
    test: /^kaykit-hexagon\/building-lumbermill/,
    r: 3.2,
    ref: 0.45,
    spots: [{ x: 1.5, z: 1.7, facing: -0.4, roles: ["lumberjack"], clip: "Sawing" }],
  },
  {
    test: /^kaykit-hexagon\/building-mine/,
    r: 3.4,
    ref: 0.42,
    spots: [{ x: -1.3, z: 1.9, facing: Math.PI * 0.85, roles: ["miner"] }],
  },
  { test: /^kaykit-hexagon\/building-/, r: 2.6 },
  // ---- furniture ----
  {
    test: /^kenney-graveyard\/bench$/,
    r: 0.6,
    ref: 0.55,
    spots: [{ kind: "sit", x: 0, z: 0.12, facing: 0, clip: SIT, y: BENCH_LIFT }],
  },
  {
    test: /^kenney-town\/stall-(red|green)$/,
    r: 1.6,
    ref: 0.45,
    // behind the counter, facing the customers
    spots: [{ x: 0, z: -0.45, facing: 0, roles: ["merchant"] }],
  },
  { test: /^kenney-town\/stall-bench$/, r: 0.9 },
  // ---- the castle's (curtain.ts, castleyard.ts) ----
  {
    // a guard either side of the gate, inside it, looking out through it
    test: /^kaykit-hexagon\/wall-straight-gate$/,
    r: 0,
    ref: 0.38,
    spots: [
      { kind: "stand", x: -1.3, z: -1.0, facing: 0, roles: ["guard"], hours: [6, 21] },
      { kind: "stand", x: 1.3, z: -1.0, facing: 0, roles: ["guard"], hours: [6, 21] },
    ],
  },
  {
    // a practice target (a shield on a straw bale): sword drill in front of it
    test: /^kaykit-adventurers\/shield-round-color$/,
    r: 0,
    ref: 0.9,
    spots: [
      {
        x: 0,
        z: 0.95,
        facing: Math.PI,
        roles: ["guard"],
        clip: "Melee_2H_Attack_Chop",
        prop: "kaykit-weapons/sword-a",
        hours: [8, 18],
      },
    ],
  },
  { test: /^kenney-graveyard\/hay-bale/, r: 0.5 },
  { test: /^kaykit-dungeon\/sword-shield$/, r: 0.45 },
  { test: /^kaykit-dungeon\/banner-/, r: 0.3 },
  { test: /^kenney-town\/cart/, r: 2.2 },
  {
    test: /^kenney-survival\/workbench-anvil$/,
    r: 0.5,
    ref: 0.9,
    spots: [{ x: 0, z: 0.75, facing: Math.PI, roles: ["smith"], clip: "Hammering" }],
  },
  {
    test: /^kaykit-resources\/wood-log-stack$/,
    r: 0.85,
    ref: 0.6,
    spots: [{ x: 0, z: 0.95, facing: Math.PI, roles: ["lumberjack"], clip: "Chopping" }],
  },
  {
    test: /^kaykit-resources\/stone-chunks-large$/,
    r: 0.75,
    ref: 0.6,
    spots: [{ x: 0, z: 0.95, facing: Math.PI, roles: ["miner"], clip: "Pickaxing" }],
  },
  {
    test: /^kenney-graveyard\/gravestone/,
    r: 0.45,
    ref: 0.5,
    spots: [{ kind: "stand", x: 0, z: 0.75, facing: Math.PI, roles: ["monk"] }],
  },
  {
    // a woodcutter at the trunk (the crown is over people's heads: only the trunk blocks)
    test: /^kaykit-forest\/tree-(1|2|3)-/,
    r: 0.5,
    ref: 0.6,
    spots: [{ x: 0, z: 0.75, facing: Math.PI, roles: ["lumberjack"], clip: "Chopping" }],
  },
  { test: /^kaykit-forest\/tree-/, r: 0.5 },
  { test: /^kenney-pirate\/barrel$/, r: 0.65 },
  { test: /^kaykit-dungeon\/barrel-small$/, r: 0.5 },
  { test: /^kenney-pirate\/crate/, r: 0.65 },
  { test: /^kaykit-dungeon\/crates-stacked$/, r: 1 },
  { test: /^kaykit-resources\/(textiles|wood-planks|iron-bars|pallet|fuel)/, r: 0.85 },
  { test: /^kaykit-resources\/wood-log-a$/, r: 0.6 },
  { test: /^kaykit-forest\/rock-/, r: 0.9 },
  { test: /^kaykit-halloween\/post-lantern$/, r: 0.35 },
  { test: /^kenney-survival\/signpost$/, r: 0.3 },
  { test: /^kenney-town\/hedge$/, r: 0.9 },
  { test: /^kenney-survival\/tent/, r: 1.5 },
  {
    // sitting on the ground round the campfire
    test: /^kenney-survival\/campfire/,
    r: 0.45,
    spots: [
      { kind: "sit", x: 0, z: 0.85, facing: Math.PI, clip: "Sit_Floor_Idle" },
      { kind: "sit", x: -0.75, z: -0.4, facing: Math.PI * 0.35, clip: "Sit_Floor_Idle" },
    ],
  },
]

/** Fishing off a pier: the rod is a plain staff held out over the water (data/mounts.json tilts it). */
const DOCK_END = { clip: "Fishing_Idle", roles: ["fisher"], prop: "kaykit-weapons/staff-a" }
/** The fallback, by prefab (tile frame): what no single piece says. */
const PREFAB_SPOTS: Record<string, LocalSpot[]> = {
  // between the crop rows (rows at z = 0, ±0.8, ±1.6), working along them
  field: [-1.2, -0.4, 0.4, 1.2].flatMap((z, k) =>
    [-0.9, 0.9].map((x) => ({
      x: x + (k % 2) * 0.3,
      z,
      facing: x < 0 ? Math.PI / 2 : -Math.PI / 2,
      roles: ["farmer"],
    })),
  ),
  // the end of the pier, facing the sea (the pier runs out toward -z)
  dock: [
    { x: -0.45, z: -1.55, facing: Math.PI, ...DOCK_END },
    { x: 0.5, z: -1.45, facing: Math.PI, ...DOCK_END },
  ],
  "dock-ship": [
    { x: -0.4, z: -1.55, facing: Math.PI, ...DOCK_END },
    { x: 0.5, z: -1.5, facing: Math.PI, ...DOCK_END },
  ],
  "dock-boats": [
    { x: -0.45, z: 0.4, facing: Math.PI, ...DOCK_END },
    { x: 0.5, z: 0.45, facing: Math.PI, ...DOCK_END },
  ],
}

/** The rule a piece follows (null: none), on its id without the colour a building was given. */
function ruleOf(piece: string): PieceRule | null {
  for (const rule of PIECE_RULES) if (rule.test.test(piece)) return rule
  return null
}

/** (x, z) in a frame at (ox, oz) turned by `rot` (placeTile's turn), scaled by `k`. */
const turn = (ox: number, oz: number, rot: number, x: number, z: number, k = 1): [number, number] => {
  const c = Math.cos(rot)
  const s = Math.sin(rot)
  return [ox + (x * c + z * s) * k, oz + (-x * s + z * c) * k]
}

const placeSpot = (tile: number, l: LocalSpot, at: [number, number], facing: number): PlacedSpot => ({
  ...l,
  kind: l.kind ?? "work",
  tile,
  x: at[0],
  z: at[1],
  facing,
})

/** The spots and blockers of a built island. */
export function tileFurniture(
  g: HexGrid,
  w: Pick<HexWorld, "tiles" | "pieces"> & Partial<Pick<HexWorld, "stairs" | "bridges" | "decks">>,
): TileFurniture {
  const R = HEX_TILE_SIZE
  const tileAt = (x: number, z: number) => {
    const { q, r } = hexAt(x / R, z / R)
    return g.index(q, r)
  }
  const spots: PlacedSpot[] = []
  const blockers: Disc[] = []
  /** The authored blockers' shapes, as solids (soft: kept clear of where there is room). */
  const shaped: Solid[] = []
  // the pieces as placed, by id and 2 m cell: a blocker that is a piece's own shape (`of`) stands where
  // that piece was put (its jitter, a nudge off the road), and is none where it is packed away
  const PCELL = 2
  const placedAt = new Map<string, PlacedPiece[]>()
  const pkey = (id: string, cx: number, cz: number) => `${id}|${cx}|${cz}`
  for (const p of w.pieces as readonly PlacedPiece[]) {
    const k = pkey(p.piece, Math.floor(p.x / PCELL), Math.floor(p.z / PCELL))
    const list = placedAt.get(k)
    if (list) list.push(p)
    else placedAt.set(k, [p])
  }
  /** The placed piece `id` nearest (x, y, z) within `reach` metres on the ground, if any. */
  const placedNear = (
    id: string,
    x: number,
    y: number,
    z: number,
    reach: number,
  ): PlacedPiece | undefined => {
    let best: PlacedPiece | undefined
    let bestD = reach
    for (let cx = Math.floor((x - reach) / PCELL); cx <= Math.floor((x + reach) / PCELL); cx++)
      for (let cz = Math.floor((z - reach) / PCELL); cz <= Math.floor((z + reach) / PCELL); cz++)
        for (const p of placedAt.get(pkey(id, cx, cz)) ?? []) {
          const d = Math.hypot(p.x - x, p.z - z) + Math.abs(p.y - y) * 0.5
          if (d < bestD) {
            bestD = d
            best = p
          }
        }
    return best
  }
  // which tiles carry authored spots / blockers: their pieces add none of the fallback's
  const authoredSpots = new Set<number>()
  const authoredBlockers = new Set<number>()
  for (const t of w.tiles) {
    const base = t.prefab ? tilePrefab(t.prefab) : undefined
    if (!base) continue
    const variant = tileVariant(base, t.i)
    const prefab = t.mirror ? mirrorPrefab(variant) : variant
    const local = prefab.spots ?? PREFAB_SPOTS[prefab.id]
    if (prefab.spots) authoredSpots.add(t.i)
    for (const s of local ?? [])
      spots.push(placeSpot(t.i, s, turn(t.x, t.z, t.rot, s.x, s.z), s.facing + t.rot))
    if (prefab.blockers) {
      authoredBlockers.add(t.i)
      for (const b of prefab.blockers) {
        let solids: Solid[]
        if (isBlockerOf(b)) {
          // the piece's own shape, as it was placed (none: it is packed away on this tile)
          const q = prefab.pieces[b.of]
          if (!q) continue
          const [x, z] = turn(t.x, t.z, t.rot, q.x, q.z)
          const p = placedNear(q.piece, x, t.top + (q.y ?? 0), z, OF_REACH)
          if (!p) continue
          solids = pieceBlockerShapes(p, b.pad ?? 0).map((sh) => shapeSolid(sh, 0, 0, 0, p.y))
        } else solids = blockerShapes(b, []).map((sh) => shapeSolid(sh, t.x, t.z, t.rot, t.top))
        for (const so of solids) {
          so.soft = true
          shaped.push(so)
          blockers.push({ x: so.cx, z: so.cz, r: so.r, solid: so })
        }
      }
    }
  }
  // the collision layer: every piece's outline, the authored blockers, the stairs' cheeks, the rails
  const solids: Solid[] = []
  // the composer's blockers (their real shapes): kept clear of where there is room, but the pieces' own
  // outlines are the walls
  solids.push(...shaped)
  for (const st of w.stairs ?? []) solids.push(...walkwaySolids(st))
  for (const b of w.bridges ?? []) for (const leg of b.legs) solids.push(...walkwaySolids(leg))
  const ways = [...(w.stairs ?? []), ...(w.bridges ?? []).flatMap((b) => b.legs), ...(w.decks ?? [])]
  // the walkways in 4 m cells (asked for often: every way round a prop checks the ground it goes over)
  const WCELL = 4
  const wayCells = new Map<number, Walkway[]>()
  const wkey = (cx: number, cz: number) => (cx + 4096) * 8192 + cz + 4096
  for (const st of ways) {
    const pad = st.half + 0.3
    for (
      let cx = Math.floor((Math.min(st.ax, st.bx) - pad) / WCELL);
      cx <= Math.floor((Math.max(st.ax, st.bx) + pad) / WCELL);
      cx++
    )
      for (
        let cz = Math.floor((Math.min(st.az, st.bz) - pad) / WCELL);
        cz <= Math.floor((Math.max(st.az, st.bz) + pad) / WCELL);
        cz++
      ) {
        const list = wayCells.get(wkey(cx, cz))
        if (list) list.push(st)
        else wayCells.set(wkey(cx, cz), [st])
      }
  }
  const wayAt = (x: number, z: number) => {
    for (const st of wayCells.get(wkey(Math.floor(x / WCELL), Math.floor(z / WCELL))) ?? []) {
      const y = walkwayAt(st, x, z)
      if (y !== null) return y
    }
    return null
  }
  /** A piece under a walkway's surface (a quay's stone blocks): stood on, not bumped into. */
  const floor = (p: PlacedPiece) => {
    const deck = wayAt(p.x, p.z)
    const o = pieceOutline(p.piece)
    return deck !== null && !!o && p.y + o.top * p.scale <= deck + 0.12
  }
  for (const p of w.pieces as readonly PlacedPiece[]) {
    const own = floor(p) ? [] : pieceSolids(p)
    solids.push(...own)
    const rule = ruleOf(p.piece)
    if (!rule) continue
    const tile = tileAt(p.x, p.z)
    const building = p.piece.startsWith("kaykit-hexagon/building-")
    if (rule.r > 0 && (building || !authoredBlockers.has(tile))) {
      const [x, z] = turn(p.x, p.z, p.rot, rule.at?.[0] ?? 0, rule.at?.[1] ?? 0, p.scale)
      blockers.push({ x, z, r: rule.r * p.scale })
      // a piece the library has no outline of blocks by its rule's disc
      if (!own.length && solidKind(p.piece)) solids.push(discSolid("blocker", x, z, rule.r * p.scale, p.y))
    }
    if (!rule.spots || authoredSpots.has(tile)) continue
    const k = p.scale / (rule.ref ?? 1)
    for (const s of rule.spots)
      spots.push(placeSpot(tile, s, turn(p.x, p.z, p.rot, s.x, s.z, k), s.facing + p.rot))
  }
  // every spot clear of buildings, walls and fences by a body (a standing one of props too): one set
  // into a wall is moved out the shortest way, and one that cannot be is left out
  const grid = new SolidGrid(solids)
  const all = () => true
  const blocked = (x: number, z: number, r: number, kinds: (k: SolidKind) => boolean = all) => {
    for (const o of grid.near(x, z, r)) if (kinds(o.kind) && solidDistance(o, x, z) < r) return true
    return false
  }
  const dir: [number, number] = [0, 0]
  const onWay = (x: number, z: number) => wayAt(x, z) !== null
  const kept: PlacedSpot[] = []
  const dropped: PlacedSpot[] = []
  for (const sp of spots) {
    if (sp.kind === "sleep") {
      kept.push(sp)
      continue
    }
    // at work, face to the wall it works at (a smith at his forge, a builder in the scaffold)
    const clear = sp.kind === "work" ? WORK_CLEAR : SPOT_CLEAR
    let x = sp.x
    let z = sp.z
    // only one set in or against a building, a wall or a fence (nearer than a body's core) moves, out to
    // a body's room from it: the rest stand where their tile put them
    const inside = grid.near(x, z, BODY_CORE).some((o) => HARD(o.kind) && solidDistance(o, x, z) < BODY_CORE)
    for (let round = 0; round < 4 && inside; round++) {
      let moved = false
      for (const o of grid.near(x, z, SPOT_CLEAR)) {
        const r = HARD(o.kind) ? clear : 0
        if (r <= 0) continue
        const d = solidDistance(o, x, z, dir)
        if (d >= r) continue
        x += dir[0] * (r - d + 1e-3)
        z += dir[1] * (r - d + 1e-3)
        moved = true
      }
      if (!moved) break
    }
    // … and one standing in a prop as it was placed (a merchant's spot by a stall a hair of jitter took
    // over it, a pile's by its logs) steps out of it, a little way, the shortest way (a seat's sitter and a
    // bed's sleeper are where they are)
    if (sp.kind !== "sit")
      for (let round = 0; round < 3; round++) {
        let moved = false
        for (const o of grid.near(x, z, PROP_OUT)) {
          if (o.soft || HARD(o.kind) || o.kind === "seat") continue
          const d = solidDistance(o, x, z, dir)
          if (d >= PROP_IN) continue
          const nx = x + dir[0] * (PROP_OUT - d)
          const nz = z + dir[1] * (PROP_OUT - d)
          if (Math.hypot(nx - sp.x, nz - sp.z) > PROP_STEP || blocked(nx, nz, BODY_CORE, HARD)) continue
          x = nx
          z = nz
          moved = true
        }
        if (!moved) break
      }
    // a spot on a deck or a flight (a fisher at the quay's edge) stays on it
    if (onWay(sp.x, sp.z) && !onWay(x, z)) {
      x = sp.x
      z = sp.z
    }
    if (Math.hypot(x - sp.x, z - sp.z) > 1.2 || blocked(x, z, 0.02, HARD)) {
      dropped.push(sp)
      continue
    }
    kept.push(x === sp.x && z === sp.z ? sp : { ...sp, x, z })
  }
  spots.length = 0
  spots.push(...kept)
  const onTile = new Map<number, number[]>()
  for (const [k, s] of spots.entries()) {
    const list = onTile.get(s.tile)
    if (list) list.push(k)
    else onTile.set(s.tile, [k])
  }
  // blockers in 4 m cells, for `near`
  const CELL = 4
  // (a number key: `near` runs for every walker every frame)
  const cellKey = (cx: number, cz: number) => (cx + 4096) * 8192 + cz + 4096
  const cells = new Map<number, Disc[]>()
  for (const b of blockers)
    for (let cx = Math.floor((b.x - b.r) / CELL); cx <= Math.floor((b.x + b.r) / CELL); cx++)
      for (let cz = Math.floor((b.z - b.r) / CELL); cz <= Math.floor((b.z + b.r) / CELL); cz++) {
        const key = cellKey(cx, cz)
        const list = cells.get(key)
        if (list) list.push(b)
        else cells.set(key, [b])
      }
  const none: Disc[] = []
  return {
    spots,
    blockers,
    solids,
    solidsNear: (x, z, r) => grid.near(x, z, r),
    walkwayAt: wayAt,
    blocked,
    dropped,
    on: (tile) => onTile.get(tile) ?? [],
    near(x, z, r) {
      let out = none
      for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++)
        for (let cz = Math.floor((z - r) / CELL); cz <= Math.floor((z + r) / CELL); cz++)
          for (const b of cells.get(cellKey(cx, cz)) ?? none) {
            if (Math.hypot(b.x - x, b.z - z) >= b.r + r || out.includes(b)) continue
            if (out === none) out = []
            out.push(b)
          }
      return out
    },
  }
}
