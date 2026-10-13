import { log } from "@guildhall/core"
import { ShaderChunk, Vector4, type WebGLProgramParametersWithUniforms } from "three"

/**
 * The shader half of the sun's cascades (ADR 009), patched into the palette material only. The sun is
 * several directional lights looking the same way: light 0 carries the colour and intensity, the rest
 * are there so three draws and binds their maps (intensity 0). With more than one shadowed directional
 * light, light 0's shadow becomes `cascadeShadow()`: the smallest cascade whose light-space box holds
 * the fragment, blended into the next over the outer tenth of its box. With one shadowed light the
 * stock lookup stays, so the patch changes nothing there.
 *
 * It edits three r186's chunk text, so it checks its anchor and says so when a three upgrade moved it;
 * the material then keeps three's stock per-light shadows (cascade 0 only).
 */

/** How much of a cascade's selection square, from its edge (in map uv), fades into the next one out. */
export const CASCADE_FADE = 0.1

/**
 * The square of each cascade's map the shader selects it for, in the map's uv: centre, half-width,
 * fade width. The whole map (0.5, 0.5, 0.5, CASCADE_FADE) unless the sun says otherwise: a near
 * cascade's map is rendered wider than its square and re-aimed only as the target leaves it
 * (`sun/cascades.ts` MARGIN), so the square moves across the map while the box stands. Shared by
 * every patched material; the sun replaces the array with one entry per cascade.
 */
export const CASCADE_INNER: { value: Vector4[] } = { value: [new Vector4(0.5, 0.5, 0.5, CASCADE_FADE)] }

const FUNCTION = /* glsl */ `
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 1 && defined( SHADOWMAP_TYPE_PCF )
uniform vec4 cascadeInner[ NUM_DIR_LIGHT_SHADOWS ];
// A fixed 3x3 kernel of hardware-filtered taps, spaced shadowRadius texels apart. The stock kernel
// turns per screen pixel, so a soft edge crawls as the view pans; this one answers the same for the
// same world point from any camera.
float cascadeTaps( sampler2DShadow map, vec2 mapSize, float intensity, float bias, float radius, vec4 coord ) {
	vec3 uvz = coord.xyz / coord.w;
	uvz.z += bias;
	vec2 spacing = radius / mapSize;
	float sum = 0.0;
	for ( int y = -1; y <= 1; y ++ ) {
		for ( int x = -1; x <= 1; x ++ ) sum += texture( map, vec3( uvz.xy + vec2( x, y ) * spacing, uvz.z ) );
	}
	return mix( 1.0, sum / 9.0, intensity );
}
float cascadeShadow() {
	float lit = 0.0;
	float rest = 1.0;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
		{
			vec3 box = vDirectionalShadowCoord[ i ].xyz / vDirectionalShadowCoord[ i ].w;
			vec4 inner = cascadeInner[ i ];
			vec2 edge = inner.z - abs( box.xy - inner.xy );
			float weight = ( box.z >= 0.0 && box.z <= 1.0 ) ? smoothstep( 0.0, inner.w, min( edge.x, edge.y ) ) : 0.0;
			if ( weight > 0.0 && rest > 0.0 ) {
				DirectionalLightShadow s = directionalLightShadows[ i ];
				lit += rest * weight * cascadeTaps( directionalShadowMap[ i ], s.shadowMapSize, s.shadowIntensity, s.shadowBias, s.shadowRadius, vDirectionalShadowCoord[ i ] );
				rest *= 1.0 - weight;
			}
		}
	}
	#pragma unroll_loop_end
	return lit + rest;
}
#endif
`

/** The stock directional shadow term in `lights_fragment_begin`. */
const STOCK =
  "directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;"

const CASCADED = `#if NUM_DIR_LIGHT_SHADOWS > 1 && defined( SHADOWMAP_TYPE_PCF )
#if UNROLLED_LOOP_INDEX == 0
directLight.color *= ( directLight.visible && receiveShadow ) ? cascadeShadow() : 1.0;
#endif
#else
${STOCK}
#endif`

const PARS = "#include <shadowmap_pars_fragment>"
const LIGHTS = "#include <lights_fragment_begin>"

const logger = log("render:sun")
let warned = false

/** `onBeforeCompile` for a lit material: its directional shadows read the cascades. */
export function patchCascades(shader: WebGLProgramParametersWithUniforms): void {
  const lighting = ShaderChunk.lights_fragment_begin
  const fragment = shader.fragmentShader
  if (!lighting.includes(STOCK) || !fragment.includes(PARS) || !fragment.includes(LIGHTS)) {
    if (!warned) logger.error("three's shadow chunks moved: the sun keeps one cascade")
    warned = true
    return
  }
  shader.fragmentShader = fragment
    .replace(PARS, () => `${PARS}\n${FUNCTION}`)
    .replace(LIGHTS, () => lighting.replace(STOCK, () => CASCADED))
  shader.uniforms.cascadeInner = CASCADE_INNER
}
