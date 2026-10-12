import { PALETTE } from "@guildhall/assets"
import { log, roll } from "@guildhall/core"
import {
  bbox,
  clip,
  closest,
  contains,
  type MultiPolygon,
  orient,
  type Ring,
  type TownDraw,
  type Vec2,
} from "@guildhall/world"
import { BufferAttribute, BufferGeometry, Color, Mesh, ShapeUtils, Vector2 } from "three"
import { paletteMaterial } from "./material.ts"
import type { Stage } from "./stage.ts"

export type GroundDraw = TownDraw["ground"]
type OverlayKind = GroundDraw["overlays"][number]["kind"]

/** A flat triangle mesh in the ground plane: x,z pairs and triangle indices. */
export interface FlatMesh {
  points: number[]
  indices: number[]
}

/** The grid the land is refined on, metres: vertex colours vary at this pitch (plan §5). */
export const GRID = 2
/** How far past a footprint the ground darkens, metres, and how dark it gets at the wall. */
export const CONTACT_REACH = 1.5
export const CONTACT_MAX = 0.35
/** The darker grass band along a shore, metres. */
const SHORE_BAND = 3.5
/** How far the bank skirt runs down the land's edge: past the water (−0.6) so no seam shows. */
const SKIRT_BOTTOM = -1.4
/** Field rows: the spacing across them (half a furrow) and the grid pitch along them, metres. */
const FURROW = 0.6
const ALONG_ROWS = 4

const logger = log("render:ground")

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/** How much a ground point `d` metres outside a footprint is darkened (0 at CONTACT_REACH and past it). */
export function contactShade(d: number): number {
  return CONTACT_MAX * (1 - smoothstep(0, CONTACT_REACH, Math.max(0, d)))
}

const rect = (x0: number, z0: number, x1: number, z1: number): Ring => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
]

/**
 * The shape triangulated on a `sx` × `sz` grid: whole cells inside it are two triangles, the cells its
 * outline crosses are clipped to it and ear-cut (holes included). Vertices are shared within the mesh,
 * so the colours it carries blend smoothly.
 */
export function gridMesh(shape: MultiPolygon, sx: number, sz = sx): FlatMesh {
  const out: FlatMesh = { points: [], indices: [] }
  if (shape.length === 0) return out
  const index = new Map<string, number>()
  const vertex = (x: number, z: number) => {
    const key = `${Math.round(x * 1000)},${Math.round(z * 1000)}`
    let i = index.get(key)
    if (i === undefined) {
      i = out.points.length / 2
      out.points.push(x, z)
      index.set(key, i)
    }
    return i
  }
  const triangle = (a: number, b: number, c: number) => {
    const p = out.points
    // Facing up (+y): (b − a) × (c − a) has a positive y.
    const up =
      ((p[2 * b + 1] as number) - (p[2 * a + 1] as number)) * ((p[2 * c] as number) - (p[2 * a] as number)) -
      ((p[2 * b] as number) - (p[2 * a] as number)) * ((p[2 * c + 1] as number) - (p[2 * a + 1] as number))
    if (up > 0) out.indices.push(a, b, c)
    else if (up < 0) out.indices.push(a, c, b)
  }
  const fill = (poly: Ring[]) => {
    const [outer, ...holes] = poly.map((ring) => ring.map(([x, z]) => new Vector2(x, z)))
    if (!outer || outer.length < 3) return
    const all = [...outer, ...holes.flat()]
    const ids = all.map((v) => vertex(v.x, v.y))
    for (const [a, b, c] of ShapeUtils.triangulateShape(outer, holes))
      triangle(ids[a as number] as number, ids[b as number] as number, ids[c as number] as number)
  }

  const [min, max] = bbox(shape.flat(2))
  const first = Math.floor(min[1] / sz)
  for (let row = first; row * sz < max[1]; row++) {
    const z0 = row * sz
    const z1 = z0 + sz
    const strip = clip(shape, rect(min[0] - 1, z0, max[0] + 1, z1), "intersection")
    if (strip.length === 0) continue
    // Columns the strip's outline passes through (edges along the strip's own sides do not count).
    const crossed = new Set<number>()
    let lo = Number.POSITIVE_INFINITY
    let hi = Number.NEGATIVE_INFINITY
    for (const ring of strip.flat()) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i] as Vec2
        const b = ring[(i + 1) % ring.length] as Vec2
        lo = Math.min(lo, a[0])
        hi = Math.max(hi, a[0])
        const onSide = (z: number) => Math.abs(a[1] - z) < 1e-6 && Math.abs(b[1] - z) < 1e-6
        if (onSide(z0) || onSide(z1)) continue
        const c0 = Math.floor(Math.min(a[0], b[0]) / sx)
        const c1 = Math.floor((Math.max(a[0], b[0]) - 1e-9) / sx)
        for (let c = c0; c <= Math.max(c0, c1); c++) crossed.add(c)
      }
    }
    for (let col = Math.floor(lo / sx); col * sx < hi; col++) {
      const x0 = col * sx
      const x1 = x0 + sx
      if (crossed.has(col)) {
        for (const poly of clip(strip, rect(x0, z0, x1, z1), "intersection")) fill(poly)
      } else if (strip.some((poly) => contains(poly, [x0 + sx / 2, z0 + sz / 2], 0))) {
        const a = vertex(x0, z0)
        const b = vertex(x1, z0)
        const c = vertex(x1, z1)
        const d = vertex(x0, z1)
        triangle(a, b, c)
        triangle(a, c, d)
      }
    }
  }
  return out
}

