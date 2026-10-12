/**
 * The town's ground as plain typed arrays (plan §5), pure so the town worker can build it: render
 * only wraps the arrays. No polygon booleans: the land is a signed-distance field on a CELL-metre grid
 * cut along its zero line (marching squares, so the coast is smooth and watertight), and the painted
 * ground (streets, squares, fields, plots) is rasterised SS × SS per cell into a mask that every vertex
 * reads as coverage, so a kerb is a clean blend one cell wide wherever it falls. Vertex colours carry
 * the paint, the darker grass along the coast and the contact shade round footprints; a bank skirt
 * runs down the coast.
 */
import { PALETTE, srgbToLinear } from "@guildhall/assets"
import { roll } from "@guildhall/core"
import { bbox, contains } from "../geom/poly.ts"
import type { Vec2 } from "../geom/vec.ts"
import type { GroundTint } from "./nature-field.ts"
import type { TownDraw } from "./types.ts"

export type GroundDraw = TownDraw["ground"]
type OverlayKind = GroundDraw["overlays"][number]["kind"]

/** Plain arrays three takes as they are: x,y,z positions and normals, linear rgb, triangle indices. */
export interface GroundGeometry {
  position: Float32Array
  normal: Float32Array
  color: Float32Array
  index: Uint32Array
}

/** The ground's grid pitch, metres: vertex colours vary at this pitch. */
export const CELL = 1
/** Mask samples per cell side: a vertex's colour is the coverage of the SS × SS samples round it. */
const SS = 4
/** How far past a footprint the ground darkens, metres, and how dark it gets at the wall. */
export const CONTACT_REACH = 1.5
export const CONTACT_MAX = 0.35
/** The darker grass band along a shore, metres. */
const SHORE_BAND = 3.5
/** How far the bank skirt runs down the land's edge: past the water (−0.6) so no seam shows. */
export const SKIRT_BOTTOM = -1.4
/** A field's ridge (and furrow) width across its rows, metres: wide enough for the colour grid. */
const FURROW = 1.2

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/** How much a ground point `d` metres outside a footprint is darkened (0 at CONTACT_REACH and past it). */
export function contactShade(d: number): number {
  return CONTACT_MAX * (1 - smoothstep(0, CONTACT_REACH, Math.max(0, d)))
}

/** A vertex grid: (nx + 1) × (nz + 1) vertices `step` metres apart from (x0, z0). */
export interface Grid {
  x0: number
  z0: number
  nx: number
  nz: number
  step: number
}

/** Lowers `out` at every grid vertex within `reach` of segment ab to its distance from it. */
export function stampSegment(g: Grid, out: Float32Array, a: Vec2, b: Vec2, reach: number): void {
  const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - reach - g.x0) / g.step))
  const i1 = Math.min(g.nx, Math.ceil((Math.max(a[0], b[0]) + reach - g.x0) / g.step))
  const j0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - reach - g.z0) / g.step))
  const j1 = Math.min(g.nz, Math.ceil((Math.max(a[1], b[1]) + reach - g.z0) / g.step))
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const l2 = dx * dx + dz * dz
  for (let j = j0; j <= j1; j++) {
    const pz = g.z0 + j * g.step
    for (let i = i0; i <= i1; i++) {
      const px = g.x0 + i * g.step
      const t = l2 === 0 ? 0 : clamp01(((px - a[0]) * dx + (pz - a[1]) * dz) / l2)
      const ex = a[0] + t * dx - px
      const ez = a[1] + t * dz - pz
      const d = Math.sqrt(ex * ex + ez * ez)
      const k = j * (g.nx + 1) + i
      if (d < (out[k] as number)) out[k] = d
    }
  }
}

/** Where the line z = `z` crosses the rings' sides, sorted: inside is between pairs (even–odd). */
export function crossings(rings: readonly (readonly Vec2[])[], z: number, out: number[] = []): number[] {
  out.length = 0
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i] as Vec2
      const b = ring[j] as Vec2
      if (a[1] > z !== b[1] > z) out.push(a[0] + ((z - a[1]) * (b[0] - a[0])) / (b[1] - a[1]))
    }
  return out.sort((p, q) => p - q)
}

