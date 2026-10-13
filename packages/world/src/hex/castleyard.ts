/**
 * The castle's paved courts dressed (decisions.md backlog "castle yards read as big empty paving"):
 * the ways from the gate to the doors stay clear, and what is left of each court tile gets a few things
 * that say what the court is for, set where they stand clear of the ways and of the curtain wall:
 *
 *   the gate court   torches either side, a cart in from the road, a rack of arms;
 *   the heart        the court before the great hall (or the keep): banners and benches for whoever waits;
 *   the others       by turns: a practice target (a straw bale with a shield, a guard's drill spot in
 *                    front of it, spots.ts), benches under a lantern, barrels and crates against the wall,
 *                    a flag on its pole.
 *
 * Benches give seats and targets drill spots through spots.ts's piece rules (court tiles carry no
 * authored spots); every piece is placed only where it clears the path strips by a stride.
 */
import { hash2 } from "../geom/noise.ts"
import { HEX_TILE_SIZE, KENNEY_WOOD, type PlacedPiece } from "./tiles.ts"

type P = [number, number]

/** What a court is for. */
export type CourtKind = "gate" | "heart" | "plain"

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
  gate: [["torch", "torch", "rack", "cart", "barrels"]],
  heart: [["banner", "banner", "bench", "bench", "barrels"]],
  plain: [
    ["target", "bench", "hay", "barrels"],
    ["bench", "stores", "logs", "flag"],
    ["cart", "hay", "bench", "barrels"],
    ["stores", "bench", "flag", "logs"],
  ],
}

const R = HEX_TILE_SIZE
/** Half a court's path strip (world.ts paves them 1.1 m either side), and the stride kept clear of it. */
const STRIP = 1.1
const CLEAR = 0.2
/** How close to a walled side's inner face an item may stand (the wall's inner face is ~1.36 m in). */
const WALL_FACE = R * (Math.sqrt(3) / 2) - 1.33

const dir = (d: number): P => [Math.cos((Math.PI / 3) * d), -Math.sin((Math.PI / 3) * d)]

/** Distance from a point to the segment from the origin to `b`. */
function toRay(p: P, b: P): number {
  const l2 = b[0] * b[0] + b[1] * b[1]
  const t = Math.max(0, Math.min(1, (p[0] * b[0] + p[1] * b[1]) / l2))
  return Math.hypot(p[0] - b[0] * t, p[1] - b[1] * t)
}

/**
 * A court tile's dressing at `at` (its centre) and height `y`: `paths` the sides its path strips run
 * out through, `walls` the sides the curtain wall stands on, `kind` what the court is for, in the keep's
 * `colour`. Pieces stand only where they clear every strip and the wall.
 */
export function courtDressing(
  at: P,
  y: number,
  paths: readonly number[],
  walls: readonly number[],
  kind: CourtKind,
  colour: string,
  seed: number,
): PlacedPiece[] {
  const plans = PLANS[kind]
  const plan = plans[Math.floor(hash2(seed, 71, 3) * plans.length) % plans.length]!
  const reach = (R * Math.sqrt(3)) / 2
  const strips = paths.map((d): P => [dir(d)[0] * reach, dir(d)[1] * reach])
  const taken: [number, number, number][] = []
  const fits = (p: P, r: number): boolean => {
    if (strips.some((s) => toRay(p, s) < STRIP + r + CLEAR)) return false
    if (paths.length === 0 && Math.hypot(p[0], p[1]) < STRIP + r) return false
    for (let d = 0; d < 6; d++) {
      const [ux, uz] = dir(d)
      const out = p[0] * ux + p[1] * uz + r
      if (out > (walls.includes(d) ? WALL_FACE : reach - 0.25)) return false
    }
    return taken.every(([x, z, rr]) => Math.hypot(x - p[0], z - p[1]) >= rr + r + 0.1)
  }
  // the places items may go: out toward each side, a little either way along it
  const spots: { p: P; d: number; wall: boolean }[] = []
  for (let d = 0; d < 6; d++) {
    const [ux, uz] = dir(d)
    for (const out of [1.95, 1.7, 1.45, 1.2, 1.0])
      for (const side of [0, -0.6, 0.6, -1.1, 1.1])
        spots.push({ p: [ux * out - uz * side, uz * out + ux * side], d, wall: walls.includes(d) })
  }
  const out: PlacedPiece[] = []
  for (const [k, name] of plan.entries()) {
    const item = ITEMS[name]!
    // against the wall where it belongs there, else where the court opens; a pair stands either side
    const order = [...spots].sort(
      (a, b) =>
        Number(b.wall === item.wall) - Number(a.wall === item.wall) ||
        hash2(seed, k, a.d * 31 + Math.round(a.p[0] * 10)) -
          hash2(seed, k, b.d * 31 + Math.round(b.p[0] * 10)),
    )
    const spot = order.find((s) => fits(s.p, item.r))
    if (!spot) continue
    taken.push([spot.p[0], spot.p[1], item.r])
    // the item's +z looks out from the court's middle: its front (−z) toward it
    const face = Math.atan2(spot.p[0], spot.p[1])
    const c = Math.cos(face)
    const s = Math.sin(face)
    for (const q of item.pieces(colour)) {
      const placed: PlacedPiece = {
        piece: q.piece,
        x: at[0] + spot.p[0] + q.x * c + q.z * s,
        y: y + (q.y ?? 0),
        z: at[1] + spot.p[1] - q.x * s + q.z * c,
        rot: face + q.rot,
        scale: q.scale,
      }
      if (q.piece.startsWith("kenney-")) placed.swatchMap = KENNEY_WOOD
      out.push(placed)
    }
  }
  return out
}
