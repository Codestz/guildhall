/**
 * Simple ground meshes: a draped one-colour surface (the hex world's road strips) and V1-style hex
 * prisms (`?ground=hex`), both taking the cascaded sun like every placed piece.
 */
import { BufferAttribute, BufferGeometry, Color, Mesh, MeshStandardMaterial, SRGBColorSpace } from "three"
import { livingMaterial, patchLivingTint } from "./livingTint.ts"
import { paletteMaterial } from "./material.ts"
import type { Stage } from "./stage.ts"

export interface TerrainMesh {
  dispose(): void
}

/** A draped surface's material: one colour, pulled a hair toward the camera so it sits over the ground. */
export function surfaceMaterial(color: string, roughness = 1): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    color,
    roughness,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  })
  // a road through a place being read glows with it, through a failing one is blighted (livingTint.ts)
  material.onBeforeCompile = patchLivingTint
  livingMaterial(material, false)
  return material
}

/** A draped surface (roads, water) from triangle positions in one colour. */
export function createSurface(
  stage: Pick<Stage, "scene">,
  positions: Float32Array,
  color: string,
  roughness = 1,
): TerrainMesh {
  const geometry = new BufferGeometry()
  geometry.setAttribute("position", new BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  const material = surfaceMaterial(color, roughness)
  const mesh = new Mesh(geometry, material)
  mesh.receiveShadow = true
  stage.scene.add(mesh)
  return {
    dispose() {
      mesh.removeFromParent()
      geometry.dispose()
      material.dispose()
    },
  }
}

export interface HexPrism {
  x: number
  z: number
  top: number
  /** sRGB 0–255. */
  color: [number, number, number]
  side: [number, number, number]
}

/**
 * V1-style hex ground: one flat-shaded prism per tile (a hexagon on top, six sides down to `base`), all
 * in one mesh in the palette material, so it takes the cascaded sun like every placed piece. The top is
 * inset by a hair at its rim and the rim drops a little, the low-poly bevel that catches the light.
 */
export function createHexGround(
  stage: Pick<Stage, "scene">,
  g: { size: number; base: number; tiles: readonly HexPrism[] },
): TerrainMesh {
  const { size, base, tiles } = g
  const corners: [number, number][] = []
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 180) * (60 * k - 30)
    corners.push([Math.cos(a), Math.sin(a)])
  }
  // per tile: top 6 tris (fan) + rim bevel 12 tris + sides 12 tris = 30 tris
  const pos = new Float32Array(tiles.length * 30 * 9)
  const col = new Float32Array(tiles.length * 30 * 9)
  const c = new Color()
  let o = 0
  const put = (x: number, y: number, z: number, rgb: [number, number, number], k: number) => {
    c.setRGB((rgb[0] * k) / 255, (rgb[1] * k) / 255, (rgb[2] * k) / 255, SRGBColorSpace)
    pos[o] = x
    pos[o + 1] = y
    pos[o + 2] = z
    col[o] = c.r
    col[o + 1] = c.g
    col[o + 2] = c.b
    o += 3
  }
  const inner = 0.86
  const drop = 0.18
  for (const t of tiles) {
    const s = size * 0.995
    const P = corners.map(([cx, cz]) => [t.x + cx * s, t.z + cz * s] as const)
    const I = corners.map(([cx, cz]) => [t.x + cx * s * inner, t.z + cz * s * inner] as const)
    for (let k = 0; k < 6; k++) {
      const a = I[k]!
      const b = I[(k + 1) % 6]!
      // top (counter-clockwise seen from above: centre, b, a)
      put(t.x, t.top, t.z, t.color, 1)
      put(b[0], t.top, b[1], t.color, 1)
      put(a[0], t.top, a[1], t.color, 1)
      // bevel: inner edge at the top, outer edge a little lower
      const pa = P[k]!
      const pb = P[(k + 1) % 6]!
      put(a[0], t.top, a[1], t.color, 0.94)
      put(b[0], t.top, b[1], t.color, 0.94)
      put(pb[0], t.top - drop, pb[1], t.color, 0.94)
      put(a[0], t.top, a[1], t.color, 0.94)
      put(pb[0], t.top - drop, pb[1], t.color, 0.94)
      put(pa[0], t.top - drop, pa[1], t.color, 0.94)
      // side down to the base
      put(pa[0], t.top - drop, pa[1], t.side, 1)
      put(pb[0], t.top - drop, pb[1], t.side, 1)
      put(pb[0], base, pb[1], t.side, 0.55)
      put(pa[0], t.top - drop, pa[1], t.side, 1)
      put(pb[0], base, pb[1], t.side, 0.55)
      put(pa[0], base, pa[1], t.side, 0.55)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute("position", new BufferAttribute(pos.subarray(0, o), 3))
  geometry.setAttribute("color", new BufferAttribute(col.subarray(0, o), 3))
  geometry.computeVertexNormals()
  const mesh = new Mesh(geometry, paletteMaterial())
  mesh.receiveShadow = true
  mesh.castShadow = true
  stage.scene.add(mesh)
  return {
    dispose() {
      mesh.removeFromParent()
      geometry.dispose()
    },
  }
}
