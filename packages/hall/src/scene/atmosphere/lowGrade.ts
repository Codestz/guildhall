import { ShaderChunk } from "three"

/**
 * The Low tier's colour grade, in the renderer's own tone mapping (no post pass there to grade).
 * Medium and up grade in the post pass (GradeEffect.ts): exposure and saturation, so a storm goes
 * steel-grey. Low only had the exposure (`renderer.toneMappingExposure`), so its storms were darker
 * but still saturated. Here Neutral tone mapping gains a saturation step at no cost: the same
 * Neutral curve (three's NeutralToneMapping, verbatim), then a mix towards luminance.
 *
 * The amount rides in the one uniform the renderer hands every lit material, packed with the
 * exposure: `packed = 4 · round(desaturate · 64) + exposure` (exposure < 4 always; 1/64 steps). The
 * renderer runs CustomToneMapping only on Low (Atmosphere.tsx); with post on, its tone mapping is
 * off and toneMappingExposure stays the plain exposure, so nothing else ever sees a packed value.
 */
export const DESATURATE_STEPS = 64
const SLOT = 4

/** Exposure and a desaturation (0–1) in one number, as the shader unpacks it. Pure. */
export function packExposure(exposure: number, desaturate: number): number {
  const d = desaturate < 0 ? 0 : desaturate > 1 ? 1 : desaturate
  const e = exposure < 0 ? 0 : exposure > SLOT - 0.001 ? SLOT - 0.001 : exposure
  return SLOT * Math.round(d * DESATURATE_STEPS) + e
}

/** The shader's unpacking, in TypeScript (for tests): [exposure, desaturate]. */
export function unpackExposure(packed: number): [number, number] {
  const k = Math.floor(packed / SLOT)
  return [packed - SLOT * k, k / DESATURATE_STEPS]
}

const CUSTOM = /* glsl */ `vec3 CustomToneMapping( vec3 color ) {
	float slot = floor( toneMappingExposure / ${SLOT}.0 );
	float exposure = toneMappingExposure - ${SLOT}.0 * slot;
	float desaturate = slot / ${DESATURATE_STEPS}.0;
	const float StartCompression = 0.8 - 0.04;
	const float Desaturation = 0.15;
	color *= exposure;
	float x = min( color.r, min( color.g, color.b ) );
	float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
	color -= offset;
	float peak = max( color.r, max( color.g, color.b ) );
	if ( peak >= StartCompression ) {
		float d = 1. - StartCompression;
		float newPeak = 1. - d * d / ( peak + d - StartCompression );
		color *= newPeak / peak;
		float g = 1. - 1. / ( Desaturation * ( peak - newPeak ) + 1. );
		color = mix( color, vec3( newPeak ), g );
	}
	return mix( color, vec3( dot( color, vec3( 0.2126, 0.7152, 0.0722 ) ) ), desaturate );
}`

const STOCK = "vec3 CustomToneMapping( vec3 color ) { return color; }"

export function installLowGrade(): void {
  if (ShaderChunk.tonemapping_pars_fragment.includes(STOCK))
    ShaderChunk.tonemapping_pars_fragment = ShaderChunk.tonemapping_pars_fragment.replace(STOCK, CUSTOM)
}
