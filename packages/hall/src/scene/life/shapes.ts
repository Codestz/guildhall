import {
  BoxGeometry,
  type BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  IcosahedronGeometry,
  OctahedronGeometry,
  TorusGeometry,
  Vector3,
} from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"

/**
 * The Life layer's little things, as geometry: the logs, stones, fish, books and arrows the trace
 * piles stack (Piles.tsx), and the same things in a worker's hands while they work, with the tools
 * the kit lacks (a fishing rod, a bow). Every shape carries position + normal + vertex colour, so
 * any of them can share one batch or one material.
 */

const BARK = new Color("#7b5536")
const CUT = new Color("#d8b07a")
const STONE = new Color("#9a9b98")
const FISH_BACK = new Color("#5f7f96")
const FISH_BELLY = new Color("#c9d6dc")
const SHAFT = new Color("#a98256")
const FLETCH = new Color("#f1ece0")
const TIP = new Color("#4a4d52")
const PAGES = new Color("#d9cfb4")
const PLANK = new Color("#c99a62")
const PLANK_END = new Color("#e2c08c")
const STRING = new Color("#e8e0cc")
const CORD = new Color("#d9d4c4")
export const COVERS = ["#8e3b33", "#2f5a8a", "#3f6e45", "#6d4a8a", "#8a6a2f"].map((c) => new Color(c))

// ---- Shapes: low-poly, flat-shaded, coloured per vertex (KayKit's look, no texture) ----------------

/** Non-indexed, position + normal + color: every shape in the batch carries the same attributes. */
export function paint(
  source: BufferGeometry,
  colour: (normal: Vector3, position: Vector3) => Color,
): BufferGeometry {
  const geometry = (source.index ? source.toNonIndexed() : source).clone()
  geometry.deleteAttribute("uv")
  geometry.computeVertexNormals()
  const positions = geometry.getAttribute("position")
  const normals = geometry.getAttribute("normal")
  const colors = new Float32Array(positions.count * 3)
  const n = new Vector3()
  const p = new Vector3()
  for (let i = 0; i < positions.count; i++) {
    n.fromBufferAttribute(normals, i)
    p.fromBufferAttribute(positions, i)
    const c = colour(n, p)
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3))
  return geometry
}

export function merge(parts: BufferGeometry[]): BufferGeometry {
  return mergeGeometries(parts) ?? parts[0] ?? new BoxGeometry()
}

/** A log lying along x: bark round the sides, pale cut ends. */
export function logGeometry(): BufferGeometry {
  const log = new CylinderGeometry(0.3, 0.3, 2.3, 7, 1)
  // Colour by the cylinder's own normals (ends face ±y) before laying it down.
  const painted = paint(log, (normal) => (Math.abs(normal.y) > 0.9 ? CUT : BARK))
  painted.rotateZ(Math.PI / 2)
  painted.rotateY(Math.PI / 2)
  return painted
}

/** A fish lying on its side along x: dark back, pale belly, a tail fin. */
export function fishGeometry(): BufferGeometry {
  const body = paint(new OctahedronGeometry(0.5, 0).scale(0.75, 0.12, 0.26), (_, p) =>
    p.z > 0.01 ? FISH_BACK : FISH_BELLY,
  )
  const tail = paint(
    new ConeGeometry(0.16, 0.28, 3)
      .rotateZ(Math.PI / 2)
      .scale(1, 0.4, 1)
      .translate(0.48, 0, 0),
    () => FISH_BACK,
  )
  return merge([body, tail])
}

/** An arrow along +z, its tip at the origin: dark tip, wooden shaft, pale fletching. */
export function arrowGeometry(): BufferGeometry {
  const shaft = paint(
    new CylinderGeometry(0.035, 0.035, 1.25, 5).rotateX(Math.PI / 2).translate(0, 0, 0.7),
    () => SHAFT,
  )
  const tip = paint(new ConeGeometry(0.07, 0.2, 5).rotateX(-Math.PI / 2).translate(0, 0, 0.05), () => TIP)
  const vane = (turn: number) =>
    paint(new BoxGeometry(0.22, 0.012, 0.3).rotateZ(turn).translate(0, 0, 1.18), () => FLETCH)
  return merge([shaft, tip, vane(0), vane(Math.PI / 2)])
}

/** A closed book lying flat: coloured cover, cream page edges on three sides. */
export function bookGeometry(cover: Color): BufferGeometry {
  return paint(new BoxGeometry(0.72, 0.15, 0.52), (normal) =>
    normal.x > 0.9 || Math.abs(normal.z) > 0.9 ? PAGES : cover,
  )
}

/** A broken stone, its faces flat. */
export function stoneGeometry(): BufferGeometry {
  return paint(new IcosahedronGeometry(0.42, 0), () => STONE)
}

/** A sawn plank lying along x. */
export function plankGeometry(): BufferGeometry {
  return paint(new BoxGeometry(1.9, 0.09, 0.36), (normal) => (Math.abs(normal.x) > 0.9 ? PLANK_END : PLANK))
}

/** A loose sheet: a blueprint, a page, a note to pin. */
export function noteGeometry(): BufferGeometry {
  return paint(new BoxGeometry(0.42, 0.015, 0.55), () => PAGES)
}

/** A fishing rod along +y from the grip at the origin, its line hanging from the tip. */
export function rodGeometry(): BufferGeometry {
  const rod = paint(new CylinderGeometry(0.018, 0.035, 2.4, 5).translate(0, 1.1, 0), () => SHAFT)
  const line = paint(
    new CylinderGeometry(0.006, 0.006, 1.1, 3).translate(0, 1.75, 0).rotateZ(0.25),
    () => CORD,
  )
  return merge([rod, line])
}

/**
 * A short bow standing along y, its grip at the origin: the limbs curve back towards −x, where the
 * string runs between their tips. Turned into the hand by whoever holds it.
 */
export function bowGeometry(): BufferGeometry {
  const sweep = Math.PI * 0.9
  const limbs = paint(
    new TorusGeometry(0.62, 0.03, 4, 14, sweep).rotateZ(-sweep / 2).translate(-0.62, 0, 0),
    () => SHAFT,
  )
  const tip = 0.62 * Math.cos(sweep / 2) - 0.62
  const height = 2 * 0.62 * Math.sin(sweep / 2)
  const string = paint(new CylinderGeometry(0.006, 0.006, height, 3).translate(tip, 0, 0), () => STRING)
  return merge([limbs, string])
}
