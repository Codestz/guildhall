import { useGLTF } from "@react-three/drei"
import { useFrame, useThree } from "@react-three/fiber"
import { use, useEffect, useMemo, useState } from "react"
import {
  BufferGeometry,
  Color,
  DataTexture,
  type DirectionalLight,
  Float32BufferAttribute,
  type Material,
  type Object3D,
  RGBAFormat,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
  Vector4,
  type WebGLRenderer,
} from "three"
import type { Tier } from "../../guild/quality.ts"
import { useGuildStore } from "../../guild/useGuild.ts"
import { isWebGPU } from "../../render/backend.ts"
import { SEA_CELL } from "../../world/archipelago.ts"
import { useArchipelago } from "../../world/archipelagoSource.ts"
import { LANDS_URL } from "../../world/cast.ts"
import { cellToWorld } from "../../world/lands.ts"
import type { Spot } from "../../world/layout.ts"
import { lightsOf } from "../../world/lights.ts"
import { useWorld } from "../../world/source.ts"
import type { World } from "../../world/world.ts"
import { useLooks } from "../atmosphere/looks.ts"
import { sky } from "../atmosphere/state.ts"
import { wind } from "../atmosphere/wind.ts"
import { landOf, viewReachOf } from "../frameReach.ts"
import { riseWater, useRiseMask } from "../growth/mask.ts"
import { installNodes, TSL } from "../tsl.ts"
import { targetOf } from "../weather/shared.ts"
import { noiseTexture } from "./noise.ts"
import { HEX_RADIUS } from "./scatter.ts"
import { waterFragment, waterVertex } from "./shaders.ts"
import { Bakes, patchSquares, SHORE, type ShoreLayout, seaSquares } from "./shore.ts"
import { bakeShore, RING_MAX, riverOf, type Shore } from "./shoreBake.ts"
import { RIVER_Y, SEA_Y } from "./waterline.ts"
import { type Part, partsOf, type Sea } from "./waterParts.ts"
import { useWaterSky } from "./waterSky.ts"

/**
 * The island's water (ADR 0007, Nature): one surface, one draw call, for the sea, the lake and the
 * river. It lies a hair above the pack's flat water (waterline.ts), so the land's own geometry clips
 * it exactly where the tiles put the shore — no seams to hide. What it can't see from the tiles it
 * reads from a texture baked once at start (shoreBake.ts): how far each point of water is from land
 * (foam, shallows) and which way the river runs there (its flow).
 *
 * Water v2 (docs/research/gpu-techniques.md V3), all in this one shader: the body steps through
 * soft toon bands by depth; caustics shimmer in the sunlit shallows; foam rings ripple out from
 * whatever stands in the water — dock posts, rocks, the bridge, the mill wheel — read from a
 * second distance baked into the same texture (from below: the lowest surfaces at the waterline);
 * and the turning wheel churns a wake down the river's flow.
 *
 * GLSL by default. The same water as a TSL node material (waterNodes.ts), reading the same
 * uniforms, on WebGPU always and on WebGL with `?tsl=1` (scene/tsl.ts); it suspends while that
 * loads. The shore bake is GLSL with a synchronous readback on WebGL; on WebGPU the same masks are
 * node materials, read back once asynchronously (the sea reads open water until then).
 */

/**
 * Under an archipelago (world/archipelagoSource.ts) the open sea reaches past every island and has
 * a hole cut for each far island's patch: that island's own Water, drawn with `at` (its offset, the
 * group round it translated there) over ±PATCH_HALF, reading its own baked shore. The home island's
 * water and its bake are the same as without an archipelago. A home island too big for the one bake
 * (generator v2, shoreTiles.ts) is drawn as patches too: the open sea with a hole for each of its
 * shore tiles, and a surface over each reading its own bake, baked one a frame, nearest the keep first.
 */
export function Water({ tier, at }: { tier: Tier; at?: Spot }) {
  const world = useWorld()
  const archipelago = useArchipelago()
  // The sea reaches past whatever the cameras can show (scene/frameReach.ts), in steps so a resize rarely rebuilds it.
  const size = useThree((state) => state.size)
  const view = useMemo(() => Math.ceil(viewReachOf(size, landOf(world)) / 100) * 100, [size, world])
  const parts = useMemo(() => partsOf(world, archipelago, view, at), [world, archipelago, view, at])
  return parts.map((part) => <Surface key={part.key} tier={tier} at={at} part={part} />)
}

