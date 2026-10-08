import { type BatchedMesh, type DirectionalLight, DoubleSide, type LightShadow, type Material } from "three"
import {
  attribute,
  batchIndirectIndex,
  cameraPosition,
  dot,
  Fn,
  float,
  int,
  ivec2,
  max,
  mix,
  modelWorldMatrix,
  modelWorldMatrixInverse,
  normalize,
  positionGeometry,
  positionLocal,
  positionWorld,
  pow,
  reference,
  shadow,
  sin,
  smoothstep,
  texture,
  textureLoad,
  textureSize,
  uv,
  varyingProperty,
  vec2,
  vec3,
  vec4,
} from "three/tsl"
import { MeshStandardNodeMaterial, type Node, type NodeBuilder, NodeMaterial } from "three/webgpu"
import { wind } from "../atmosphere/wind.ts"
import type { GrassUniforms } from "./Grass.tsx"

/**
 * Nature's swaying plants as TSL node materials (WebGPU, always; WebGL with `?tsl=1`, scene/tsl.ts):
 * the grass and its flowers (nature/shaders.ts `grassVertex` / `grassFragment`) and the wilds'
 * patched standard material (Wilds.tsx), node for node, with the one wind sway both share
 * (`swayGrass`, `swayPlant`: shaders.ts `WIND_SWAY`). Loaded on demand: it pulls in three/webgpu.
 *
 * Both sway after the instance transform, in the mesh's space, as three's node materials place
 * their instancing (InstancedMesh, BatchedMesh) before anything a material adds.
 */

type Float = Node<"float">
type Vec2 = Node<"vec2">

/** A `{ value }` uniform, read each draw (the very objects the GLSL path is fed). */
const float_ = (holder: { value: number }): Float => reference("value", "float", holder)
const vec3_ = (holder: { value: object }) => reference("value", "vec3", holder) as unknown as Node<"vec3">
const color_ = (holder: { value: object }) => reference("value", "color", holder) as unknown as Node<"vec3">

/** atmosphere/wind.ts's uniforms, as nodes. */
function windNodes() {
  const u = wind.uniforms
  return {
    time: float_(u.uTime),
    strength: float_(u.uWind),
    dir: reference("value", "vec2", u.uWindDir) as Vec2,
  }
}

// ---- The one wind sway (shaders.ts WIND_SWAY) ---------------------------------------------------

/** A tree or bush: a slow two-sine rock, phased by where it stands; roots still, tops most (h²). */
export function swayPlant(root: Vec2, h: Float): Float {
  const { time, strength } = windNodes()
  const phase = time.mul(1.7).add(dot(root, vec2(0.23, 0.17)))
  return h
    .mul(h)
    .mul(0.03)
    .mul(strength.add(0.25))
    .mul(
      sin(phase)
        .mul(0.65)
        .add(sin(phase.mul(2.3).add(1)).mul(0.35)),
    )
}

/** Grass: a steady lean plus gusts that travel across the island (scale by height² at the blade). */
export function swayGrass(world: Vec2): Float {
  const { time, strength, dir } = windNodes()
  const phase = dot(world, vec2(0.37, 0.61))
  const gust = sin(
    dot(world, dir)
      .mul(0.16)
      .sub(time.mul(strength.mul(1.6).add(1.1))),
  )
  const sway = sin(time.mul(strength.mul(2.2).add(1.6)).add(phase))
    .mul(0.35)
    .add(gust.mul(0.65))
  return strength.mul(0.32).add(0.05).mul(sway.mul(0.45).add(0.55)).add(sway.mul(0.05))
}

// ---- The key light's shadow ---------------------------------------------------------------------

/**
 * The key light's shadow (GLSL `getShadowMask()`), read from the map the light already draws: its
 * own shadow node on WebGPU, WebGLRenderer on WebGL (where the nodes handler does the same). A
 * shadow node of its own would draw a second map, and on WebGPU the on-demand cache's one redraw
 * (render/shims.ts `syncShadows`) would go to whichever drew first, leaving the other empty. So:
 * call once the light's `shadow.map` exists.
 */
