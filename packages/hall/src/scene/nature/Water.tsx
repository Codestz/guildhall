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
  Vector3,
  Vector4,
  type WebGLRenderer,
  WebGLRenderTarget,
} from "three"
import { reducedMotion } from "../../guild/opening.ts"
import type { Tier } from "../../guild/quality.ts"
import { useGuildStore } from "../../guild/useGuild.ts"
import { LANDS_URL } from "../../world/cast.ts"
import { cellToWorld, HEX_SCALE, island, MAP_FOR_TESTS } from "../../world/lands.ts"
import { LIGHTS } from "../../world/lights.ts"
import { useLooks } from "../atmosphere/looks.ts"
import { sky } from "../atmosphere/state.ts"
import { wind } from "../atmosphere/wind.ts"
import { installNodes, TSL } from "../tsl.ts"
import { EASE, targetOf } from "../weather/shared.ts"
import { noiseTexture } from "./noise.ts"
import { HEX_RADIUS } from "./scatter.ts"
import { waterFragment, waterVertex } from "./shaders.ts"
import { distanceToLand, riverCells, riverLine, SHORE, shoreTexels } from "./shore.ts"

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
 * With `?tsl=1` (scene/tsl.ts) the same water is a TSL node material (waterNodes.ts), reading the
 * same uniforms; it suspends while that loads. The shore bake stays GLSL either way.
 */
const SEA_Y = -0.2 * HEX_SCALE + 0.05
const RIVER_Y = -0.1 * HEX_SCALE + 0.06

export function Water({ tier }: { tier: Tier }) {
  const store = useGuildStore()
  const gl = useThree((state) => state.gl)
  const { nodes } = useGLTF(LANDS_URL) as unknown as { nodes: Record<string, Object3D> }
  const geometry = useMemo(surface, [])
  const v2 = useLooks().water
  const build = TSL ? use(nodeWater(gl)) : waterMaterial
  // The node material's shadow is the key light's own (waterNodes.ts): found once it has a map.
  const [key, setKey] = useState<DirectionalLight | null>(null)
  const { material, uniforms } = useMemo(() => build(tier === 0, v2, key), [build, tier, v2, key])
  const eased = useMemo(() => ({ rain: 0, gloom: 0, cloud: 0, pick: 0, caustics: 0 }), [])
  const still = useMemo(reducedMotion, [])

  // The shore texture: render the tiles' land mask from above once (after the first commit, so a
  // suspended render never pays for it), then measure it on the CPU. Kept for the page's life.
  useEffect(() => {
    shore ??= bakeShore(gl, nodes)
    uniforms.uShore.value = shore
    uniforms.uWheel.value.copy(wheel)
  }, [gl, nodes, uniforms])
  useEffect(() => () => material.dispose(), [material])
  useEffect(() => () => geometry.dispose(), [geometry])

  useFrame((state, delta) => {
    if (TSL && !key?.parent) {
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
      nearestFlames(targetOf(state.controls), u.uFlames.value)
    }
  })

  return (
    <mesh
      name="nature-water"
      geometry={geometry}
      material={material}
      receiveShadow
      frustumCulled={false}
      renderOrder={-1}
    />
  )
}

/** The water's material, either path, and the uniforms it reads (Water writes them each frame). */
interface WaterMaterial {
  material: Material
  uniforms: WaterUniforms
}
type Build = (low: boolean, v2: boolean, key: DirectionalLight | null) => WaterMaterial

const nodeBuilds = new WeakMap<WebGLRenderer, Promise<Build>>()

