import {
  CustomToneMapping,
  type Light,
  type LightShadow,
  NeutralToneMapping,
  type Object3D,
  type ToneMapping,
} from "three"
import { unpackExposure } from "../scene/atmosphere/lowGrade.ts"

/**
 * The WebGL renderer APIs the scene still calls, made safe on three's WebGPURenderer — so the
 * `?renderer=webgpu` spike boots without touching the scene's own files. Each one degrades; none
 * reproduces WebGL exactly (the gaps are listed in docs and the spike report).
 *
 * No `three/webgpu` import here: these work on any object shaped like the renderer (tests use plain ones).
 */

/** The renderer-level shadow switches the on-demand cache writes (atmosphere/Atmosphere.tsx Key). */
interface ShadowSwitches {
  shadowMap: { enabled: boolean; autoUpdate?: boolean; needsUpdate?: boolean }
}

/**
 * The on-demand shadow cache (atmosphere/shadows.ts) on WebGPU. The scene writes the WebGL
 * renderer's `shadowMap.autoUpdate` / `needsUpdate`; WebGPURenderer has neither and reads each
 * light's own `shadow.autoUpdate` / `shadow.needsUpdate` instead. Called just before the frame is
 * drawn: when a redraw was asked for, every shadow-casting light takes the renderer's switches and
 * draws its map once. Between requests nothing is traversed. A light that mounts without a request
 * keeps three's default (redrawn every frame): correct, only uncached.
 */
export function syncShadows(gl: ShadowSwitches, scene: Object3D): void {
  const map = gl.shadowMap
  if (map.needsUpdate !== true) return
  map.needsUpdate = false
  const auto = map.autoUpdate !== false
  scene.traverse((object) => {
    const light = object as Light & { shadow?: LightShadow }
    if (!light.isLight || !light.castShadow || !light.shadow) return
    light.shadow.autoUpdate = auto
    light.shadow.needsUpdate = true
  })
}

/**
 * The Low tier's tone mapping (atmosphere/lowGrade.ts) is a GLSL `CustomToneMapping` with the
 * saturation packed into `toneMappingExposure`. WebGPU has no CustomToneMapping: the renderer here
 * reports Neutral for it and unpacks the exposure, so Low keeps its curve and its storm/night
 * exposure and loses only the desaturation (instead of an unknown tone mapping and a 4–260× exposure).
 */
export function shimLowGrade(renderer: { toneMapping: ToneMapping; toneMappingExposure: number }): void {
  let mapping = renderer.toneMapping
  let exposure = renderer.toneMappingExposure
  Object.defineProperty(renderer, "toneMapping", {
    configurable: true,
    get: () => (mapping === CustomToneMapping ? NeutralToneMapping : mapping),
    set: (value: ToneMapping) => {
      mapping = value
    },
  })
  Object.defineProperty(renderer, "toneMappingExposure", {
    configurable: true,
    get: () => (mapping === CustomToneMapping ? unpackExposure(exposure)[0] : exposure),
    set: (value: number) => {
      exposure = value
    },
  })
}

/**
 * Water's shore bake (nature/Water.tsx bakeShore) reads its mask back with the synchronous
 * `readRenderTargetPixels`; WebGPU only reads back asynchronously, and the call is missing. Here it
 * leaves the buffer as it is (zeros: no land, no standing posts), so the bake finishes with an
 * open-sea shore instead of throwing on load. The real fix bakes the mask offline (codebase-map §3.1).
 */
export function shimReadback(renderer: object): void {
  const target = renderer as { readRenderTargetPixels?: unknown }
  if (typeof target.readRenderTargetPixels === "function") return
  let warned = false
  target.readRenderTargetPixels = () => {
    if (warned) return
    warned = true
    console.info("[hall] WebGPU: no synchronous readback; the water's shore mask is left empty")
  }
}
