import { log } from "@guildhall/core"
import { DirectionalLight, PCFShadowMap, Vector3, Vector4 } from "three"
import type { Stage } from "../stage.ts"
import {
  type Box,
  type CascadeFit,
  fitBox,
  fitCascade,
  fitCascades,
  innerUv,
  reaimNeeded,
  type Span,
  type Vec3,
} from "./fit.ts"
import { CASCADE_FADE, CASCADE_INNER } from "./patch.ts"

export interface SunOpts {
  /** The target-centred cascades' fixed radii, smallest first (metres). */
  radii?: readonly number[]
  /** The whole town: the last cascade, drawn once; its heights bound every cascade's depth. */
  town: Box
  /** Shadow map texels a side, per cascade (the near cascades' maps are MARGIN times wider, see there). */
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
/**
 * A near cascade's map is rendered this much wider than the square the shader selects it for (and with
 * that many more texels, so a texel stays the same size on the ground), and re-aimed only when the
 * target has left that inner square: a pan that moved the target a texel used to re-render cascade 0
 * (2.3 cm texels) every frame, 14–18 ms of p95; now it re-renders every 6 m. The picture is the same:
 * the map's texels lie on the same light-space lattice wherever the box stands, and the fade between
 * cascades follows the target (`CASCADE_INNER`), not the box's edge.
 */
export const MARGIN = 1.25
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
 * re-renders only when the target leaves its inner square (MARGIN), and the town only on `markDirty()`.
 * A still camera costs no shadow passes. Only the palette material reads the cascades (`sun/patch.ts`).
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
    const texels = light === town ? mapSize : Math.round(mapSize * MARGIN)
    light.shadow.mapSize.set(texels, texels)
    if (light !== sun) scene.add(light)
    scene.add(light.target)
  }
  // The shader's selection squares, one per cascade: centre (uv), half-width (uv), fade width (uv).
  // The town's is its whole map; a near cascade's is the inner square, moved as the target moves.
  const inner = lights.map(() => new Vector4(0.5, 0.5, 0.5, CASCADE_FADE))
  CASCADE_INNER.value = inner

  let dir: Vec3 = [0, 0, 1]
  /** Where each near cascade's map is aimed (its snapped centre); none until aimed. */
  const aimed: (Vec3 | undefined)[] = []
  const refit = () => {
    const target = stage.getCamera().target
    // The sky sets how dark the key's shadow is (light.ts); every cascade casts it the same.
    for (const light of lights) light.shadow.intensity = sun.shadow.intensity
    // the inner squares: the target snapped to each cascade's texel lattice, as the maps were centred before
    fitCascades(target, dir, radii, mapSize, span).forEach((square, i) => {
      const radius = radii[i] as number
      let at = aimed[i]
      if (!at || reaimNeeded(at, square.target, dir, radius * (MARGIN - 1))) {
        const fit = fitCascade(target, dir, radius, mapSize, span, MARGIN)
        aim(lights[i] as DirectionalLight, fit, SOFTNESS_TEXELS.near[i] ?? SOFTNESS_TEXELS.town)
        at = fit.target
        aimed[i] = at
      }
      const [u, v] = innerUv(at, square.target, dir, radius * MARGIN)
      ;(inner[i] as Vector4).set(u, v, 0.5 / MARGIN, CASCADE_FADE / MARGIN)
    })
  }
  const markDirty = () => {
    const d = new Vector3().subVectors(sun.position, sun.target.position).normalize()
    dir = [d.x, d.y, d.z]
    aimed.length = 0
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
  logger.info("sun", { radii, mapSize, margin: MARGIN, dir, town: opts.town })

  return {
    markDirty,
    stats: () => ({ ...last }),
    dispose() {
      unsubscribe()
      shadowMap.render = render
      CASCADE_INNER.value = [new Vector4(0.5, 0.5, 0.5, CASCADE_FADE)]
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
