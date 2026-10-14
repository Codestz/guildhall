import { log } from "@guildhall/core"
import { Matrix4, Mesh, PCFShadowMap, PlaneGeometry, ShadowMaterial, Vector3 } from "three"
import type { Disposable, Stage } from "./stage.ts"

type Vec3 = [number, number, number]

export interface ShadowBox {
  /** The world-space box the sun's shadow covers: fixed, so shadows never swim as the camera moves. */
  min: Vec3
  max: Vec3
}

const logger = log("render:shadow")

/** Shadow map texels a side. A 100 m lineup comes out near 2.5 cm a texel. */
const MAP_SIZE = 4096
/** PCF blur radius in texels: a soft edge without the cost of a contact-hardening filter. */
const SOFTNESS = 3
/** How far the ground plane reaches past the box, so shadows cast outward still land on it. */
const GROUND_MARGIN = 8

/**
 * The orthographic bounds, in the light's view space, that hold every corner of `box` for a light at
 * `from` looking at `to`. Pure maths, so the fit is testable without a GPU.
 */
export function fitShadowCamera(from: Vec3, to: Vec3, box: ShadowBox) {
  const view = new Matrix4().lookAt(new Vector3(...from), new Vector3(...to), new Vector3(0, 1, 0))
  view.setPosition(...from).invert()
  const lo = new Vector3(Infinity, Infinity, Infinity)
  const hi = new Vector3(-Infinity, -Infinity, -Infinity)
  for (const x of [box.min[0], box.max[0]])
    for (const y of [box.min[1], box.max[1]])
      for (const z of [box.min[2], box.max[2]]) {
        const p = new Vector3(x, y, z).applyMatrix4(view)
        lo.min(p)
        hi.max(p)
      }
  // The camera looks down -z: near is the closest corner, far the furthest.
  return { left: lo.x, right: hi.x, bottom: lo.y, top: hi.y, near: Math.max(0.1, -hi.z), far: -lo.z }
}

/**
 * Soft sun shadows over a fixed world box, and a ground plane that shows them. The sun keeps the
 * stage's direction; it is re-aimed at the box centre and stood back far enough to see all of it.
 * Objects opt in with `castShadow` (`loadModel` sets it on every mesh).
 */
export function createShadows(stage: Stage, box: ShadowBox): Disposable {
  const { renderer, scene, sun } = stage
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = PCFShadowMap

  const centre: Vec3 = [0, 1, 2].map((i) => ((box.min[i] as number) + (box.max[i] as number)) / 2) as Vec3
  const reach = Math.hypot(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2])
  const dir = sun.position.clone().sub(sun.target.position).normalize()
  const from: Vec3 = [centre[0] + dir.x * reach, centre[1] + dir.y * reach, centre[2] + dir.z * reach]
  sun.position.set(...from)
  sun.target.position.set(...centre)
  scene.add(sun.target)

  sun.castShadow = true
  sun.shadow.mapSize.set(MAP_SIZE, MAP_SIZE)
  sun.shadow.radius = SOFTNESS
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 0.03
  Object.assign(sun.shadow.camera, fitShadowCamera(from, centre, box))
  sun.shadow.camera.updateProjectionMatrix()

  const width = box.max[0] - box.min[0] + GROUND_MARGIN * 2
  const depth = box.max[2] - box.min[2] + GROUND_MARGIN * 2
  const ground = new Mesh(new PlaneGeometry(width, depth), new ShadowMaterial({ opacity: 0.3 }))
  ground.name = "shadow-ground"
  ground.rotation.x = -Math.PI / 2
  // A hair under the grid, so its lines never fight the plane.
  ground.position.set(centre[0], -0.002, centre[2])
  ground.receiveShadow = true
  scene.add(ground)
  logger.debug("shadows", { box, mapSize: MAP_SIZE })

  return {
    dispose() {
      ground.removeFromParent()
      ground.geometry.dispose()
      ground.material.dispose()
      sun.castShadow = false
      sun.shadow.map?.dispose()
      sun.shadow.map = null
    },
  }
}
