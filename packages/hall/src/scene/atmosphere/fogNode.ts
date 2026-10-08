import type { Fog } from "three"
import { fog, positionWorld, reference, smoothstep } from "three/tsl"
import type { Node } from "three/webgpu"

/**
 * The island's radial fog (fog.ts) for node materials. Node materials never read `ShaderChunk`, so
 * the chunk patch that fogs every built-in material doesn't reach them: this is the same fog as a
 * TSL node — linear, by horizontal distance from the island's centre, `near` / `far` as radii.
 *
 * On WebGLRenderer the nodes handler (scene/tsl.ts) hands it to every node material with
 * `fog: true`; on WebGPURenderer it is `scene.fogNode = radialFog(scene.fog)`.
 */
export function radialFogFactor(near: Node<"float"> | number, far: Node<"float"> | number): Node<"float"> {
  return smoothstep(near, far, positionWorld.xz.length())
}

/** `scene.fog` as a radial fog node. Reads the fog's colour, near and far live (no rebuild). */
export function radialFog(sceneFog: Fog): Node<"vec4"> {
  const color = reference("color", "color", sceneFog)
  const near = reference("near", "float", sceneFog)
  const far = reference("far", "float", sceneFog)
  return fog(color, radialFogFactor(near, far))
}
