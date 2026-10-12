import { log } from "@guildhall/core"
import { type GroundGeometry, groundGeometry, type Tint, type TownDraw } from "@guildhall/world"
import { BufferAttribute, BufferGeometry, Mesh } from "three"
import { paletteMaterial } from "./material.ts"
import type { Stage } from "./stage.ts"

export type GroundDraw = TownDraw["ground"]

const logger = log("render:ground")

export interface Ground {
  mesh: Mesh
  dispose(): void
}

/**
 * The town's ground (plan §5) as one mesh in the palette material: it receives the cascaded sun
 * shadows like every library piece and casts none. One draw call. Takes the ground's geometry
 * prebuilt (world `groundGeometry`, in a worker) or builds it here from the draw.
 */
export function createGround(
  stage: Stage,
  g: GroundDraw | GroundGeometry,
  opts: { seed?: number; tint?: Tint } = {},
): Ground {
  const start = performance.now()
  const built = "position" in g ? g : groundGeometry(g, opts.seed ?? 0, opts.tint)
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
    prebuilt: "position" in g,
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
