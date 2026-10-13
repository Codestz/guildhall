/**
 * The castle's paved courts dressed (decisions.md backlog "castle yards read as big empty paving"):
 * the ways from the gate to the doors stay clear, and what is left of each court tile gets a few things
 * that say what the court is for, set where they stand clear of the ways and of the curtain wall:
 *
 *   the gate court   torches either side, a cart in from the road, a rack of arms;
 *   the heart        the court before the great hall (or the keep): banners and benches for whoever waits;
 *   the others       by turns: a practice target (a straw bale with a shield, a guard's drill spot in
 *                    front of it, spots.ts), benches under a lantern, barrels and crates against the wall,
 *                    a flag on its pole;
 *   by the wall      (tier 2 up, world.ts gives them out by turns) a yard of one trade: the stables (hay,
 *                    a cart, its wheel), the smithy (an anvil, the grindstone, firewood), a well with
 *                    benches, the stores, or the barracks' drill.
 *
 * Benches give seats, targets drill spots and the anvil a smith's place through spots.ts's piece rules
 * (court tiles carry no authored spots); every piece is placed only where it clears the path strips by
 * a stride. Away from the gate and the heart a court's things stand as one group: the first in the
 * corner farthest from its ways (against the wall where it belongs there), the rest gathered round it.
 */
import { hash2 } from "../geom/noise.ts"
import { HEX_TILE_SIZE, KENNEY_WOOD, type PlacedPiece } from "./tiles.ts"

type P = [number, number]

/** What a court is for: by the gate, the heart, before the barracks' door (drill), a tower's (stores). */
export type CourtKind = "gate" | "heart" | "drill" | "stores" | "plain" | "stables" | "smithy" | "well"

/** The trades a walled court is given by turns (world.ts), each a yard of its own along the wall. */
export const COURT_THEMES: readonly CourtKind[] = ["stables", "smithy", "well", "stores", "drill"]

/** One thing a court may hold: its pieces round a point (local: +z away from the court's middle), its size. */
interface Item {
  /** Clearance radius, metres. */
  r: number
  /** Whether it belongs against the wall (stores) or out in the open (benches, targets). */
  wall: boolean
  pieces: (colour: string) => {
    piece: string
    x: number
    z: number
    rot: number
    scale: number
    y?: number
  }[]
}

