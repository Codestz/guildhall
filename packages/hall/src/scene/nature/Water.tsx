import { useGLTF } from "@react-three/drei"
import { useFrame, useThree } from "@react-three/fiber"
import { use, useEffect, useMemo, useState } from "react"
import {
  Box3,
  BufferGeometry,
  Color,
  DataTexture,
  type DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  LinearFilter,
  type Material,
  MathUtils,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  OrthographicCamera,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  type Texture,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
  Vector4,
  type WebGLRenderer,
  WebGLRenderTarget,
} from "three"
import { reducedMotion } from "../../guild/opening.ts"
import type { Tier } from "../../guild/quality.ts"
import { useGuildStore } from "../../guild/useGuild.ts"
import { isWebGPU } from "../../render/backend.ts"
import { PATCH_HALF, SEA_CELL, seaRadiusOf } from "../../world/archipelago.ts"
import { type Archipelago, useArchipelago } from "../../world/archipelagoSource.ts"
import { LANDS_URL } from "../../world/cast.ts"
import { type Cell, cellToWorld, HEX_SCALE } from "../../world/lands.ts"
import type { Spot } from "../../world/layout.ts"
import { lightsOf } from "../../world/lights.ts"
import { useWorld } from "../../world/source.ts"
import { reachOf, type World } from "../../world/world.ts"
import { useLooks } from "../atmosphere/looks.ts"
import { sky } from "../atmosphere/state.ts"
import { wind } from "../atmosphere/wind.ts"
import { installNodes, TSL } from "../tsl.ts"
import { EASE, targetOf } from "../weather/shared.ts"
import { noiseTexture } from "./noise.ts"
import { HEX_RADIUS } from "./scatter.ts"
import { waterFragment, waterVertex } from "./shaders.ts"
import {
  distanceToLand,
  patchSquares,
  riverCells,
  SHORE,
  type ShoreLayout,
  seaSquares,
  shoreTexels,
  smooth,
} from "./shore.ts"

/**
 * The island's water (ADR 0007, Nature): one surface, one draw call, for the sea, the lake and the
 * river. It lies a hair above the pack's flat water (sea and lake at y −1, the river's channel at
 * −0.5), so the land's own geometry clips it exactly where the tiles put the shore — no seams to
 * hide. What it can't see from the tiles it reads from a texture baked once at start: how far each
 * point of water is from land (foam, shallows) and which way the river runs there (its flow).
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
const SEA_Y = -0.2 * HEX_SCALE + 0.05
const RIVER_Y = -0.1 * HEX_SCALE + 0.06
/** A far island's shore patch (world/archipelago.ts): its own bake, coarser than the home island's. */
const PATCH: ShoreLayout = { half: PATCH_HALF, size: 512 }

/**
 * Under an archipelago (world/archipelagoSource.ts) the open sea reaches past every island and has
 * a hole cut for each far island's patch: that island's own Water, drawn with `at` (its offset, the
 * group round it translated there) over ±PATCH_HALF, reading its own baked shore. The home island's
 * water and its bake are the same as without an archipelago.
 */