export function keyShadow(key: DirectionalLight): Float {
  const node = shadow(key) as unknown as {
    setupRenderTarget: (shadow: LightShadow) => object
    updateBefore: () => void
  }
  node.setupRenderTarget = (light) => {
    const map = light.map as NonNullable<LightShadow["map"]>
    return { shadowMap: map, depthTexture: map.depthTexture }
  }
  node.updateBefore = () => {}
  return node as unknown as Float
}

// ---- Grass ------------------------------------------------------------------------------------

/** What the vertex stage hands the fragment: the blade's colour (palette, root shade, jitter). */
const grassColour = varyingProperty("vec3", "vGrassColour")

/**
 * The grass (or, `flowers`, its flowers) as a node material: Grass.tsx's GLSL ShaderMaterial,
 * lit the same way (sky-state uniforms, one key and a hemisphere fill, no light loop), fogged by
 * the handler's radial fog, its output the renderer's step. `key`: the light whose shadow it takes
 * (null until that light has drawn its map: unshadowed).
 */
export function grassNodeMaterial(
  u: GrassUniforms,
  { flowers, key }: { flowers: boolean; key: DirectionalLight | null },
): NodeMaterial {
  const material = new GrassNodeMaterial(u, flowers)
  material.fog = true
  material.side = DoubleSide
  material.colorNode = grassFragment(u, flowers, key)
  return material
}

class GrassNodeMaterial extends NodeMaterial {
  constructor(
    private readonly u: GrassUniforms,
    private readonly flowers: boolean,
  ) {
    super()
  }

  /** The instancing (three's), then snow and sway in the mesh's space, and the blade's colour. */
  override setupPosition(builder: NodeBuilder): Node {
    super.setupPosition(builder)
    grassVertex(this.u, this.flowers)()
    return positionLocal
  }

  // The vertex step is no node property: the graph's own key can't tell a flower from a blade.
  override customProgramCacheKey(): string {
    return `${super.customProgramCacheKey()}:grass:${this.flowers}`
  }
}

/** shaders.ts `grassVertex` after `instanceMatrix`: snow, sway (world space), colour. */
function grassVertex(u: GrassUniforms, flowers: boolean) {
  return Fn(() => {
    const height = uv().y
    // On a flower mesh, uv.x marks the head (1) apart from the stalk (0).
    const flower = flowers ? uv().x : float(0)
    // Snow presses the tufts down a little. Each tuft stands at y 0 and turns only about y, so
    // squashing its y after the instance transform is squashing it before (as the GLSL does).
    const local = positionLocal.mul(vec3(1, float_(u.uSnow).mul(-0.35).add(1), 1)).toVar()
    const world = modelWorldMatrix.mul(vec4(local, 1)).xyz.toVar()

    // Wind: more at the tips.
    const { dir } = windNodes()
    const bend = swayGrass(world.xz).toVar()
    const k = height.mul(height)
    const offset = vec3(dir.x.mul(bend).mul(k), bend.mul(bend).mul(k).mul(-0.6), dir.y.mul(bend).mul(k))
    positionLocal.assign(local.add(modelWorldMatrixInverse.mul(vec4(offset, 0)).xyz))

    // The tiles' own grass from the palette, a shade deeper at the root, per-tuft hue jitter.
    const phase = dot(world.xz, vec2(0.37, 0.61))
    const palette = texture(u.uPalette.value ?? undefined, vec2(0.045, 0.58)).rgb
    const grass = palette
      .mul(vec3(0.741 * 0.86, 0.827, 0.776 * 0.8))
      .mul(mix(0.62, 1.06, height))
      .mul(phase.mul(13.7).fract().mul(0.2).add(0.9))
    grassColour.assign(flowers ? mix(grass, attribute<"vec3">("aTint", "vec3"), flower) : grass)
  }, "void")
}

