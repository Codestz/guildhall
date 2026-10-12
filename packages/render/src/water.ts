import { PALETTE } from "@guildhall/assets"
import { log } from "@guildhall/core"
import { type TownDraw, type WaterGeometry, waterGeometry } from "@guildhall/world"
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Fog,
  Mesh,
  MeshStandardMaterial,
  type WebGLProgramParametersWithUniforms,
} from "three"
import type { Stage } from "./stage.ts"
import { patchCascades } from "./sun/patch.ts"

export type WaterDraw = TownDraw["water"]

/** Past this distance from the shore the water is at its deepest colour, metres. */
const DEEP_AT = 10

const logger = log("render:water")

const swatch = (name: string): Color => {
  const s = PALETTE.swatches.find((w) => w.name === name)
  if (!s) throw new Error(`water: no swatch "${name}"`)
  return new Color(s.hex)
}

const PARS = /* glsl */ `
uniform float uTime;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uFoam;
uniform vec3 uSky;
varying float vShore;
varying vec2 vWorld;
`

/**
 * The water's shader additions, after the cascade patch: colour by distance to shore (shallow → deep)
 * with a foam band at the shore and a fainter line breathing just off it; normals rippled by a few
 * travelling sines (no textures); and a fresnel lean toward the haze, so the far water meets the sky.
 */
function patchWater(
  shader: WebGLProgramParametersWithUniforms,
  uniforms: Record<string, { value: unknown }>,
) {
  patchCascades(shader)
  Object.assign(shader.uniforms, uniforms)
  shader.vertexShader = shader.vertexShader
    .replace(
      "#include <common>",
      `#include <common>\nattribute float shore;\nvarying float vShore;\nvarying vec2 vWorld;`,
    )
    .replace(
      "#include <begin_vertex>",
      "#include <begin_vertex>\nvShore = shore;\nvWorld = (modelMatrix * vec4(position, 1.0)).xz;",
    )
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `#include <common>\n${PARS}`)
    .replace(
      "#include <color_fragment>",
      /* glsl */ `#include <color_fragment>
float depth = smoothstep(1.2, ${DEEP_AT.toFixed(1)}, vShore);
diffuseColor.rgb = mix(uShallow, uDeep, depth);
float lap = 0.12 * sin(uTime * 0.9 + vWorld.x * 0.21 + vWorld.y * 0.17);
float foam = 1.0 - smoothstep(0.45 + lap, 1.1 + lap, vShore);
float ring = 1.0 - smoothstep(0.0, 0.18, abs(vShore - (1.7 + 0.35 * sin(uTime * 0.6 + vWorld.x * 0.05))));
foam = max(foam, 0.45 * ring);
diffuseColor.rgb = mix(diffuseColor.rgb, uFoam, foam);`,
    )
    .replace(
      "#include <normal_fragment_maps>",
      /* glsl */ `#include <normal_fragment_maps>
vec2 q = vWorld;
float t = uTime;
// Ripples a few metres long, faded out with distance so the far water never shimmers.
float near = 1.0 - smoothstep(50.0, 200.0, length(vViewPosition));
vec2 slope = 0.035 * near * vec2(cos(q.x * 1.3 + q.y * 0.4 + t * 1.6) + 0.7 * cos(q.x * 0.9 - q.y * 1.1 + t * 1.1),
                                cos(q.y * 1.4 - q.x * 0.3 - t * 1.4) + 0.7 * cos(q.y * 0.8 + q.x * 1.2 - t * 1.7));
normal = normalize(normal + (viewMatrix * vec4(slope.x, 0.0, slope.y, 0.0)).xyz * (1.0 - foam));`,
    )
    .replace(
      "#include <opaque_fragment>",
      /* glsl */ `vec3 level = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
float facing = clamp(dot(level, normalize(vViewPosition)), 0.0, 1.0);
outgoingLight = mix(outgoingLight, uSky, 0.45 * pow(1.0 - facing, 5.0) * (1.0 - foam));
#include <opaque_fragment>`,
    )
}

export interface Water {
  mesh: Mesh
  dispose(): void
}

/**
 * The water (plan §5): its polygons as one flat mesh at `level`, each vertex carrying its distance to
 * the shore lines; a small patched standard material does the rest (depth tint, foam, ripples, sky
 * fresnel, the sun's glint, and the cascaded shadows of what stands over it). One draw call. Takes
 * the geometry prebuilt (world `waterGeometry`, in a worker) or builds it here from the draw.
 */
export function createWater(stage: Stage, w: WaterDraw | WaterGeometry): Water {
  const start = performance.now()
  const built = "position" in w ? w : waterGeometry(w)
  const count = built.position.length / 3
  const geometry = new BufferGeometry()
  geometry.setAttribute("position", new BufferAttribute(built.position, 3))
  geometry.setAttribute("normal", new BufferAttribute(built.normal, 3))
  geometry.setAttribute("shore", new BufferAttribute(built.shore, 1))
  geometry.setIndex(new BufferAttribute(built.index, 1))
  geometry.computeBoundingSphere()

  const uniforms = {
    uTime: { value: 0 },
    uShallow: { value: swatch("water-shallow").lerp(swatch("water-foam"), 0.4) },
    uDeep: { value: swatch("water-shallow").lerp(swatch("water-deep"), 0.3) },
    uFoam: { value: swatch("water-foam") },
    uSky: { value: new Color("#cde2f6") },
  }
  const material = new MeshStandardMaterial({ roughness: 0.28, metalness: 0 })
  material.onBeforeCompile = (shader) => patchWater(shader, uniforms)
  material.customProgramCacheKey = () => "guildhall-water"
  const mesh = new Mesh(geometry, material)
  mesh.name = "water"
  mesh.receiveShadow = true
  stage.scene.add(mesh)

  const unsubscribe = stage.onFrame((dt) => {
    uniforms.uTime.value += dt
    // The fresnel leans toward the haze the sky set (light.ts), so the far water meets the horizon.
    const fog = stage.scene.fog
    if (fog instanceof Fog) uniforms.uSky.value.copy(fog.color)
  })
  logger.info("water", {
    vertices: count,
    triangles: built.index.length / 3,
    ms: Math.round(performance.now() - start),
  })
  return {
    mesh,
    dispose() {
      unsubscribe()
      mesh.removeFromParent()
      geometry.dispose()
      material.dispose()
    },
  }
}