/** A typed array that grows as it is pushed to. */
export function growable<T extends Float32Array | Uint32Array>(make: (n: number) => T) {
  let a = make(1 << 14)
  let n = 0
  return {
    push(v: number) {
      if (n === a.length) {
        const b = make(a.length * 2)
        b.set(a)
        a = b
      }
      a[n++] = v
    },
    get length() {
      return n
    },
    done: (): T => a.slice(0, n) as T,
  }
}

type RGB = [number, number, number]

const swatch = (name: string): RGB => {
  const s = PALETTE.swatches.find((w) => w.name === name)
  if (!s) throw new Error(`ground: no swatch "${name}"`)
  return [srgbToLinear(s.srgb[0]), srgbToLinear(s.srgb[1]), srgbToLinear(s.srgb[2])]
}

const set = (out: RGB, c: RGB): RGB => {
  out[0] = c[0]
  out[1] = c[1]
  out[2] = c[2]
  return out
}
const mix = (out: RGB, c: RGB, t: number): RGB => {
  out[0] += (c[0] - out[0]) * t
  out[1] += (c[1] - out[1]) * t
  out[2] += (c[2] - out[2]) * t
  return out
}

/** Smooth value noise in [0, 1) on a `cell`-metre lattice. */
function noise(seed: number, salt: string, cell: number): (x: number, z: number) => number {
  const cache = new Map<number, number>()
  const at = (i: number, j: number) => {
    const key = i * 262144 + j
    let v = cache.get(key)
    if (v === undefined) {
      v = roll(seed, `${i},${j}:${salt}`)
      cache.set(key, v)
    }
    return v
  }
  // The last lattice cell's corners: the grid walks in rows, so most lookups land in the same cell.
  let ci = Number.NaN
  let cj = Number.NaN
  let a = 0
  let b = 0
  let c = 0
  let d = 0
  return (x, z) => {
    const fx = x / cell
    const fz = z / cell
    const i = Math.floor(fx)
    const j = Math.floor(fz)
    if (i !== ci || j !== cj) {
      ci = i
      cj = j
      a = at(i, j)
      b = at(i + 1, j)
      c = at(i, j + 1)
      d = at(i + 1, j + 1)
    }
    const u = smoothstep(0, 1, fx - i)
    const v = smoothstep(0, 1, fz - j)
    const top = a + (b - a) * u
    const bottom = c + (d - c) * u
    return top + (bottom - top) * v
  }
}

/** Where nature's field says the grass is shaded, light, dry or worn (nature-field.ts `groundTint`). */
export type Tint = (x: number, z: number) => GroundTint

/** How far each tint pulls the grass toward its swatch at full strength. */
export const TINT = { light: 0.6, dry: 0.65, shade: 0.8, worn: 0.7 } as const

/** The grass tint's lattice pitch, metres: woods, meadows and wear vary over tens of metres. */
const TINT_CELL = 8

/**
 * A tint looked up once per TINT_CELL lattice point and blended between them, into `out` (the last
 * cell's corners kept: the grid walks in rows).
 */
function lattice(tint: Tint): (x: number, z: number, out: GroundTint) => GroundTint {
  const cache = new Map<number, GroundTint>()
  const at = (i: number, j: number) => {
    const key = i * 262144 + j
    let v = cache.get(key)
    if (!v) {
      v = tint(i * TINT_CELL, j * TINT_CELL)
      cache.set(key, v)
    }
    return v
  }
  let ci = Number.NaN
  let cj = Number.NaN
  let a = at(0, 0)
  let b = a
  let c = a
  let d = a
  return (x, z, out) => {
    const fx = x / TINT_CELL
    const fz = z / TINT_CELL
    const i = Math.floor(fx)
    const j = Math.floor(fz)
    if (i !== ci || j !== cj) {
      ci = i
      cj = j
      a = at(i, j)
      b = at(i + 1, j)
      c = at(i, j + 1)
      d = at(i + 1, j + 1)
    }
    const u = fx - i
    const v = fz - j
    const w00 = (1 - u) * (1 - v)
    const w10 = u * (1 - v)
    const w01 = (1 - u) * v
    const w11 = u * v
    out.shade = a.shade * w00 + b.shade * w10 + c.shade * w01 + d.shade * w11
    out.light = a.light * w00 + b.light * w10 + c.light * w01 + d.light * w11
    out.dry = a.dry * w00 + b.dry * w10 + c.dry * w01 + d.dry * w11
    out.worn = a.worn * w00 + b.worn * w10 + c.worn * w01 + d.worn * w11
    return out
  }
}