/** shaders.ts `grassFragment`. */
function grassFragment(u: GrassUniforms, flowers: boolean, key: DirectionalLight | null): Node<"vec4"> {
  return Fn(() => {
    const height = uv().y
    const flower = flowers ? uv().x : float(0)
    const wet = float_(u.uWet)
    const snow = float_(u.uSnow)
    const keyColour = color_(u.uKeyColor).mul(float_(u.uKeyIntensity))
    const keyDir = vec3_(u.uKeyDir)
    const shade = (key ? keyShadow(key) : float(1)).toVar()

    const albedo = grassColour.mul(wet.mul(-0.32).mul(flower.oneMinus()).add(1)).toVar()
    // Frost and snow settle on the upper blades first.
    albedo.assign(
      mix(
        albedo,
        vec3(0.93, 0.96, 1.0),
        snow.mul(smoothstep(0.15, 0.8, height)).mul(flower.mul(-0.5).add(1)),
      ),
    )
    // Lit with the normal straight up (GLSL `fill(n) + key(n, shadow)`): the hemisphere's sky half
    // (its ground colour weighs nothing straight up) and the key.
    const fill = color_(u.uHemiSky).mul(float_(u.uHemiIntensity))
    const lit = fill.add(keyColour.mul(max(keyDir.y, 0)).mul(shade))
    const colour = albedo
      .mul(lit)
      .mul(1 / Math.PI)
      .toVar()
    // Wet blades catch the light.
    const v = normalize(cameraPosition.sub(positionWorld))
    const spec = pow(max(dot(normalize(keyDir.add(v)), normalize(vec3(0, 1, 0).add(v.mul(0.6)))), 0), 24)
    colour.addAssign(keyColour.mul(spec).mul(wet).mul(height).mul(shade).mul(0.08))
    return vec4(colour, 1)
  })()
}

// ---- Wilds ------------------------------------------------------------------------------------

/**
 * Wilds.tsx's sway material as a node material: a MeshStandardNodeMaterial copied from `base` (the
 * pack's, lime tamed), each vertex bent downwind by its piece's `aSway` and `swayPlant`, phased by
 * where its instance stands. Three's lighting, shadows and fog are the standard material's own.
 */
export function wildsNodeMaterial(base: Material): MeshStandardNodeMaterial {
  const material = new WildsNodeMaterial()
  material.copy(base as MeshStandardNodeMaterial)
  return material
}

class WildsNodeMaterial extends MeshStandardNodeMaterial {
  /** The batching (three's), then the sway, in the mesh's space; or a merged mesh's (Wilds.tsx on WebGPU). */
  override setupPosition(builder: NodeBuilder): Node {
    super.setupPosition(builder)
    if ((builder.object as BatchedMesh).isBatchedMesh) wildsVertex(builder.object as BatchedMesh)()
    else if (builder.geometry.hasAttribute("aRoot")) mergedWildsVertex()
    return positionLocal
  }

  override customProgramCacheKey(): string {
    return `${super.customProgramCacheKey()}:wilds-sway`
  }
}

/**
 * Wilds.tsx's GLSL bends the vertex in the instance's own space by the world wind turned into it
 * (`transpose(mat3(batchingMatrix)) · wind / scale²`): an instance turned about y and scaled
 * evenly maps that back to exactly the world wind, so after the batching it is added as it is.
 * The height is the piece's own (before its scale), the root the instance's place.
 */
function wildsVertex(mesh: BatchedMesh) {
  // BatchedMesh's own matrix texture (three's Batch.js layout: four texels a matrix, the fourth its place).
  const matrices = (mesh as unknown as { _matricesTexture: Parameters<typeof textureLoad>[0] })
    ._matricesTexture
  return Fn(() => {
    const size = int((textureSize(textureLoad(matrices), int(0)) as unknown as Node<"ivec2">).x)
    const j = int(batchIndirectIndex).mul(4)
    const root = textureLoad(matrices, ivec2(j.mod(size).add(3), j.div(size))).xyz
    const { dir } = windNodes()
    const bend = attribute<"float">("aSway", "float").mul(swayPlant(root.xz, max(positionGeometry.y, 0)))
    positionLocal.addAssign(vec3(dir.x, 0, dir.y).mul(bend))
  }, "void")
}

/**
 * The same sway on a merged mesh (every instance baked into world space): each vertex carries its
 * instance's root and its own height (`aRoot`: x, z, height), so it bends exactly as when batched.
 */
const mergedWildsVertex = Fn(() => {
  const root = attribute<"vec3">("aRoot", "vec3")
  const { dir } = windNodes()
  const bend = attribute<"float">("aSway", "float").mul(swayPlant(root.xy, max(root.z, 0)))
  positionLocal.addAssign(vec3(dir.x, 0, dir.y).mul(bend))
}, "void")
