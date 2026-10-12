import { log } from "@guildhall/core"
import { DirectionalLight, PCFShadowMap, Vector3 } from "three"
import type { Stage } from "../stage.ts"
import { type Box, type CascadeFit, fitBox, fitCascades, type Span, type Vec3 } from "./fit.ts"

export interface SunOpts {
  /** The target-centred cascades' fixed radii, smallest first (metres). */
  radii?: readonly number[]
  /** The whole town: the last cascade, drawn once; its heights bound every cascade's depth. */
  town: Box
  /** Shadow map texels a side, per cascade. */
  mapSize?: number
}

/**
 * How many cascade maps the sun re-rendered. Their draw calls and triangles go through three's
 * `shadowMap.render`, so the stage already counts them as `FrameStats.shadowCalls`/`shadowTris`.
 */
export interface SunStats {
  /** Cascade maps re-rendered last frame: 0 on a still camera. */
  renders: number
  /** Cascade maps rendered since the sun was created. */
  total: number
}

export interface Sun {
  /** Re-renders every cascade next frame: call after the scene's casters (or the sun's direction) change. */
  markDirty(): void
  stats(): SunStats
  dispose(): void
}

const DEFAULTS = { radii: [24, 80], mapSize: 2048 } as const
/**
 * Kernel spacing in texels (the 3x3 taps of `sun/patch.ts`), smallest cascade first, then the town's:
 * crisp edges up close, softer ones far off, where a wide texel would otherwise step. Past 2 the taps
 * leave gaps between their hardware-filtered footprints and the edge doubles.
 */
export const SOFTNESS_TEXELS = { near: [1, 1.5], town: 2 } as const
/** Depth bias in texels of the cascade, and how far along the normal (in texels) a receiver is pushed. */
const BIAS_TEXELS = 0.5
const NORMAL_BIAS_TEXELS = 1

const logger = log("render:sun")

function aim(light: DirectionalLight, fit: CascadeFit, softness: number): void {
  light.position.set(...fit.position)
  light.target.position.set(...fit.target)
  const { shadow } = light
  Object.assign(shadow.camera, {
    left: -fit.half,
    right: fit.half,
    bottom: -fit.half,
    top: fit.half,
    near: fit.near,
    far: fit.far,
  })
  shadow.camera.updateProjectionMatrix()
  // three reads bias as a share of the light's depth range.
  shadow.bias = -(BIAS_TEXELS * fit.texel) / (fit.far - fit.near)
  shadow.normalBias = NORMAL_BIAS_TEXELS * fit.texel
  shadow.radius = softness
  shadow.needsUpdate = true
}

/**
 * Stable sun shadows (ADR 009). The stage's sun keeps its world direction and becomes cascade 0;
 * cascade 1.. are more lights the same way (intensity 0), and the last is the whole town. Cascades
 * 0.. have fixed radii and follow the camera target, snapped to whole texels in light space; each
 * re-renders only when its snapped centre moves, and the town only on `markDirty()`. A still camera
 * costs no shadow passes. Only the palette material reads the cascades (`sun/patch.ts`).
 */
export function createSun(stage: Stage, opts: SunOpts): Sun {
  const { renderer, scene, sun } = stage
  const radii = opts.radii ?? DEFAULTS.radii
  const mapSize = opts.mapSize ?? DEFAULTS.mapSize
  const span: Span = { floor: opts.town.min[1], ceiling: opts.town.max[1] }
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = PCFShadowMap

  const extra = Array.from({ length: radii.length - 1 }, () => new DirectionalLight(sun.color, 0))
  const town = new DirectionalLight(sun.color, 0)
  // Light order is the shader's cascade order: three keeps shadowed lights in scene order.
  const lights = [sun, ...extra, town]
  for (const light of lights) {
    light.castShadow = true
    light.shadow.autoUpdate = false
    light.shadow.mapSize.set(mapSize, mapSize)
    if (light !== sun) scene.add(light)
    scene.add(light.target)
  }

  let dir: Vec3 = [0, 0, 1]
  const keys: string[] = []
  const refit = () => {
    const target = stage.getCamera().target
    // The sky sets how dark the key's shadow is (light.ts); every cascade casts it the same.
    for (const light of lights) light.shadow.intensity = sun.shadow.intensity
    fitCascades(target, dir, radii, mapSize, span).forEach((fit, i) => {
      if (keys[i] === fit.key) return
      keys[i] = fit.key
      aim(lights[i] as DirectionalLight, fit, SOFTNESS_TEXELS.near[i] ?? SOFTNESS_TEXELS.town)
    })
  }
  const markDirty = () => {
    const d = new Vector3().subVectors(sun.position, sun.target.position).normalize()
    dir = [d.x, d.y, d.z]
    keys.length = 0
    aim(town, fitBox(opts.town, dir, mapSize), SOFTNESS_TEXELS.town)
    refit()
  }
  markDirty()
  const unsubscribe = stage.onFrame(refit)

  // Count the maps three actually redraws: it renders every due map inside `shadowMap.render`. The
  // stage wraps the same hook for the shadow draw calls; the two wrappers chain.
  const shadowMap = renderer.shadowMap
  const render = shadowMap.render
  const last: SunStats = { renders: 0, total: 0 }
  shadowMap.render = (shadowed, sceneArg, camera) => {
    const due = lights.filter((light) => light.shadow.needsUpdate).length
    render.call(shadowMap, shadowed, sceneArg, camera)
    last.renders = due
    last.total += due
  }
  logger.info("sun", { radii, mapSize, dir, town: opts.town })

  return {
    markDirty,
    stats: () => ({ ...last }),
    dispose() {
      unsubscribe()
      shadowMap.render = render
      for (const light of lights) {
        light.shadow.map?.dispose()
        light.shadow.map = null
        light.shadow.autoUpdate = true
        light.castShadow = false
        light.target.removeFromParent()
        if (light !== sun) light.removeFromParent()
      }
    },
  }
}
