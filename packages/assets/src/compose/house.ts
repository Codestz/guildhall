/**
 * A parametric house (HouseBlueprint) + seed → placed kit modules, in recipe space: the footprint is
 * centred on the origin and the front (+z) edge is at z = +depth/2. Pure and deterministic: every
 * choice is `roll(seed, salt)`; there is no trigonometry (turns are quarter turns from a table).
 */
import { roll } from "@guildhall/core"
import type { Facing } from "../compose.ts"
import type { RecipeInstance } from "../recipe.ts"
import type { HouseBlueprint, Storey } from "./blueprint.ts"
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

/** `i` of `n` from a roll, for picking from a list. */
const pick = (seed: number, salt: string, n: number): number =>
  Math.min(n - 1, Math.floor(roll(seed, salt) * n))

function fail(message: string): never {
  throw new Error(`house: ${message}`)
}

/** Ramp → ramp, one replacement per swapped ramp chosen by seed; identity choices are dropped. */
function rampMapFor(h: HouseBlueprint, seed: number): Record<string, string> {
  const swaps = h.vary.rampSwaps ?? {}
  const map: Record<string, string> = {}
  for (const from of Object.keys(swaps).sort()) {
    const options = swaps[from] ?? []
    if (options.length === 0) continue
    const to = options[pick(seed, `${from}:ramp`, options.length)] as string
    if (to !== from) map[from] = to
  }
  return map
}

/**
 * The roof's ramp map: the house's, plus one of the kit's roofings by seed, unless the blueprint's
 * `rampSwaps` names a baked roof ramp itself (a teal roof only when a recipe asks for it).
 */
function roofRampMapFor(
  kit: KitProfile,
  h: HouseBlueprint,
  seed: number,
  house: Record<string, string>,
): Record<string, string> {
  const swaps = h.vary.rampSwaps ?? {}
  if (kit.roofings.some((r) => Object.keys(r).some((from) => from in swaps))) return house
  const roofing = kit.roofings[pick(seed, "roofing", kit.roofings.length)] ?? {}
  const changed = Object.entries(roofing).filter(([from, to]) => from !== to)
  return { ...house, ...Object.fromEntries(changed) }
}

type RoofPart = { piece: string; x: number; y?: number; z: number; rot: number }

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
      // Slopes the whole run: the ridge is one line end to end, and each slope's baked gable
      // triangle closes the ends. (The kit's hip corners peak at a point, below the slopes' ridge
      // roll, so a hipped end left the ridge stopping short in a raised block.)
      for (let a = 0; a < 2; a++) {
        const { x, z } = at(r, a)
        // Toward the ridge: +side for the first cell across, -side for the second.
        const s = a === 0 ? 1 : -1
        out.push({ piece: need(set.slope, "slope"), x, z, rot: turnTo(s * sx, s * sz) })
      }
    } else
      fail(
        `a ${h.roof.style} roof spans at most 2 cells across its ridge, got ${across} (ridge ${h.roof.ridge})`,
      )
  }
  return out
}

/**
 * An upper bound on the roof surface over the footprint point (x, z), metres above the wall top: it
 * rises from the kit's `eave` at a sloped wall line to the style's peak at the ridge (or the apex).
 * Gables slope across the ridge, and also toward the ends where a run of more than one cell is hipped.
 */
function roofHeight(kit: KitProfile, h: HouseBlueprint, x: number, z: number): number {
  const M = kit.module
  const { w, d } = h.size
  const { peak } = kit.roofs[h.roof.style]
  const rise = (top: number, dist: number, reach: number): number =>
    kit.eave + ((top - kit.eave) * Math.min(Math.max(dist, 0), reach)) / reach
  if (h.roof.style === "flat") return peak.one
  if (h.roof.style === "point") return rise(peak.one, M / 2 - Math.max(Math.abs(x), Math.abs(z)), M / 2)
  const alongX = h.roof.ridge === "x"
  const [run, across] = alongX ? [w, d] : [d, w]
  const [a, r] = alongX ? [z, x] : [x, z]
  const half = (across * M) / 2
  const toEave = half - Math.abs(a)
  const toEnd = run > 1 ? (run * M) / 2 - Math.abs(r) : Number.POSITIVE_INFINITY
  return rise(across === 1 ? peak.one : peak.two, Math.min(toEave, toEnd), half)
}

/** How far a chimney's shaft stands in from the back wall line, metres (clear of eave and wall). */
const CHIMNEY_INSET = 0.6
/** How far the chimney's top clears the roof surface around it, metres. */
const CHIMNEY_CLEAR = 0.6

