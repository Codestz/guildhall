import { ShaderChunk } from "three"

/**
 * The shader half of cascaded shadows (cascades.ts). The key light is several directional lights
 * that look the same way: the first carries the colour and intensity, the rest are there only so
 * three draws and binds their shadow maps (intensity 0, and the lighting below skips them). When a
 * program has more than one shadowed directional light, the stock lookups are replaced by
 * `getCascadedShadow()`: the tightest map that holds the pixel, blended into the next over its
 * outer edge. With one shadowed light (the hand island, the labs, Low) the stock lines stay: the
 * patch changes nothing there.
 *
 * Every built-in lit material takes its shadow from `lights_fragment_begin`; the island's own
 * shaders (grass, water, rivers) from `getShadowMask()` — both are patched. Like the radial fog
 * (fog.ts) this edits three's chunk text, so it checks each anchor and says so when one is gone
 * (a three upgrade): `installCascadeChunks()` then returns false and the scene keeps one map.
 */

/** How much of a map's width, from its edge, blends into the next one out. */
export const FADE = 0.12

const FUNCTION = /* glsl */ `
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 1
#if defined( SHADOWMAP_TYPE_PCF )
// A far cascade's texels are coarse already: one hardware-filtered tap (four texels) is enough, and
// costs a fifth of the stock five-tap disc the near cascade keeps.
float getFarShadow( sampler2DShadow map, float intensity, float bias, vec4 coord ) {
	vec3 uvz = coord.xyz / coord.w;
	uvz.z += bias;
	return mix( 1.0, texture( map, uvz ), intensity );
}
#endif
float getCascadedShadow() {
	float lit = 0.0;
	float rest = 1.0;
	DirectionalLightShadow cascade;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
		if ( rest > 0.001 ) {
			vec3 coord = vDirectionalShadowCoord[ i ].xyz / vDirectionalShadowCoord[ i ].w;
			vec2 edge = min( coord.xy, 1.0 - coord.xy );
			float weight = ( coord.z >= 0.0 && coord.z <= 1.0 ) ? smoothstep( 0.0, ${FADE.toFixed(2)}, min( edge.x, edge.y ) ) : 0.0;
			if ( weight > 0.0 ) {
				cascade = directionalLightShadows[ i ];
				#if defined( SHADOWMAP_TYPE_PCF ) && UNROLLED_LOOP_INDEX > 0
				lit += rest * weight * getFarShadow( directionalShadowMap[ i ], cascade.shadowIntensity, cascade.shadowBias, vDirectionalShadowCoord[ i ] );
				#else
				lit += rest * weight * getShadow( directionalShadowMap[ i ], cascade.shadowMapSize, cascade.shadowIntensity, cascade.shadowBias, cascade.shadowRadius, vDirectionalShadowCoord[ i ] );
				#endif
				rest *= 1.0 - weight;
			}
		}
	}
	#pragma unroll_loop_end
	return lit + rest;
}
#endif
`

/** The stock directional shadow term in `lights_fragment_begin`, and in `getShadowMask`. */
const LIGHT_SHADOW =
  "directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;"
const MASK_SHADOW =
  "shadow *= receiveShadow ? getShadow( directionalShadowMap[ i ], directionalLight.shadowMapSize, directionalLight.shadowIntensity, directionalLight.shadowBias, directionalLight.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;"
const DIR_BLOCK = "#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )"
const DIRECT =
  "RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );"

/** The chunk with `from` swapped for `to`, or null when `from` is not in it. */
function swap(chunk: string, from: string, to: string): string | null {
  return chunk.includes(from) ? chunk.replace(from, () => to) : null
}

let installed: boolean | undefined

/** Teach the lit materials and the island's shaders to read cascades. Once; false when three's chunks have moved. */
export function installCascadeChunks(): boolean {
  if (installed !== undefined) return installed
  installed = false
  const pars = ShaderChunk.shadowmap_pars_fragment
  const mask = swap(ShaderChunk.shadowmask_pars_fragment, MASK_SHADOW, cascadeOr("shadow *= ", MASK_SHADOW))
  const lighting = ShaderChunk.lights_fragment_begin
  const at = lighting.indexOf(DIR_BLOCK)
  if (at < 0) return false
  const head = lighting.slice(0, at)
  const block = lighting.slice(at)
  // Light 0 takes the cascaded shadow; the others (same direction, intensity 0) are not lit at all.
  const shadowed = swap(
    block,
    LIGHT_SHADOW,
    `#if NUM_DIR_LIGHT_SHADOWS > 1\n#if UNROLLED_LOOP_INDEX == 0\ndirectLight.color *= ( directLight.visible && receiveShadow ) ? getCascadedShadow() : 1.0;\n#endif\n#else\n${LIGHT_SHADOW}\n#endif`,
  )
  const skipped =
    shadowed &&
    swap(
      shadowed,
      DIRECT,
      `#if NUM_DIR_LIGHT_SHADOWS < 2 || UNROLLED_LOOP_INDEX == 0 || UNROLLED_LOOP_INDEX >= NUM_DIR_LIGHT_SHADOWS\n${DIRECT}\n#endif`,
    )
  if (!mask || !skipped) return false
  ShaderChunk.shadowmap_pars_fragment = pars + FUNCTION
  ShaderChunk.shadowmask_pars_fragment = mask
  ShaderChunk.lights_fragment_begin = head + skipped
  installed = true
  return true
}

/** `getShadowMask`'s line for cascades: light 0 reads them all, the rest add nothing. */
function cascadeOr(lead: string, stock: string): string {
  return `#if NUM_DIR_LIGHT_SHADOWS > 1\n#if UNROLLED_LOOP_INDEX == 0\n${lead}receiveShadow ? getCascadedShadow() : 1.0;\n#endif\n#else\n${stock}\n#endif`
}
