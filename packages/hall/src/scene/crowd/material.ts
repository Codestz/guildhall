import { type Material, type MeshStandardMaterial, type Texture, type Vector3, Vector4 } from "three"
import type { BoneBake } from "./bake.ts"

/**
 * The crowd's skinning, in the vertex shader of a stock MeshStandardMaterial (onBeforeCompile): the
 * mesh is a plain InstancedMesh, not a SkinnedMesh, so three's own skinning chunks are empty and
 * these take their place. Everything else — lights, the island's radial fog (atmosphere/fog.ts
 * patches the shared fog chunks, which stay included), instance colours — is the stock material's.
 *
 * Per instance (InstancedBufferAttributes, written only when a clip changes):
 *   crowdNow = (clip, start, speed)   what it plays: started at `start` on the crowd clock
 *   crowdWas = (clip, start, speed)   what it played before; faded out over `crowdFade` s from `start`
 * The clip's rows come from the bake (bake.ts); two rows blend by nlerp, as do the two clips.
 *
 * `bone` (gear): the mesh rides that one bone whole instead of reading skinIndex/skinWeight.
 */

export interface CrowdUniforms {
  crowdBones: { value: Texture }
  /** The crowd clock, seconds: the one number written per frame for the whole crowd. */
  crowdTime: { value: number }
  /** Seconds a clip change takes to blend in (0: cut). */
  crowdFade: { value: number }
  /** Per clip: first row, rows, duration, loops (1/0). */
  crowdClips: { value: Vector4[] }
  /** Per bone: its bind position, what it turns about. */
  crowdPivots: { value: Vector3[] }
}

export function crowdUniforms(bake: BoneBake, fade: number): CrowdUniforms {
  return {
    crowdBones: { value: bake.texture },
    crowdTime: { value: 0 },
    crowdFade: { value: fade },
    crowdClips: { value: bake.clips.map((c) => new Vector4(c.row, c.frames, c.duration, c.loop ? 1 : 0)) },
    crowdPivots: { value: bake.pivots.map((pivot) => pivot.clone()) },
  }
}

const PARS = /* glsl */ `
uniform highp sampler2D crowdBones;
uniform float crowdTime;
uniform float crowdFade;
uniform vec4 crowdClips[ CROWD_CLIPS ];
uniform vec3 crowdPivots[ CROWD_BONES ];
attribute vec3 crowdNow;
attribute vec3 crowdWas;
#ifndef CROWD_BONE
	attribute vec4 skinIndex;
	attribute vec4 skinWeight;
#endif

// A bone's pose: q turns about its pivot, head.xyz is where the pivot is now, head.w its scale.
struct CrowdPose { vec4 q; vec4 head; };

int crowdRowNow;
int crowdRowWas;
float crowdBlendNow;
float crowdBlendWas;
float crowdIn;

// The two rows of a clip to blend at its time, and how far (bake.ts frameAt).
void crowdFrame( const in vec3 play, out int row, out float blend ) {
	vec4 clip = crowdClips[ int( play.x ) ];
	float u = ( crowdTime - play.y ) * play.z / clip.z;
	u = clip.w > 0.5 ? fract( u ) : clamp( u, 0.0, 1.0 );
	float x = u * ( clip.y - 1.0 );
	float first = min( floor( x ), clip.y - 2.0 );
	row = int( clip.x + first );
	blend = x - first;
}

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
	CrowdPose pose = crowdMix( crowdRead( crowdRowNow, bone ), crowdRead( crowdRowNow + 1, bone ), crowdBlendNow );
	if ( crowdIn < 1.0 ) {
		CrowdPose was = crowdMix( crowdRead( crowdRowWas, bone ), crowdRead( crowdRowWas + 1, bone ), crowdBlendWas );
		pose = crowdMix( was, pose, crowdIn );
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

const BASE = /* glsl */ `
	crowdFrame( crowdNow, crowdRowNow, crowdBlendNow );
	crowdIn = crowdFade > 0.0 ? clamp( ( crowdTime - crowdNow.y ) / crowdFade, 0.0, 1.0 ) : 1.0;
	if ( crowdIn < 1.0 ) crowdFrame( crowdWas, crowdRowWas, crowdBlendWas );
	#ifdef CROWD_BONE
		CrowdPose crowdPoses[ 1 ];
		crowdPoses[ 0 ] = crowdPose( CROWD_BONE );
		ivec4 crowdJoints = ivec4( CROWD_BONE, 0, 0, 0 );
		vec4 crowdWeights = vec4( 1.0, 0.0, 0.0, 0.0 );
		const int crowdInfluences = 1;
	#else
		CrowdPose crowdPoses[ 4 ];
		ivec4 crowdJoints = ivec4( skinIndex );
		vec4 crowdWeights = skinWeight;
		const int crowdInfluences = 4;
		for ( int i = 0; i < 4; i ++ ) if ( crowdWeights[ i ] > 0.0 ) crowdPoses[ i ] = crowdPose( crowdJoints[ i ] );
	#endif
`

const NORMAL = /* glsl */ `
	{
		vec3 turned = vec3( 0.0 );
		for ( int i = 0; i < crowdInfluences; i ++ )
			if ( crowdWeights[ i ] > 0.0 ) turned += crowdWeights[ i ] * crowdTurn( crowdPoses[ i ].q, objectNormal );
		objectNormal = turned;
	}
`

const POSITION = /* glsl */ `
	{
		vec3 moved = vec3( 0.0 );
		for ( int i = 0; i < crowdInfluences; i ++ )
			if ( crowdWeights[ i ] > 0.0 ) moved += crowdWeights[ i ] * crowdMove( crowdPoses[ i ], crowdJoints[ i ], transformed );
		transformed = moved;
	}
`

/**
 * A copy of `base` (its map, colour, roughness…) skinned by the bake. Materials made from the same
 * `uniforms` share the clock, the texture and the clip table.
 */
export function crowdMaterial(base: Material, uniforms: CrowdUniforms, bone?: number): MeshStandardMaterial {
  const material = base.clone() as MeshStandardMaterial
  if (!(material as MeshStandardMaterial).isMeshStandardMaterial)
    throw new Error(`crowdMaterial: ${base.type} is not a MeshStandardMaterial`)
  material.defines = {
    ...material.defines,
    CROWD_CLIPS: uniforms.crowdClips.value.length,
    CROWD_BONES: uniforms.crowdPivots.value.length,
    ...(bone === undefined ? {} : { CROWD_BONE: bone }),
  }
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace("#include <skinning_pars_vertex>", PARS)
      .replace("#include <skinbase_vertex>", BASE)
      .replace("#include <skinnormal_vertex>", NORMAL)
      .replace("#include <skinning_vertex>", POSITION)
  }
  material.customProgramCacheKey = () => "crowd"
  return material
}
