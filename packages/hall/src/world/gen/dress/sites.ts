import {
  type Cell,
  cellToWorld,
  HEX_SCALE,
  type Landmark,
  type LandmarkKind,
  type LandPiece,
  type LandPlacement,
  PIECES,
} from "../../lands.ts"
import type { Post, Spot } from "../../layout.ts"
import type { Biome, KitColour } from "../biomes.ts"

/** Each district's landmark, the quay, and the posts people stand at to work. */

export const LANDMARK: Record<Biome, (kit: KitColour) => LandPiece> = {
  harbour: () => "building_well_blue",
  village: (kit) => (kit === "red" || kit === "yellow" ? "building_market_red" : "building_market_blue"),
  proving: () => "building_archeryrange_blue",
  library: () => "building_tower_A_blue",
  quarry: () => "building_mine_blue",
  forest: () => "building_lumbermill_blue",
  farms: () => "building_windmill_blue",
  wilds: () => "tent",
}
/** Landmark kinds Life animates or dresses (lands.ts LANDMARK_OF's pieces the generator places). */
const KIND: Partial<Record<LandPiece, LandmarkKind>> = {
  building_windmill_blue: "windmill",
  building_lumbermill_blue: "lumbermill",
  building_mine_blue: "mine",
  building_tower_A_blue: "tower",
  building_well_blue: "well",
  building_market_blue: "market",
  building_market_red: "market",
  floor_wood_large: "dock",
}
const FLAG: Record<KitColour, LandPiece> = {
  blue: "flag_blue",
  red: "flag_red",
  yellow: "flag_yellow",
  green: "flag_yellow",
}

export const round = (value: number): number => Math.round(value * 100) / 100
export const facing = (from: Spot, to: Spot): number => Math.atan2(to[0] - from[0], to[1] - from[1])

const place = (
  piece: LandPiece,
  x: number,
  z: number,
  rot: number,
  scale: number,
  y: number,
): LandPlacement => ({
  piece,
  x: round(x),
  z: round(z),
  rot,
  scale,
  y,
})

/** The quay: planks south off the hub into the bay, a barrel and a crate on them. */
export function quayOf(hub: Cell): LandPlacement[] {
  const [hx, hz] = cellToWorld(hub)
  return [
    ...[6, 10, 14, 18].map((dz) => place("floor_wood_large", hx, hz + dz, 0, 0.2, -0.45)),
    place("floor_wood_large", hx - 4, hz + 18, 0, 0.2, -0.45),
    place("floor_wood_large", hx + 4, hz + 18, 0, 0.2, -0.45),
    place("barrel", hx + 1.3, hz + 8.5, 0, 1, -0.4),
    place("crate_long_A", hx - 4.5, hz + 17.5, 1.6, 1, -0.4),
  ]
}

/** The landmarks Life knows among the decor, the quay's end its dock. */
export function landmarksOf(hub: Cell, decor: readonly LandPlacement[]): Landmark[] {
  const [hx, hz] = cellToWorld(hub)
  const landmarks: Landmark[] = [
    { kind: "dock", piece: "floor_wood_large", x: hx, z: hz + 18, y: -0.45, rot: 0 },
  ]
  for (const placement of decor) {
    const kind = KIND[placement.piece]
    if (!kind || kind === "dock") continue
    landmarks.push({ kind, piece: placement.piece, x: placement.x, z: placement.z, rot: placement.rot ?? 0 })
  }
  return landmarks
}

/** How far in front of a landmark's front face its posts stand, and the nearest to its centre. */
const FRONT_GAP = 1
const NEAREST_POST = 3.4
/**
 * Three posts in front of a landmark (it faces the square), a step off its front face, facing it:
 * on the square's side, where its road ends. `reach` is how far out they stand when the landmark's
 * own size doesn't say: a venue is bigger than its main piece, scaled, with its yard in front.
 */
export function postsAround(site: Spot, square: Spot, landmark: LandPiece, reach?: number): Post[] {
  const toSquare = Math.atan2(square[0] - site[0], square[1] - site[1])
  const front = reach ?? Math.max(NEAREST_POST, (PIECES[landmark].max[2] ?? 0) * HEX_SCALE + FRONT_GAP)
  return [-0.35, 0, 0.35].map((spread) => {
    const angle = toSquare + spread
    const reach = front / Math.cos(spread)
    const x = round(site[0] + Math.sin(angle) * reach)
    const z = round(site[1] + Math.cos(angle) * reach)
    return [x, z, facing([x, z], site)] as Post
  })
}

/** A district's landmark hex: its building facing the square, the biome's props, its flag. */
export function siteDressing(
  biome: Biome,
  kit: KitColour,
  cell: Cell,
  square: Cell,
  random: () => number,
): LandPlacement[] {
  const [x, z] = cellToWorld(cell)
  const look = cellToWorld(square)
  const toSquare = facing([x, z], look)
  const at = (angle: number, distance: number): [number, number] => [
    round(x + Math.sin(toSquare + angle) * distance),
    round(z + Math.cos(toSquare + angle) * distance),
  ]
  const out: LandPlacement[] = [{ piece: LANDMARK[biome](kit), x, z, rot: toSquare }]
  const [fx, fz] = at(Math.PI / 2, 3.8)
  out.push({ piece: FLAG[kit], x: fx, z: fz, rot: 0 })
  const prop = (piece: LandPiece, angle: number, distance: number, scale?: number): void => {
    const [px, pz] = at(angle, distance)
    out.push({ piece, x: px, z: pz, rot: random() * Math.PI * 2, ...(scale ? { scale } : {}) })
  }
  switch (biome) {
    case "proving":
      for (const angle of [2.4, 3.1, 3.8]) {
        const [tx, tz] = at(angle, 3.5)
        out.push({ piece: "target", x: tx, z: tz, rot: facing([tx, tz], [x, z]), scale: 1.4 })
      }
      break
    case "quarry":
      prop("resource_stone", -Math.PI / 2, 3.6)
      prop("rock_single_D", -2.2, 3.4, 1.4)
      break
    case "forest":
      prop("resource_lumber", -Math.PI / 2, 3.6)
      prop("tree_single_A_cut", 2.6, 3.4)
      break
    case "farms":
      prop("sack", -Math.PI / 2, 3.4)
      prop("sack", -2, 3.2, 1.1)
      break
    case "village":
      prop("crate_A_big", -Math.PI / 2, 3.6)
      prop("barrel", -2.2, 3.4)
      break
    case "harbour":
      prop("barrel", -Math.PI / 2, 3.4)
      prop("crate_open", -2.2, 3.4)
      break
    default:
      break
  }
  return out
}
