/**
 * What lit materials read from the atmosphere: one set of uniforms shared by every patched program
 * (the palette material, the water), so the atmosphere writes them once a frame and every program
 * sees the same sky. `patchCloudShade` is the opt-in hook (like `patchCascades`): the sun's direct
 * light is dimmed by the cloud-shadow mask under each fragment. With no atmosphere the mask is a black
 * texel and the strength 0, so a patched program draws exactly as before.
 */
import { log } from "@guildhall/core"
import {
  Color,
  DataTexture,
  RGBAFormat,
  ShaderChunk,
  type Texture,
  Vector2,
  Vector3,
  Vector4,
  type WebGLProgramParametersWithUniforms,
} from "three"

const empty = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, RGBAFormat)
empty.needsUpdate = true

/** The atmosphere's uniforms, one object shared by every program that reads them. */
export const ATMOSPHERE = {
  /** R: the clouds' shadows projected on the ground along the sun; G: the clouds' own footprint. */
  uCloudMap: { value: empty as Texture },
  /** The mask's world window: x0, z0, 1 / width, 1 / depth. */
  uCloudWindow: { value: new Vector4(0, 0, 0, 0) },
  /** The sun's slant (sun.xz / sun.y): how far a shadow moves sideways per metre of height. */
  uCloudSlant: { value: new Vector2() },
  /** How dark full shadow makes the sun's light (0: off). */
  uCloudShadow: { value: 0 },
  /** The clouds' mean base height (what the water reflects them at) and how much they show there. */
  uCloudHeight: { value: 90 },
  uCloudReflect: { value: 0 },
  uCloudLit: { value: new Color("#ffffff") },
  /** The sky the water mirrors: zenith, horizon, the glow round the sun; the sun's true direction. */
  uSkyZenith: { value: new Color("#4a82c4") },
  uSkyHorizon: { value: new Color("#f1d4ae") },
  uSkyGlow: { value: new Color("#ffcf98") },
  uSunDirection: { value: new Vector3(0, 1, 0) },
  uSunColor: { value: new Color("#ffd2a1") },
  /** 1: the water mirrors the sky and clouds (fresnel); 0: the plain look it had before. */
  uReflect: { value: 0 },
}

const FUNCTION = /* glsl */ `
#define CLOUD_SHADE
uniform sampler2D uCloudMap;
uniform vec4 uCloudWindow;
uniform vec2 uCloudSlant;
uniform float uCloudShadow;
varying vec3 vCloudWorld;
// The mask at uv, faded out over the outer tenth of its window so no edge ever shows.
vec4 cloudMask( vec2 uv ) {
	vec2 edge = min( uv, 1.0 - uv );
	return texture2D( uCloudMap, uv ) * smoothstep( 0.0, 0.1, min( edge.x, edge.y ) );
}
float cloudShade() {
	if ( uCloudShadow <= 0.0 ) return 1.0;
	vec2 uv = ( vCloudWorld.xz + vCloudWorld.y * uCloudSlant - uCloudWindow.xy ) * uCloudWindow.zw;
	return 1.0 - uCloudShadow * cloudMask( uv ).r;
}
`

const WORLD = /* glsl */ `
vec4 cloudWorld = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
cloudWorld = batchingMatrix * cloudWorld;
#endif
#ifdef USE_INSTANCING
cloudWorld = instanceMatrix * cloudWorld;
#endif
vCloudWorld = ( modelMatrix * cloudWorld ).xyz;`

const LIGHTS = "#include <lights_fragment_begin>"
const ANCHOR = "getDirectionalLightInfo( directionalLight, directLight );"
const PROJECT = "#include <project_vertex>"

const logger = log("render:atmosphere")
let warned = false

/**
 * `onBeforeCompile` for a lit material, after `patchCascades`: the sun's light (every directional
 * light, which are the sun's cascades) is dimmed by the cloud shadows over the fragment.
 */
export function patchCloudShade(shader: WebGLProgramParametersWithUniforms): void {
  let fragment = shader.fragmentShader
  if (fragment.includes(LIGHTS)) fragment = fragment.replace(LIGHTS, () => ShaderChunk.lights_fragment_begin)
  if (!fragment.includes(ANCHOR) || !shader.vertexShader.includes(PROJECT)) {
    if (!warned) logger.error("three's light chunks moved: no cloud shadows")
    warned = true
    return
  }
  Object.assign(shader.uniforms, ATMOSPHERE)
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nvarying vec3 vCloudWorld;")
    .replace(PROJECT, () => `${PROJECT}\n${WORLD}`)
  shader.fragmentShader = fragment
    .replace("#include <common>", () => `#include <common>\n${FUNCTION}`)
    .replace(ANCHOR, () => `${ANCHOR}\ndirectLight.color *= cloudShade();`)
}
