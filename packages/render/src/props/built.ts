/**
 * Props built in code where no CC0 pack has one in the KayKit style (decisions.md "Game feel plan", style
 * rule): a wicker basket, a mine cart, a fishing float, a notice board, a spyglass, a pair of bellows and a
 * training dummy. Each is a few chunky low-poly primitives (6–8 sides, flat-shaded), every face one
 * palette swatch (`_swatch` set, so a re-tint maps them like any library piece), toy proportions.
 *
 * They load like library pieces: `loadPiece(url("built/<name>.glb"))` (pieces.ts) makes one instead of
 * fetching it, so the crowd, a hero's mounts and the stock batch take them as they take a GLB. Each sits
 * on its base at the origin (a float: its waterline), +z its front.
 */
import { PALETTE } from "@guildhall/assets"
import {
  BoxGeometry,
  BufferAttribute,
  type BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  Group,
  IcosahedronGeometry,
  Matrix4,
  Mesh,
  type Object3D,
  Quaternion,
  Vector3,
} from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import { CART_BED } from "./stockLayout.ts"

/** The pieces this module builds, by name: `built/<name>`. */
export const BUILT = ["basket", "cart", "float", "board", "spyglass", "bellows", "dummy"] as const
export type BuiltName = (typeof BUILT)[number]

/** A built piece's catalog id. */
export const builtId = (name: BuiltName): string => `built/${name}`

/** Each built piece's size (w, h, d metres), as the catalog would give it. */
export const BUILT_SIZE: Readonly<Record<BuiltName, readonly [number, number, number]>> = {
  basket: [0.56, 0.32, 0.56],
  cart: [0.8, 0.64, 0.9],
  float: [0.14, 0.18, 0.14],
  board: [1.44, 2.05, 0.5],
  spyglass: [0.1, 0.1, 0.5],
  bellows: [0.36, 0.16, 0.74],
  dummy: [0.96, 1.72, 0.56],
}

/** The library path a built piece "loads" from (pieces.ts recognises it). */
export const builtPath = (name: BuiltName): string => `built/${name}.glb`

// (`.glb.gz` as the showcase names every library GLB it ships gzipped: gltf.ts)
const BUILT_URL = /(?:^|\/)built\/([a-z]+)\.glb(?:\.gz)?$/

/** The built piece a url names, or null for a library file. */
export function builtOf(url: string): BuiltName | null {
  const m = BUILT_URL.exec(url)
  const name = m?.[1]
  return name && (BUILT as readonly string[]).includes(name) ? (name as BuiltName) : null
}

// ---- the palette ----

/** Swatch ids by name (palette.json: an ABI, never reordered). */
const SW = Object.fromEntries(PALETTE.swatches.map((s) => [s.name, s.id])) as Record<string, number>

const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

/** A swatch's colour as the pieces carry it (linear, glTF COLOR_0). */
export function swatchLinear(id: number): [number, number, number] {
  const s = PALETTE.swatches[id]
  if (!s) throw new Error(`built: no swatch ${id}`)
  return [linear(s.srgb[0]), linear(s.srgb[1]), linear(s.srgb[2])]
}

// ---- the primitives ----

interface Part {
  geometry: BufferGeometry
  swatch: string
  at?: readonly [number, number, number]
  /** Euler XYZ, radians. */
  turn?: readonly [number, number, number]
  scale?: readonly [number, number, number]
}

const m4 = new Matrix4()
const q = new Quaternion()

/** One part: flat-shaded (unindexed, a normal per face), coloured one swatch, placed. */
function shaped(p: Part): BufferGeometry {
  const g = p.geometry.index ? p.geometry.toNonIndexed() : p.geometry
  if (g !== p.geometry) p.geometry.dispose()
  for (const name of Object.keys(g.attributes)) if (name !== "position") g.deleteAttribute(name)
  q.setFromEuler(new Euler(...(p.turn ?? [0, 0, 0])))
  m4.compose(new Vector3(...(p.at ?? [0, 0, 0])), q, new Vector3(...(p.scale ?? [1, 1, 1])))
  g.applyMatrix4(m4)
  g.computeVertexNormals()
  const n = g.getAttribute("position").count
  const id = SW[p.swatch]
  if (id === undefined) throw new Error(`built: no swatch "${p.swatch}"`)
  const [r, gg, b] = swatchLinear(id)
  const color = new Float32Array(n * 3)
  for (let v = 0; v < n; v++) color.set([r, gg, b], v * 3)
  g.setAttribute("color", new BufferAttribute(color, 3))
  g.setAttribute("_swatch", new BufferAttribute(new Uint8Array(n).fill(id), 1))
  return g
}