/** Each ground kind's colour at a point: palette ramps, gently varied. Fields are their base here. */
function painter(seed: number, tint?: Tint) {
  const broad = noise(seed, "ground-broad", 23)
  const fine = noise(seed, "ground-fine", 4.5)
  // The same lattices read elsewhere (swapped, scaled) get their own instance: each keeps its last cell.
  const broadSwapped = noise(seed, "ground-broad", 23)
  const leafy = noise(seed, "ground-fine", 4.5)
  const tinted = tint ? lattice(tint) : null
  const t: GroundTint = { shade: 0, light: 0, dry: 0, worn: 0 }
  const c = {
    grass: swatch("grass"),
    grassDark: swatch("grass-dark"),
    grassLight: swatch("grass-light"),
    dryGrass: swatch("dry-grass"),
    dry: swatch("dry-grass-light"),
    cobble: swatch("cobble-light"),
    cobbleDark: swatch("cobble"),
    sand: swatch("sand"),
    sandDark: swatch("sand-dark"),
    sandLight: swatch("sand-light"),
    dirt: swatch("dirt"),
    dirtLight: swatch("dirt-light"),
    dirtDark: swatch("dirt-dark"),
    leaf: swatch("leaf"),
  }
  return (kind: "grass" | OverlayKind, x: number, z: number, out: RGB): RGB => {
    switch (kind) {
      case "grass": {
        mix(set(out, c.grass), c.grassLight, 0.35 + 0.5 * broad(x, z))
        mix(out, c.dry, 0.12 + 0.3 * smoothstep(0.5, 0.95, fine(x, z)) * broadSwapped(z, x))
        if (!tinted) return out
        // The ramps sit close: strong weights, so woods, meadows and worn verges read from the hero.
        tinted(x, z, t)
        mix(out, c.grassLight, TINT.light * t.light)
        mix(out, c.dryGrass, TINT.dry * t.dry)
        mix(out, c.grassDark, TINT.shade * t.shade)
        return mix(out, c.dirt, TINT.worn * t.worn)
      }
      // Warm, light sandy cobbles (V1's paths), a hint of grey stone; the plaza paving lighter still.
      case "cobble":
        return mix(mix(mix(set(out, c.sand), c.sandDark, 0.3), c.cobble, 0.15), c.sandDark, 0.4 * fine(x, z))
      case "plaza":
        return mix(mix(mix(set(out, c.sandLight), c.sand, 0.5), c.cobble, 0.1), c.sandDark, 0.3 * fine(x, z))
      case "dirt":
        return mix(set(out, c.dirt), c.dirtLight, 0.6 * fine(x, z))
      case "sand":
        return mix(set(out, c.sand), c.sandDark, 0.5 * fine(x, z))
      case "garden":
        return mix(set(out, c.dirtDark), c.leaf, 0.25 + 0.5 * smoothstep(0.4, 0.8, leafy(x * 3, z * 3)))
      case "field":
        return mix(set(out, c.dirt), c.dirtLight, 0.3 * broad(x, z))
    }
  }
}

/** A field's row direction: along its longest edge. */
function rowAngle(poly: readonly Vec2[]): number {
  let best = 0
  let angle = 0
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length] as Vec2
    const l = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (l > best) {
      best = l
      angle = Math.atan2(b[1] - a[1], b[0] - a[0])
    }
  })
  return angle
}

/**
 * The overlays rasterised SS × SS per cell, back to front (a later one paints over an earlier one):
 * each sample holds its overlay's index + 1, 0 for none (grass).
 */
function rasterize(g: Grid, overlays: GroundDraw["overlays"]): Uint16Array {
  const w = g.nx * SS
  const h = g.nz * SS
  const s = g.step / SS
  const mask = new Uint16Array(w * h)
  const xs: number[] = []
  overlays.forEach((o, k) => {
    if (o.poly.length < 3) return
    const [lo, hi] = bbox(o.poly)
    const b0 = Math.max(0, Math.ceil((lo[1] - g.z0) / s - 0.5))
    const b1 = Math.min(h - 1, Math.floor((hi[1] - g.z0) / s - 0.5))
    for (let b = b0; b <= b1; b++) {
      crossings([o.poly], g.z0 + (b + 0.5) * s, xs)
      for (let p = 0; p + 1 < xs.length; p += 2) {
        const a0 = Math.max(0, Math.ceil(((xs[p] as number) - g.x0) / s - 0.5))
        const a1 = Math.min(w - 1, Math.floor(((xs[p + 1] as number) - g.x0) / s - 0.5))
        mask.fill(k + 1, b * w + a0, a1 >= a0 ? b * w + a1 + 1 : b * w + a0)
      }
    }
  })
  return mask
}