function Surface({ tier, at, part }: { tier: Tier; at?: Spot; part: Part }) {
  const _store = useGuildStore()
  const gl = useThree((state) => state.gl)
  const { nodes } = useGLTF(LANDS_URL) as unknown as { nodes: Record<string, Object3D> }
  const world = useWorld()
  const node = isWebGPU(gl) || TSL
  const { sea, layout, queued } = part
  const geometry = useMemo(() => surface(world, node, sea), [world, node, sea])
  const v2 = useLooks().water
  const build = node ? use(nodeWater(gl)) : waterMaterial
  // The node material's shadow is the key light's own (waterNodes.ts): found once it has a map.
  const [key, setKey] = useState<DirectionalLight | null>(null)
  // The node material is built with the baked shore (a texture swapped into a built node material
  // never reaches WebGPU's bindings): built once without it, once more when the bake lands.
  const [baked, setBaked] = useState<{ world: World; shore: Shore } | null>(null)
  const shore = node && baked?.world === world ? baked.shore : null
  // The growth timelapse (`?grow`): only the land up so far has a shore (scene/growth/mask.ts).
  const rise = useRiseMask(Boolean(at))
  const { material, uniforms } = useMemo(() => {
    const built = build(tier === 0, v2, key, shore)
    built.uniforms.uShoreHalf.value = layout?.half ?? SHORE.half
    built.uniforms.uShoreAt.value.set(
      (at?.[0] ?? 0) + (layout?.at?.[0] ?? 0),
      (at?.[1] ?? 0) + (layout?.at?.[1] ?? 0),
    )
    if (rise && !node) riseWater(built.material, rise)
    return built
  }, [build, tier, v2, key, shore, layout, at, rise, node])
  const flames = useMemo(() => watersideOf(world, at), [world, at])
  const eased = useMemo(() => ({ pick: 0 }), [])

  // The shore texture: baked once per world and square (after the first commit, so a suspended
  // render never pays for it), kept while a water draws it (Bakes). A shore tile waits its turn.
  // WebGPU reads it back asynchronously: the water takes it a few frames later.
  useEffect(() => {
    if (!layout) return
    const id = bakeKey(world, layout)
    let made = shores.get(id)
    if (!made) {
      made = queued ? later(() => bakeShore(gl, nodes, world, layout)) : bakeShore(gl, nodes, world, layout)
      shores.set(id, made)
    }
    const release = shores.hold(id)
    if (!node && !(made instanceof Promise)) {
      uniforms.uShore.value = made.texture
      uniforms.uWheel.value.copy(made.wheel)
      return release
    }
    let live = true
    Promise.resolve(made)
      .then((shore) => {
        if (!live) return
        if (node) return setBaked({ world, shore })
        uniforms.uShore.value = shore.texture
        uniforms.uWheel.value.copy(shore.wheel)
      })
      .catch((error) => console.warn("water: the shore bake failed", error))
    return () => {
      live = false
      release()
    }
  }, [gl, nodes, world, uniforms, node, layout, queued])
  useEffect(() => () => material.dispose(), [material])
  useEffect(() => () => geometry.dispose(), [geometry])

  useWaterSky(uniforms, node ? setKey : undefined)
  useFrame((state, delta) => {
    const u = uniforms
    u.uLamps.value = sky.lamps * sky.night
    // The flames nearest what the camera looks at, re-picked twice a second (no per-frame garbage).
    eased.pick -= delta
    if (eased.pick <= 0) {
      eased.pick = 0.5
      nearestFlames(flames, targetOf(state.controls), u.uFlames.value)
    }
  })

  return (
    <mesh
      name="nature-water"
      geometry={geometry}
      material={material}
      receiveShadow
      frustumCulled={"patch" in sea}
      renderOrder={-1}
    />
  )
}

/** The water's material, either path, and the uniforms it reads (Water writes them each frame). */
interface WaterMaterial {
  material: Material
  uniforms: WaterUniforms
}
type Build = (low: boolean, v2: boolean, key: DirectionalLight | null, shore: Shore | null) => WaterMaterial

const nodeBuilds = new WeakMap<object, Promise<Build>>()

/**
 * The node-material water, once the renderer can draw it (one promise per renderer, for `use`).
 * WebGPU draws node materials natively; WebGL needs the nodes handler first.
 */