const box = (w: number, h: number, d: number) => new BoxGeometry(w, h, d)
const cyl = (top: number, bottom: number, h: number, sides = 8) =>
  new CylinderGeometry(top, bottom, h, sides, 1, false)
const cone = (r: number, h: number, sides = 8) => new ConeGeometry(r, h, sides, 1, false)
const ball = (r: number) => new IcosahedronGeometry(r, 0)

// ---- the pieces ----

/**
 * A round wicker basket, open at the top: a dark inside under a rim of dark timber (so it reads on a
 * dock's planks or stone), a light woven band round the middle and a dark one low down.
 */
function basket(): Part[] {
  return [
    { geometry: cyl(0.26, 0.2, 0.28), swatch: "thatch", at: [0, 0.14, 0] },
    { geometry: cyl(0.235, 0.235, 0.02), swatch: "dirt-dark", at: [0, 0.275, 0] },
    { geometry: cyl(0.28, 0.28, 0.045), swatch: "timber-dark", at: [0, 0.285, 0] },
    { geometry: cyl(0.25, 0.25, 0.035), swatch: "thatch-light", at: [0, 0.17, 0] },
    { geometry: cyl(0.215, 0.215, 0.035), swatch: "thatch-dark", at: [0, 0.05, 0] },
    // two little grips on the rim, left and right
    { geometry: box(0.05, 0.06, 0.1), swatch: "timber", at: [0.27, 0.3, 0] },
    { geometry: box(0.05, 0.06, 0.1), swatch: "timber", at: [-0.27, 0.3, 0] },
  ]
}

/** The mine cart's tub (outer, metres): narrower than the wheels' track, so they show beside it. */
const TUB = { w: 0.5, d: 0.84, y0: 0.22, y1: 0.58, wall: 0.05 }

/**
 * A mine cart that reads as one from above: an open timber tub (four walls round a dark bed the ore lies
 * on), a light rim bound in iron at the corners, on a chassis whose four iron wheels stand outside the
 * tub, a rail's gauge apart.
 */
