/**
 * A parametric house (HouseBlueprint) + seed → placed kit modules, in recipe space: the footprint is
 * centred on the origin and the front (+z) edge is at z = +depth/2. Pure and deterministic: every
 * choice is `roll(seed, salt)`; there is no trigonometry (turns are quarter turns from a table).
 */
import { roll } from "@guildhall/core"
import type { Facing } from "../compose.ts"
import type { RecipeInstance } from "../recipe.ts"
import type { HouseBlueprint } from "./blueprint.ts"
import { KIT_PROFILES, type KitProfile, type RoofSet } from "./kits.ts"

const PI = Math.PI

/** Which wall panel an instance fills: `index` runs along +x on the ±z sides and along +z on ±x. */
export interface PanelSlot {
  storey: number
  side: Facing
  index: number
}

/** One placed module; panels carry their slot (what `edits` and the composer's panel click address). */
export interface HousePart {
  instance: RecipeInstance
  slot?: PanelSlot
}

export interface House {
  parts: HousePart[]
  /** The door's foot on the front edge, metres. */
  door: [x: number, z: number]
  /** Front-edge cells × module, side cells × module. */
  frontage: number
  depth: number
}

/** Panel order within a storey (front, back, right, left): the output order, so hashes are stable. */
const SIDES: readonly Facing[] = ["+z", "-z", "+x", "-x"]

/** The turn about +y that points a module's +x toward a direction (a unit step on x or z). */
function turnTo(dx: number, dz: number): number {
  if (dx > 0) return 0
  if (dx < 0) return PI
  return dz > 0 ? -PI / 2 : PI / 2
}

/** The turn that puts a hip corner's (+x, -z) peak toward the quadrant (sx, sz). */
function cornerTurn(sx: number, sz: number): number {
  if (sx > 0) return sz < 0 ? 0 : -PI / 2
  return sz < 0 ? PI / 2 : PI
}

/** `i` of `n` from a roll, for picking from a list. */
const pick = (seed: number, salt: string, n: number): number =>
  Math.min(n - 1, Math.floor(roll(seed, salt) * n))

function fail(message: string): never {
  throw new Error(`house: ${message}`)
}

/** Ramp → ramp, one replacement per swapped ramp chosen by seed; identity choices are dropped. */
function rampMapFor(h: HouseBlueprint, seed: number): Record<string, string> | undefined {
  const swaps = h.vary.rampSwaps ?? {}
  const map: Record<string, string> = {}
  for (const from of Object.keys(swaps).sort()) {
    const options = swaps[from] ?? []
    if (options.length === 0) continue
    const to = options[pick(seed, `${from}:ramp`, options.length)] as string
    if (to !== from) map[from] = to
  }
  return Object.keys(map).length > 0 ? map : undefined
}

type RoofPart = { piece: string; x: number; z: number; rot: number }

/** The roof modules over the w × d footprint (cell centres from `cx`, `cz`). */
function roofParts(
  kit: KitProfile,
  h: HouseBlueprint,
  cx: (i: number) => number,
  cz: (j: number) => number,
): RoofPart[] {
  const { w, d } = h.size
  const set: RoofSet = kit.roofs[h.roof.style]
  const out: RoofPart[] = []
  const need = (piece: string | undefined, what: string): string =>
    piece ?? fail(`roof ${h.roof.style} has no ${what} piece in kit ${kit.id}`)

  if (set.point) return [{ piece: set.point, x: cx(0), z: cz(0), rot: 0 }]
  if (set.flat) {
    for (let j = 0; j < d; j++)
      for (let i = 0; i < w; i++) out.push({ piece: set.flat, x: cx(i), z: cz(j), rot: 0 })
    return out
  }
  // Gables: the ridge runs along `ridge`; `run` cells along it, `across` cells across it.
  const alongX = h.roof.ridge === "x"
  const run = alongX ? w : d
  const across = alongX ? d : w
  // Cell (r along the ridge, a across it) → its x, z and the unit steps along/across.
  const at = (r: number, a: number) => (alongX ? { x: cx(r), z: cz(a) } : { x: cx(a), z: cz(r) })
  const [ax, az]: [number, number] = alongX ? [1, 0] : [0, 1]
  const [sx, sz]: [number, number] = alongX ? [0, 1] : [1, 0]
  for (let r = 0; r < run; r++) {
    // -1 at the run's start, +1 at its end, 0 inside (or a run of one: no caps).
    const end = run === 1 ? 0 : r === 0 ? -1 : r === run - 1 ? 1 : 0
    if (across === 1) {
      const { x, z } = at(r, 0)
      if (end === 0) out.push({ piece: need(set.gable, "gable"), x, z, rot: alongX ? 0 : -PI / 2 })
      // The cap's ridge runs inward, away from its hip.
      else
        out.push({
          piece: need(set.gableEnd, "gable-end"),
          x,
          z,
          rot: turnTo(-end * ax, -end * az),
        })
    } else if (across === 2) {
      for (let a = 0; a < 2; a++) {
        const { x, z } = at(r, a)
        // Toward the ridge: +side for the first cell across, -side for the second.
        const s = a === 0 ? 1 : -1
        const [tx, tz] = [s * sx, s * sz]
        if (end === 0) out.push({ piece: need(set.slope, "slope"), x, z, rot: turnTo(tx, tz) })
        else {
          // Peak toward the ridge and inward along the run.
          const px = tx - end * ax
          const pz = tz - end * az
          out.push({ piece: need(set.corner, "corner"), x, z, rot: cornerTurn(px, pz) })
        }
      }
    } else
      fail(
        `a ${h.roof.style} roof spans at most 2 cells across its ridge, got ${across} (ridge ${h.roof.ridge})`,
      )
  }
  return out
}

