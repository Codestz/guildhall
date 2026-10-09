import type { Material, MeshStandardMaterial, WebGLProgramParametersWithUniforms } from "three"
import { SWATCH, swatchV } from "../../world/gen/relief/swatches.ts"

/**
 * The massifs' snow line: a copy of the land material (same palette, same atlas) that turns faces
 * white above a height, set by one uniform. Faces are flat-shaded, so the snow is a sharp, faceted
 * cap in the kit's own white swatch; it only settles on gentle faces (a wall stays rock), and the
 * line itself is a few units of dither-free blend so a rising line never pops.
 *
 *   `snowline.value` is the world height (units) the cap starts at; 1e4 is no snow. The relief sets it
 *   from `snowlineOf(relief, winter)`, lowered in winter. WebGPU never runs onBeforeCompile: its twin is
 *   snowNodes.ts, fed the same uniform object.
 *
 * A second hook sits here for slice 2e: the dithered cutaway (a capsule from camera to subject,
 * discarded on a Bayer pattern) is another fragment-side uniform block on this same material.
 */

/** A `{ value }` uniform, shared by every material of the relief. */
export interface Snowline {
  value: number
}

/** The line, and how wide its soft edge is, world units. */
export const SNOW_EDGE = 1.4

export const newSnowline = (): Snowline => ({ value: 1e4 })

/** The fragment's blend, GLSL (and its twin in snowNodes.ts): world height and face steepness in, white out. */
export const SNOW_FRAGMENT = /* glsl */ `
float reliefSnow = smoothstep( uSnowline - ${SNOW_EDGE.toFixed(2)}, uSnowline + ${SNOW_EDGE.toFixed(2)}, vReliefY )
	* smoothstep( 0.4, 0.66, vReliefUp );
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
vReliefY = ( modelMatrix * reliefWorld ).y;
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
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", `${VERTEX_PARS}\nvoid main() {`)
      .replace("#include <project_vertex>", `#include <project_vertex>\n${VERTEX}`)
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", `${FRAGMENT_PARS}\nvoid main() {`)
      .replace("#include <map_fragment>", `#include <map_fragment>\n${SNOW_FRAGMENT}`)
  }
  copy.customProgramCacheKey = () => `${key}|snowline`
  return copy
}

/** Makes the snow-line material for a land material: GLSL here, the node twin on WebGPU (snowNodes.ts). */
export type SnowMaker = (base: Material, snowline: Snowline) => Material