function cart(): Part[] {
  const { w, d, y0, y1, wall } = TUB
  const h = y1 - y0
  const wheels: Part[] = [-1, 1].flatMap((sx) =>
    [-1, 1].map(
      (sz): Part => ({
        geometry: cyl(0.14, 0.14, 0.08, 8),
        swatch: "grey-dark",
        at: [sx * 0.36, 0.14, sz * 0.27],
        turn: [0, 0, Math.PI / 2],
      }),
    ),
  )
  const hubs: Part[] = [-1, 1].flatMap((sx) =>
    [-1, 1].map(
      (sz): Part => ({
        geometry: cyl(0.045, 0.045, 0.1, 6),
        swatch: "iron",
        at: [sx * 0.37, 0.14, sz * 0.27],
        turn: [0, 0, Math.PI / 2],
      }),
    ),
  )
  const corners: Part[] = [-1, 1].flatMap((sx) =>
    [-1, 1].map(
      (sz): Part => ({
        geometry: box(0.08, h + 0.02, 0.08),
        swatch: "iron",
        at: [sx * (w / 2 - 0.02), y0 + h / 2, sz * (d / 2 - 0.02)],
      }),
    ),
  )
  return [
    ...wheels,
    ...hubs,
    // axles and the chassis the tub sits on
    { geometry: box(0.74, 0.05, 0.05), swatch: "iron", at: [0, 0.14, 0.27] },
    { geometry: box(0.74, 0.05, 0.05), swatch: "iron", at: [0, 0.14, -0.27] },
    { geometry: box(w - 0.04, 0.06, d - 0.04), swatch: "iron", at: [0, y0 - 0.02, 0] },
    // the tub: a floor, the dark bed the ore lies on, four walls
    { geometry: box(w, 0.04, d), swatch: "timber-dark", at: [0, y0 + 0.02, 0] },
    // (CART_BED, stockLayout.ts: what the ore lies on)
    {
      geometry: box(w - 2 * wall, CART_BED - y0, d - 2 * wall),
      swatch: "dirt-dark",
      at: [0, (CART_BED + y0) / 2, 0],
    },
    { geometry: box(w, h, wall), swatch: "timber", at: [0, y0 + h / 2, d / 2 - wall / 2] },
    { geometry: box(w, h, wall), swatch: "timber", at: [0, y0 + h / 2, -d / 2 + wall / 2] },
    { geometry: box(wall, h, d - 2 * wall), swatch: "timber", at: [w / 2 - wall / 2, y0 + h / 2, 0] },
    { geometry: box(wall, h, d - 2 * wall), swatch: "timber", at: [-w / 2 + wall / 2, y0 + h / 2, 0] },
    // a light rim round the top, wider than the walls, and the iron band at mid height
    { geometry: box(w + 0.06, 0.04, 0.07), swatch: "timber-light", at: [0, y1 + 0.02, d / 2 - 0.015] },
    { geometry: box(w + 0.06, 0.04, 0.07), swatch: "timber-light", at: [0, y1 + 0.02, -d / 2 + 0.015] },
    { geometry: box(0.07, 0.04, d - 0.03), swatch: "timber-light", at: [w / 2 - 0.015, y1 + 0.02, 0] },
    { geometry: box(0.07, 0.04, d - 0.03), swatch: "timber-light", at: [-w / 2 + 0.015, y1 + 0.02, 0] },
    { geometry: box(w + 0.02, 0.04, d + 0.02), swatch: "iron", at: [0, y0 + h * 0.4, 0] },
    ...corners,
  ]
}

/** A fishing float: red over white, a little stick on top; its waterline at the origin. */
function float(): Part[] {
  return [
    { geometry: cone(0.06, 0.07, 6), swatch: "banner-red", at: [0, 0.035, 0] },
    { geometry: cone(0.06, 0.06, 6), swatch: "snow-light", at: [0, -0.03, 0], turn: [Math.PI, 0, 0] },
    { geometry: cyl(0.012, 0.012, 0.08, 4), swatch: "banner-red", at: [0, 0.1, 0] },
  ]
}

/** A notice board: two posts, a board with notes pinned on it, a little roof. */
function board(): Part[] {
  const notes: Part[] = [
    [-0.36, 1.3, "snow"],
    [0.05, 1.42, "sand-light"],
    [0.4, 1.24, "snow-light"],
    [-0.12, 1.06, "sand-light"],
    [0.32, 0.98, "snow"],
  ].map(([x, y, s]) => ({
    geometry: box(0.26, 0.3, 0.02),
    swatch: s as string,
    at: [x as number, y as number, 0.06] as const,
    turn: [0, 0, ((x as number) * 0.4) as number] as const,
  }))
  return [
    { geometry: box(0.12, 1.8, 0.12), swatch: "timber-dark", at: [-0.62, 0.9, 0] },
    { geometry: box(0.12, 1.8, 0.12), swatch: "timber-dark", at: [0.62, 0.9, 0] },
    { geometry: box(1.36, 0.86, 0.08), swatch: "timber-light", at: [0, 1.2, 0] },
    { geometry: box(1.44, 0.08, 0.12), swatch: "timber", at: [0, 0.75, 0.01] },
    { geometry: box(1.44, 0.08, 0.12), swatch: "timber", at: [0, 1.65, 0.01] },
    ...notes,
    { geometry: box(1.6, 0.06, 0.32), swatch: "roof-blue", at: [0, 1.85, 0.1], turn: [0.45, 0, 0] },
    { geometry: box(1.6, 0.06, 0.32), swatch: "roof-blue-dark", at: [0, 1.85, -0.1], turn: [-0.45, 0, 0] },
  ]
}

