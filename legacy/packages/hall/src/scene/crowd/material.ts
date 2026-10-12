import {
  type Material,
  MeshDepthMaterial,
  type MeshStandardMaterial,
  type Texture,
  Vector3,
  type WebGLRenderer,
} from "three"
import { isWebGPU } from "../../render/backend.ts"
import { installNodes, TSL } from "../tsl.ts"
import type { BoneBake } from "./bake.ts"

/**
 * The crowd's skinning, in the vertex shader of a stock MeshStandardMaterial (onBeforeCompile): the
 * mesh is a plain InstancedMesh, not a SkinnedMesh, so three's own skinning chunks are empty and
 * these take their place. Everything else — lights, the island's radial fog (atmosphere/fog.ts
 * patches the shared fog chunks, which stay included), instance colours — is the stock material's.
 *
 * Per instance, one attribute: `crowdMember`, whose three texels in the stage texture (`crowdStage`,
 * written by crowd/Crowd.ts once a frame for everyone) say
 *   place  = (x, y, z, yaw)                         where its rig's root stands, which way it faces
 *   frames = (row, blend, row before, blend before) the bake's rows to blend now, in the clip it
 *                                                   plays and in the one it is fading out of
 *   fade   = (in, -, -, -)                          how far the clip has faded in (1: done)
 * so a member's body and everything it holds read one record. What is the same for every vertex
 * of a member — which rows its clips are at — is worked out once a member on the CPU (bake.ts
 * frameAt), in double precision: the shader never sees the clock. Two rows blend by nlerp, as do
 * the two clips. The place is applied in the shader (the mesh's own instance matrices stay
 * identity): a rig's root only ever stands upright and turns about y.
 *
 * `bone` (gear): the mesh rides that one bone whole instead of reading skinIndex/skinWeight.
 * `up` (a levelled grip, scene/grips.ts `upright`: a mug, a staff, a book): the item's own up, in
 * the bind frame. The bone's turn is followed by the shortest turn that points it at the world's up,
 * about the bone's head — keepUpright's levelling, per vertex instead of per frame on the CPU. The
 * rig's root only ever turns about y (instance places), so "up" in the rig's space is the world's.
 *
 * GLSL by default. On WebGPU (which ignores onBeforeCompile) always, and on WebGL with `?tsl=1`
 * (scene/tsl.ts), the same skinning is a TSL node material instead (materialNodes.ts): a crowd is
 * made with the `CrowdShading` its renderer draws (`wantsNodes`, `nodeShading`).
 */

/** Members per row of the stage texture (three texels each). */
export const STAGE_ROW = 64
export const TEXELS_PER_MEMBER = 3

export interface CrowdUniforms {
  crowdBones: { value: Texture }
  /** Every member's place and clips (crowd/Crowd.ts): STAGE_ROW members a row. */
  crowdStage: { value: Texture | null }
  /** Per bone: its bind position, what it turns about. */
  crowdPivots: { value: Vector3[] }
}

export function crowdUniforms(bake: BoneBake): CrowdUniforms {
  return {
    crowdBones: { value: bake.texture },
    crowdStage: { value: null },
    crowdPivots: { value: bake.pivots.map((pivot) => pivot.clone()) },
  }
}

const PARS = /* glsl */ `
uniform highp sampler2D crowdBones;
uniform highp sampler2D crowdStage;
uniform vec3 crowdPivots[ CROWD_BONES ];
attribute float crowdMember;
#ifndef CROWD_BONE
	attribute vec4 skinIndex;
	attribute vec4 skinWeight;
#endif

// A bone's pose: q turns about its pivot, head.xyz is where the pivot is now, head.w its scale.
struct CrowdPose { vec4 q; vec4 head; };

vec4 crowdPlace;
int crowdRowNow;
int crowdRowWas;
float crowdBlendNow;
float crowdBlendWas;
float crowdIn;

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

#ifdef CROWD_UP
// q, then the shortest turn taking the item's up (CROWD_UP, bind frame) to +y.
vec4 crowdLevel( const in vec4 q ) {
	vec3 up = normalize( crowdTurn( q, CROWD_UP ) );
	vec4 level = vec4( - up.z, 0.0, up.x, 1.0 + up.y );
	level = level.w < 1e-4 ? vec4( 1.0, 0.0, 0.0, 0.0 ) : normalize( level );
	return vec4( level.w * q.xyz + q.w * level.xyz + cross( level.xyz, q.xyz ), level.w * q.w - dot( level.xyz, q.xyz ) );
}
#endif

// Texel k of this instance's member in the stage.
vec4 crowdStageAt( const in int k ) {
	int member = int( crowdMember + 0.5 );
	return texelFetch( crowdStage, ivec2( ( member % CROWD_STAGE_ROW ) * 3 + k, member / CROWD_STAGE_ROW ), 0 );
}

// The member's turn about y (crowdPlace.w), as Matrix4.makeRotationY.
vec3 crowdYaw( const in vec3 v ) {
	float c = cos( crowdPlace.w );
	float s = sin( crowdPlace.w );
	return vec3( c * v.x + s * v.z, v.y, c * v.z - s * v.x );
}

vec3 crowdMove( const in CrowdPose pose, const in int bone, const in vec3 p ) {
	return pose.head.xyz + pose.head.w * crowdTurn( pose.q, p - crowdPivots[ bone ] );
}
`

