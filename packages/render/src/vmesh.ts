/**
 * A ready-made triangle mesh (positions + sRGB vertex colours, flat-shaded) in the palette material, so it
 * takes the cascaded sun like every placed piece: what a world builder hands render as plain arrays.
 */
import { BufferAttribute, BufferGeometry, Color, Mesh, SRGBColorSpace } from "three"
import { paletteMaterial } from "./material.ts"
import type { Stage } from "./stage.ts"
import type { TerrainMesh } from "./terrain.ts"

export function createVertexMesh(
  stage: Pick<Stage, "scene">,
  position: Float32Array,
  srgb: Float32Array,
): TerrainMesh {
  const color = new Float32Array(srgb.length)
  const c = new Color()
  for (let i = 0; i < srgb.length; i += 3) {
    c.setRGB(srgb[i]!, srgb[i + 1]!, srgb[i + 2]!, SRGBColorSpace)
    color[i] = c.r
    color[i + 1] = c.g
    color[i + 2] = c.b
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute("position", new BufferAttribute(position, 3))
  geometry.setAttribute("color", new BufferAttribute(color, 3))
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
