/**
 * The clouds on the GPU: every puff of every cloud is one instance of one faceted icosahedron, so the
 * whole sky is one draw call. Instances never change on the CPU: each carries its cloud's start, base
 * height and coverage threshold, and the vertex shader drifts it with the wind (wrapping round the
 * field), grows it in with coverage, flattens its base and fades it off the hero view. The same
 * instance data, drawn as soft discs, paints the mask (two more draws into a small target): its R
 * channel is the shadows cast along the sun onto the ground, its G channel the clouds' own footprint,
 * which the water mirrors.
 */
import {
  type BufferGeometry,
  Color,
  CustomBlending,
  DoubleSide,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  MaxEquation,
  PlaneGeometry,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderTarget,
} from "three"
import type { Cloud } from "./field.ts"
import { ATMOSPHERE } from "./shade.ts"

/** The puff mesh: an icosahedron split once, so it reads round but every face shows. */
const DETAIL = 1
/** The cloud-shadow mask's resolution, texels a side. */
export const MASK_SIZE = 512

/** Uniforms both the cloud mesh and the mask read: where the field is and how far it has drifted. */
export function fieldUniforms() {
  return {
    uDrift: { value: new Vector2() },
    uSpan: { value: 400 },
    uCentre: { value: new Vector2() },
    uSwell: { value: 20 },
    uCoverage: { value: 0.4 },
    uEye: { value: new Vector3() },
    uTarget: { value: new Vector3() },
    uEyeDistance: { value: 200 },
    uFocus: { value: 1 },
  }
}
export type FieldUniforms = ReturnType<typeof fieldUniforms>

const FIELD = /* glsl */ `
uniform vec2 uDrift;
uniform float uSpan;
uniform vec2 uCentre;
uniform float uSwell;
uniform float uCoverage;
uniform vec3 uEye;
uniform vec3 uTarget;
uniform float uEyeDistance;
uniform float uFocus;
attribute vec4 aPuff;
attribute vec4 aCloud;
// The cloud's centre relative to the field's, after drifting and wrapping.
vec2 cloudLocal() {
	return mod( aCloud.xy + uDrift + uSpan, 2.0 * uSpan ) - uSpan;
}
// Out with coverage, and gone before it reaches the wrap so it never pops across.
float cloudPresence( vec2 local ) {
	float edge = 1.0 - smoothstep( 0.8 * uSpan, 0.97 * uSpan, max( abs( local.x ), abs( local.y ) ) );
	return edge * smoothstep( aCloud.w - 0.02, aCloud.w + 0.1, uCoverage );
}
vec3 cloudCentre( vec2 local ) {
	return vec3( local.x + uCentre.x, aCloud.z + 0.4 * uSwell, local.y + uCentre.y );
}
// field.ts viewFade (uEyeDistance is the capped reach): off near the eye and off the focus.
float cloudView( vec3 centre ) {
	float near = smoothstep( 0.55 * uEyeDistance, 0.95 * uEyeDistance, distance( centre, uEye ) );
	float clear = smoothstep( 0.35 * uEyeDistance, 0.75 * uEyeDistance, distance( centre.xz, uTarget.xz ) );
	return near * mix( 1.0, clear, uFocus );
}
`

const MESH_VERTEX = /* glsl */ `
${FIELD}
varying vec3 vWorld;
varying float vFade;
void main() {
	vec2 local = cloudLocal();
	float presence = cloudPresence( local );
	vec3 centre = cloudCentre( local );
	// Coverage grows a cloud in from nothing (no see-through stipple); only the view fade dissolves.
	float grow = smoothstep( 0.0, 1.0, presence );
	vec3 world = centre + ( aPuff.xyz * uSwell + position * vec3( 1.0, 0.74, 1.0 ) * aPuff.w * uSwell ) * grow;
	world.y = max( world.y, aCloud.z );
	vFade = step( 0.02, grow ) * cloudView( centre );
	vWorld = world;
	gl_Position = projectionMatrix * viewMatrix * vec4( world, 1.0 );
	if ( vFade < 0.01 ) gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
}
`

const MESH_FRAGMENT = /* glsl */ `
uniform vec3 uLit;
uniform vec3 uShade;
uniform vec3 uSun;
uniform vec3 uHaze;
uniform vec2 uHazeRange;
varying vec3 vWorld;
varying float vFade;
void main() {
	// Flat faces from the screen derivatives: the facets read, and the flattened base is one plane.
	vec3 n = normalize( cross( dFdx( vWorld ), dFdy( vWorld ) ) );
	vec3 toEye = cameraPosition - vWorld;
	if ( dot( n, toEye ) < 0.0 ) n = -n;
	float lit = smoothstep( -0.2, 0.55, dot( n, uSun ) );
	float up = 0.6 + 0.4 * clamp( n.y, 0.0, 1.0 );
	vec3 colour = mix( uShade, uLit, lit * up );
	colour = mix( colour, uShade * 0.94, smoothstep( -0.8, -0.95, n.y ) );
	colour = mix( colour, uHaze, 0.55 * smoothstep( uHazeRange.x, uHazeRange.y, length( toEye ) ) );
	gl_FragColor = vec4( colour, vFade );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}
`

