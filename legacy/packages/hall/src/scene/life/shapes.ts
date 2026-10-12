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

/**
 * The same book open, as it is read: two halves either side of the spine (along z at the origin),
 * pages up, rising a little from the spine into a shallow V. Same footprint as the closed one.
 */
export function openBookGeometry(cover: Color): BufferGeometry {
  const half = (side: 1 | -1) => {
    const board = paint(new BoxGeometry(0.37, 0.03, 0.54).translate(0, -0.03, 0), () => cover)
    const leaves = paint(new BoxGeometry(0.34, 0.05, 0.5).translate(0, 0.01, 0), (normal) =>
      normal.y > 0.9 ? PAGES : PAGES.clone().multiplyScalar(0.85),
    )
    return merge([board, leaves])
      .translate(side * 0.185, 0, 0)
      .rotateZ(side * 0.2)
  }
  return merge([half(-1), half(1)])
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

// ---- The townsfolk's things (scene/life/rounds.ts): what farmers, merchants and guards carry ------

const WICKER = new Color("#a67c45")
const LEAVES = new Color("#5f9a3c")
const CARROT = new Color("#d9772b")
const IRON = new Color("#6f7378")
const BRISTLE = new Color("#c9a85a")

/** A basket of greens and carrots, carried in both arms. */
export function produceGeometry(): BufferGeometry {
  const basket = paint(new CylinderGeometry(0.42, 0.32, 0.36, 7, 1), () => WICKER)
  const greens = paint(new IcosahedronGeometry(0.2, 0).translate(-0.12, 0.22, 0.04), () => LEAVES)
  const more = paint(new IcosahedronGeometry(0.17, 0).translate(0.16, 0.2, -0.08), () => LEAVES)
  const carrot = paint(
    new ConeGeometry(0.06, 0.4, 5).rotateZ(Math.PI / 2.4).translate(0.08, 0.26, 0.16),
    () => CARROT,
  )
  return merge([basket, greens, more, carrot])
}

/** A small wooden crate, carried in both arms. */
export function crateGeometry(): BufferGeometry {
  return paint(new BoxGeometry(0.62, 0.48, 0.5), (normal) => (Math.abs(normal.y) > 0.9 ? PLANK_END : PLANK))
}

/** A hoe along +y from the grip at the origin, its iron blade at the top. */
export function hoeGeometry(): BufferGeometry {
  const shaft = paint(new CylinderGeometry(0.03, 0.035, 1.7, 5).translate(0, 0.55, 0), () => SHAFT)
  const blade = paint(new BoxGeometry(0.32, 0.05, 0.2).translate(0, 1.38, 0.1), () => IRON)
  return merge([shaft, blade])
}

/** A wooden bucket hanging from the hand, its handle at the origin. */
export function bucketGeometry(): BufferGeometry {
  const pail = paint(new CylinderGeometry(0.22, 0.17, 0.32, 8, 1).translate(0, -0.3, 0), (normal) =>
    normal.y > 0.9 ? FISH_BACK : PLANK,
  )
  const handle = paint(new TorusGeometry(0.2, 0.012, 3, 8, Math.PI).translate(0, -0.16, 0), () => IRON)
  return merge([pail, handle])
}

/** A guard's spear along +y from the grip at the origin. */
export function spearGeometry(): BufferGeometry {
  const shaft = paint(new CylinderGeometry(0.025, 0.03, 2.3, 5).translate(0, 0.65, 0), () => SHAFT)
  const tip = paint(new ConeGeometry(0.06, 0.3, 4).translate(0, 1.95, 0), () => IRON)
  return merge([shaft, tip])
}

/** A broom along +y from the grip at the origin, its bristles at the bottom. */
export function broomGeometry(): BufferGeometry {
  const shaft = paint(new CylinderGeometry(0.025, 0.03, 1.5, 5).translate(0, 0.1, 0), () => SHAFT)
  const bristles = paint(new ConeGeometry(0.18, 0.42, 6).translate(0, -0.78, 0), () => BRISTLE)
  return merge([shaft, bristles])
}
