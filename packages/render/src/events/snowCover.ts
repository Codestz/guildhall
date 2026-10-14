/**
 * The ground under the weather, in the shader: a light white dusting on what faces up (the terraces,
 * the roofs, the tops of the trees) and a subtle darkening when it is wet. One pair of uniforms shared
 * by every program that opts in (`patchSnowCover`: the palette and batch materials and the ground), so
 * the drive moves them once a frame and no geometry changes. At 0 and 0 a program draws as it did.
 * The dusting fills in patchily as `uSnow` rises (some faces whiten before others) and recedes the
 * same way as it melts, so a 20 s ease reads as snow settling and going, not as a fade.
 */
import type { WebGLProgramParametersWithUniforms } from "three"

export const SNOW_COVER = {
  /** The dusting, 0 … 1 (eased by the drive over ~20 s). */
  uSnow: { value: 0 },
  /** The wet ground, 0 … 1. */
  uWet: { value: 0 },
}

const PARS = /* glsl */ `
uniform float uSnow;
uniform float uWet;
`

const COVER = /* glsl */ `
if ( uSnow > 0.0 || uWet > 0.0 ) {
	vec3 coverN = inverseTransformDirection( normal, viewMatrix );
	diffuseColor.rgb *= 1.0 - 0.2 * uWet;
	if ( uSnow > 0.0 ) {
		float up = smoothstep( 0.5, 0.82, coverN.y );
		vec2 w = vCloudWorld.xz;
		float p = 0.5 + 0.25 * sin( w.x * 0.9 + sin( w.y * 0.5 ) ) * sin( w.y * 1.1 + 1.3 )
			+ 0.25 * sin( w.x * 2.3 + w.y * 1.7 );
		float fill = clamp( ( uSnow * 1.5 - ( 1.0 - p ) ) * 3.0, 0.0, 1.0 );
		diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.93, 0.96, 1.0 ), 0.7 * up * fill );
	}
}`

const ANCHOR = "#include <normal_fragment_maps>"

/** `onBeforeCompile` for a lit material, after `patchCloudShade` (which passes the world position). */
export function patchSnowCover(shader: WebGLProgramParametersWithUniforms): void {
  if (!shader.fragmentShader.includes(ANCHOR) || !shader.fragmentShader.includes("vCloudWorld")) return
  Object.assign(shader.uniforms, SNOW_COVER)
  shader.fragmentShader = shader.fragmentShader
    .replace("void main() {", () => `${PARS}\nvoid main() {`)
    .replace(ANCHOR, () => `${ANCHOR}\n${COVER}`)
}