const ITEMS: Record<string, Item> = {
  torch: {
    r: 0.3,
    wall: true,
    pieces: () => [{ piece: "kaykit-halloween/post-lantern", x: 0, z: 0, rot: 0, scale: 0.55 }],
  },
  banner: {
    r: 0.35,
    wall: false,
    pieces: (c) => [{ piece: `kaykit-dungeon/banner-${c}`, x: 0, z: 0, rot: Math.PI, scale: 0.4 }],
  },
  bench: {
    r: 0.6,
    wall: false,
    // facing the court's middle
    pieces: () => [{ piece: "kenney-graveyard/bench", x: 0, z: 0, rot: Math.PI, scale: 0.5 }],
  },
  target: {
    r: 0.55,
    wall: true,
    // a straw bale with a shield on its face, toward the court
    pieces: () => [
      { piece: "kenney-graveyard/hay-bale", x: 0, z: 0, rot: 0, scale: 0.6 },
      { piece: "kaykit-adventurers/shield-round-color", x: 0, z: -0.36, rot: Math.PI, scale: 1.05, y: 0.5 },
    ],
  },
  stores: {
    r: 0.65,
    wall: true,
    pieces: () => [
      { piece: "kaykit-dungeon/crates-stacked", x: -0.25, z: 0.1, rot: 0.3, scale: 0.4 },
      { piece: "kaykit-dungeon/barrel-small", x: 0.45, z: 0.05, rot: 0, scale: 0.45 },
    ],
  },
  rack: {
    r: 0.55,
    wall: true,
    pieces: () => [{ piece: "kaykit-dungeon/sword-shield", x: 0, z: 0, rot: Math.PI, scale: 0.42 }],
  },
  cart: {
    r: 0.9,
    wall: false,
    pieces: () => [{ piece: "kenney-town/cart", x: 0, z: 0, rot: Math.PI / 2, scale: 0.34 }],
  },
  flag: {
    r: 0.3,
    wall: false,
    pieces: () => [{ piece: "kenney-castle/flag", x: 0, z: 0, rot: 0, scale: 0.4 }],
  },
  shed: {
    r: 1.0,
    wall: true,
    // the smithy's roof on four posts, the anvil under it (its smith's place before it, toward the court)
    pieces: () => [
      { piece: "kenney-survival/structure-roof", x: 0, z: 0, rot: 0, scale: 0.5 },
      { piece: "kenney-survival/workbench-anvil", x: 0, z: -0.1, rot: Math.PI, scale: 0.9 },
    ],
  },
  stall: {
    r: 1.0,
    wall: true,
    // the stables' canvas roof on its posts, hay under it
    pieces: () => [
      { piece: "kenney-survival/structure-canvas", x: 0, z: 0, rot: 0, scale: 0.5 },
      { piece: "kenney-graveyard/hay-bale-bundled", x: -0.3, z: 0.15, rot: 0.2, scale: 0.55 },
      { piece: "kenney-graveyard/hay-bale", x: 0.35, z: 0.1, rot: 1.4, scale: 0.5 },
    ],
  },
  wagon: {
    r: 0.85,
    wall: false,
    // the stables' high-sided cart, along the yard
    pieces: () => [{ piece: "kenney-town/cart-high", x: 0, z: 0, rot: Math.PI / 2, scale: 0.3 }],
  },
  workbench: {
    r: 0.65,
    wall: true,
    pieces: () => [{ piece: "kenney-survival/workbench", x: 0, z: 0, rot: Math.PI, scale: 0.9 }],
  },
  grinder: {
    r: 0.62,
    wall: true,
    pieces: () => [{ piece: "kenney-survival/workbench-grind", x: 0, z: 0, rot: Math.PI, scale: 0.9 }],
  },
  bars: {
    r: 0.45,
    wall: true,
    // the smith's iron
    pieces: () => [{ piece: "kaykit-resources/iron-bars-stack-medium", x: 0, z: 0, rot: 0.3, scale: 0.6 }],
  },
  tub: {
    r: 0.5,
    wall: false,
    // a water tub: the horses' trough, the smith's quench
    pieces: () => [{ piece: "kenney-survival/barrel-open", x: 0, z: 0, rot: 0, scale: 0.9 }],
  },
  bale: {
    r: 0.35,
    wall: true,
    pieces: () => [{ piece: "kenney-graveyard/hay-bale-bundled", x: 0, z: 0, rot: 0.2, scale: 0.5 }],
  },
  hay: {
    r: 0.6,
    wall: true,
    // bales for the stables, one on another
    pieces: () => [
      { piece: "kenney-graveyard/hay-bale-bundled", x: -0.2, z: 0, rot: 0.2, scale: 0.6 },
      { piece: "kenney-graveyard/hay-bale-bundled", x: -0.15, z: 0, rot: -0.1, scale: 0.6, y: 0.5 },
      { piece: "kenney-graveyard/hay-bale", x: 0.5, z: -0.1, rot: 1.4, scale: 0.55 },
    ],
  },
  logs: {
    r: 0.6,
    wall: true,
    // firewood for the hall's hearths
    pieces: () => [{ piece: "kaykit-resources/wood-log-stack", x: 0, z: 0, rot: Math.PI / 2, scale: 0.45 }],
  },
  barrel: {
    r: 0.3,
    wall: true,
    pieces: () => [{ piece: "kaykit-dungeon/barrel-small", x: 0, z: 0, rot: 0.4, scale: 0.45 }],
  },
  keg: {
    r: 0.4,
    wall: true,
    pieces: () => [{ piece: "kaykit-dungeon/barrel-large", x: 0, z: 0, rot: 0, scale: 0.4 }],
  },
  box: {
    r: 0.3,
    wall: true,
    pieces: () => [{ piece: "kaykit-dungeon/box-small", x: 0, z: 0, rot: 0.6, scale: 0.45 }],
  },
  chest: {
    r: 0.4,
    wall: true,
    pieces: () => [{ piece: "kaykit-dungeon/chest", x: 0, z: 0, rot: Math.PI, scale: 0.4 }],
  },
  bucket: {
    r: 0.25,
    wall: false,
    pieces: () => [{ piece: "kenney-survival/bucket", x: 0, z: 0, rot: 0, scale: 0.6 }],
  },
  anvil: {
    // (with room for the smith in front of it)
    r: 0.75,
    wall: true,
    // its smith's place on the court's side (spots.ts): the anvil turned so it stands in front of it
    pieces: () => [{ piece: "kenney-survival/workbench-anvil", x: 0, z: 0, rot: Math.PI, scale: 0.9 }],
  },
  grindstone: {
    r: 0.55,
    wall: true,
    pieces: () => [{ piece: "kaykit-tools/grindstone", x: 0, z: 0, rot: 0.4, scale: 0.35 }],
  },
  wheel: {
    r: 0.4,
    wall: true,
    // a spare cart wheel leant on the wall
    pieces: () => [{ piece: "kenney-town/wheel", x: -0.48, z: 0, rot: 0.3, scale: 0.42 }],
  },
  well: {
    r: 0.85,
    wall: true,
    pieces: (c) => [{ piece: `kaykit-hexagon/building-well-${c}`, x: 0, z: 0, rot: 0, scale: 0.28 }],
  },
  barrels: {
    r: 0.5,
    wall: true,
    pieces: () => [
      { piece: "kaykit-dungeon/barrel-small", x: -0.25, z: 0, rot: 0, scale: 0.45 },
      { piece: "kaykit-dungeon/barrel-small", x: 0.25, z: 0.05, rot: 0.5, scale: 0.45 },
    ],
  },
}