/**
 * Distance from a point to the nearest footprint, 0 inside one, capped at CONTACT_REACH. Footprints
 * are bucketed on a coarse grid so a point only checks the few near it.
 */
export function footprintDistance(footprints: readonly Vec2[][]): (p: Vec2) => number {
  const CELL = 8
  const buckets = new Map<string, number[]>()
  footprints.forEach((poly, i) => {
    const [min, max] = bbox(poly)
    for (
      let x = Math.floor((min[0] - CONTACT_REACH) / CELL);
      x <= Math.floor((max[0] + CONTACT_REACH) / CELL);
      x++
    )
      for (
        let z = Math.floor((min[1] - CONTACT_REACH) / CELL);
        z <= Math.floor((max[1] + CONTACT_REACH) / CELL);
        z++
      ) {
        const key = `${x},${z}`
        const list = buckets.get(key)
        if (list) list.push(i)
        else buckets.set(key, [i])
      }
  })
  return (p) => {
    const near = buckets.get(`${Math.floor(p[0] / CELL)},${Math.floor(p[1] / CELL)}`)
    let best = CONTACT_REACH
    for (const i of near ?? []) {
      const poly = footprints[i] as Vec2[]
      if (contains(poly, p, 0)) return 0
      for (let j = 0; j < poly.length; j++)
        best = Math.min(best, closest(p, poly[j] as Vec2, poly[(j + 1) % poly.length] as Vec2).d)
    }
    return best
  }
}

/** The land's coast: its edges that do not lie on its bounding box (that is the map's edge), and every hole. */
function shoreEdges(land: readonly Vec2[], holes: readonly Vec2[][]): [Vec2, Vec2][] {
  const [min, max] = bbox(land)
  const both = (a: number, b: number, v: number) => Math.abs(a - v) < 1e-6 && Math.abs(b - v) < 1e-6
  const onBox = (a: Vec2, b: Vec2) =>
    both(a[0], b[0], min[0]) ||
    both(a[0], b[0], max[0]) ||
    both(a[1], b[1], min[1]) ||
    both(a[1], b[1], max[1])
  const edges = (ring: readonly Vec2[]) =>
    ring.map((a, i): [Vec2, Vec2] => [a, ring[(i + 1) % ring.length] as Vec2])
  return [...edges(land).filter(([a, b]) => !onBox(a, b)), ...holes.flatMap(edges)]
}

const swatch = (name: string): Color => {
  const s = PALETTE.swatches.find((w) => w.name === name)
  if (!s) throw new Error(`ground: no swatch "${name}"`)
  return new Color(s.hex)
}

/** Smooth value noise in [0, 1) on a `cell`-metre lattice. */
function noise(seed: number, salt: string, cell: number): (x: number, z: number) => number {
  const cache = new Map<string, number>()
  const at = (i: number, j: number) => {
    const key = `${i},${j}`
    let v = cache.get(key)
    if (v === undefined) {
      v = roll(seed, `${key}:${salt}`)
      cache.set(key, v)
    }
    return v
  }
  return (x, z) => {
    const fx = x / cell
    const fz = z / cell
    const i = Math.floor(fx)
    const j = Math.floor(fz)
    const u = smoothstep(0, 1, fx - i)
    const v = smoothstep(0, 1, fz - j)
    const top = at(i, j) + (at(i + 1, j) - at(i, j)) * u
    const bottom = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * u
    return top + (bottom - top) * v
  }
}

type Paint = (x: number, z: number, out: Color) => Color