const BASE = /* glsl */ `
	crowdPlace = crowdStageAt( 0 );
	{
		vec4 frames = crowdStageAt( 1 );
		crowdRowNow = int( frames.x + 0.5 );
		crowdBlendNow = frames.y;
		crowdRowWas = int( frames.z + 0.5 );
		crowdBlendWas = frames.w;
		crowdIn = crowdStageAt( 2 ).x;
	}
	#ifdef CROWD_BONE
		CrowdPose crowdPoses[ 1 ];
		crowdPoses[ 0 ] = crowdPose( CROWD_BONE );
		#ifdef CROWD_UP
			crowdPoses[ 0 ].q = crowdLevel( crowdPoses[ 0 ].q );
		#endif
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
		objectNormal = crowdYaw( turned );
	}
`

const POSITION = /* glsl */ `
	{
		vec3 moved = vec3( 0.0 );
		for ( int i = 0; i < crowdInfluences; i ++ )
			if ( crowdWeights[ i ] > 0.0 ) moved += crowdWeights[ i ] * crowdMove( crowdPoses[ i ], crowdJoints[ i ], transformed );
		transformed = crowdYaw( moved ) + crowdPlace.xyz;
	}
`

/**
 * A copy of `base` (its map, colour, roughness…) skinned by the bake. Materials made from the same
 * `uniforms` share the bake and the stage.
 */
export function crowdMaterial(
  base: Material,
  uniforms: CrowdUniforms,
  bone?: number,
  up?: Vector3,
): MeshStandardMaterial {
  const material = base.clone() as MeshStandardMaterial
  if (!(material as MeshStandardMaterial).isMeshStandardMaterial)
    throw new Error(`crowdMaterial: ${base.type} is not a MeshStandardMaterial`)
  material.defines = {
    ...material.defines,
    CROWD_BONES: uniforms.crowdPivots.value.length,
    CROWD_STAGE_ROW: STAGE_ROW,
    ...(bone === undefined ? {} : { CROWD_BONE: bone }),
    ...(bone === undefined || !up ? {} : { CROWD_UP: `vec3( ${glsl(up.x)}, ${glsl(up.y)}, ${glsl(up.z)} )` }),
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
  material.userData.crowdDepth = crowdDepth(material, uniforms)
  return material
}

/**
 * The ground the characters' shadow pass draws (atmosphere/characterShadows.ts): x and z of its
 * centre, then its radius. A member beyond it has no bone weights in the depth shader, so it reads
 * no bone texture and its triangles collapse to a point.
 */
export const castBox: { value: Vector3 } = { value: new Vector3(0, 0, 1e9) }

/** The body material's depth twin, `customDepthMaterial` of its meshes: the same skinning, drawn from the sun. */
function crowdDepth(body: MeshStandardMaterial, uniforms: CrowdUniforms): MeshDepthMaterial {
  const depth = new MeshDepthMaterial()
  depth.defines = { ...body.defines }
  depth.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, { crowdCastBox: castBox })
    shader.vertexShader = shader.vertexShader
      .replace("#include <skinning_pars_vertex>", `uniform vec3 crowdCastBox;\n${PARS}`)
      .replace("#include <skinbase_vertex>", DEPTH_BASE)
      .replace("#include <skinning_vertex>", POSITION)
  }
  depth.customProgramCacheKey = () => "crowd-depth"
  return depth
}

/** BASE, except that a member outside `castBox` gets no weights (and, as gear, no pose read). */
export const DEPTH_BASE = BASE.replace(
  "crowdPlace = crowdStageAt( 0 );",
  "crowdPlace = crowdStageAt( 0 );\n\tbool crowdOut = distance( crowdPlace.xz, crowdCastBox.xy ) > crowdCastBox.z;",
)
  .replace(
    "crowdPoses[ 0 ] = crowdPose( CROWD_BONE );",
    "if ( ! crowdOut ) crowdPoses[ 0 ] = crowdPose( CROWD_BONE );",
  )
  .replace(
    "vec4 crowdWeights = vec4( 1.0, 0.0, 0.0, 0.0 );",
    "vec4 crowdWeights = crowdOut ? vec4( 0.0 ) : vec4( 1.0, 0.0, 0.0, 0.0 );",
  )
  .replace("vec4 crowdWeights = skinWeight;", "vec4 crowdWeights = crowdOut ? vec4( 0.0 ) : skinWeight;")

/** How a crowd's materials are made: the uniforms they share, and a part's skinned material. */
export interface CrowdShading {
  uniforms(bake: BoneBake): CrowdUniforms
  material(base: Material, uniforms: CrowdUniforms, bone?: number, up?: Vector3): Material
}

/** The default: onBeforeCompile on a stock MeshStandardMaterial (above). */
export const GLSL_SHADING: CrowdShading = { uniforms: crowdUniforms, material: crowdMaterial }

/** True when `gl` draws the crowd as node materials: WebGPU always, WebGL with `?tsl=1`. */
export function wantsNodes(gl: object): boolean {
  return isWebGPU(gl) || TSL
}

const nodeShadings = new WeakMap<object, Promise<CrowdShading>>()

/**
 * The node-material shading, once `gl` can draw it (one promise per renderer, for `use`). WebGPU
 * draws node materials natively; WebGL needs the nodes handler first.
 */
export function nodeShading(gl: object): Promise<CrowdShading> {
  let shading = nodeShadings.get(gl)
  if (!shading) {
    const ready = isWebGPU(gl) ? Promise.resolve() : installNodes(gl as WebGLRenderer)
    shading = ready.then(() => import("./materialNodes.ts")).then((nodes) => nodes.NODE_SHADING)
    nodeShadings.set(gl, shading)
  }
  return shading
}

function glsl(value: number): string {
  return value.toFixed(6)
}