/**
 * The ground's geometry: the land (its holes cut out, its islets beside it) on the CELL grid with
 * the overlays painted in as vertex colours, contact-darkened round the footprints and darker along
 * the coast, the grass tinted where `tint` (nature's field) says; then the bank skirt down every coast
 * segment, facing out of the land.
 */
export function groundGeometry(gd: GroundDraw, seed = 0, tint?: Tint): GroundGeometry {
  const rings = [gd.land, ...gd.holes, ...(gd.islets ?? [])].filter((r) => r.length >= 3)
  const pos = growable((n) => new Float32Array(n))
  const nor = growable((n) => new Float32Array(n))
  const col = growable((n) => new Float32Array(n))
  const idx = growable((n) => new Uint32Array(n))
  if (rings.length === 0)
    return { position: pos.done(), normal: nor.done(), color: col.done(), index: idx.done() }

  const [lo, hi] = bbox(rings.flat())
  const x0 = Math.floor(lo[0] / CELL) * CELL - CELL
  const z0 = Math.floor(lo[1] / CELL) * CELL - CELL
  const g: Grid = {
    x0,
    z0,
    nx: Math.ceil((hi[0] - x0) / CELL) + 1,
    nz: Math.ceil((hi[1] - z0) / CELL) + 1,
    step: CELL,
  }
  const W = g.nx + 1
  const N = W * (g.nz + 1)

  // Distances: to the land's outline (the field's magnitude near it), to the shore, to a footprint.
  const REACH = 2 * CELL
  const coast = new Float32Array(N).fill(REACH)
  const shore = new Float32Array(N).fill(SHORE_BAND)
  const contact = new Float32Array(N).fill(CONTACT_REACH)
  // The land's sides along its own bounding box are the map's edge, not a shore.
  const [blo, bhi] = bbox(gd.land)
  const both = (a: number, b: number, v: number) => Math.abs(a - v) < 1e-6 && Math.abs(b - v) < 1e-6
  const onBox = (a: Vec2, b: Vec2) =>
    both(a[0], b[0], blo[0]) ||
    both(a[0], b[0], bhi[0]) ||
    both(a[1], b[1], blo[1]) ||
    both(a[1], b[1], bhi[1])
  for (const ring of rings)
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i] as Vec2
      const b = ring[(i + 1) % ring.length] as Vec2
      stampSegment(g, coast, a, b, REACH)
      if (ring !== gd.land || !onBox(a, b)) stampSegment(g, shore, a, b, SHORE_BAND)
    }
  for (const fp of gd.footprints) {
    if (fp.length < 3) continue
    for (let i = 0; i < fp.length; i++)
      stampSegment(g, contact, fp[i] as Vec2, fp[(i + 1) % fp.length] as Vec2, CONTACT_REACH)
    const [flo, fhi] = bbox(fp)
    for (let j = Math.max(0, Math.ceil((flo[1] - z0) / CELL)); j <= Math.min(g.nz, (fhi[1] - z0) / CELL); j++)
      for (
        let i = Math.max(0, Math.ceil((flo[0] - x0) / CELL));
        i <= Math.min(g.nx, (fhi[0] - x0) / CELL);
        i++
      )
        if (contains(fp, [x0 + i * CELL, z0 + j * CELL], 0)) contact[j * W + i] = 0
  }

  // The land's signed distance (positive on land): the outline distance, signed by row crossings.
  const field = new Float32Array(N)
  const xs: number[] = []
  for (let j = 0; j <= g.nz; j++) {
    crossings(rings, z0 + j * CELL, xs)
    let p = 0
    for (let i = 0; i <= g.nx; i++) {
      const x = x0 + i * CELL
      while (p < xs.length && (xs[p] as number) <= x) p++
      const k = j * W + i
      const d = Math.max(coast[k] as number, 1e-6)
      field[k] = p % 2 === 1 ? d : -d
    }
  }

  // Colour: the coverage of the overlay samples round a point, each kind painted, then shaded.
  const mask = rasterize(g, gd.overlays)
  const mw = g.nx * SS
  const mh = g.nz * SS
  const s = CELL / SS
  const paint = painter(seed, tint)
  const darkGrass = swatch("grass-dark")
  const fields = gd.overlays.map((o) =>
    o.kind === "field" ? { c: Math.cos(rowAngle(o.poly)), s: Math.sin(rowAngle(o.poly)) } : null,
  )
  const ids = new Int32Array(SS * SS)
  const counts = new Int32Array(SS * SS)
  const ridges = new Int32Array(SS * SS)
  const part: RGB = [0, 0, 0]
  const colourAt = (x: number, z: number, shoreD: number, contactD: number) => {
    const a0 = Math.floor((x - x0) / s - SS / 2 + 0.5)
    const b0 = Math.floor((z - z0) / s - SS / 2 + 0.5)
    let n = 0
    for (let b = b0; b < b0 + SS; b++)
      for (let a = a0; a < a0 + SS; a++) {
        const id = a >= 0 && b >= 0 && a < mw && b < mh ? (mask[b * mw + a] as number) : 0
        let m = 0
        while (m < n && ids[m] !== id) m++
        if (m === n) {
          ids[n] = id
          counts[n] = 0
          ridges[n] = 0
          n++
        }
        counts[m] = (counts[m] as number) + 1
        const f = id > 0 ? fields[id - 1] : null
        if (f) {
          // Across the rows in the field's frame: alternate FURROW-wide bands are ridges.
          const sx = x0 + (a + 0.5) * s
          const sz = z0 + (b + 0.5) * s
          if ((Math.round((-sx * f.s + sz * f.c) / FURROW) & 1) === 0) ridges[m] = (ridges[m] as number) + 1
        }
      }
    let r = 0
    let gr = 0
    let bl = 0
    const band = 0.22 * (1 - Math.min(shoreD, SHORE_BAND) / SHORE_BAND)
    for (let m = 0; m < n; m++) {
      const id = ids[m] as number
      const kind = id > 0 ? (gd.overlays[id - 1]?.kind ?? "grass") : "grass"
      paint(kind, x, z, part)
      const count = counts[m] as number
      if (kind === "field") mix(part, darkGrass, (0.45 * (ridges[m] as number)) / count)
      if (kind === "grass" || kind === "sand") mix(part, darkGrass, band)
      const w = count / (SS * SS)
      r += part[0] * w
      gr += part[1] * w
      bl += part[2] * w
    }
    const shade = 1 - contactShade(contactD)
    col.push(r * shade)
    col.push(gr * shade)
    col.push(bl * shade)
  }

  let count = 0
  /** Each vertex's x, z, for the coast segments. */
  const xz: number[] = []
  const vertex = (x: number, z: number, shoreD: number, contactD: number) => {
    xz.push(x, z)
    pos.push(x)
    pos.push(0)
    pos.push(z)
    nor.push(0)
    nor.push(1)
    nor.push(0)
    colourAt(x, z, shoreD, contactD)
    return count++
  }
  const corner = new Int32Array(N).fill(-1)
  const cornerAt = (k: number) => {
    if ((corner[k] as number) < 0)
      corner[k] = vertex(
        x0 + (k % W) * CELL,
        z0 + Math.floor(k / W) * CELL,
        shore[k] as number,
        contact[k] as number,
      )
    return corner[k] as number
  }
  // A crossing on the grid edge between vertices ka < kb, cached per edge (horizontal, vertical).
  const across = [new Int32Array(N).fill(-1), new Int32Array(N).fill(-1)]
  const crossAt = (ka: number, kb: number) => {
    const lo2 = Math.min(ka, kb)
    const hi2 = Math.max(ka, kb)
    const cache = across[hi2 - lo2 === 1 ? 0 : 1] as Int32Array
    if ((cache[lo2] as number) < 0) {
      const fa = field[lo2] as number
      const t = fa / (fa - (field[hi2] as number))
      const lerp = (arr: Float32Array) =>
        (arr[lo2] as number) + ((arr[hi2] as number) - (arr[lo2] as number)) * t
      const ax = x0 + (lo2 % W) * CELL
      const az = z0 + Math.floor(lo2 / W) * CELL
      const bx = x0 + (hi2 % W) * CELL
      const bz = z0 + Math.floor(hi2 / W) * CELL
      cache[lo2] = vertex(ax + (bx - ax) * t, az + (bz - az) * t, lerp(shore), lerp(contact))
    }
    return cache[lo2] as number
  }

  /** Coast segments as runs of ax, az, bx, bz, the land on each one's left. */
  const coastline: number[] = []
  const poly: number[] = []
  const crossed: boolean[] = []
  const k = new Int32Array(4)
  const f = new Float32Array(4)
  for (let j = 0; j < g.nz; j++)
    for (let i = 0; i < g.nx; i++) {
      // Corners counter-clockwise in x,z: (i, j), (i+1, j), (i+1, j+1), (i, j+1).
      k[0] = j * W + i
      k[1] = k[0] + 1
      k[2] = k[0] + W + 1
      k[3] = k[0] + W
      let ins = 0
      for (let c = 0; c < 4; c++) {
        f[c] = field[k[c] as number] as number
        if ((f[c] as number) > 0) ins++
      }
      if (ins === 0) continue
      if (ins === 4) {
        // Facing up (+y) in three is clockwise in x,z.
        const a = cornerAt(k[0] as number)
        const b = cornerAt(k[1] as number)
        const c = cornerAt(k[2] as number)
        const d = cornerAt(k[3] as number)
        idx.push(a)
        idx.push(c)
        idx.push(b)
        idx.push(a)
        idx.push(d)
        idx.push(c)
        continue
      }
      // Marching squares: walk the cell's sides, keeping the land corners and the zero crossings.
      poly.length = 0
      crossed.length = 0
      for (let c = 0; c < 4; c++) {
        const here = f[c] as number
        const next = f[(c + 1) % 4] as number
        if (here > 0) {
          poly.push(cornerAt(k[c] as number))
          crossed.push(false)
        }
        if (here > 0 !== next > 0) {
          poly.push(crossAt(k[c] as number, k[(c + 1) % 4] as number))
          crossed.push(true)
        }
      }
      for (let m = 1; m + 1 < poly.length; m++) {
        idx.push(poly[0] as number)
        idx.push(poly[m + 1] as number)
        idx.push(poly[m] as number)
      }
      // Two crossings in a row are a coast segment, land on its left.
      for (let m = 0; m < poly.length; m++)
        if (crossed[m] && crossed[(m + 1) % poly.length]) {
          const a = poly[m] as number
          const b = poly[(m + 1) % poly.length] as number
          coastline.push(
            xz[2 * a] as number,
            xz[2 * a + 1] as number,
            xz[2 * b] as number,
            xz[2 * b + 1] as number,
          )
        }
    }

  // The bank: a vertical ribbon down every coast segment, facing out of the land, earth-coloured.
  const top = swatch("sand-light")
  const bottom = swatch("sand-dark")
  for (let m = 0; m < coastline.length; m += 4) {
    const ax = coastline[m] as number
    const az = coastline[m + 1] as number
    const bx = coastline[m + 2] as number
    const bz = coastline[m + 3] as number
    const length = Math.hypot(bx - ax, bz - az)
    if (length < 1e-6) continue
    // The land is on the segment's left (x right, z up), so (dz, −dx) points out of it.
    const nx = (bz - az) / length
    const nz = -(bx - ax) / length
    for (const v of [ax, 0, az, bx, 0, bz, bx, SKIRT_BOTTOM, bz, ax, SKIRT_BOTTOM, az]) pos.push(v)
    for (let k = 0; k < 4; k++) {
      nor.push(nx)
      nor.push(0)
      nor.push(nz)
    }
    for (const c of [top, top, bottom, bottom]) for (const v of c) col.push(v)
    // (a_top, a_bottom, b_bottom) faces along u × v, u = (0, h, 0), v = (dx, h, dz): (h·dz, 0, −h·dx).
    const facing = SKIRT_BOTTOM * ((bz - az) * nx - (bx - ax) * nz)
    for (const q of facing > 0 ? [0, 3, 2, 0, 2, 1] : [0, 2, 3, 0, 1, 2]) idx.push(count + q)
    count += 4
  }
  return { position: pos.done(), normal: nor.done(), color: col.done(), index: idx.done() }
}
