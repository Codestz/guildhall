import {
  type DirectionalLight,
  type Mesh,
  Object3D,
  type OrthographicCamera,
  type PerspectiveCamera,
} from "three"
import { walkers } from "../Blobs.tsx"
import { castedCrowd } from "../crowd/cast.ts"
import { castBox } from "../crowd/material.ts"

/**
 * Real shadows for characters, inside the near cascade only (cascades.ts). The cascades are static
 * maps (shadows.ts): nobody who moves can cast into them. Characters get a small map of their own,
 * the same box as the near cascade, redrawn every frame with just them in it, and the shader
 * (cascadeChunk.ts) takes the darker of the two inside that box. Outside it, and on Low, the blobs
 * (Blobs.tsx) stay: the box is only as wide as `reach`, so an island view pays nothing.
 *
 * The pass runs inside three's own shadow step (`installCharacterPass` wraps `shadowMap.render`):
 * the renderer is mid-render there, which a bare call from a frame callback is not. Who is drawn is
 * decided once a frame (`planCharacters`, from CascadeKey.tsx): the walkers whose roots are in the
 * box (a hero's rig and gear: Blobs.tsx) and, at "crowd", the baked crowd, whose depth shader
 * (crowd/material.ts) drops members outside the box before it reads their bones. Meshes cast only for
 * the length of that draw, so the cascade passes never see them.
 */

/** A character's height: how far its shadow reaches is its height over the sun's tangent. */
const HEIGHT = 3
/** The longest a shadow is followed in from outside the box, world units. */
const MAX_UPSTREAM = 24

/** The near cascade's disc. */
export interface Box {
  cx: number
  cz: number
  radius: number
}

/** How far outside the box a character can stand and still throw its shadow into it, at a key light `dy` high. */
export function upstream(dx: number, dy: number, dz: number): number {
  const tan = dy / Math.max(Math.hypot(dx, dz), 1e-6)
  return Math.min(MAX_UPSTREAM, HEIGHT / Math.max(tan, 0.05))
}

/** True when a root at (x, z) is within the box and its margin. */
export function inReach(x: number, z: number, box: Box, margin: number): boolean {
  return Math.hypot(x - box.cx, z - box.cz) <= box.radius + margin
}

const proxy = new Object3D()
const meshes: Mesh[] = []
const was: boolean[] = []

/** What this frame's pass draws, set by `planCharacters`. */
const plan = { count: 0, frame: 0, drawn: -1 }

/**
 * Who casts this frame. `box`: the near cascade's disc, or undefined when there is none; `reach`:
 * the widest box that still has characters casting. Returns how many roots are drawn (0: skip the
 * pass, and the light's intensity goes to 0 so the shader never reads a stale map).
 */
export function planCharacters(
  box: Box | undefined,
  casts: "off" | "heroes" | "crowd",
  reach: number,
  key: readonly [number, number, number],
): number {
  plan.frame++
  proxy.children.length = 0
  for (const walker of walkers) walker.cast = false
  plan.count = 0
  if (!box || casts === "off" || box.radius > reach) return 0
  const margin = upstream(key[0], key[1], key[2])
  for (const walker of walkers) {
    const e = walker.node.matrixWorld.elements
    if (!walker.node.visible || (walker.opacity?.() ?? 1) < 0.5) continue
    if (!inReach(e[12] as number, e[14] as number, box, margin)) continue
    walker.cast = true
    proxy.children.push(walker.node)
  }
  const crowd = casts === "crowd" ? castedCrowd() : null
  if (crowd && crowd.size > 0) {
    castBox.value.set(box.cx, box.cz, box.radius + margin)
    proxy.children.push(crowd.root)
  }
  plan.count = proxy.children.length
  return plan.count
}

/** The slice of three's shadow map this needs. */
interface ShadowStep {
  needsUpdate: boolean
  render(lights: DirectionalLight[], scene: Object3D, camera: OrthographicCamera | PerspectiveCamera): void
}

/**
 * Wraps `map.render`: the cascades go through as three draws them; then, once a frame and when
 * `planCharacters` found anyone, the characters' light is drawn from the planned roots (castShadow
 * on for the length of the draw). Returns the way back.
 */
export function installCharacterPass(map: ShadowStep, light: DirectionalLight): () => void {
  const stock = map.render
  map.render = function (this: ShadowStep, lights, scene, camera) {
    if (!lights.includes(light)) return stock.call(this, lights, scene, camera)
    const rest = lights.filter((one) => one !== light)
    if (rest.length > 0) stock.call(this, rest, scene, camera)
    // Drawn at least once even with no one in it: a light with no map binds a texture the shader's
    // shadow sampler cannot read, and every draw that reads it fails.
    if ((plan.count === 0 && light.shadow.map !== null) || plan.drawn === plan.frame) return
    plan.drawn = plan.frame
    meshes.length = 0
    was.length = 0
    for (const root of proxy.children)
      root.traverse((node) => {
        const mesh = node as Mesh
        if (!mesh.isMesh) return
        meshes.push(mesh)
        was.push(mesh.castShadow)
        mesh.castShadow = true
      })
    this.needsUpdate = true
    light.shadow.needsUpdate = true
    stock.call(this, [light], proxy, camera)
    meshes.forEach((mesh, i) => {
      mesh.castShadow = was[i] as boolean
    })
  }
  return () => {
    map.render = stock
  }
}