/** The blueprint's modules for `seed`. Throws (prefixed "house:") when the kit cannot draw it. */
export function buildHouse(h: HouseBlueprint, seed: number): House {
  const kit = KIT_PROFILES[h.kit]
  const M = kit.module
  const { w, d } = h.size
  const cx = (i: number): number => (i + 0.5) * M - (w * M) / 2
  const cz = (j: number): number => (j + 0.5) * M - (d * M) / 2
  const doorIndex = h.door.index === "centre" ? Math.floor((w - 1) / 2) : h.door.index
  const edits = new Map(h.edits.map((e) => [`${e.storey}|${e.side}|${e.index}`, e.piece]))
  const styles = h.vary.openings && h.vary.openings.length > 0 ? h.vary.openings : undefined
  const style = styles ? styles[pick(seed, "window-style", styles.length)] : undefined
  const rampMap = rampMapFor(h, seed)

  const parts: HousePart[] = []
  const put = (piece: string, x: number, y: number, z: number, rot: number, slot?: PanelSlot): void => {
    const instance: RecipeInstance = { piece, x, y, z, rot, scale: 1 }
    if (rampMap) instance.rampMap = { ...rampMap }
    parts.push(slot ? { instance, slot } : { instance })
  }

  for (const [k, storey] of h.storeys.entries()) {
    const set = kit.walls[storey.family]
    const windowStyle = style ?? set.window
    const window =
      set.windows[windowStyle] ??
      fail(`unknown window style "${windowStyle}" (kit ${kit.id}: ${Object.keys(set.windows).join(", ")})`)
    const panel = (side: Facing, index: number, cells: number): string | null => {
      const edit = edits.get(`${k}|${side}|${index}`)
      if (edit !== undefined) return edit
      if (k === 0 && side === "+z" && index === doorIndex) return set.doors[h.door.style ?? "round"]
      if (storey.openings === "blind" || side === "-z") return set.blind
      if (storey.openings === "shop") return side === "+z" ? set.shop : set.blind
      // A home: every front cell, and the middle cell of each side.
      return side === "+z" || index === Math.floor(cells / 2) ? window : set.blind
    }
    const y = k * kit.storey
    for (const side of SIDES) {
      const cells = side === "+z" || side === "-z" ? w : d
      for (let index = 0; index < cells; index++) {
        const piece = panel(side, index, cells)
        if (piece === null) continue
        const x = side === "+x" ? cx(w - 1) : side === "-x" ? cx(0) : cx(index)
        const z = side === "+z" ? cz(d - 1) : side === "-z" ? cz(0) : cz(index)
        const rot = { "+x": 0, "+z": -PI / 2, "-x": PI, "-z": PI / 2 }[side]
        put(piece, x, y, z, rot, { storey: k, side, index })
      }
    }
    // The post stands on its cell's (+x, +z) corner: turn it to each outer corner.
    put(kit.corner, cx(w - 1), y, cz(d - 1), 0)
    put(kit.corner, cx(0), y, cz(d - 1), -PI / 2)
    put(kit.corner, cx(0), y, cz(0), PI)
    put(kit.corner, cx(w - 1), y, cz(0), PI / 2)
  }

  const top = h.storeys.length * kit.storey
  for (const r of roofParts(kit, h, cx, cz)) put(r.piece, r.x, top, r.z, r.rot)

  // A chimney by chance, on a back cell by seed, standing toward the back wall.
  if (h.chimney !== undefined && roll(seed, "chimney") < h.chimney) {
    put(kit.chimney, cx(pick(seed, "chimney-cell", w)), top, cz(0), turnTo(0, -1))
  }

  return { parts, door: [cx(doorIndex), (d * M) / 2], frontage: w * M, depth: d * M }
}