/** The node-material water, once the renderer can draw it (one promise per renderer, for `use`). */
function nodeWater(gl: WebGLRenderer): Promise<Build> {
  let build = nodeBuilds.get(gl)
  if (!build) {
    build = installNodes(gl)
      .then(() => import("./waterNodes.ts"))
      .then(({ waterNodeMaterial }) => (low, v2, key) => {
        const uniforms = waterUniforms()
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
/** Flames close enough to water to be reflected in it (the rest never are). */
const WATERSIDE = (() => {
  const water = island().water
  const reach = HEX_RADIUS + 7
  return LIGHTS.map((light) => light.flame).filter(([x, , z]) =>
    water.some(([wx, wz]) => Math.hypot(wx - x, wz - z) < reach),
  )
})()
const byDistance: { flame: readonly [number, number, number]; d: number }[] = WATERSIDE.map((flame) => ({
  flame,
  d: 0,
}))
/** Writes the FLAMES waterside flames nearest `at` into `out` (w = 1), the rest w = 0. */
function nearestFlames(at: Vector3, out: Vector4[] | undefined): void {
  if (!out) return
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
let shore: DataTexture | undefined
/** Where the mill wheel's water rejoins the river (xyz) and the wheel's radius (w), found by the bake; w = 0 until then (no wake). */
const wheel = new Vector4()
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
    uShore: { value: shore ?? OPEN_SEA },
    uShoreHalf: { value: SHORE.half },
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
 * hex at the river's height; `aRiver` tells the shader which is which.
 */
function surface(): BufferGeometry {
  const positions: number[] = []
  const river: number[] = []
  const push = (x: number, y: number, z: number, r: number) => {
    positions.push(x, y, z)
    river.push(r)
  }
  const SEGMENTS = 96
  const RADIUS = 420
  for (let i = 0; i < SEGMENTS; i++) {
    const a0 = (i / SEGMENTS) * Math.PI * 2
    const a1 = ((i + 1) / SEGMENTS) * Math.PI * 2
    // Counter-clockwise seen from above (+y normal).
    push(0, SEA_Y, 0, 0)
    push(Math.cos(a1) * RADIUS, SEA_Y, Math.sin(a1) * RADIUS, 0)
    push(Math.cos(a0) * RADIUS, SEA_Y, Math.sin(a0) * RADIUS, 0)
  }
  for (const cell of riverCells()) {
    const char = MAP_FOR_TESTS.at(cell)
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
  if (TSL)
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
 * Renders the island's tiles from straight above into a mask (land = above the water it borders
 * and not the pack's blue), reads it back and turns it into the shore texture. Once, at start.
 */
function bakeShore(gl: WebGLRenderer, nodes: Record<string, Object3D>): DataTexture {
  const { half, size } = SHORE
  const scene = new Scene()
  let palette: Texture | null = null
  for (const tile of island().tiles) {
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
    scene.add(copy)
  }
  const mask = new ShaderMaterial({
    uniforms: { map: { value: palette } },
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
        float land = (!blue && vY > ${(SEA_Y + 0.02).toFixed(3)}) ? 1.0 : 0.0;
        gl_FragColor = vec4(land, 0.0, 0.0, 1.0);
      }`,
  })
  scene.overrideMaterial = mask
  const camera = new OrthographicCamera(-half, half, half, -half, 1, 200)
  camera.position.set(0, 100, 0)
  camera.up.set(0, 0, -1)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  const target = new WebGLRenderTarget(size, size)
  const previous = gl.getRenderTarget()
  const clear = gl.getClearColor(new Color())
  const alpha = gl.getClearAlpha()
  const shadows = gl.shadowMap.autoUpdate
  gl.shadowMap.autoUpdate = false
  gl.setRenderTarget(target)
  gl.setClearColor(0x000000, 1)
  gl.clear()
  gl.render(scene, camera)
  const pixels = new Uint8Array(size * size * 4)
  gl.readRenderTargetPixels(target, 0, 0, size, size, pixels)
  gl.setRenderTarget(previous)
  target.dispose()
  mask.dispose()

  // readPixels' row 0 is the bottom of the image (z = +half): the layout shoreTexels expects.
  const land = new Uint8Array(size * size)
  for (let i = 0; i < land.length; i++) land[i] = (pixels[i * 4] as number) > 127 ? 1 : 0
  const texels = shoreTexels(land)

  // What stands in the water: the decor seen from *below*, where the lowest surface shows — a
  // post, a rock's foot, a wheel's rim at the waterline marks the mask; a bridge deck or a roof
  // overhead doesn't. Its distance goes in the alpha, for foam rings.
  const below = new Scene()
  for (const piece of island().decor) {
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
    for (const [x, z] of riverLine()) {
      const d = Math.hypot(x - scratch.x, z - scratch.z)
      if (d < best) {
        best = d
        wheel.set(x, RIVER_Y, z, radius)
      }
    }
    if (best > 12) wheel.set(0, 0, 0, 0)
  }
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
        gl_FragColor = vec4(vY < ${(RIVER_Y + 0.35).toFixed(3)} ? 1.0 : 0.0, 0.0, 0.0, 1.0);
      }`,
  })
  below.overrideMaterial = standing
  // Looking up: left and right swap so the image reads back in the same layout as the top view.
  const up = new OrthographicCamera(half, -half, half, -half, 1, 200)
  up.position.set(0, -100, 0)
  up.up.set(0, 0, -1)
  up.lookAt(0, 0, 0)
  up.updateMatrixWorld()
  const target2 = new WebGLRenderTarget(size, size)
  gl.setRenderTarget(target2)
  gl.setClearColor(0x000000, 1)
  gl.clear()
  gl.render(below, up)
  gl.readRenderTargetPixels(target2, 0, 0, size, size, pixels)
  gl.setRenderTarget(previous)
  gl.setClearColor(clear, alpha)
  gl.shadowMap.autoUpdate = shadows
  target2.dispose()
  standing.dispose()
  const posts = new Uint8Array(size * size)
  for (let i = 0; i < posts.length; i++) posts[i] = (pixels[i * 4] as number) > 127 ? 1 : 0
  const cell = (half * 2) / size
  const ring = distanceToLand(posts, size, size)
  for (let i = 0; i < posts.length; i++)
    texels[i * 4 + 3] = Math.round(Math.min(1, ((ring[i] as number) * cell) / RING_MAX) * 255)

  const texture = new DataTexture(texels, size, size, RGBAFormat)
  texture.magFilter = LinearFilter
  texture.minFilter = LinearFilter
  texture.needsUpdate = true
  return texture
}
