/**
 * A height-map ground (the terrain lab, decisions.md "Target island + terrain-first pipeline"): one
 * grid mesh over the cell centres in the palette material, so it takes the cascaded sun and its
 * contact shading like every placed piece; and flat inland water (rivers, lakes) as given quads.
 */
import { BufferAttribute, BufferGeometry, Color, Mesh, MeshStandardMaterial, SRGBColorSpace } from "three"
import { paletteMaterial } from "./material.ts"
import type { Stage } from "./stage.ts"

export interface HeightGrid {
  w: number
  h: number
  cell: number
  /** World [x, z] of cell (0, 0)'s corner. */
  origin: [number, number]
  /** Height per cell, metres, row-major. */
  height: Float32Array
  /** sRGB RGBA per cell (0–255), row-major. */
  rgba: Uint8ClampedArray
  /** Heights below this are clamped (the sea floor's depth). */
  floor?: number
}

export interface TerrainMesh {
  dispose(): void
}

export function createHeightGround(stage: Pick<Stage, "scene">, g: HeightGrid): TerrainMesh {
  const { w, h, cell, origin, height, rgba } = g
  const floor = g.floor ?? -14
  const pos = new Float32Array(w * h * 3)
  const col = new Float32Array(w * h * 3)
  const c = new Color()
  for (let i = 0; i < w * h; i++) {
    const x = i % w
    const z = (i - x) / w
    pos[i * 3] = origin[0] + (x + 0.5) * cell
    pos[i * 3 + 1] = Math.max(height[i]!, floor)
    pos[i * 3 + 2] = origin[1] + (z + 0.5) * cell
    c.setRGB(rgba[i * 4]! / 255, rgba[i * 4 + 1]! / 255, rgba[i * 4 + 2]! / 255, SRGBColorSpace)
    col[i * 3] = c.r
    col[i * 3 + 1] = c.g
    col[i * 3 + 2] = c.b
  }
  const idx = new Uint32Array((w - 1) * (h - 1) * 6)
  let k = 0
  for (let z = 0; z < h - 1; z++)
    for (let x = 0; x < w - 1; x++) {
      const a = z * w + x
      idx[k++] = a
      idx[k++] = a + w
      idx[k++] = a + 1
      idx[k++] = a + 1
      idx[k++] = a + w
      idx[k++] = a + w + 1
    }
  const geometry = new BufferGeometry()
  geometry.setAttribute("position", new BufferAttribute(pos, 3))
  geometry.setAttribute("color", new BufferAttribute(col, 3))
  geometry.setIndex(new BufferAttribute(idx, 1))
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

/** Flat inland water from triangle positions (x, y, z per vertex). */
export function createInlandWater(stage: Pick<Stage, "scene">, positions: Float32Array): TerrainMesh {
  return createSurface(stage, positions, "#4f9ad8", 0.25)
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
  const material = new MeshStandardMaterial({
    color,
    roughness,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  })
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
