/**
 * Coarser copies of batch geometry for the static batch's LOD tiers, made at load time with
 * meshoptimizer's simplifier (cached by the batch, one per variant and tier). Library pieces are
 * welded at import, so the simplifier sees real topology. Collapses may cross normal seams (flat-shaded
 * low-poly art is all seams), but never a `_swatch` border: vertices where two swatches meet are
 * protected, so palette regions keep their outlines and colours never bleed. Normals a collapse left
 * pointing away from their new face are replaced by the face's own. Two-sided cards (a leaf modelled
 * as a triangle and its reversed twin) are simplified one side only and given their back again, since
 * collapsing both sides as one surface drops a side.
 */

import { MeshoptSimplifier } from "meshoptimizer"
import { BufferAttribute, BufferGeometry, Group, type Matrix4, Mesh, Vector3 } from "three"
import { BATCH_ATTRIBUTES, batchGeometry } from "./batchGeometry.ts"

/** The simplifier's WASM is compiled asynchronously; await this before simplifying. */
export const simplifierReady: Promise<void> = MeshoptSimplifier.ready

/** meshopt's vertex_lock value that keeps a vertex from collapsing in permissive mode. */
const PROTECT = 2
/** How much a vertex's normal steers collapses next to its position (meshopt attribute weight). */
const NORMAL_WEIGHT = 0.5
/** A corner keeps its own normal while within ~60° of its (new) face; otherwise it gets the face's. */
const KEEP_NORMAL = 0.5

/**
 * How far a tier may go: `ratio` of the triangles at most, `error` the deviation allowed (share of
 * size); `prune` also drops disconnected bits smaller than the error (trim on a shell, but the blades
 * of a crop are such bits too).
 */
export interface Simplify {
  ratio: number
  error: number
  prune?: boolean
}

type Arrays = {
  position: Float32Array
  normal: Float32Array
  color: Uint8Array
  _swatch: Uint8Array
  _shade: Uint8Array
  _ao: Uint8Array
}

const arrays = (geometry: BufferGeometry) =>
  Object.fromEntries(
    Object.keys(BATCH_ATTRIBUTES).map((name) => [name, geometry.getAttribute(name).array]),
  ) as Arrays

/** 2 for each vertex sharing its position with a vertex of another swatch, 0 otherwise. */
function swatchBorders(remap: Uint32Array, swatch: Uint8Array): Uint8Array {
  const first = new Int16Array(remap.length).fill(-1)
  const mixed = new Uint8Array(remap.length)
  for (let v = 0; v < remap.length; v++) {
    const at = remap[v] as number
    const s = swatch[v] as number
    if (first[at] === -1) first[at] = s
    else if (first[at] !== s) mixed[at] = 1
  }
  const lock = new Uint8Array(remap.length)
  for (let v = 0; v < remap.length; v++) if (mixed[remap[v] as number]) lock[v] = PROTECT
  return lock
}

/** The winding of corners (a, b, c) read from the smallest: whether the next one is the smaller other. */
function winding(a: number, b: number, c: number): boolean {
  if (a < b && a < c) return b < c
  if (b < c) return c < a
  return a < b
}

/**
 * `index` split into one-sided triangles and the front sides of two-sided cards: a triangle whose
 * reversed twin (the same corner positions, `remap`ped, wound the other way) is also there. The twins
 * are left out.
 */