/** What each kind of court holds, in the order it tries them. */
const PLANS: Record<CourtKind, string[][]> = {
  gate: [["torch", "torch", "rack", "cart", "barrels", "barrel"]],
  heart: [["banner", "banner", "bench", "bench", "barrels", "bucket"]],
  // before the barracks: a drill court, targets and the arms between them
  drill: [
    ["target", "rack", "target", "barrel", "bucket"],
    ["target", "target", "rack", "box"],
  ],
  // before a tower: its stores against the wall
  stores: [
    ["stores", "chest", "keg", "barrel", "box", "barrels", "stores", "box"],
    ["keg", "stores", "box", "chest", "barrel", "stores", "barrels"],
  ],
  // yards of one trade along the wall (COURT_THEMES)
  // (a yard of two or three courts has room for the whole list; a single court for its first few)
  stables: [
    [
      "stall|wagon|cart|hay|bale",
      "wagon|hay|bale",
      "tub|bucket",
      "hay|bale",
      "wheel",
      "bale",
      "barrel",
      "bucket",
    ],
    ["stall|wagon|cart|hay|bale", "wagon|hay|bale", "hay|bale", "tub|bucket", "wheel", "barrel", "bale"],
  ],
  smithy: [
    ["shed|anvil|grindstone", "workbench|grindstone", "bars", "tub", "grinder", "logs", "barrel", "box"],
    ["shed|anvil|grindstone", "grinder|grindstone", "workbench", "logs", "tub", "bars", "keg", "bucket"],
  ],
  well: [["well|bucket", "bench", "bucket", "bench", "torch", "barrel", "tub"]],
  // (each with small things last, for what room is left)
  plain: [
    ["target", "bench", "hay", "barrels", "barrel", "bucket"],
    ["bench", "stores", "logs", "flag", "box"],
    ["cart", "hay", "bench", "barrels", "bucket"],
    ["stores", "bench", "flag", "logs", "barrel"],
  ],
}

const R = HEX_TILE_SIZE
/**
 * Half a court's walked strip (roads.ts ROAD_HALF; world.ts paves 1.1 m either side, so a cart or a
 * bench may stand on the paving's edge), and the hand's width kept clear of it.
 */
const STRIP = 0.85
const CLEAR = 0.15
/** How close to a walled side's inner face an item may stand (the wall's inner face is ~1.36 m in). */
const WALL_FACE = R * (Math.sqrt(3) / 2) - 1.33

const dir = (d: number): P => [Math.cos((Math.PI / 3) * d), -Math.sin((Math.PI / 3) * d)]

/** Distance from a point to the segment from the origin to `b`. */
function toRay(p: P, b: P): number {
  const l2 = b[0] * b[0] + b[1] * b[1]
  const t = Math.max(0, Math.min(1, (p[0] * b[0] + p[1] * b[1]) / l2))
  return Math.hypot(p[0] - b[0] * t, p[1] - b[1] * t)
}

