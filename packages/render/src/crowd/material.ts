/**
 * The crowd's skinning and tint, patched into a copy of the palette material (V1's crowd/material.ts,
 * moved onto a BatchedMesh). The bodies are one BatchedMesh, not SkinnedMeshes, so three's skinning
 * chunks are empty and these take their place; everything else (the sun's cascades, cloud shade, the
 * night grade, fog) is the palette material's own patches.
 *
 * Per instance (three's `getIndirectIndex(gl_DrawID)`, the BatchedMesh instance id), two texels of the
 * people texture (`crowdPeople`, written by crowd.ts once a frame):
 *   0 = (row, blend, row before, blend before)  the bake's rows to blend now, in the clip it plays and
 *                                               in the one it is fading out of
 *   1 = (fade, hidden parts mask, outfit row, -)
 * The batching matrix places the person (feet, heading, height); the shader works in rig space.
 */
import type { MeshStandardMaterial, Texture, Vector3 } from "three"
import { patchCloudShade } from "../atmosphere/shade.ts"
import { paletteMaterial } from "../material.ts"
import { patchGlow } from "../night/glow.ts"
import { patchCascades } from "../sun/patch.ts"
import type { BoneBake } from "./bake.ts"

/** People per row of the people texture (two texels each). */
export const PEOPLE_ROW = 512
export const TEXELS_PER_PERSON = 2

export interface CrowdUniforms {
  crowdBones: { value: Texture }
  crowdPeople: { value: Texture | null }
  crowdTint: { value: Texture }
  crowdOutfits: { value: Texture | null }
  crowdPivots: { value: Vector3[] }
}

export function crowdUniforms(bake: BoneBake, tint: Texture): CrowdUniforms {
  return {
    crowdBones: { value: bake.texture },
    crowdPeople: { value: null },
    crowdTint: { value: tint },
    crowdOutfits: { value: null },
    crowdPivots: { value: bake.pivots.map((pivot) => pivot.clone()) },
  }
}

const PARS = /* glsl */ `
uniform highp sampler2D crowdBones;
uniform highp sampler2D crowdPeople;
uniform highp sampler2D crowdTint;
uniform highp sampler2D crowdOutfits;
uniform vec3 crowdPivots[ CROWD_BONES ];
attribute vec4 skinIndex;
attribute vec4 skinWeight;
attribute float _swatch;
attribute float _shade;
attribute float _part;

// A bone's pose: q turns about its pivot, head.xyz is where the pivot is now, head.w its scale.
struct CrowdPose { vec4 q; vec4 head; };

vec4 crowdNow;
vec4 crowdMore;

CrowdPose crowdRead( const in int row, const in int bone ) {
	return CrowdPose(
		texelFetch( crowdBones, ivec2( bone * 2, row ), 0 ),
		texelFetch( crowdBones, ivec2( bone * 2 + 1, row ), 0 )
	);
}

// nlerp's blend (normalised once, at the end): the short way round, even across two clips.
CrowdPose crowdMix( const in CrowdPose a, const in CrowdPose b, const in float t ) {
	vec4 q = dot( a.q, b.q ) < 0.0 ? - b.q : b.q;
	return CrowdPose( mix( a.q, q, t ), mix( a.head, b.head, t ) );
}

CrowdPose crowdPose( const in int bone ) {
	int row = int( crowdNow.x + 0.5 );
	CrowdPose pose = crowdMix( crowdRead( row, bone ), crowdRead( row + 1, bone ), crowdNow.y );
	if ( crowdMore.x < 1.0 ) {
		int was = int( crowdNow.z + 0.5 );
		CrowdPose before = crowdMix( crowdRead( was, bone ), crowdRead( was + 1, bone ), crowdNow.w );
		pose = crowdMix( before, pose, crowdMore.x );
	}
	pose.q = normalize( pose.q );
	return pose;
}

vec3 crowdTurn( const in vec4 q, const in vec3 v ) {
	return v + 2.0 * cross( q.xyz, cross( q.xyz, v ) + q.w * v );
}

vec3 crowdMove( const in CrowdPose pose, const in int bone, const in vec3 p ) {
	return pose.head.xyz + pose.head.w * crowdTurn( pose.q, p - crowdPivots[ bone ] );
}
`