export function splitCards(
  index: Uint32Array,
  remap: Uint32Array,
): { single: Uint32Array; cards: Uint32Array } {
  /** Sorted corners → the first triangle seen with them, its winding, and whether it found its twin. */
  const seen = new Map<string, { t: number; turn: boolean; paired: boolean }>()
  /** Per triangle: 0 one-sided, 1 a card's front, 2 a card's twin. */
  const role = new Uint8Array(index.length / 3)
  for (let t = 0; t < index.length; t += 3) {
    const a = remap[index[t] as number] as number
    const b = remap[index[t + 1] as number] as number
    const c = remap[index[t + 2] as number] as number
    const turn = winding(a, b, c)
    const key = [a, b, c].sort((x, y) => x - y).join(",")
    const first = seen.get(key)
    if (!first) seen.set(key, { t, turn, paired: false })
    else if (!first.paired && first.turn !== turn) {
      first.paired = true
      role[first.t / 3] = 1
      role[t / 3] = 2
    }
  }
  const single: number[] = []
  const cards: number[] = []
  for (let t = 0; t < index.length; t += 3) {
    const list = role[t / 3] === 0 ? single : role[t / 3] === 1 ? cards : null
    list?.push(index[t] as number, index[t + 1] as number, index[t + 2] as number)
  }
  return { single: Uint32Array.from(single), cards: Uint32Array.from(cards) }
}

/**
 * `geometry` (batch format, indexed) simplified to about `ratio` of its triangles, stopping at
 * `error` (relative to its size) whatever the ratio, pruning small bits if it says so. A new
 * geometry in the batch format; `geometry` is untouched. The simplifier must be ready.
 */
export function simplifyGeometry(
  geometry: BufferGeometry,
  { ratio, error, prune = false }: Simplify,
): BufferGeometry {
  const source = arrays(geometry)
  const remap = MeshoptSimplifier.generatePositionRemap(source.position, 3)
  const lock = swatchBorders(remap, source._swatch)
  const { single, cards } = splitCards(Uint32Array.from(geometry.index?.array ?? []), remap)
  const simplify = (index: Uint32Array) =>
    index.length === 0
      ? index
      : MeshoptSimplifier.simplifyWithAttributes(
          index,
          source.position,
          3,
          source.normal,
          3,
          [NORMAL_WEIGHT, NORMAL_WEIGHT, NORMAL_WEIGHT],
          lock,
          Math.max(3, Math.floor((index.length * ratio) / 3) * 3),
          error,
          prune ? ["Permissive", "Prune"] : ["Permissive"],
        )[0]
  return rebuild(source, simplify(single), simplify(cards), geometry.name)
}

/**
 * The triangles of `single`, and of `cards` each with its reversed back, as a compact geometry; a
 * corner bent off its face gets the face normal.
 */
function rebuild(source: Arrays, single: Uint32Array, cards: Uint32Array, name: string): BufferGeometry {
  /** Output vertex per (source vertex, normal) — the source's own normal under key `v`. */
  const made = new Map<string, number>()
  const from: number[] = []
  const normals: number[] = []
  const out: number[] = []
  const p = source.position
  const n = source.normal
  const triangles: [number, number, number][] = []
  for (let t = 0; t < single.length; t += 3)
    triangles.push([single[t] as number, single[t + 1] as number, single[t + 2] as number])
  for (let t = 0; t < cards.length; t += 3)
    triangles.push(
      [cards[t] as number, cards[t + 1] as number, cards[t + 2] as number],
      [cards[t + 2] as number, cards[t + 1] as number, cards[t] as number],
    )
  for (const [a, b, c] of triangles) {
    const ux = (p[b * 3] as number) - (p[a * 3] as number)
    const uy = (p[b * 3 + 1] as number) - (p[a * 3 + 1] as number)
    const uz = (p[b * 3 + 2] as number) - (p[a * 3 + 2] as number)
    const vx = (p[c * 3] as number) - (p[a * 3] as number)
    const vy = (p[c * 3 + 1] as number) - (p[a * 3 + 1] as number)
    const vz = (p[c * 3 + 2] as number) - (p[a * 3 + 2] as number)
    let fx = uy * vz - uz * vy
    let fy = uz * vx - ux * vz
    let fz = ux * vy - uy * vx
    const length = Math.hypot(fx, fy, fz)
    if (length === 0) continue
    fx /= length
    fy /= length
    fz /= length
    for (const v of [a, b, c]) {
      const own =
        (n[v * 3] as number) * fx + (n[v * 3 + 1] as number) * fy + (n[v * 3 + 2] as number) * fz >=
        KEEP_NORMAL
      const key = own ? `${v}` : `${v}|${Math.round(fx * 64)},${Math.round(fy * 64)},${Math.round(fz * 64)}`
      let at = made.get(key)
      if (at === undefined) {
        at = from.length
        made.set(key, at)
        from.push(v)
        if (own) normals.push(n[v * 3] as number, n[v * 3 + 1] as number, n[v * 3 + 2] as number)
        else normals.push(fx, fy, fz)
      }
      out.push(at)
    }
  }

  const geometry = new BufferGeometry()
  for (const [attribute, f] of Object.entries(BATCH_ATTRIBUTES)) {
    const values = source[attribute as keyof Arrays]
    const array = attribute === "normal" ? Float32Array.from(normals) : new f.array(from.length * f.itemSize)
    if (attribute !== "normal")
      from.forEach((v, i) => {
        for (let k = 0; k < f.itemSize; k++) array[i * f.itemSize + k] = values[v * f.itemSize + k] as number
      })
    geometry.setAttribute(attribute, new BufferAttribute(array, f.itemSize, f.normalized))
  }
  geometry.setIndex(new BufferAttribute(Uint32Array.from(out), 1))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  geometry.name = name
  return geometry
}

