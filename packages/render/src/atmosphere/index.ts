/**
 * The atmosphere (part 1): drifting low-poly clouds, their soft shadows moving over land and water,
 * and the sky the water mirrors. It follows the light through `light()` (the sky's `light`, light.ts),
 * read every frame, so whoever moves the hour moves the clouds' colours, the shadows' strength and the
 * reflections with it. Cost: the clouds are one draw, the shadow/reflection mask two small ones.
 */
import { Color, Fog, Vector3 } from "three"
import type { DayLight } from "../light.ts"
import type { Stage } from "../stage.ts"
import { AIR } from "./air.ts"
import { cloudMask, cloudMesh, fieldUniforms, puffAttributes } from "./clouds.ts"
import { cloudField, focusWeight, swell, VIEW_REACH } from "./field.ts"
import { cloudLook } from "./look.ts"
import { ATMOSPHERE } from "./shade.ts"

export { cloudField, presence, viewFade, wrap } from "./field.ts"
export { type CloudLook, cloudLook } from "./look.ts"
export { ATMOSPHERE, patchCloudShade } from "./shade.ts"

export interface AtmosphereParams {
  clouds: boolean
  shadows: boolean
  reflections: boolean
  /** 0 clear … 1 overcast. */
  coverage: number
  /** Where the wind blows toward, degrees from +x toward +z; and its speed, m/s. */
  windHeading: number
  windSpeed: number
}

export interface AtmosphereOpts {
  /** The light now (the sky's `light`): read every frame. */
  light: () => DayLight
  /** The middle of the land the shadows fall on, and its half side, metres. */
  centre: [number, number]
  reach: number
  seed?: number
  params?: Partial<AtmosphereParams>
}

export interface Atmosphere {
  set(params: Partial<AtmosphereParams>): void
  params(): AtmosphereParams
  dispose(): void
}

export const DEFAULT_ATMOSPHERE: AtmosphereParams = {
  clouds: true,
  shadows: true,
  reflections: true,
  coverage: 0.45,
  windHeading: 30,
  windSpeed: 4,
}

/** Clouds in the field: enough for overcast over the whole square. */
const COUNT = 72
/** The cloud bases' height range, metres. */
const HEIGHT: [number, number] = [60, 95]
/** The field wraps this far past the shadowed land's half side. */
const FIELD_REACH = 1.8

const RAD = Math.PI / 180

/** The sun's true direction (light.ts clamps `sunDir` for shadows; the glow and disc sit where it is). */
export function trueSun(light: DayLight, out = new Vector3()): Vector3 {
  return out.set(...light.sunTrue)
}

