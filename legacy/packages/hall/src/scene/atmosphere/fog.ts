import { ShaderChunk } from "three"

/**
 * Island fog (ADR 0007, task "Sky"). Three's fog is by depth from the camera, which can't work
 * for the Diorama: an orthographic camera sits a fixed 220 units away, and what should fade is the
 * *edge of the island*, not whatever is far from the lens. So the linear fog here is radial — by
 * horizontal distance from the island's centre — and `scene.fog`'s near / far are radii. Every
 * built-in material (and any ShaderMaterial that includes the fog chunks) gets it; the coast and
 * the sea fade into the sky dome's horizon, whatever the view.
 *
 * Custom shaders: include `<fog_pars_vertex>` / `<fog_vertex>` after `mvPosition` is computed, as
 * the built-in ones do. FogExp2 still works the stock (depth) way.
 */
export function installRadialFog(): void {
  ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
	varying float vFogDepth;
	varying vec2 vFogWorld;
#endif
`
  ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
	// World position from view space: inverse(view) = transpose(R) * (p - t), view = [R | t].
	vFogWorld = ( ( mvPosition.xyz - viewMatrix[ 3 ].xyz ) * mat3( viewMatrix ) ).xz;
#endif
`
  ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	varying vec2 vFogWorld;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif
`
  ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, length( vFogWorld ) );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif
`
}
