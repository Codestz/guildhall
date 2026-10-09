import type { Material, MeshStandardMaterial, WebGLProgramParametersWithUniforms } from "three"
import { SWATCH, swatchV } from "../../world/gen/relief/swatches.ts"
import { CUT_FRAGMENT, CUT_FRAGMENT_PARS, CUT_VERTEX, CUT_VERTEX_PARS, cutaway } from "./cutaway.ts"

/**
 * The massifs' snow line: a copy of the land material (same palette, same atlas) that turns faces
 * white above a height, set by one uniform. Faces are flat-shaded, so the snow is a sharp, faceted
 * cap in the kit's own white swatch; it only settles on gentle faces (a wall stays rock). The line is
 * a soft band (SNOW_EDGE below the line) warped by a slow wave (SNOW_WARP), read per fragment from its own
 * height and interpolated normal, so it is one natural edge across the facets and a rising line never pops.
 *
 *   `snowline.value` is the world height (units) the cap starts at; 1e4 is no snow. The relief sets it
 *   from `snowlineOf(relief, winter)`, lowered in winter. WebGPU never runs onBeforeCompile: its twin is
 *   snowNodes.ts, fed the same uniform object.
 *
 * The same material carries the see-through cut (cutaway.ts): fragments of the relief that hide a
 * figure from the camera are discarded on a Bayer pattern, from the shared `cutaway` uniforms.
 */

/** A `{ value }` uniform, shared by every material of the relief. */
export interface Snowline {
  value: number
}

/** How wide the soft edge below the line is, world units: bare at the foot of it, white at the line. */
export const SNOW_EDGE = 3.2
/** How far a slow wave in x, z pushes the line up and down, world units: a natural edge, never a straight cut. */
export const SNOW_WARP = 1.6
/** Snow settles where the surface faces up this much (its normal's y): none below the first, all above the second. */
export const SNOW_SLOPE: readonly [number, number] = [0.3, 0.7]

const smoothstep = (lo: number, hi: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)))
  return t * t * (3 - 2 * t)
}

/** The line's push at a point (two sines of different wavelengths, within SNOW_WARP): GLSL and the node twin compute exactly this. */
export const snowWarp = (x: number, z: number): number =>
  SNOW_WARP * (0.6 * Math.sin(0.37 * x + 0.21 * z) + 0.4 * Math.sin(0.53 * z - 0.17 * x + 1.3))

/**
 * How white a point is, 0 to 1: its height over a warped line, softly, times how upward its surface
 * faces, softly. It reads the point's own height and interpolated normal, never the face it lies on,
 * so the line is one smooth edge across the facets, not a step per triangle. (The shaders compute this.)
 */
export const snowAmount = (line: number, x: number, y: number, z: number, up: number): number =>
  smoothstep(line - SNOW_EDGE, line, y + snowWarp(x, z)) * smoothstep(SNOW_SLOPE[0], SNOW_SLOPE[1], up)

export const newSnowline = (): Snowline => ({ value: 1e4 })

/** The fragment's blend, GLSL (and its twin in snowNodes.ts): world height and face steepness in, white out. */
export const SNOW_FRAGMENT = /* glsl */ `
float reliefWarp = ${SNOW_WARP.toFixed(2)} * ( 0.6 * sin( 0.37 * vReliefXZ.x + 0.21 * vReliefXZ.y ) + 0.4 * sin( 0.53 * vReliefXZ.y - 0.17 * vReliefXZ.x + 1.3 ) );
float reliefSnow = smoothstep( uSnowline - ${SNOW_EDGE.toFixed(2)}, uSnowline, vReliefY + reliefWarp )
	* smoothstep( ${SNOW_SLOPE[0].toFixed(2)}, ${SNOW_SLOPE[1].toFixed(2)}, vReliefUp );
vec4 reliefWhite = texture2D( map, vec2( ${SWATCH.snow.u.toFixed(3)}, ${swatchV(SWATCH.snow, 0.15).toFixed(3)} + 0.12 * ( 1.0 - vReliefUp ) ) );
diffuseColor.rgb = mix( diffuseColor.rgb, reliefWhite.rgb, reliefSnow );
`

const VERTEX_PARS = /* glsl */ `
varying float vReliefY;
varying vec2 vReliefXZ;
varying float vReliefUp;
`
const VERTEX = /* glsl */ `
vec4 reliefWorld = vec4( transformed, 1.0 );
vec3 reliefNormal = objectNormal;
#ifdef USE_BATCHING
	reliefWorld = batchingMatrix * reliefWorld;
	reliefNormal = mat3( batchingMatrix ) * reliefNormal;
#endif
#ifdef USE_INSTANCING
	reliefWorld = instanceMatrix * reliefWorld;
	reliefNormal = mat3( instanceMatrix ) * reliefNormal;
#endif
vec4 reliefPlaced = modelMatrix * reliefWorld;
vReliefY = reliefPlaced.y;
vReliefXZ = reliefPlaced.xz;
vReliefUp = normalize( mat3( modelMatrix ) * reliefNormal ).y;
`
const FRAGMENT_PARS = /* glsl */ `
uniform float uSnowline;
varying float vReliefY;
varying vec2 vReliefXZ;
varying float vReliefUp;
`

/** A copy of `base` (the land material) with the snow line patched in (WebGL's GLSL). */
export function snowMaterial(base: Material, snowline: Snowline): Material {
  const copy = (base as MeshStandardMaterial).clone()
  const key = base.customProgramCacheKey()
  copy.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uSnowline = snowline
    shader.uniforms.uCutDots = { value: cutaway.dots }
    shader.uniforms.uCutView = { value: cutaway.view }
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", `${VERTEX_PARS}\n${CUT_VERTEX_PARS}\nvoid main() {`)
      .replace("#include <project_vertex>", `#include <project_vertex>\n${VERTEX}\n${CUT_VERTEX}`)
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", `${FRAGMENT_PARS}\n${CUT_FRAGMENT_PARS}\nvoid main() {`)
      .replace("#include <map_fragment>", `${CUT_FRAGMENT}\n#include <map_fragment>\n${SNOW_FRAGMENT}`)
  }
  copy.customProgramCacheKey = () => `${key}|snowline|cut`
  return copy
}

/** Makes the snow-line material for a land material: GLSL here, the node twin on WebGPU (snowNodes.ts). */
export type SnowMaker = (base: Material, snowline: Snowline) => Material