/** First in main(): who this vertex belongs to, and its outfit's colour (replaces color_vertex). */
const COLOUR = /* glsl */ `
	{
		int person = int( getIndirectIndex( gl_DrawID ) );
		int x = ( person % ${PEOPLE_ROW} ) * ${TEXELS_PER_PERSON};
		int y = person / ${PEOPLE_ROW};
		crowdNow = texelFetch( crowdPeople, ivec2( x, y ), 0 );
		crowdMore = texelFetch( crowdPeople, ivec2( x + 1, y ), 0 );
		int worn = int( texelFetch( crowdOutfits, ivec2( int( _swatch + 0.5 ), int( crowdMore.z + 0.5 ) ), 0 ).r * 255.0 + 0.5 );
		vColor = vec4( texelFetch( crowdTint, ivec2( int( _shade * 255.0 + 0.5 ), worn ), 0 ).rgb, 1.0 );
	}
`

const BASE = /* glsl */ `
	// A hidden part (its bit set in the mask) has no weights: every vertex of it collapses to the origin.
	// In integers: exp2() is not exact on every GPU, and a float divide by it misreads the bits.
	bool crowdShown = ( ( int( crowdMore.y + 0.5 ) >> int( _part + 0.5 ) ) & 1 ) == 0;
	CrowdPose crowdPoses[ 4 ];
	ivec4 crowdJoints = ivec4( skinIndex );
	vec4 crowdWeights = crowdShown ? skinWeight : vec4( 0.0 );
	for ( int i = 0; i < 4; i ++ ) if ( crowdWeights[ i ] > 0.0 ) crowdPoses[ i ] = crowdPose( crowdJoints[ i ] );
`

const NORMAL = /* glsl */ `
	{
		vec3 turned = vec3( 0.0 );
		for ( int i = 0; i < 4; i ++ )
			if ( crowdWeights[ i ] > 0.0 ) turned += crowdWeights[ i ] * crowdTurn( crowdPoses[ i ].q, objectNormal );
		objectNormal = turned;
	}
`

const POSITION = /* glsl */ `
	{
		vec3 moved = vec3( 0.0 );
		for ( int i = 0; i < 4; i ++ )
			if ( crowdWeights[ i ] > 0.0 ) moved += crowdWeights[ i ] * crowdMove( crowdPoses[ i ], crowdJoints[ i ], transformed );
		transformed = moved;
	}
`

/** The anchors the patch replaces; a three upgrade that moves one fails loudly here, not silently on screen. */
const ANCHORS = [
  "#include <skinning_pars_vertex>",
  "#include <color_vertex>",
  "#include <skinbase_vertex>",
  "#include <skinnormal_vertex>",
  "#include <skinning_vertex>",
]

/**
 * A copy of the palette material skinned by the bake and tinted per person, for the crowd's
 * BatchedMesh. Materials made from the same `uniforms` share the bake and the people texture.
 */
export function crowdMaterial(uniforms: CrowdUniforms): MeshStandardMaterial {
  const material = paletteMaterial().clone()
  material.defines = { ...material.defines, CROWD_BONES: uniforms.crowdPivots.value.length }
  material.onBeforeCompile = (shader) => {
    for (const anchor of ANCHORS)
      if (!shader.vertexShader.includes(anchor)) throw new Error(`crowdMaterial: three moved ${anchor}`)
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace("#include <skinning_pars_vertex>", PARS)
      .replace("#include <color_vertex>", COLOUR)
      .replace("#include <skinbase_vertex>", BASE)
      .replace("#include <skinnormal_vertex>", NORMAL)
      .replace("#include <skinning_vertex>", POSITION)
    patchCascades(shader)
    patchCloudShade(shader)
    patchGlow(shader)
  }
  material.customProgramCacheKey = () => "crowd"
  return material
}
