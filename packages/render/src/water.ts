import { PALETTE } from "@guildhall/assets"
import { log } from "@guildhall/core"
import {
  bbox,
  clip,
  closest,
  type MultiPolygon,
  orient,
  type Ring,
  type TownDraw,
  type Vec2,
} from "@guildhall/world"
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Fog,
  Mesh,
  MeshStandardMaterial,
  type WebGLProgramParametersWithUniforms,
} from "three"
import { type FlatMesh, gridMesh } from "./ground.ts"
import type { Stage } from "./stage.ts"
import { patchCascades } from "./sun/patch.ts"

export type WaterDraw = TownDraw["water"]

/** The water's grid pitch near the shore, metres: the shore distance it carries is interpolated across it. */
const PITCH = 4
/** Past this distance from the shore the water is at its deepest colour, metres. */
const DEEP_AT = 10
/** Water further than this past the shore lines' box is all deep: one coarse grid, metres. */
const NEAR = 30
const FAR_PITCH = 40

const logger = log("render:water")

const swatch = (name: string): Color => {
  const s = PALETTE.swatches.find((w) => w.name === name)
  if (!s) throw new Error(`water: no swatch "${name}"`)
  return new Color(s.hex)
}

/** Per vertex of the water's polygons: its distance to the nearest shore line, metres. */
export function shoreDistance(p: Vec2, shore: readonly Vec2[][]): number {
  let best = Number.POSITIVE_INFINITY
  for (const line of shore)
    for (let i = 0; i + 1 < line.length; i++)
      best = Math.min(best, closest(p, line[i] as Vec2, line[i + 1] as Vec2).d)
  return best
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

/** The water's polygons on a fine grid near the shore lines and a coarse one past them. */
function waterMesh(w: WaterDraw): FlatMesh {
  const polys: MultiPolygon = w.polys.filter((ring) => ring.length >= 3).map((ring) => [orient(ring, true)])
  const [min, max] = bbox(w.shore.flat())
  const box: Ring = [
    [min[0] - NEAR, min[1] - NEAR],
    [max[0] + NEAR, min[1] - NEAR],
    [max[0] + NEAR, max[1] + NEAR],
    [min[0] - NEAR, max[1] + NEAR],
  ]
  if (w.shore.length === 0) return gridMesh(polys, PITCH)
  const near = gridMesh(clip(polys, [[box]], "intersection"), PITCH)
  const far = gridMesh(clip(polys, [[box]], "difference"), FAR_PITCH)
  const base = near.points.length / 2
  return {
    points: [...near.points, ...far.points],
    indices: [...near.indices, ...far.indices.map((i) => i + base)],
  }
}

export interface Water {
  mesh: Mesh
  dispose(): void
}

/**
 * The water (plan §5): its polygons as one flat mesh at `level`, each vertex carrying its distance to
 * the shore lines; a small patched standard material does the rest (depth tint, foam, ripples, sky
 * fresnel, the sun's glint, and the cascaded shadows of what stands over it). One draw call.
 */
export function createWater(stage: Stage, w: WaterDraw): Water {
  const start = performance.now()
  const flat = waterMesh(w)
  const count = flat.points.length / 2
  const position = new Float32Array(count * 3)
  const normal = new Float32Array(count * 3)
  const shore = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const x = flat.points[2 * i] as number
    const z = flat.points[2 * i + 1] as number
    position.set([x, w.level, z], 3 * i)
    normal[3 * i + 1] = 1
    shore[i] = Math.min(shoreDistance([x, z], w.shore), 1e3)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute("position", new BufferAttribute(position, 3))
  geometry.setAttribute("normal", new BufferAttribute(normal, 3))
  geometry.setAttribute("shore", new BufferAttribute(shore, 1))
  geometry.setIndex(flat.indices)
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
    triangles: flat.indices.length / 3,
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
