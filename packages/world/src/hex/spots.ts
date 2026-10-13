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
import { type HexGrid, hexAt } from "./grid.ts"
import { HEX_TILE_SIZE, type PlacedPiece, type TileSpot, tilePrefab, tileVariant } from "./tiles.ts"
import type { HexWorld } from "./world.ts"

/** A spot in the world (facing in world radians, 0 = +z). */
export interface PlacedSpot extends TileSpot {
  /** The tile it is on. */
  tile: number
}

/** A disc nobody walks through, world metres. */
export interface Disc {
  x: number
  z: number
  r: number
}

export interface TileFurniture {
  spots: PlacedSpot[]
  blockers: Disc[]
  /** Indices of the spots on a tile. */
  on(tile: number): readonly number[]
  /** The blockers within `r` of a point. */
  near(x: number, z: number, r: number): Disc[]
}

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
export function tileFurniture(g: HexGrid, w: Pick<HexWorld, "tiles" | "pieces">): TileFurniture {
  const R = HEX_TILE_SIZE
  const tileAt = (x: number, z: number) => {
    const { q, r } = hexAt(x / R, z / R)
    return g.index(q, r)
  }
  const spots: PlacedSpot[] = []
  const blockers: Disc[] = []
  // which tiles carry authored spots / blockers: their pieces add none of the fallback's
  const authoredSpots = new Set<number>()
  const authoredBlockers = new Set<number>()
  for (const t of w.tiles) {
    const base = t.prefab ? tilePrefab(t.prefab) : undefined
    if (!base) continue
    const prefab = tileVariant(base, t.i)
    const local = prefab.spots ?? PREFAB_SPOTS[prefab.id]
    if (prefab.spots) authoredSpots.add(t.i)
    for (const s of local ?? [])
      spots.push(placeSpot(t.i, s, turn(t.x, t.z, t.rot, s.x, s.z), s.facing + t.rot))
    if (prefab.blockers) {
      authoredBlockers.add(t.i)
      for (const b of prefab.blockers) {
        const [x, z] = turn(t.x, t.z, t.rot, b.x, b.z)
        blockers.push({ x, z, r: b.r })
      }
    }
  }
  for (const p of w.pieces as readonly PlacedPiece[]) {
    const rule = ruleOf(p.piece)
    if (!rule) continue
    const tile = tileAt(p.x, p.z)
    const building = p.piece.startsWith("kaykit-hexagon/building-")
    if (rule.r > 0 && (building || !authoredBlockers.has(tile))) {
      const [x, z] = turn(p.x, p.z, p.rot, rule.at?.[0] ?? 0, rule.at?.[1] ?? 0, p.scale)
      blockers.push({ x, z, r: rule.r * p.scale })
    }
    if (!rule.spots || authoredSpots.has(tile)) continue
    const k = p.scale / (rule.ref ?? 1)
    for (const s of rule.spots)
      spots.push(placeSpot(tile, s, turn(p.x, p.z, p.rot, s.x, s.z, k), s.facing + p.rot))
  }
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