/** Each ground kind's colour at a point: palette ramps, gently varied. */
function painters(seed: number): Record<"grass" | OverlayKind, Paint> {
  const broad = noise(seed, "ground-broad", 23)
  const fine = noise(seed, "ground-fine", 4.5)
  const c = {
    grassDark: swatch("grass-dark"),
    grass: swatch("grass"),
    grassLight: swatch("grass-light"),
    dry: swatch("dry-grass-light"),
    cobble: swatch("cobble-light"),
    cobbleDark: swatch("cobble"),
    sand: swatch("sand"),
    sandDark: swatch("sand-dark"),
    dirt: swatch("dirt"),
    dirtLight: swatch("dirt-light"),
    dirtDark: swatch("dirt-dark"),
    leaf: swatch("leaf"),
  }
  return {
    grass: (x, z, out) =>
      out
        .copy(c.grass)
        .lerp(c.grassLight, 0.35 + 0.5 * broad(x, z))
        .lerp(c.dry, 0.12 + 0.3 * smoothstep(0.5, 0.95, fine(x, z)) * broad(z, x)),
    cobble: (x, z, out) =>
      out
        .copy(c.cobble)
        .lerp(c.sandDark, 0.45)
        .lerp(c.cobbleDark, 0.4 * fine(x, z)),
    plaza: (x, z, out) =>
      out
        .copy(c.cobble)
        .lerp(c.sand, 0.45)
        .lerp(c.cobbleDark, 0.3 * fine(x, z)),
    dirt: (x, z, out) => out.copy(c.dirt).lerp(c.dirtLight, 0.6 * fine(x, z)),
    sand: (x, z, out) => out.copy(c.sand).lerp(c.sandDark, 0.5 * fine(x, z)),
    garden: (x, z, out) =>
      out.copy(c.dirtDark).lerp(c.leaf, 0.25 + 0.5 * smoothstep(0.4, 0.8, fine(x * 3, z * 3))),
    // Fields are painted in their row frame: alternate rows of the furrow grid are ridges.
    field: (x, z, out) => out.copy(c.dirt).lerp(c.dirtLight, 0.3 * broad(x, z)),
  }
}

