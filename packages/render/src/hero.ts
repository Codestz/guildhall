import {
  BoxGeometry,
  BufferAttribute,
  type BufferGeometry,
  CapsuleGeometry,
  Color,
  Group,
  Mesh,
  type Object3D,
  SphereGeometry,
} from "three"
import { paletteMaterial } from "./material.ts"

/** Paints every vertex one colour, so the geometry draws with the shared vertex-colour material. */
function paint<G extends BufferGeometry>(geometry: G, colour: string): G {
  const c = new Color(colour)
  const n = geometry.getAttribute("position").count
  const rgb = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) rgb.set([c.r, c.g, c.b], i * 3)
  geometry.setAttribute("color", new BufferAttribute(rgb, 3))
  return geometry
}

/**
 * A placeholder hero `heightM` tall, feet on the ground at the origin: a capsule body and a head,
 * low-poly so it reads as a silhouette. Stands in until the catalog has a real KayKit hero.
 */
export function heroSilhouette(heightM = 2.2, colour = "#5b5f6b"): Object3D {
  const head = heightM * 0.13
  const radius = heightM * 0.16
  const bodyH = heightM - head * 2 - heightM * 0.02
  const body = new Mesh(
    paint(new CapsuleGeometry(radius, bodyH - radius * 2, 4, 10), colour),
    paletteMaterial(),
  )
  body.position.y = bodyH / 2
  const skull = new Mesh(paint(new SphereGeometry(head, 12, 8), colour), paletteMaterial())
  skull.position.y = heightM - head
  const hero = new Group()
  hero.name = "hero-silhouette"
  hero.add(body, skull)
  return hero
}

/** A `sizeM` cube resting on the ground at the origin, in one vertex colour on the palette material. */
export function testBox(sizeM: number, colour: string): Object3D {
  const box = new Mesh(paint(new BoxGeometry(sizeM, sizeM, sizeM), colour), paletteMaterial())
  box.position.y = sizeM / 2
  box.name = `box-${sizeM}m`
  return box
}

/** Frees the geometries under `root` and detaches it. The shared palette material is left alone. */
export function disposeObject(root: Object3D): void {
  root.traverse((node) => {
    if (node instanceof Mesh) node.geometry.dispose()
  })
  root.removeFromParent()
}