/** A spyglass along +z: brass tubes stepping down to the eyepiece at the origin. */
function spyglass(): Part[] {
  const along: readonly [number, number, number] = [Math.PI / 2, 0, 0]
  return [
    { geometry: cyl(0.03, 0.03, 0.14, 6), swatch: "gold", at: [0, 0, 0.07], turn: along },
    { geometry: cyl(0.038, 0.038, 0.16, 6), swatch: "timber-dark", at: [0, 0, 0.21], turn: along },
    { geometry: cyl(0.048, 0.048, 0.18, 6), swatch: "gold", at: [0, 0, 0.37], turn: along },
    { geometry: cyl(0.052, 0.052, 0.03, 6), swatch: "iron", at: [0, 0, 0.47], turn: along },
  ]
}

/** A forge's bellows lying flat, nozzle to +z: two boards and the leather between, handles behind. */
function bellows(): Part[] {
  return [
    { geometry: box(0.34, 0.035, 0.5), swatch: "timber", at: [0, 0.02, 0] },
    { geometry: box(0.34, 0.035, 0.5), swatch: "timber", at: [0, 0.13, -0.01], turn: [-0.18, 0, 0] },
    {
      geometry: cyl(0.16, 0.06, 0.48, 6),
      swatch: "dirt-dark",
      at: [0, 0.075, 0],
      turn: [Math.PI / 2, 0, 0],
      scale: [1, 1, 0.35],
    },
    { geometry: cone(0.04, 0.2, 6), swatch: "iron", at: [0, 0.07, 0.34], turn: [Math.PI / 2, 0, 0] },
    { geometry: box(0.06, 0.03, 0.14), swatch: "timber-dark", at: [0, 0.02, -0.31] },
    { geometry: box(0.06, 0.03, 0.14), swatch: "timber-dark", at: [0, 0.16, -0.31], turn: [-0.18, 0, 0] },
  ]
}

/** A training dummy: a post on a cross foot, a straw body bound in rope, a sack head, a crossbar for arms. */
function dummy(): Part[] {
  return [
    { geometry: box(0.56, 0.08, 0.1), swatch: "timber-dark", at: [0, 0.04, 0] },
    { geometry: box(0.1, 0.08, 0.56), swatch: "timber-dark", at: [0, 0.04, 0] },
    { geometry: cyl(0.06, 0.07, 1.3, 6), swatch: "timber", at: [0, 0.7, 0] },
    { geometry: cyl(0.22, 0.26, 0.62, 7), swatch: "thatch", at: [0, 1.06, 0] },
    { geometry: cyl(0.235, 0.235, 0.05, 7), swatch: "thatch-dark", at: [0, 1.22, 0] },
    { geometry: cyl(0.26, 0.26, 0.05, 7), swatch: "thatch-dark", at: [0, 0.92, 0] },
    { geometry: box(0.96, 0.09, 0.09), swatch: "timber", at: [0, 1.24, 0] },
    { geometry: ball(0.17), swatch: "sand", at: [0, 1.53, 0] },
    { geometry: cyl(0.05, 0.05, 0.08, 6), swatch: "thatch-dark", at: [0, 1.39, 0] },
    // a target painted on the chest
    {
      geometry: cyl(0.1, 0.1, 0.02, 8),
      swatch: "banner-red",
      at: [0, 1.08, 0.245],
      turn: [Math.PI / 2, 0, 0],
    },
    {
      geometry: cyl(0.045, 0.045, 0.025, 8),
      swatch: "snow-light",
      at: [0, 1.08, 0.255],
      turn: [Math.PI / 2, 0, 0],
    },
  ]
}

const MAKERS: Record<BuiltName, () => Part[]> = { basket, cart, float, board, spyglass, bellows, dummy }

/** A built piece's geometry: its parts merged, flat-shaded, with `color` and `_swatch` per vertex. */
export function builtGeometry(name: BuiltName): BufferGeometry {
  const parts = MAKERS[name]().map(shaped)
  const merged = mergeGeometries(parts, false)
  for (const p of parts) p.dispose()
  if (!merged) throw new Error(`built: ${name} did not merge`)
  merged.computeBoundingBox()
  merged.computeBoundingSphere()
  return merged
}

/** A built piece as a scene graph (one mesh; the caller's `preparePiece` gives it the palette material). */
export function builtPiece(name: BuiltName): Object3D {
  const root = new Group()
  root.name = builtId(name)
  const mesh = new Mesh(builtGeometry(name))
  mesh.name = name
  root.add(mesh)
  return root
}
