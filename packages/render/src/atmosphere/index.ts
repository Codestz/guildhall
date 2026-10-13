/**
 * The atmosphere (part 1): drifting clouds (low-poly puffs, or a high broken deck, deck.ts), their soft
 * shadows moving over land and water, and the sky the water mirrors. It follows the light through `light()` (the sky's `light`, light.ts),
 * read every frame, so whoever moves the hour moves the clouds' colours, the shadows' strength and the
 * reflections with it. Cost: the clouds are one draw, the shadow/reflection mask two small ones.
 */
import { Color, Fog, type Object3D, Vector3 } from "three"
import type { DayLight } from "../light.ts"
import type { Stage } from "../stage.ts"
import { AIR } from "./air.ts"
import { cloudMask, cloudMesh, fieldUniforms, maskTarget, puffAttributes } from "./clouds.ts"
import { createDeck, DECK_WRAP, type DeckOpts } from "./deck.ts"
import { cloudField, focusWeight, smoothstep, swell, VIEW_REACH } from "./field.ts"
import { cloudLook } from "./look.ts"
import { ATMOSPHERE } from "./shade.ts"

export { cloudNoise, type Deck, type DeckOpts, deckFocus, deckGapFade, deckHeight } from "./deck.ts"
export { cloudField, presence, viewFade, wrap } from "./field.ts"
export { createHorizon, type Horizon, type HorizonBand, type HorizonOpts, horizonBand } from "./horizon.ts"
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
  /** The clouds' base heights, metres (60–95 by default). */
  height?: [number, number]
  /**
   * Where the clouds' meshes show, metres from `centre`: faded in from [0] to [1], out from [2] to [3].
   * Everywhere by default; round an island, a ring over the sea (their shadows still cross the land).
   */
  ring?: [number, number, number, number]
  /**
   * A high broken cloud deck in place of the puffs (deck.ts): the clouds, their shadows and what the
   * water mirrors all come from it. `height` is ignored then.
   */
  deck?: DeckOpts
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
  const height = opts.height ?? HEIGHT
  const deck = opts.deck ? createDeck(opts.deck) : null
  const field = fieldUniforms()
  field.uSpan.value = span
  field.uCentre.value.set(...opts.centre)
  if (opts.ring) field.uRing.value.set(...opts.ring)
  const puffs = deck ? null : puffAttributes(cloudField({ seed: opts.seed ?? 1, count: COUNT, span, height }))
  const mesh = puffs ? cloudMesh(puffs, field) : null
  const mask = puffs ? cloudMask(puffs, field) : null
  const target = mask?.target ?? maskTarget()
  const layers: readonly Object3D[] = deck ? [deck.mask] : (mask?.layers ?? [])
  if (deck) stage.scene.add(deck.mesh)
  if (mesh) stage.scene.add(mesh.mesh)
  // the clouds and their shadow mask are the "sky" pass, with the dome
  if (deck) stage.timing.gpu.tag(deck.mesh, "sky")
  if (mesh) stage.timing.gpu.tag(mesh.mesh, "sky")

  // The mask covers the land and a margin, so shadows cast from clouds offshore still land on it.
  const half = 2 * opts.reach
  ATMOSPHERE.uCloudWindow.value.set(
    opts.centre[0] - half,
    opts.centre[1] - half,
    1 / (2 * half),
    1 / (2 * half),
  )
  ATMOSPHERE.uCloudMap.value = target.texture
  ATMOSPHERE.uCloudHeight.value = opts.deck
    ? opts.deck.height
    : (height[0] + height[1]) / 2 + 0.4 * swell(params.coverage)

  const sun = new Vector3()
  const clearColour = new Color()
  let hour = Number.NaN
  let coverage = Number.NaN
  let veil = 1
  const applyLook = (light: DayLight) => {
    const look = cloudLook(light, params.coverage)
    // by night only a veil: the clouds' dark undersides read as rocks hanging in the sky
    veil = 0.45 + 0.55 * smoothstep(-10, 2, light.elevation)
    ATMOSPHERE.uCloudLit.value.copy(look.lit)
    AIR.uCirrusLit.value.copy(look.lit)
    trueSun(light, sun)
    ATMOSPHERE.uSunDirection.value.copy(sun)
    // The clouds are lit from whichever is up and brighter: by night the moon catches their tops.
    const key = light.moonIntensity > light.sunIntensity ? new Vector3(...light.moonTrue) : sun
    if (mesh) {
      mesh.uniforms.uLit.value.copy(look.lit)
      mesh.uniforms.uShade.value.copy(look.shade)
      mesh.uniforms.uSun.value.copy(key)
      field.uVeil.value = veil
    }
    if (deck) {
      deck.uniforms.uLit.value.copy(look.lit)
      deck.uniforms.uShade.value.copy(look.shade)
      deck.sun(key.x, key.z)
    }
    ATMOSPHERE.uSunColor.value.copy(light.sun).multiplyScalar(light.sunIntensity / 3)
    ATMOSPHERE.uSkyZenith.value.copy(light.zenith)
    ATMOSPHERE.uSkyHorizon.value.copy(light.horizon)
    ATMOSPHERE.uSkyGlow.value.copy(light.glow)
    // Shadows fall along the clamped key light, the one the cascades cast along.
    const [x, y, z] = light.sunDir
    ATMOSPHERE.uCloudSlant.value.set(x / y, z / y)
    if (mask) {
      mask.uniforms.uSlant.value.set(x / y, z / y)
      const flat = Math.hypot(x, z) || 1
      mask.uniforms.uHeading.value.set(x / flat, z / flat)
      mask.uniforms.uStretch.value = Math.min(2.2, 1 / Math.max(y, 0.2))
    }
    ATMOSPHERE.uCloudShadow.value = params.shadows ? look.shadow : 0
  }

  const drift = { x: 0, z: 0 }
  const deckDrift = { x: 0, z: 0 }
  const unsubscribe = stage.onFrame((dt) => {
    const light = opts.light()
    if (light.hour !== hour || params.coverage !== coverage) {
      hour = light.hour
      coverage = params.coverage
      field.uCoverage.value = params.coverage
      field.uSwell.value = swell(params.coverage)
      if (deck) deck.uniforms.uDeckCover.value = params.coverage
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
    const visible = params.clouds && params.coverage > 0
    if (mesh) {
      field.uEye.value.copy(stage.camera.position)
      field.uTarget.value.set(...pose.target)
      field.uEyeDistance.value = Math.min(pose.distance, VIEW_REACH)
      field.uFocus.value = focusWeight(pose.distance)
      const fog = stage.scene.fog
      if (fog instanceof Fog) mesh.uniforms.uHazeRange.value.set(fog.near, fog.far * 1.6)
      mesh.mesh.visible = visible
    }
    if (deck) {
      // The noise moves against the drift, so the clouds go with the wind; it wraps on a whole number
      // of the noise's tiles, so it never jumps.
      deckDrift.x = (deckDrift.x + Math.cos(params.windHeading * RAD) * step) % DECK_WRAP
      deckDrift.z = (deckDrift.z + Math.sin(params.windHeading * RAD) * step) % DECK_WRAP
      deck.uniforms.uDeckDrift.value.set(-deckDrift.x, -deckDrift.z)
      deck.view(stage.camera.position, pose.target, veil)
      deck.mesh.visible = visible
    }
    ATMOSPHERE.uReflect.value = params.reflections ? 1 : 0
    // A deck mirrors faintly (a whole sheet of white in the water reads as mist on it), and only as
    // much as it shows: level with the eye it is gone, and so is its reflection.
    const mirrored = deck ? 0.4 * deck.uniforms.uDeckFade.value.x : 1
    ATMOSPHERE.uCloudReflect.value = params.reflections && params.clouds ? mirrored : 0
    if ((params.shadows || params.reflections) && params.coverage > 0) renderMask()
  })

  const renderMask = () => {
    const { renderer } = stage
    const before = renderer.getRenderTarget()
    const autoClear = renderer.autoClear
    renderer.getClearColor(clearColour)
    const clearAlpha = renderer.getClearAlpha()
    renderer.setRenderTarget(target)
    renderer.setClearColor(0x000000, 1)
    renderer.clear(true, false, false)
    // Every layer into one target: the second must not clear the first.
    renderer.autoClear = false
    stage.timing.gpu.begin("sky")
    for (const layer of layers) renderer.render(layer, stage.camera)
    stage.timing.gpu.end()
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
      if (mesh) {
        mesh.mesh.removeFromParent()
        mesh.mesh.geometry.dispose()
        mesh.mesh.material.dispose()
      }
      for (const layer of mask?.layers ?? []) {
        layer.geometry.dispose()
        layer.material.dispose()
      }
      deck?.dispose()
      target.dispose()
      ATMOSPHERE.uCloudShadow.value = 0
      AIR.uCirrus.value = 0
      ATMOSPHERE.uReflect.value = 0
      ATMOSPHERE.uCloudReflect.value = 0
    },
  }
}