/**
 * The total area of `geometry`'s triangles (m²). A simplification that loses much of it has lost
 * outline too: thin leaves collapsed, a two-sided card's back dropped.
 */
export function surfaceArea(geometry: BufferGeometry): number {
  const p = geometry.getAttribute("position")
  const index = geometry.index
  if (!index) return 0
  const a = new Vector3()
  const b = new Vector3()
  const c = new Vector3()
  let area = 0
  for (let t = 0; t < index.count; t += 3) {
    a.fromBufferAttribute(p, index.getX(t))
    b.fromBufferAttribute(p, index.getX(t + 1)).sub(a)
    c.fromBufferAttribute(p, index.getX(t + 2)).sub(a)
    area += b.cross(c).length() / 2
  }
  return area
}

/** One part of a cluster's shell: a batch geometry (its coarsest tier) and where it sits in the cluster. */
export interface ShellPart {
  geometry: BufferGeometry
  matrix: Matrix4
}

/** How a shell is made: parts under `minRadius` metres left out, then simplified unless that loses area. */
export interface Shell {
  minRadius: number
  simplify: Simplify
  /** The share of the merged parts' surface area the simplified shell must keep; else they stay merged as they are. */
  minArea: number
}

/**
 * A cluster (a house, a field, a wood) as one geometry for far away: its parts merged in cluster
 * space, those whose bounding radius is under `minRadius` (trim, lanterns, crates, flowers) left out
 * unless every part is that small, then simplified as one when that keeps the outline (walls and
 * roofs do; a field of crops, all small and apart, does not and stays merged as it is). The parts are
 * not touched.
 */
export function shellGeometry(
  parts: readonly ShellPart[],
  { minRadius, simplify, minArea }: Shell,
): BufferGeometry {
  const radius = ({ geometry, matrix }: ShellPart) => {
    if (!geometry.boundingSphere) geometry.computeBoundingSphere()
    return (geometry.boundingSphere?.radius ?? 0) * matrix.getMaxScaleOnAxis()
  }
  const big = parts.filter((part) => radius(part) >= minRadius)
  const root = new Group()
  for (const { geometry, matrix } of big.length > 0 ? big : parts) {
    const mesh = new Mesh(geometry)
    mesh.matrixAutoUpdate = false
    mesh.matrix.copy(matrix)
    root.add(mesh)
  }
  const merged = batchGeometry(root)
  const shell = simplifyGeometry(merged, simplify)
  if (surfaceArea(shell) >= minArea * surfaceArea(merged)) {
    merged.dispose()
    return shell
  }
  shell.dispose()
  return merged
}
