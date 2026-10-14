/**
 * A ready-made triangle mesh (positions + sRGB vertex colours, flat-shaded) in the palette material, so it
 * takes the cascaded sun like every placed piece: what a world builder hands render as plain arrays.
 * `{ speckle: true }` draws it in the ground material instead: the same light, plus clover and drifts of
 * small flowers dotted over the green from a cheap world-space hash (no textures, the low-poly feel kept).
 */
import { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial } from "three"
import { patchCloudShade } from "./atmosphere/shade.ts"
import { patchSnowCover } from "./events/snowCover.ts"
import { paletteMaterial } from "./material.ts"
import { patchRegionTint } from "./regionTint.ts"
import type { Stage } from "./stage.ts"
import { patchCascades } from "./sun/patch.ts"
import type { TerrainMesh } from "./terrain.ts"
import { type VertexMeshData, vertexMeshData } from "./vmeshData.ts"

const SPECKLE_VERTEX = /* glsl */ `#include <begin_vertex>
vSpeckleAt = (modelMatrix * vec4(transformed, 1.0)).xyz;
vSpeckleUp = normalize(mat3(modelMatrix) * objectNormal).y;`

const SPECKLE_FRAGMENT = /* glsl */ `#include <color_fragment>
{
	// one dot per 0.3 m cell at most, jittered in it; only on upward green faces, faded out where a cell
	// shrinks under a pixel (no shimmer from afar)
	vec2 sp = vSpeckleAt.xz / 0.3;
	vec2 cell = floor(sp);
	float h = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
	vec2 jit = vec2(fract(h * 17.31), fract(h * 31.17)) - 0.5;
	float d = length(fract(sp) - 0.5 - jit * 0.5);
	vec3 c = diffuseColor.rgb;
	float green = step(c.r * 1.05, c.g) * step(c.b * 1.5, c.g);
	float near = 1.0 - smoothstep(0.12, 0.35, length(fwidth(sp)));
	float up = smoothstep(0.92, 0.99, vSpeckleUp);
	// flowers come in drifts: a coarse cell decides whether this patch flowers
	float drift = fract(sin(dot(floor(vSpeckleAt.xz / 4.0), vec2(269.5, 183.3))) * 43758.5453);
	float k = green * near * up;
	if (k > 0.0) {
		// a meadow (regionTint.ts) flowers thicker, in more of its drifts
		float meadow = 0.0;
#ifdef REGION_TINT
		meadow = regionW.a;
#endif
		if (h > 0.9 - 0.14 * meadow && drift > 0.55 - 0.5 * meadow) {
			float pick = fract(h * 53.7);
			vec3 petal = pick < 0.35 ? vec3(0.95, 0.93, 0.85) : pick < 0.65 ? vec3(0.98, 0.82, 0.25) : pick < 0.85 ? vec3(0.93, 0.52, 0.62) : vec3(0.62, 0.52, 0.9);
			diffuseColor.rgb = mix(c, petal, k * (1.0 - smoothstep(0.08, 0.13, d)));
		} else if (h < 0.22) {
			diffuseColor.rgb = mix(c, c * vec3(0.8, 0.86, 0.78), k * (1.0 - smoothstep(0.14, 0.22, d)));
		}
	}
}`

let ground: MeshStandardMaterial | null = null

/** The ground's material: the palette material's light and shadows plus the speckle. Shared. */
export function groundMaterial(): MeshStandardMaterial {
  if (!ground) {
    ground = new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 })
    ground.onBeforeCompile = (shader) => {
      patchCascades(shader)
      patchCloudShade(shader)
      patchSnowCover(shader)
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying vec3 vSpeckleAt;\nvarying float vSpeckleUp;",
        )
        .replace("#include <begin_vertex>", SPECKLE_VERTEX)
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying vec3 vSpeckleAt;\nvarying float vSpeckleUp;",
        )
        .replace("#include <color_fragment>", SPECKLE_FRAGMENT)
      // after the speckle, so the region's green is turned before the speckle reads it
      patchRegionTint(shader, "ground")
    }
    ground.customProgramCacheKey = () => "guildhall-ground"
  }
  return ground
}

/**
 * The mesh of triangle `position`s and their sRGB colours, or of arrays already prepared off the main
 * thread (`vertexMeshData`, then `srgb` is left out): then this only uploads.
 */
export function createVertexMesh(
  stage: Pick<Stage, "scene">,
  position: Float32Array | VertexMeshData,
  srgb?: Float32Array,
  opts: { speckle?: boolean } = {},
): TerrainMesh {
  const data =
    position instanceof Float32Array ? vertexMeshData(position, srgb ?? new Float32Array(0)) : position
  const geometry = new BufferGeometry()
  geometry.setAttribute("position", new BufferAttribute(data.position, 3))
  geometry.setAttribute("color", new BufferAttribute(data.color, 3))
  geometry.setAttribute("normal", new BufferAttribute(data.normal, 3))
  const mesh = new Mesh(geometry, opts.speckle ? groundMaterial() : paletteMaterial())
  mesh.receiveShadow = true
  mesh.castShadow = true
  stage.scene.add(mesh)
  return {
    dispose() {
      mesh.removeFromParent()
      geometry.dispose()
    },
  }
}