export function Water({ tier, at }: { tier: Tier; at?: Spot }) {
  const store = useGuildStore()
  const gl = useThree((state) => state.gl)
  const { nodes } = useGLTF(LANDS_URL) as unknown as { nodes: Record<string, Object3D> }
  const world = useWorld()
  const node = isWebGPU(gl) || TSL
  const archipelago = useArchipelago()
  const geometry = useMemo(
    () => surface(world, node, at ? "patch" : archipelago),
    [world, node, at, archipelago],
  )
  const layout = at ? PATCH : SHORE
  const v2 = useLooks().water
  const build = node ? use(nodeWater(gl)) : waterMaterial
  // The node material's shadow is the key light's own (waterNodes.ts): found once it has a map.
  const [key, setKey] = useState<DirectionalLight | null>(null)
  // The node material is built with the baked shore (a texture swapped into a built node material
  // never reaches WebGPU's bindings): built once without it, once more when the bake lands.
  const [baked, setBaked] = useState<{ world: World; shore: Shore } | null>(null)
  const shore = node && baked?.world === world ? baked.shore : null
  const { material, uniforms } = useMemo(() => {
    const built = build(tier === 0, v2, key, shore)
    built.uniforms.uShoreHalf.value = layout.half
    if (at) built.uniforms.uShoreAt.value.set(at[0], at[1])
    return built
  }, [build, tier, v2, key, shore, layout, at])
  const flames = useMemo(() => watersideOf(world, at), [world, at])
  const eased = useMemo(() => ({ rain: 0, gloom: 0, cloud: 0, pick: 0, caustics: 0 }), [])
  const still = useMemo(reducedMotion, [])

  // The shore texture: render the tiles' land mask from above once per world (after the first
  // commit, so a suspended render never pays for it), then measure it on the CPU. Kept per world.
  // WebGPU reads it back asynchronously: the water takes it a few frames later.
  useEffect(() => {
    let made = shores.get(world)
    if (!made) {
      made = isWebGPU(gl)
        ? bakeShoreGPU(gl, nodes, world, layout)
        : bakeShore(gl as WebGLRenderer, nodes, world, layout)
      shores.set(world, made)
    }
    if (!node) {
      const glsl = made as Shore
      uniforms.uShore.value = glsl.texture
      uniforms.uWheel.value.copy(glsl.wheel)
      return
    }
    let live = true
    Promise.resolve(made)
      .then((shore) => live && setBaked({ world, shore }))
      .catch((error) => console.warn("water: the shore bake failed", error))
    return () => {
      live = false
    }
  }, [gl, nodes, world, uniforms, node, layout])
  useEffect(() => () => material.dispose(), [material])
  useEffect(() => () => geometry.dispose(), [geometry])

  useFrame((state, delta) => {
    if (node && !key?.parent) {
      const found = keyLight(state.scene)
      if (found !== key) setKey(found)
    }
    const env = store.environment
    const u = uniforms
    eased.rain = MathUtils.damp(eased.rain, env.weather === "snow" ? 0 : env.precipitation, EASE, delta)
    eased.gloom = MathUtils.damp(
      eased.gloom,
      env.weather === "storm" ? 1 : env.weather === "rain" ? 0.4 : 0,
      EASE,
      delta,
    )
    eased.cloud = MathUtils.damp(eased.cloud, env.cloudCover, EASE, delta)
    u.uRain.value = eased.rain
    u.uGloom.value = eased.gloom
    u.uCloud.value = eased.cloud
    u.uKeyIntensity.value = sky.keyIntensity
    u.uHemiIntensity.value = sky.hemiIntensity
    u.uFlash.value = sky.flash
    // Water v2's own clock (caustics, rings, wake): it holds still under prefers-reduced-motion.
    if (!still) eased.caustics = (eased.caustics + Math.min(delta, 0.1)) % 1000
    u.uCaustics.value = eased.caustics
    const [x, y, z] = sky.keyDirection
    u.uKeyDir.value.set(x, y, z)
    // A photogenic moon: its path swings round towards where the camera looks, so the diorama's
    // high, fixed angle still sees it (a true mirror image is mostly behind or off screen).
    const [mx, my, mz] = env.moon
    state.camera.getWorldDirection(look)
    look.y = 0
    look.normalize()
    const lift = Math.max(0.15, Math.min(0.75, (my + 0.6) * 0.5))
    u.uMoonDir.value
      .set(mx, 0, mz)
      .normalize()
      .lerp(look, 0.75)
      .setY(0)
      .normalize()
      .multiplyScalar(Math.sqrt(1 - lift * lift))
      .setY(lift)
    u.uNight.value = sky.night
    u.uMoon.value = sky.moonDisc * sky.night
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
      frustumCulled={!!at}
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

/** The scene's shadow-casting directional light (Atmosphere's key), once its shadow map exists. */
function keyLight(scene: Object3D): DirectionalLight | null {
  let found: DirectionalLight | null = null
  scene.traverse((object) => {
    const light = object as DirectionalLight
    if (!found && light.isDirectionalLight && light.castShadow && light.shadow.map) found = light
  })
  return found
}

/** Deep and shallow water (sRGB, softened like the tiles); the sky lights them. */
const DEEP = new Color("#1d6aa6")
const SHALLOW = new Color("#3fb0b8")

const noise = noiseTexture()
const look = new Vector3()
const scratch = new Vector3()
const size3 = new Vector3()

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
/**
 * A world's baked shore: the texture, and where the mill wheel's water rejoins the river (xyz)
 * with the wheel's radius (w; 0: no wheel, no wake).
 */
interface Shore {
  texture: DataTexture
  wheel: Vector4
}
const shores = new WeakMap<World, Shore | Promise<Shore>>()
/** Foam rings reach this far from what stands in the water (world units; the texture's alpha). */
const RING_MAX = 4
/** Pieces that sit on the water but shouldn't ring it (they float, they don't stand). */
const AFLOAT = /^(waterlily|waterplant)/

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
    /** Where the baked shore is centred (world xz): a far island's patch is off the origin. */
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
 * hex at the river's height; `aRiver` tells the shader which is which. Under an archipelago the sea
 * is a grid instead, wider, with a hole for each far island; a far island's own (`"patch"`) is the
 * same grid over its hole.
 */
function surface(world: World, node: boolean, sea: Archipelago | "patch" | null): BufferGeometry {
  const positions: number[] = []
  const river: number[] = []
  const push = (x: number, y: number, z: number, r: number) => {
    positions.push(x, y, z)
    river.push(r)
  }
  const SEGMENTS = 96
  const RADIUS = 420
  const grid =
    sea === "patch"
      ? patchSquares(PATCH_HALF, SEA_CELL)
      : sea
        ? seaSquares(
            seaRadiusOf(sea.extent),
            sea.islands.map((island) => island.at),
            PATCH_HALF,
            SEA_CELL,
          )
        : null
  if (grid) for (const [x, z] of grid) push(x, SEA_Y, z, 0)
  else
    for (let i = 0; i < SEGMENTS; i++) {
      const a0 = (i / SEGMENTS) * Math.PI * 2
      const a1 = ((i + 1) / SEGMENTS) * Math.PI * 2
      // Counter-clockwise seen from above (+y normal).
      push(0, SEA_Y, 0, 0)
      push(Math.cos(a1) * RADIUS, SEA_Y, Math.sin(a1) * RADIUS, 0)
      push(Math.cos(a0) * RADIUS, SEA_Y, Math.sin(a0) * RADIUS, 0)
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

/**
 * The river's hexes, source first. Only the hand map has one (shore.ts reads its course from the
 * hand map's river links); a repo's island has no river, so no river hexes and no flow.
 */
function riverOf(world: World): Cell[] {
  return world.kind === "hand" ? riverCells() : []
}

/** The land is what stands above this (world y): a wet strip of sea-level sand is under the water. */
export const LAND_ABOVE = SEA_Y + 0.02
/** Seen from below, a surface lower than this (world y) stands in the water: a post, a rock's foot. */
export const STANDS_BELOW = RIVER_Y + 0.35

/** What the shore bake draws, either backend: the two scenes, their cameras, and what they're read for. */
export interface ShoreSetup {
  /** The island's tiles, seen from above (`top`): land where they rise above the sea. */
  land: Scene
  top: OrthographicCamera
  /** The decor, seen from below (`up`): the lowest surfaces at the waterline. */
  below: Scene
  up: OrthographicCamera
  /** The pack's palette (the land mask tells its blue water apart), or null. */
  palette: Texture | null
  half: number
  size: number
  line: Spot[]
  wheel: Vector4
}

/** The bake's scenes and cameras, and the mill wheel's tailrace (no GPU work). */
function shoreSetup(nodes: Record<string, Object3D>, world: World, layout: ShoreLayout): ShoreSetup {
  const { half, size } = layout
  // The bake sees ±half: land past it would be open sea to the foam. Generated islands reach
  // ~104–120 (tile centres); say so if one ever grows past the edge rather than lose its coast.
  const reach = reachOf(world) + HEX_RADIUS
  if (reach > half)
    console.warn(`water: the island reaches ${reach.toFixed(0)}, the shore bake only ±${half}`)
  const line = world.kind === "hand" ? smooth(riverOf(world).map(cellToWorld), 3) : []
  const wheel = new Vector4()
  const land = new Scene()
  let palette: Texture | null = null
  for (const tile of world.island.tiles) {
    const source = nodes[tile.piece]
    if (!source) continue
    const copy = source.clone(true)
    copy.position.set(tile.x, tile.y ?? 0, tile.z)
    copy.rotation.set(0, tile.rot ?? 0, 0)
    copy.scale.setScalar(HEX_SCALE * (tile.scale ?? 1))
    copy.traverse((child) => {
      const mesh = child as Mesh
      if (mesh.isMesh && !palette) palette = (mesh.material as MeshStandardMaterial).map
    })
    land.add(copy)
  }
  const top = new OrthographicCamera(-half, half, half, -half, 1, 200)
  top.position.set(0, 100, 0)
  top.up.set(0, 0, -1)
  top.lookAt(0, 0, 0)
  top.updateMatrixWorld()

  // What stands in the water: the decor seen from *below*, where the lowest surface shows — a
  // post, a rock's foot, a wheel's rim at the waterline marks the mask; a bridge deck or a roof
  // overhead doesn't. Its distance goes in the alpha, for foam rings.
  const below = new Scene()
  for (const piece of world.island.decor) {
    const source = nodes[piece.piece]
    if (!source || AFLOAT.test(piece.piece)) continue
    const copy = source.clone(true)
    copy.position.set(piece.x, piece.y ?? 0, piece.z)
    copy.rotation.set(0, piece.rot ?? 0, 0)
    copy.scale.setScalar(HEX_SCALE * (piece.scale ?? 1))
    below.add(copy)
  }
  below.updateMatrixWorld(true)
  const axle = below.getObjectByName("building_watermill_wheel_blue")
  if (axle) {
    axle.getWorldPosition(scratch)
    const radius = new Box3().setFromObject(axle).getSize(size3).y / 2
    // The wheel turns beside the river, not in it: its water rejoins at the nearest bit of river.
    let best = Number.POSITIVE_INFINITY
    for (const [x, z] of line) {
      const d = Math.hypot(x - scratch.x, z - scratch.z)
      if (d < best) {
        best = d
        wheel.set(x, RIVER_Y, z, radius)
      }
    }
    if (best > 12) wheel.set(0, 0, 0, 0)
  }
  // Looking up: left and right swap so the image reads back in the same layout as the top view.
  const up = new OrthographicCamera(half, -half, half, -half, 1, 200)
  up.position.set(0, -100, 0)
  up.up.set(0, 0, -1)
  up.lookAt(0, 0, 0)
  up.updateMatrixWorld()
  return { land, top, below, up, palette, half, size, line, wheel }
}

/**
 * The shore texture from the two masks read back (RGBA, red > 127 marks; row 0 at z = +half, as
 * WebGL's readPixels lays them out): distance to land and the river's flow (shoreTexels), and the
 * distance to whatever stands in the water in the alpha.
 */
function shoreOf(setup: ShoreSetup, landPixels: Uint8Array, postPixels: Uint8Array): Shore {
  const { half, size } = setup
  const land = new Uint8Array(size * size)
  for (let i = 0; i < land.length; i++) land[i] = (landPixels[i * 4] as number) > 127 ? 1 : 0
  const texels = shoreTexels(land, setup.line, setup)
  const posts = new Uint8Array(size * size)
  for (let i = 0; i < posts.length; i++) posts[i] = (postPixels[i * 4] as number) > 127 ? 1 : 0
  const cell = (half * 2) / size
  const ring = distanceToLand(posts, size, size)
  for (let i = 0; i < posts.length; i++)
    texels[i * 4 + 3] = Math.round(Math.min(1, ((ring[i] as number) * cell) / RING_MAX) * 255)

  const texture = new DataTexture(texels, size, size, RGBAFormat)
  texture.magFilter = LinearFilter
  texture.minFilter = LinearFilter
  texture.needsUpdate = true
  return { texture, wheel: setup.wheel }
}

/**
 * Renders the island's tiles from straight above into a mask (land = above the water it borders
 * and not the pack's blue), reads it back and turns it into the shore texture. Once per world.
 * WebGL: GLSL masks, read back synchronously.
 */
function bakeShore(
  gl: WebGLRenderer,
  nodes: Record<string, Object3D>,
  world: World,
  layout: ShoreLayout,
): Shore {
  const setup = shoreSetup(nodes, world, layout)
  const { size } = setup
  const mask = new ShaderMaterial({
    uniforms: { map: { value: setup.palette } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying float vY;
      void main() {
        vUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vY = world.y;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      varying vec2 vUv;
      varying float vY;
      void main() {
        vec3 c = texture2D(map, vUv).rgb;
        bool blue = c.b > c.r + 0.1 && c.b > c.g;
        // Sea-level land below the sea surface (a wet strip of sand) is under the water too.
        float land = (!blue && vY > ${LAND_ABOVE.toFixed(3)}) ? 1.0 : 0.0;
        gl_FragColor = vec4(land, 0.0, 0.0, 1.0);
      }`,
  })
  setup.land.overrideMaterial = mask
  const target = new WebGLRenderTarget(size, size)
  const previous = gl.getRenderTarget()
  const clear = gl.getClearColor(new Color())
  const alpha = gl.getClearAlpha()
  const shadows = gl.shadowMap.autoUpdate
  gl.shadowMap.autoUpdate = false
  gl.setRenderTarget(target)
  gl.setClearColor(0x000000, 1)
  gl.clear()
  gl.render(setup.land, setup.top)
  const landPixels = new Uint8Array(size * size * 4)
  gl.readRenderTargetPixels(target, 0, 0, size, size, landPixels)
  gl.setRenderTarget(previous)
  target.dispose()
  mask.dispose()

  const standing = new ShaderMaterial({
    side: DoubleSide,
    vertexShader: /* glsl */ `
      varying float vY;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vY = world.y;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */ `
      varying float vY;
      void main() {
        gl_FragColor = vec4(vY < ${STANDS_BELOW.toFixed(3)} ? 1.0 : 0.0, 0.0, 0.0, 1.0);
      }`,
  })
  setup.below.overrideMaterial = standing
  const target2 = new WebGLRenderTarget(size, size)
  gl.setRenderTarget(target2)
  gl.setClearColor(0x000000, 1)
  gl.clear()
  gl.render(setup.below, setup.up)
  const postPixels = new Uint8Array(size * size * 4)
  gl.readRenderTargetPixels(target2, 0, 0, size, size, postPixels)
  gl.setRenderTarget(previous)
  gl.setClearColor(clear, alpha)
  gl.shadowMap.autoUpdate = shadows
  target2.dispose()
  standing.dispose()
  return shoreOf(setup, landPixels, postPixels)
}

/** The same bake on WebGPU: node-material masks (waterNodes.ts), each read back once, asynchronously. */
async function bakeShoreGPU(
  gl: object,
  nodes: Record<string, Object3D>,
  world: World,
  layout: ShoreLayout,
): Promise<Shore> {
  const setup = shoreSetup(nodes, world, layout)
  const { shoreMasks } = await import("./waterNodes.ts")
  const { land, posts } = await shoreMasks(gl, setup)
  return shoreOf(setup, land, posts)
}
