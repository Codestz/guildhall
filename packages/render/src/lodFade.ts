/**
 * LOD transitions without pops, for the static batch (batchMesh.ts). A draw in the batch's multi-draw
 * list is an instance id in the indirect texture; the walk puts a fade code in its top byte and the
 * batch's material (material.ts `batchMaterial`), patched here, reads it:
 *
 *   dither  two levels of detail (a piece's tiers, a cluster's parts and its shell) drawn at once in
 *           complementary pixels of one screen-space pattern, the coarser one taking more of them as
 *           the camera pulls back: a crossfade, never a swap.
 *   shrink  a small piece on its way out of sight drawn smaller and smaller round its own origin,
 *           until it is gone: it never blinks out.
 *
 *   bits 0..23   instance id
 *   bits 24..29  level, 0..FADE_STEPS (a weight)
 *   bit 30       dither: the outgoing side (drawn where the pattern is at or over the weight;
 *                otherwise the incoming side, drawn where it is under)
 *   bit 31       shrink (the level is the scale)
 *
 * Code 0 is drawn whole. The same weight on the two dither sides covers every pixel exactly once.
 * Shadow passes never carry a code.
 */
import { ShaderChunk, type WebGLProgramParametersWithUniforms } from "three"

/** Bits of the indirect texture's value that hold the instance id. */
export const ID_BITS = 24
const ID_MASK = (1 << ID_BITS) - 1
/** Weight steps: a weight is quantised to this many. */
export const FADE_STEPS = 63
const OUT = 1 << 6
const SHRINK = 1 << 7

const level = (w: number) => Math.round(Math.min(1, Math.max(0, w)) * FADE_STEPS)

/** The code of the incoming dither side at weight `w` (0..1); 0 when nothing of it is drawn. */
export function inCode(w: number): number {
  return level(w)
}

/** The code of the outgoing dither side as the other comes in at weight `w`; 0 (whole) at w = 0. */
export function outCode(w: number): number {
  const q = level(w)
  return q === 0 ? 0 : OUT | q
}

/** The code of a piece shrunk to `scale` (0..1); 0 (whole) at full size. */
export function shrinkCode(scale: number): number {
  const q = level(scale)
  return q === FADE_STEPS ? 0 : SHRINK | q
}

/** True when a code draws nothing (an incoming side at weight 0, a piece shrunk to nothing). */
export function drawsNothing(code: number): boolean {
  return code === SHRINK
}

/** True when a code keeps only part of its pixels (a crossfade side): it needs the dither material. */
export function dithers(code: number): boolean {
  return code !== 0 && (code & SHRINK) === 0
}

/** An indirect-texture value: instance `id` with fade `code`. */
export function packDraw(id: number, code: number): number {
  return ((code << ID_BITS) | (id & ID_MASK)) >>> 0
}

/** Whether a pixel whose pattern value is `d` (0..1) is drawn for a dither `code`, as the shader decides. */
export function keeps(code: number, d: number): boolean {
  if (code === 0 || code & SHRINK) return true
  const f = (code & (OUT - 1)) / FADE_STEPS
  return code & OUT ? d >= f : d < f
}

const RETURN = "return float( texelFetch( batchingIdTexture, ivec2( x, y ), 0 ).r );"
const HEAD = "float getIndirectIndex( const in int i ) {"

const PARS = ShaderChunk.batching_pars_vertex
  .replace(RETURN, `return float( texelFetch( batchingIdTexture, ivec2( x, y ), 0 ).r & ${ID_MASK}u );`)
  .replace(
    HEAD,
    /* glsl */ `uint getLodCode( const in int i ) {
		int size = textureSize( batchingIdTexture, 0 ).x;
		return texelFetch( batchingIdTexture, ivec2( i % size, i / size ), 0 ).r >> ${ID_BITS}u;
	}
	${HEAD}`,
  )

/** Per draw: the dither weight, + for the incoming side and - for the outgoing one, 0 for none. */
const VERTEX = /* glsl */ `#include <begin_vertex>
#ifdef USE_BATCHING
{
	uint lodCode = getLodCode( gl_DrawID );
	float lodLevel = float( lodCode & ${OUT - 1}u ) / ${FADE_STEPS}.0;
	if ( ( lodCode & ${SHRINK}u ) != 0u ) transformed *= lodLevel;
	else if ( lodCode != 0u ) vLodFade = ( lodCode & ${OUT}u ) != 0u ? - max( lodLevel, 1e-3 ) : lodLevel;
}
#endif`

const DISCARD = /* glsl */ `#include <clipping_planes_fragment>
if ( vLodFade != 0.0 ) {
	// interleaved gradient noise: an even, fine screen-space pattern
	float lodD = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
	if ( vLodFade > 0.0 ? lodD >= vLodFade : lodD < - vLodFade ) discard;
}`

/**
 * `onBeforeCompile` for the batch's materials: each draw reads its fade code. Only the `dither` one
 * (drawn for the few draws mid-crossfade) discards: a discard anywhere in a program costs the GPU its
 * early depth rejection for every draw of it, so the batch's opaque draws never carry one.
 */
export function patchLodFade(shader: WebGLProgramParametersWithUniforms, dither: boolean): void {
  if (!ShaderChunk.batching_pars_vertex.includes(RETURN) || !ShaderChunk.batching_pars_vertex.includes(HEAD))
    throw new Error("lodFade: three's batching chunk moved")
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nvarying float vLodFade;")
    .replace("#include <batching_pars_vertex>", PARS)
    .replace("#include <begin_vertex>", `vLodFade = 0.0;\n${VERTEX}`)
  shader.fragmentShader = shader.fragmentShader.replace(
    "#include <common>",
    "#include <common>\nvarying float vLodFade;",
  )
  if (dither)
    shader.fragmentShader = shader.fragmentShader.replace("#include <clipping_planes_fragment>", DISCARD)
}