function nodeWater(gl: object): Promise<Build> {
  let build = nodeBuilds.get(gl)
  if (!build) {
    const ready = isWebGPU(gl) ? Promise.resolve() : installNodes(gl as WebGLRenderer)
    build = ready
      .then(() => import("./waterNodes.ts"))
      .then(({ waterNodeMaterial }) => (low, v2, key, shore) => {
        const uniforms = waterUniforms()
        if (shore) {
          uniforms.uShore.value = shore.texture
          uniforms.uWheel.value.copy(shore.wheel)
        }
        return { material: waterNodeMaterial(uniforms, { low, v2, flames: FLAMES, key }), uniforms }
      })
    nodeBuilds.set(gl, build)
  }
  return build
}

/** Deep and shallow water (sRGB, softened like the tiles); the sky lights them. */
const DEEP = new Color("#1d6aa6")
const SHALLOW = new Color("#3fb0b8")

const noise = noiseTexture()

/** How many torch reflections the water draws at once. */
const FLAMES = 8
type Flames = { flame: readonly [number, number, number]; d: number }[]
/**
 * A world's flames close enough to water to be reflected in it (the rest never are), where the
 * water sees them: moved by `at` for a far island's patch (its world is in its own coordinates).
 */
function watersideOf(world: World, at?: Spot): Flames {
  const { water } = world.island
  const reach = HEX_RADIUS + 7
  const [ox, oz] = at ?? [0, 0]
  return lightsOf(world)
    .map((light) => light.flame)
    .filter(([x, , z]) => water.some(([wx, wz]) => Math.hypot(wx - x, wz - z) < reach))
    .map(([x, y, z]) => ({ flame: [x + ox, y, z + oz] as const, d: 0 }))
}
/** Writes the FLAMES waterside flames nearest `at` into `out` (w = 1), the rest w = 0. */
function nearestFlames(byDistance: Flames, at: Vector3, out: Vector4[]): void {
  for (const entry of byDistance) entry.d = Math.hypot(entry.flame[0] - at.x, entry.flame[2] - at.z)
  byDistance.sort((a, b) => a.d - b.d)
  for (let i = 0; i < out.length; i++) {
    const entry = byDistance[i]
    const slot = out[i] as Vector4
    if (entry) slot.set(entry.flame[0], entry.flame[1], entry.flame[2], 1)
    else slot.set(0, 0, 0, 0)
  }
}
/** Far from any shore everywhere: what the water reads until the bake is done. */
const OPEN_SEA = new DataTexture(new Uint8Array([255, 128, 128, 255]), 1, 1, RGBAFormat)
OPEN_SEA.needsUpdate = true

/** One bake: a world, and the square baked (its one bake, a far island's patch, or a shore tile). */
interface BakeKey {
  world: World
  layout: ShoreLayout
}
const bakeKeys = new WeakMap<World, Map<ShoreLayout, BakeKey>>()
function bakeKey(world: World, layout: ShoreLayout): BakeKey {
  let keys = bakeKeys.get(world)
  if (!keys) {
    keys = new Map()
    bakeKeys.set(world, keys)
  }
  let key = keys.get(layout)
  if (!key) {
    key = { world, layout }
    keys.set(layout, key)
  }
  return key
}
/** Each bake, while a water draws it; a repo's is freed once none does (shore.ts Bakes). */
const shores = new Bakes<BakeKey, Shore>(
  (shore) => shore.texture.dispose(),
  (key) => key.world.kind === "hand",
)

/** Queued bakes run one a frame (each is a readback), in the order asked. */
let turn: Promise<unknown> = Promise.resolve()
function later<T>(job: () => T | Promise<T>): Promise<T> {
  const done = turn.then(() => new Promise<void>((next) => requestAnimationFrame(() => next()))).then(job)
  turn = done.catch(() => undefined)
  return done
}

/**
 * The water's own uniforms, read by either path. Shared objects (the wind, the sky's colours, the
 * noise) are attached by reference, so their per-frame writes reach the shader with no copying.
 * Exported for tests.
 */