/** The land as a polygon with holes, outer CCW and holes CW. */
function landShape(g: GroundDraw): MultiPolygon {
  return g.land.length < 3 ? [] : [[orient(g.land, true), ...g.holes.map((h) => orient(h, false))]]
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

const turn = (p: Vec2, angle: number): Vec2 => {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return [p[0] * c - p[1] * s, p[0] * s + p[1] * c]
}

export interface GroundMesh {
  position: Float32Array
  normal: Float32Array
  color: Float32Array
  index: Uint32Array
}

/**
 * The ground's geometry, pure: the land minus the overlays as grass, each overlay (later ones on top)
 * clipped to the land, all refined on the GRID and vertex-coloured, contact-darkened round the
 * footprints and darker along the coast; then the bank skirt down every land edge.
 */
export function groundMesh(g: GroundDraw, seed = 0): GroundMesh {
  const land = landShape(g)
  const paint = painters(seed)
  const pos: number[] = []
  const nor: number[] = []
  const col: number[] = []
  const idx: number[] = []
  const nearFootprint = footprintDistance(g.footprints)
  const shore = shoreEdges(g.land, g.holes)
  const colour = new Color()
  const darkGrass = swatch("grass-dark")

  const addFlat = (mesh: FlatMesh, kind: "grass" | OverlayKind, frame?: { angle: number }) => {
    const base = pos.length / 3
    for (let i = 0; i < mesh.points.length; i += 2) {
      let p: Vec2 = [mesh.points[i] as number, mesh.points[i + 1] as number]
      if (frame) {
        // Field meshes are built in their row frame: z there runs across the rows.
        const ridge = Math.round(p[1] / FURROW) % 2 === 0
        p = turn(p, frame.angle)
        paint.field(p[0], p[1], colour)
        if (ridge) colour.lerp(darkGrass, 0.45)
      } else paint[kind](p[0], p[1], colour)
      if (kind === "grass" || kind === "sand") {
        let d = SHORE_BAND
        for (const [a, b] of shore) d = Math.min(d, closest(p, a, b).d)
        colour.lerp(darkGrass, 0.22 * (1 - d / SHORE_BAND))
      }
      colour.multiplyScalar(1 - contactShade(nearFootprint(p)))
      pos.push(p[0], 0, p[1])
      nor.push(0, 1, 0)
      col.push(colour.r, colour.g, colour.b)
    }
    // A rotation keeps every triangle's winding, so the field frame's triangles still face up.
    for (const i of mesh.indices) idx.push(base + i)
  }

  let covered: MultiPolygon = []
  const pieces: { kind: OverlayKind; shape: MultiPolygon }[] = []
  for (const overlay of [...g.overlays].reverse()) {
    const on = clip(land, [orient(overlay.poly, true)], "intersection")
    const shape = covered.length > 0 ? clip(on, covered, "difference") : on
    if (shape.length > 0) pieces.push({ kind: overlay.kind, shape })
    covered = covered.length > 0 ? clip(covered, on, "union") : on
  }
  addFlat(gridMesh(covered.length > 0 ? clip(land, covered, "difference") : land, GRID), "grass")
  for (const { kind, shape } of pieces) {
    if (kind !== "field") {
      addFlat(gridMesh(shape, GRID), kind)
      continue
    }
    const angle = rowAngle(shape[0]?.[0] ?? [])
    const local = shape.map((poly) => poly.map((ring) => ring.map((p) => turn(p, -angle))))
    addFlat(gridMesh(local, ALONG_ROWS, FURROW), kind, { angle })
  }
  skirt(land, { pos, nor, col, idx })
  return {
    position: new Float32Array(pos),
    normal: new Float32Array(nor),
    color: new Float32Array(col),
    index: new Uint32Array(idx),
  }
}

/** The bank: a vertical ribbon down every land edge, facing out of the land, earth-coloured. */
function skirt(land: MultiPolygon, m: { pos: number[]; nor: number[]; col: number[]; idx: number[] }): void {
  const top = swatch("sand-light")
  const bottom = swatch("sand-dark")
  for (const ring of land.flat()) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i] as Vec2
      const b = ring[(i + 1) % ring.length] as Vec2
      const length = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (length < 1e-6) continue
      // Outer rings are CCW and holes CW (x right, z up), so (dz, −dx) points out of the land.
      const nx = (b[1] - a[1]) / length
      const nz = -(b[0] - a[0]) / length
      const base = m.pos.length / 3
      m.pos.push(a[0], 0, a[1], b[0], 0, b[1], b[0], SKIRT_BOTTOM, b[1], a[0], SKIRT_BOTTOM, a[1])
      for (let k = 0; k < 4; k++) m.nor.push(nx, 0, nz)
      m.col.push(
        top.r,
        top.g,
        top.b,
        top.r,
        top.g,
        top.b,
        bottom.r,
        bottom.g,
        bottom.b,
        bottom.r,
        bottom.g,
        bottom.b,
      )
      // Wound so the quad faces along its normal, whichever way the ring runs.
      const facing = faceNormalSign(a, b, nx, nz)
      if (facing > 0) m.idx.push(base, base + 3, base + 2, base, base + 2, base + 1)
      else m.idx.push(base, base + 2, base + 3, base, base + 1, base + 2)
    }
  }
}

/** The sign of the triangle (a_top, a_bottom, b_bottom)'s normal along (nx, 0, nz). */
function faceNormalSign(a: Vec2, b: Vec2, nx: number, nz: number): number {
  // u = a_bottom − a_top = (0, h, 0) with h < 0; v = b_bottom − a_top = (bx − ax, h, bz − az).
  const h = SKIRT_BOTTOM
  const vx = b[0] - a[0]
  const vz = b[1] - a[1]
  // u × v = (h·vz − 0·h, 0·vx − 0·vz, 0·h − h·vx) = (h·vz, 0, −h·vx)
  return h * vz * nx - h * vx * nz
}

export interface Ground {
  mesh: Mesh
  dispose(): void
}

/**
 * The town's ground (plan §5) as one mesh in the palette material: it receives the cascaded sun
 * shadows like every library piece and casts none. One draw call.
 */
export function createGround(stage: Stage, g: GroundDraw, opts: { seed?: number } = {}): Ground {
  const start = performance.now()
  const built = groundMesh(g, opts.seed ?? 0)
  const geometry = new BufferGeometry()
  geometry.setAttribute("position", new BufferAttribute(built.position, 3))
  geometry.setAttribute("normal", new BufferAttribute(built.normal, 3))
  geometry.setAttribute("color", new BufferAttribute(built.color, 3))
  geometry.setIndex(new BufferAttribute(built.index, 1))
  geometry.computeBoundingSphere()
  const mesh = new Mesh(geometry, paletteMaterial())
  mesh.name = "ground"
  mesh.receiveShadow = true
  stage.scene.add(mesh)
  logger.info("ground", {
    vertices: built.position.length / 3,
    triangles: built.index.length / 3,
    overlays: g.overlays.length,
    ms: Math.round(performance.now() - start),
  })
  return {
    mesh,
    dispose() {
      mesh.removeFromParent()
      geometry.dispose()
    },
  }
}
