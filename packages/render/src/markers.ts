/**
 * Editor markers laid flat on the ground (the tile composer's spots and blockers), drawn over everything
 * so they read through foliage and roofs, unlit, so they stay the same colour at any hour. Apps never
 * import three: these are the only shapes the composer needs.
 */
import {
  CircleGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  RingGeometry,
  Shape,
  ShapeGeometry,
} from "three"

const flat = (geometry: CircleGeometry | RingGeometry | ShapeGeometry, colour: string, opacity: number) => {
  const mesh = new Mesh(
    geometry,
    new MeshBasicMaterial({
      color: colour,
      transparent: true,
      opacity,
      depthTest: false,
      depthWrite: false,
      side: DoubleSide,
    }),
  )
  mesh.rotation.x = -Math.PI / 2
  mesh.renderOrder = 10
  return mesh
}

/**
 * A spot: a ring with an arrow out of it toward local +z (where the person faces), `r` metres across
 * the ring; brighter and thicker when `on`. Place and turn the group like a person.
 */
export function spotMarker(colour: string, on = false, r = 0.26): Object3D {
  const g = new Group()
  g.name = "spot-marker"
  g.add(flat(new RingGeometry(r * (on ? 0.62 : 0.72), r, 28), colour, on ? 1 : 0.92))
  g.add(flat(new CircleGeometry(r * 0.62, 24), colour, on ? 0.42 : 0.24))
  const arrow = new Shape()
  arrow.moveTo(-r * 0.42, r * 0.95)
  arrow.lineTo(r * 0.42, r * 0.95)
  arrow.lineTo(0, r * 1.9)
  arrow.closePath()
  // the shape lies in x/y; laid flat its +y runs to -z, so turn it round to point along +z
  const tip = flat(new ShapeGeometry(arrow), colour, on ? 1 : 0.92)
  tip.rotation.z = Math.PI
  g.add(tip)
  for (const child of g.children) child.position.y = 0.04
  return g
}

/** A blocker: a disc `r` metres in radius, a faint fill inside a solid rim. */
export function discMarker(r: number, colour: string, on = false): Object3D {
  const g = new Group()
  g.name = "disc-marker"
  g.add(flat(new CircleGeometry(r, 36), colour, on ? 0.34 : 0.18))
  g.add(flat(new RingGeometry(Math.max(0.01, r - (on ? 0.07 : 0.045)), r, 48), colour, on ? 1 : 0.85))
  for (const child of g.children) child.position.y = 0.03
  return g
}

/**
 * A blocker's shape: a convex outline on the ground (corners x, z after one another, in the group's own
 * frame: a box's four, a circle's ring), a faint fill inside a solid rim; brighter when `on`.
 */
export function outlineMarker(pts: readonly number[], colour: string, on = false): Object3D {
  const g = new Group()
  g.name = "outline-marker"
  const n = pts.length / 2
  if (n < 3) return g
  let cx = 0
  let cz = 0
  for (let k = 0; k < n; k++) {
    cx += pts[k * 2]! / n
    cz += pts[k * 2 + 1]! / n
  }
  // the rim: the outline less the same drawn in toward its middle (a convex outline stays one)
  let reach = Number.POSITIVE_INFINITY
  for (let k = 0; k < n; k++) {
    const ax = pts[k * 2]!
    const az = pts[k * 2 + 1]!
    const bx = pts[((k + 1) % n) * 2]!
    const bz = pts[((k + 1) % n) * 2 + 1]!
    const l = Math.hypot(bx - ax, bz - az) || 1
    // the middle's distance from this edge's line
    reach = Math.min(reach, Math.abs((cx - ax) * (bz - az) - (cz - az) * (bx - ax)) / l)
  }
  const width = Math.min(on ? 0.07 : 0.045, reach * 0.5)
  const k0 = reach > 0 ? 1 - width / reach : 0
  // laid flat, the shape's +y runs to −z: (x, z) is drawn at (x, −z)
  const outer = new Shape()
  const inner = new Shape()
  const fill = new Shape()
  for (let k = 0; k < n; k++) {
    const x = pts[k * 2]!
    const z = pts[k * 2 + 1]!
    const ix = cx + (x - cx) * k0
    const iz = cz + (z - cz) * k0
    if (k === 0) {
      outer.moveTo(x, -z)
      inner.moveTo(ix, -iz)
      fill.moveTo(x, -z)
    } else {
      outer.lineTo(x, -z)
      inner.lineTo(ix, -iz)
      fill.lineTo(x, -z)
    }
  }
  outer.holes.push(inner)
  g.add(flat(new ShapeGeometry(fill), colour, on ? 0.34 : 0.18))
  g.add(flat(new ShapeGeometry(outer), colour, on ? 1 : 0.85))
  for (const child of g.children) child.position.y = 0.03
  return g
}

/** A hex outline (pointy-top, `size` centre to corner) as a thin flat ring, e.g. a claimed footprint tile. */
export function hexOutline(size: number, colour: string, width = 0.06): Object3D {
  const outer = new Shape()
  const inner = new Shape()
  for (let k = 0; k <= 6; k++) {
    const a = (Math.PI / 180) * (60 * k - 30)
    const [ox, oy] = [Math.cos(a) * size, Math.sin(a) * size]
    const [ix, iy] = [Math.cos(a) * (size - width), Math.sin(a) * (size - width)]
    if (k === 0) {
      outer.moveTo(ox, oy)
      inner.moveTo(ix, iy)
    } else {
      outer.lineTo(ox, oy)
      inner.lineTo(ix, iy)
    }
  }
  outer.holes.push(inner)
  const mesh = flat(new ShapeGeometry(outer), colour, 0.9)
  mesh.position.y = 0.03
  return mesh
}
