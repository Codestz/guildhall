import type { Material, MeshStandardMaterial, WebGLProgramParametersWithUniforms } from "three"
import { SWATCH, swatchV } from "../../world/gen/relief/swatches.ts"
import { CUT_FRAGMENT, CUT_FRAGMENT_PARS, CUT_VERTEX, CUT_VERTEX_PARS, cutaway } from "./cutaway.ts"

/**
 * The massifs' snow line: a copy of the land material (same palette, same atlas) that turns faces
 * white above a height, set by one uniform. A massif is stairs to its summit, so the snow is a cap of
 * flat white ledge tops in the kit's own white swatch: a ledge top is one height, so it is wholly
 * white or wholly bare, never a gradient across it; it only settles on faces that face up (a riser
 * stays rock). The line is a narrow soft band (SNOW_EDGE below the line), read per fragment from its
 * own height and interpolated normal, so a line that moves (winter, the growth film) fades a ledge
 * in instead of popping it.
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

/** How wide the soft edge below the line is, world units: bare at the foot of it, white at the line. A ledge is 5 high, so one top is in it at a time. */
export const SNOW_EDGE = 1.2
/** Snow settles where the surface faces up this much (its normal's y): none below the first, all above the second. */
export const SNOW_SLOPE: readonly [number, number] = [0.3, 0.7]

const smoothstep = (lo: number, hi: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)))
  return t * t * (3 - 2 * t)
}

/**
 * How white a point is, 0 to 1: its height over the line, softly, times how upward its surface
 * faces, softly. It reads the point's own height and interpolated normal, never the face it lies on,
 * so a flat ledge top is one amount all over. (The shaders compute this.)
 */
export const snowAmount = (line: number, y: number, up: number): number =>
  smoothstep(line - SNOW_EDGE, line, y) * smoothstep(SNOW_SLOPE[0], SNOW_SLOPE[1], up)

export const newSnowline = (): Snowline => ({ value: 1e4 })

/** The fragment's blend, GLSL (and its twin in snowNodes.ts): world height and face steepness in, white out. */
export const SNOW_FRAGMENT = /* glsl */ `
float reliefSnow = smoothstep( uSnowline - ${SNOW_EDGE.toFixed(2)}, uSnowline, vReliefY )
	* smoothstep( ${SNOW_SLOPE[0].toFixed(2)}, ${SNOW_SLOPE[1].toFixed(2)}, vReliefUp );
vec4 reliefWhite = texture2D( map, vec2( ${SWATCH.snow.u.toFixed(3)}, ${swatchV(SWATCH.snow, 0.15).toFixed(3)} + 0.12 * ( 1.0 - vReliefUp ) ) );
diffuseColor.rgb = mix( diffuseColor.rgb, reliefWhite.rgb, reliefSnow );
`

const VERTEX_PARS = /* glsl */ `
varying float vReliefY;
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
vReliefUp = normalize( mat3( modelMatrix ) * reliefNormal ).y;
`
const FRAGMENT_PARS = /* glsl */ `
uniform float uSnowline;
varying float vReliefY;
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