const MASK_VERTEX = /* glsl */ `
${FIELD}
uniform float uProject;
uniform vec2 uSlant;
uniform vec2 uHeading;
uniform float uStretch;
uniform vec4 uWindow;
varying vec2 vCorner;
varying float vValue;
void main() {
	vec2 local = cloudLocal();
	float presence = cloudPresence( local );
	vec3 centre = cloudCentre( local );
	vec3 puff = centre + aPuff.xyz * uSwell;
	float r = 1.3 * aPuff.w * uSwell * mix( 0.4, 1.0, presence );
	vec2 xz = puff.xz - uProject * uSlant * puff.y;
	vec2 across = vec2( -uHeading.y, uHeading.x );
	float stretch = mix( 1.0, uStretch, uProject );
	vec2 p = xz + ( uHeading * position.x * stretch + across * position.z ) * r;
	vCorner = position.xz;
	vValue = presence * mix( cloudView( centre ), 1.0, uProject );
	gl_Position = vec4( ( p - uWindow.xy ) * uWindow.zw * 2.0 - 1.0, 0.0, 1.0 );
}
`

const MASK_FRAGMENT = /* glsl */ `
uniform float uProject;
varying vec2 vCorner;
varying float vValue;
void main() {
	float v = vValue * ( 1.0 - smoothstep( 0.1, 1.0, length( vCorner ) ) );
	gl_FragColor = vec4( v * uProject, v * ( 1.0 - uProject ), 0.0, 1.0 );
}
`

/** Per-puff instance data: `aPuff` (offset × size, radius × size) and `aCloud` (x, z, base, threshold). */
export function puffAttributes(clouds: readonly Cloud[]) {
  const count = clouds.reduce((n, c) => n + c.puffs.length, 0)
  const puff = new Float32Array(count * 4)
  const cloud = new Float32Array(count * 4)
  let i = 0
  for (const c of clouds) {
    const cos = Math.cos(c.turn)
    const sin = Math.sin(c.turn)
    for (const p of c.puffs) {
      puff.set(
        [(p.x * cos - p.z * sin) * c.size, p.y * c.size, (p.x * sin + p.z * cos) * c.size, p.r * c.size],
        4 * i,
      )
      cloud.set([c.x, c.z, c.base, c.threshold], 4 * i)
      i++
    }
  }
  return { count, puff: new InstancedBufferAttribute(puff, 4), cloud: new InstancedBufferAttribute(cloud, 4) }
}

function instanced(geometry: BufferGeometry, material: ShaderMaterial, a: ReturnType<typeof puffAttributes>) {
  geometry.setAttribute("aPuff", a.puff)
  geometry.setAttribute("aCloud", a.cloud)
  const mesh = new InstancedMesh(geometry, material, a.count)
  mesh.frustumCulled = false
  mesh.castShadow = false
  mesh.receiveShadow = false
  return mesh
}

/** The clouds' mesh: one draw; its colours are set per hour by the atmosphere. */
export function cloudMesh(a: ReturnType<typeof puffAttributes>, field: FieldUniforms) {
  const uniforms = {
    ...field,
    uLit: { value: new Color() },
    uShade: { value: new Color() },
    uSun: { value: new Vector3(0, 1, 0) },
    uHaze: { value: new Color() },
    uHazeRange: { value: new Vector2(600, 1600) },
  }
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: MESH_VERTEX,
    fragmentShader: MESH_FRAGMENT,
    // MSAA turns the fade into coverage: no sorting, no see-through puffs inside a cloud.
    alphaToCoverage: true,
    fog: false,
  })
  const mesh = instanced(new IcosahedronGeometry(1, DETAIL), material, a)
  mesh.name = "clouds"
  mesh.renderOrder = 10
  return { mesh, uniforms }
}

/** The mask's two layers (shadow R, footprint G), max-blended into a small target. */
export function cloudMask(a: ReturnType<typeof puffAttributes>, field: FieldUniforms) {
  const target = new WebGLRenderTarget(MASK_SIZE, MASK_SIZE, {
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    depthBuffer: false,
  })
  const shared = {
    uSlant: { value: new Vector2() },
    uHeading: { value: new Vector2(1, 0) },
    uStretch: { value: 1 },
    uWindow: ATMOSPHERE.uCloudWindow,
  }
  const layer = (project: number) => {
    const material = new ShaderMaterial({
      uniforms: { ...field, ...shared, uProject: { value: project } },
      vertexShader: MASK_VERTEX,
      fragmentShader: MASK_FRAGMENT,
      blending: CustomBlending,
      blendEquation: MaxEquation,
      depthTest: false,
      depthWrite: false,
      // The quads are mapped straight to the mask (x → x, z → y): either winding.
      side: DoubleSide,
    })
    const geometry = new PlaneGeometry(2, 2).rotateX(-Math.PI / 2)
    return instanced(geometry, material, a)
  }
  return { target, uniforms: shared, layers: [layer(1), layer(0)] as const }
}