/**
 * The chimney stack at `x` on the back row: its pot clears the roof around it by CHIMNEY_CLEAR, and a
 * shaft fills below wherever the roof dips under the pot's foot, so nothing floats or shows a gap.
 */
function chimneyParts(kit: KitProfile, h: HouseBlueprint, x: number, top: number): RoofPart[] {
  const back = (-h.size.d * kit.module) / 2
  // Turned to the back wall (local +x → -z): the shaft spans local x 0.74..1.47 m, z ±0.59 m.
  const z = back + CHIMNEY_INSET + 1.47
  let high = 0
  let low = Number.POSITIVE_INFINITY
  for (const dx of [-0.59, 0, 0.59])
    for (const dz of [-1.47, -1.1, -0.74]) {
      const y = roofHeight(kit, h, x + dx, z + dz)
      high = Math.max(high, y)
      low = Math.min(low, y)
    }
  const { shaft, top: pot, topHeight } = kit.chimney
  const foot = top + Math.max(0, high + CHIMNEY_CLEAR - topHeight)
  const rot = turnTo(0, -1)
  const out: RoofPart[] = []
  if (foot > top + low) out.push({ piece: shaft, x, y: foot - kit.storey, z, rot })
  out.push({ piece: pot, x, y: foot, z, rot })
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
  // The wide doorway's opening runs to its cell's left edge (toward index - 1), where the next front
  // panel closes it. At index 0 it would open onto the corner, so the door is square there.
  const doorStyle = h.door.style === "wide" && doorIndex === 0 ? "square" : (h.door.style ?? "round")
  const edits = new Map(h.edits.map((e) => [`${e.storey}|${e.side}|${e.index}`, e.piece]))
  const styles = h.vary.openings && h.vary.openings.length > 0 ? h.vary.openings : undefined
  const style = styles ? styles[pick(seed, "window-style", styles.length)] : undefined
  const rampMap = rampMapFor(h, seed)
  const roofRamps = roofRampMapFor(kit, h, seed, rampMap)

  const parts: HousePart[] = []
  // `ramps`: the piece's family look under the house's own swaps.
  const put = (
    piece: string,
    [x, y, z, rot]: [number, number, number, number],
    ramps: Record<string, string>,
    slot?: PanelSlot,
  ): void => {
    const instance: RecipeInstance = { piece, x, y, z, rot, scale: 1 }
    if (Object.keys(ramps).length > 0) instance.rampMap = ramps
    parts.push(slot ? { instance, slot } : { instance })
  }

  for (const [k, storey] of h.storeys.entries()) {
    const set = kit.walls[storey.family]
    const look = { ...set.look, ...rampMap }
    const windowStyle = style ?? set.window
    const window =
      set.windows[windowStyle] ??
      fail(`unknown window style "${windowStyle}" (kit ${kit.id}: ${Object.keys(set.windows).join(", ")})`)
    const panel = (side: Facing, index: number, cells: number): string | null => {
      const edit = edits.get(`${k}|${side}|${index}`)
      if (edit !== undefined) return edit
      if (k === 0 && side === "+z" && index === doorIndex) return set.doors[doorStyle]
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
        put(piece, [x, y, z, rot], { ...look }, { storey: k, side, index })
      }
    }
    // The post stands on its cell's (+x, +z) corner: turn it to each outer corner, inset per family.
    const inset = kit.cornerInset[storey.family]
    put(kit.corner, [cx(w - 1) - inset, y, cz(d - 1) - inset, 0], { ...look })
    put(kit.corner, [cx(0) + inset, y, cz(d - 1) - inset, -PI / 2], { ...look })
    put(kit.corner, [cx(0) + inset, y, cz(0) + inset, PI], { ...look })
    put(kit.corner, [cx(w - 1) - inset, y, cz(0) + inset, PI / 2], { ...look })
  }

  const top = h.storeys.length * kit.storey
  const topFamily = (h.storeys[h.storeys.length - 1] as Storey).family
  const roofLook = { ...kit.walls[topFamily].look, ...roofRamps }
  for (const r of roofParts(kit, h, cx, cz)) put(r.piece, [r.x, top, r.z, r.rot], { ...roofLook })

  // A chimney by chance, on a back cell by seed, rising through the back of the roof. It is stone.
  if (h.chimney !== undefined && roll(seed, "chimney") < h.chimney) {
    const x = cx(pick(seed, "chimney-cell", w))
    const look = { ...kit.walls.stone.look, ...rampMap }
    for (const c of chimneyParts(kit, h, x, top)) put(c.piece, [c.x, c.y ?? top, c.z, c.rot], { ...look })
  }

  return { parts, door: [cx(doorIndex), (d * M) / 2], frontage: w * M, depth: d * M }
}