export function waterUniforms() {
  return {
    ...wind.uniforms,
    uNoise: { value: noise },
    uShore: { value: OPEN_SEA as DataTexture },
    uShoreHalf: { value: SHORE.half as number },
    /** Where the baked shore is centred (world xz): a far island's patch or a shore tile is off the origin. */
    uShoreAt: { value: new Vector2() },
    uShoreMax: { value: SHORE.maxDistance },
    uRain: { value: 0 },
    uGloom: { value: 0 },
    uCloud: { value: 0 },
    uFlash: { value: 0 },
    uKeyIntensity: { value: 1 },
    uHemiIntensity: { value: 1 },
    uKeyDir: { value: new Vector3(0, 1, 0) },
    uMoonDir: { value: new Vector3(0, 1, 0) },
    uMoon: { value: 0 },
    uNight: { value: 0 },
    uLamps: { value: 0 },
    uCaustics: { value: 0 },
    uRingMax: { value: RING_MAX },
    uWheel: { value: new Vector4() },
    uFlames: { value: Array.from({ length: FLAMES }, () => new Vector4()) },
    uMoonColor: { value: sky.moonColor },
    uZenith: { value: sky.zenith },
    uHorizon: { value: sky.horizon },
    uKeyColor: { value: sky.keyColor },
    uHemiSky: { value: sky.hemiSky },
    uHemiGround: { value: sky.hemiGround },
    uDeep: { value: DEEP },
    uShallow: { value: SHALLOW },
  }
}
export type WaterUniforms = ReturnType<typeof waterUniforms>

function waterMaterial(low: boolean, v2: boolean): WaterMaterial {
  const defines: Record<string, unknown> = { FLAMES }
  if (low) defines.NATURE_LOW = ""
  if (v2) defines.WATER_V2 = ""
  const uniforms = waterUniforms()
  const material = new ShaderMaterial({
    // Three's light (the key's shadow) and fog uniforms, then the water's own, not cloned.
    uniforms: { ...UniformsUtils.merge([UniformsLib.lights, UniformsLib.fog]), ...uniforms },
    vertexShader: waterVertex,
    fragmentShader: waterFragment,
    lights: true,
    fog: true,
    defines,
  })
  return { material, uniforms }
}

/**
 * The surface: a wide disc for the sea (past the fog, so it has no edge) and one hexagon per river
 * hex at the river's height; `aRiver` tells the shader which is which. Under an archipelago, or
 * round a tiled island, the sea is a grid instead, wider, with a hole for each patch; a patch's own
 * is the same grid over its hole.
 */
function surface(world: World, node: boolean, sea: Sea): BufferGeometry {
  const positions: number[] = []
  const river: number[] = []
  const push = (x: number, y: number, z: number, r: number) => {
    positions.push(x, y, z)
    river.push(r)
  }
  const SEGMENTS = 96
  const grid =
    "disc" in sea
      ? null
      : "patch" in sea
        ? patchSquares(sea.patch, SEA_CELL, sea.at)
        : seaSquares(sea.radius, sea.holes, SEA_CELL)
  if (grid) for (const [x, z] of grid) push(x, SEA_Y, z, 0)
  else if ("disc" in sea)
    for (let i = 0; i < SEGMENTS; i++) {
      const a0 = (i / SEGMENTS) * Math.PI * 2
      const a1 = ((i + 1) / SEGMENTS) * Math.PI * 2
      // Counter-clockwise seen from above (+y normal).
      push(0, SEA_Y, 0, 0)
      push(Math.cos(a1) * sea.disc, SEA_Y, Math.sin(a1) * sea.disc, 0)
      push(Math.cos(a0) * sea.disc, SEA_Y, Math.sin(a0) * sea.disc, 0)
    }
  for (const cell of riverOf(world)) {
    const char = world.terrain.at(cell)
    if (char !== "r" && char !== "#") continue
    const [cx, cz] = cellToWorld(cell)
    for (let k = 0; k < 6; k++) {
      const a0 = (k / 6) * Math.PI * 2
      const a1 = ((k + 1) / 6) * Math.PI * 2
      push(cx, RIVER_Y, cz, 1)
      push(cx + Math.cos(a1) * HEX_RADIUS, RIVER_Y, cz + Math.sin(a1) * HEX_RADIUS, 1)
      push(cx + Math.cos(a0) * HEX_RADIUS, RIVER_Y, cz + Math.sin(a0) * HEX_RADIUS, 1)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3))
  geometry.setAttribute("aRiver", new Float32BufferAttribute(river, 1))
  // The node material's shadow offsets along the normal (normalBias), read from the geometry; the
  // GLSL hard-codes it (up).
  if (node)
    geometry.setAttribute(
      "normal",
      new Float32BufferAttribute(
        river.flatMap(() => [0, 1, 0]),
        3,
      ),
    )
  geometry.computeBoundingSphere()
  return geometry
}