export function createAtmosphere(stage: Stage, opts: AtmosphereOpts): Atmosphere {
  let params: AtmosphereParams = { ...DEFAULT_ATMOSPHERE, ...opts.params }
  const span = FIELD_REACH * opts.reach
  const clouds = cloudField({ seed: opts.seed ?? 1, count: COUNT, span, height: HEIGHT })
  const attributes = puffAttributes(clouds)
  const field = fieldUniforms()
  field.uSpan.value = span
  field.uCentre.value.set(...opts.centre)
  const mesh = cloudMesh(attributes, field)
  const mask = cloudMask(attributes, field)
  stage.scene.add(mesh.mesh)

  // The mask covers the land and a margin, so shadows cast from clouds offshore still land on it.
  const half = 2 * opts.reach
  ATMOSPHERE.uCloudWindow.value.set(
    opts.centre[0] - half,
    opts.centre[1] - half,
    1 / (2 * half),
    1 / (2 * half),
  )
  ATMOSPHERE.uCloudMap.value = mask.target.texture
  ATMOSPHERE.uCloudHeight.value = (HEIGHT[0] + HEIGHT[1]) / 2 + 0.4 * swell(params.coverage)

  const sun = new Vector3()
  const clearColour = new Color()
  let hour = Number.NaN
  let coverage = Number.NaN
  const applyLook = (light: DayLight) => {
    const look = cloudLook(light, params.coverage)
    mesh.uniforms.uLit.value.copy(look.lit)
    mesh.uniforms.uShade.value.copy(look.shade)
    ATMOSPHERE.uCloudLit.value.copy(look.lit)
    AIR.uCirrusLit.value.copy(look.lit)
    trueSun(light, sun)
    ATMOSPHERE.uSunDirection.value.copy(sun)
    // The clouds are lit from whichever is up and brighter: by night the moon catches their tops.
    if (light.moonIntensity > light.sunIntensity) mesh.uniforms.uSun.value.set(...light.moonTrue)
    else mesh.uniforms.uSun.value.copy(sun)
    ATMOSPHERE.uSunColor.value.copy(light.sun).multiplyScalar(light.sunIntensity / 3)
    ATMOSPHERE.uSkyZenith.value.copy(light.zenith)
    ATMOSPHERE.uSkyHorizon.value.copy(light.horizon)
    ATMOSPHERE.uSkyGlow.value.copy(light.glow)
    // Shadows fall along the clamped key light, the one the cascades cast along.
    const [x, y, z] = light.sunDir
    mask.uniforms.uSlant.value.set(x / y, z / y)
    ATMOSPHERE.uCloudSlant.value.set(x / y, z / y)
    const flat = Math.hypot(x, z) || 1
    mask.uniforms.uHeading.value.set(x / flat, z / flat)
    mask.uniforms.uStretch.value = Math.min(2.2, 1 / Math.max(y, 0.2))
    ATMOSPHERE.uCloudShadow.value = params.shadows ? look.shadow : 0
  }

  const drift = { x: 0, z: 0 }
  const unsubscribe = stage.onFrame((dt) => {
    const light = opts.light()
    if (light.hour !== hour || params.coverage !== coverage) {
      hour = light.hour
      coverage = params.coverage
      field.uCoverage.value = params.coverage
      field.uSwell.value = swell(params.coverage)
      applyLook(light)
    }
    const step = params.windSpeed * Math.min(dt, 0.1)
    drift.x = (drift.x + Math.cos(params.windHeading * RAD) * step) % (2 * span)
    drift.z = (drift.z + Math.sin(params.windHeading * RAD) * step) % (2 * span)
    field.uDrift.value.set(drift.x, drift.z)
    // The high layer drifts the same way, slower (it is far above), and thickens with the coverage.
    AIR.uCirrusDrift.value.set(drift.x * 0.5, drift.z * 0.5)
    AIR.uCirrus.value = params.clouds ? 0.4 + 0.6 * params.coverage : 0
    const pose = stage.getCamera()
    field.uEye.value.copy(stage.camera.position)
    field.uTarget.value.set(...pose.target)
    field.uEyeDistance.value = Math.min(pose.distance, VIEW_REACH)
    field.uFocus.value = focusWeight(pose.distance)
    const fog = stage.scene.fog
    if (fog instanceof Fog) {
      mesh.uniforms.uHazeRange.value.set(fog.near, fog.far * 1.6)
    }
    mesh.mesh.visible = params.clouds && params.coverage > 0
    ATMOSPHERE.uReflect.value = params.reflections ? 1 : 0
    ATMOSPHERE.uCloudReflect.value = params.reflections && params.clouds ? 1 : 0
    if ((params.shadows || params.reflections) && params.coverage > 0) renderMask()
  })

  const renderMask = () => {
    const { renderer } = stage
    const before = renderer.getRenderTarget()
    const autoClear = renderer.autoClear
    renderer.getClearColor(clearColour)
    const clearAlpha = renderer.getClearAlpha()
    renderer.setRenderTarget(mask.target)
    renderer.setClearColor(0x000000, 1)
    renderer.clear(true, false, false)
    // Both layers into one target: the second must not clear the first.
    renderer.autoClear = false
    for (const layer of mask.layers) renderer.render(layer, stage.camera)
    renderer.autoClear = autoClear
    renderer.setClearColor(clearColour, clearAlpha)
    renderer.setRenderTarget(before)
  }

  return {
    set(next) {
      params = { ...params, ...next }
      hour = Number.NaN
      if (!params.shadows) ATMOSPHERE.uCloudShadow.value = 0
    },
    params: () => ({ ...params }),
    dispose() {
      unsubscribe()
      mesh.mesh.removeFromParent()
      mesh.mesh.geometry.dispose()
      mesh.mesh.material.dispose()
      for (const layer of mask.layers) {
        layer.geometry.dispose()
        layer.material.dispose()
      }
      mask.target.dispose()
      ATMOSPHERE.uCloudShadow.value = 0
      AIR.uCirrus.value = 0
      ATMOSPHERE.uReflect.value = 0
      ATMOSPHERE.uCloudReflect.value = 0
    },
  }
}