/** One tile of a court, or of a yard of courts dressed together: its centre, height, ways and walls. */
export interface CourtTile {
  at: P
  y: number
  /** The sides its path strips (and the doors onto it) run out through: kept clear. */
  paths: readonly number[]
  /** The sides the curtain wall stands on. */
  walls: readonly number[]
}

/**
 * A court's dressing: one tile, or two or three neighbouring courts of one trade dressed as one yard
 * (world.ts), its things free to stand across the side they share where no way crosses it (the most
 * room a court has: a cart fits there, not in a single court's corner). `kind` what the court is for,
 * in the keep's `colour`. Pieces stand only where they clear every strip and the wall, inside the
 * court's own tiles.
 */
export function courtDressing(
  tiles: readonly CourtTile[],
  kind: CourtKind,
  colour: string,
  seed: number,
  /**
   * Whether a disc (world x, z, radius) runs into what stands (the curtain wall as built, its towers,
   * the buildings): given, items keep clear of the real wall and not of its usual line, so they use
   * the room a wall standing out over the castle's foot leaves (curtain.ts OUTER_INSET).
   */
  blocked?: (x: number, z: number, r: number) => boolean,
): PlacedPiece[] {
  const plans = PLANS[kind]
  const plan = plans[Math.floor(hash2(seed, 71, 3) * plans.length) % plans.length]!
  const reach = (R * Math.sqrt(3)) / 2
  // each tile's strips (world: from its centre to its sides' middles), and the sides it shares with another
  const strips = tiles.flatMap((t) =>
    t.paths.map((d): [P, P] => [t.at, [dir(d)[0] * reach, dir(d)[1] * reach]]),
  )
  const shared = tiles.map((t) =>
    [0, 1, 2, 3, 4, 5].filter((d) =>
      tiles.some(
        (o) =>
          Math.hypot(t.at[0] + dir(d)[0] * 2 * reach - o.at[0], t.at[1] + dir(d)[1] * 2 * reach - o.at[1]) <
          0.5,
      ),
    ),
  )
  const home = (p: P): number => {
    let best = 0
    for (let m = 1; m < tiles.length; m++)
      if (
        Math.hypot(p[0] - tiles[m]!.at[0], p[1] - tiles[m]!.at[1]) <
        Math.hypot(p[0] - tiles[best]!.at[0], p[1] - tiles[best]!.at[1])
      )
        best = m
    return best
  }
  /** Whether a point stands inside its tile, kept off every side but a shared one (by `r`). */
  const inside = (q: P, r: number): boolean => {
    const m = home(q)
    const t = tiles[m]!
    for (let d = 0; d < 6; d++) {
      if (shared[m]!.includes(d)) continue
      const [ux, uz] = dir(d)
      const out = (q[0] - t.at[0]) * ux + (q[1] - t.at[1]) * uz + r
      if (out > (t.walls.includes(d) && !blocked ? WALL_FACE : reach - 0.25)) return false
    }
    return true
  }
  const lone = tiles.length === 1 && tiles[0]!.paths.length === 0
  const taken: [number, number, number][] = []
  const fits = (p: P, r: number): boolean => {
    if (strips.some(([o, s]) => toRay([p[0] - o[0], p[1] - o[1]], s) < STRIP + r + CLEAR)) return false
    if (lone && Math.hypot(p[0] - tiles[0]!.at[0], p[1] - tiles[0]!.at[1]) < STRIP + r) return false
    // the disc's rim, every 30° (a hex side's outward normal among them), in the court's tiles
    if (!inside(p, r)) return false
    for (let a = 0; a < 12; a++) {
      const q: P = [p[0] + Math.cos((Math.PI / 6) * a) * r, p[1] + Math.sin((Math.PI / 6) * a) * r]
      if (!inside(q, 0)) return false
    }
    if (blocked?.(p[0], p[1], r + 0.1)) return false
    return taken.every(([x, z, rr]) => Math.hypot(x - p[0], z - p[1]) >= rr + r + 0.1)
  }
  // the places items may go: out toward each side of each tile, a little either way along it
  const spots: { p: P; d: number; wall: boolean }[] = []
  for (const [m, t] of tiles.entries()) {
    for (let d = 0; d < 6; d++) {
      const [ux, uz] = dir(d)
      const wall = t.walls.includes(d)
      for (const out of [2.2, 1.95, 1.7, 1.45, 1.2, 1.0, 0.8])
        for (const side of [0, -0.3, 0.3, -0.6, 0.6, -0.85, 0.85, -1.1, 1.1, -1.35, 1.35])
          spots.push({ p: [t.at[0] + ux * out - uz * side, t.at[1] + uz * out + ux * side], d, wall })
      // and out in the corner between two sides, where two ways leave the most room
      const [vx, vz] = [Math.cos((Math.PI / 3) * d + Math.PI / 6), -Math.sin((Math.PI / 3) * d + Math.PI / 6)]
      for (const out of [2.4, 2.25, 2.0, 1.75, 1.5])
        spots.push({
          p: [t.at[0] + vx * out, t.at[1] + vz * out],
          d,
          wall: wall || t.walls.includes((d + 1) % 6),
        })
      // and across a side shared with the next tile of the yard
      if (shared[m]!.includes(d))
        for (const along of [0, -0.5, 0.5, -1.0, 1.0, -1.4, 1.4])
          for (const across of [0, -0.4, 0.4, -0.8, 0.8])
            spots.push({
              p: [t.at[0] + ux * (reach + across) - uz * along, t.at[1] + uz * (reach + across) + ux * along],
              d,
              wall: false,
            })
    }
  }
  // how far a spot stands from the court's ways (from its middle, if none run through)
  const room = (p: P): number =>
    strips.length
      ? Math.min(...strips.map(([o, s]) => toRay([p[0] - o[0], p[1] - o[1]], s)))
      : Math.hypot(p[0] - tiles[0]!.at[0], p[1] - tiles[0]!.at[1])
  // by the gate and before the hall a pair stands either side; elsewhere the court's things gather
  const grouped = kind !== "gate" && kind !== "heart"
  let group: P | undefined
  const out: PlacedPiece[] = []
  for (const [k, names] of plan.entries()) {
    const jitter = (s: { p: P; d: number }) =>
      hash2(seed, k, s.d * 31 + Math.round((s.p[0] - tiles[0]!.at[0]) * 10))
    // the first against the wall where it belongs there, else where the court opens: scattered by the
    // seed, or (grouped) in the corner farthest from the ways; the rest as near it as they fit, a wall
    // thing by the wall a little before the nearest spot
    const key = (item: Item, s: { p: P; d: number; wall: boolean }) =>
      !grouped
        ? jitter(s)
        : group
          ? Math.hypot(s.p[0] - group[0], s.p[1] - group[1]) +
            (s.wall === item.wall ? 0 : 0.6) +
            jitter(s) * 0.2
          : -room(s.p) + jitter(s) * 0.4
    const find = (item: Item) =>
      [...spots]
        .sort(
          (a, b) =>
            (grouped && group ? 0 : Number(b.wall === item.wall) - Number(a.wall === item.wall)) ||
            key(item, a) - key(item, b),
        )
        .find((s) => fits(s.p, item.r))
    // ("hay|bale": the first of them that fits, so a tight court keeps its trade in something smaller)
    let item: Item | undefined
    let spot: ReturnType<typeof find>
    for (const name of names.split("|")) {
      item = ITEMS[name]!
      spot = find(item)
      if (spot) break
    }
    if (!item || !spot) continue
    taken.push([spot.p[0], spot.p[1], item.r])
    group ??= spot.p
    // the item's +z looks out from its tile's middle: its front (−z) toward it
    const t = tiles[home(spot.p)]!
    const face = Math.atan2(spot.p[0] - t.at[0], spot.p[1] - t.at[1])
    const c = Math.cos(face)
    const s = Math.sin(face)
    for (const q of item.pieces(colour)) {
      const placed: PlacedPiece = {
        piece: q.piece,
        x: spot.p[0] + q.x * c + q.z * s,
        y: t.y + (q.y ?? 0),
        z: spot.p[1] - q.x * s + q.z * c,
        rot: face + q.rot,
        scale: q.scale,
      }
      if (q.piece.startsWith("kenney-")) placed.swatchMap = KENNEY_WOOD
      out.push(placed)
    }
  }
  return out
}
