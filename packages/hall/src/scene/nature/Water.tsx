import { useGLTF } from "@react-three/drei"
import { useFrame, useThree } from "@react-three/fiber"
import { useEffect, useMemo } from "react"
import {
  BufferGeometry,
  Color,
  DataTexture,
  Float32BufferAttribute,
  LinearFilter,
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
import type { Tier } from "../../guild/quality.ts"
import { useGuildStore } from "../../guild/useGuild.ts"
import { LANDS_URL } from "../../world/cast.ts"
import { cellToWorld, HEX_SCALE, island, MAP_FOR_TESTS } from "../../world/lands.ts"
import { LIGHTS } from "../../world/lights.ts"
import { sky } from "../atmosphere/state.ts"
import { EASE, targetOf, WIND_DIRECTION } from "../weather/shared.ts"
import { noiseTexture } from "./noise.ts"
import { HEX_RADIUS } from "./scatter.ts"
import { waterFragment, waterVertex } from "./shaders.ts"
import { riverCells, SHORE, shoreTexels } from "./shore.ts"

/**
 * The island's water (ADR 0007, Nature): one surface, one draw call, for the sea, the lake and the
 * river. It lies a hair above the pack's flat water (sea and lake at y −1, the river's channel at
 * −0.5), so the land's own geometry clips it exactly where the tiles put the shore — no seams to
 * hide. What it can't see from the tiles it reads from a texture baked once at start: how far each
 * point of water is from land (foam, shallows) and which way the river runs there (its flow).
 */
const SEA_Y = -0.2 * HEX_SCALE + 0.05
const RIVER_Y = -0.1 * HEX_SCALE + 0.06

export function Water({ tier }: { tier: Tier }) {
  const store = useGuildStore()
  const gl = useThree((state) => state.gl)
  const { nodes } = useGLTF(LANDS_URL) as unknown as { nodes: Record<string, Object3D> }
  const geometry = useMemo(surface, [])
  const material = useMemo(() => waterMaterial(tier === 0), [tier])
  const eased = useMemo(() => ({ wind: 0.2, rain: 0, gloom: 0, cloud: 0, pick: 0 }), [])

  // The shore texture: render the tiles' land mask from above once (after the first commit, so a
  // suspended render never pays for it), then measure it on the CPU. Kept for the page's life.
  useEffect(() => {
    shore ??= bakeShore(gl, nodes)
    if (material.uniforms.uShore) material.uniforms.uShore.value = shore
  }, [gl, nodes, material])
  useEffect(() => () => material.dispose(), [material])
  useEffect(() => () => geometry.dispose(), [geometry])

  useFrame((state, delta) => {
    const env = store.environment
    const u = material.uniforms
    eased.wind = MathUtils.damp(eased.wind, env.wind, EASE, delta)
    eased.rain = MathUtils.damp(eased.rain, env.weather === "snow" ? 0 : env.precipitation, EASE, delta)
    eased.gloom = MathUtils.damp(
      eased.gloom,
      env.weather === "storm" ? 1 : env.weather === "rain" ? 0.4 : 0,
      EASE,
      delta,
    )
    eased.cloud = MathUtils.damp(eased.cloud, env.cloudCover, EASE, delta)
    setUniform(u.uTime, state.clock.elapsedTime)
    setUniform(u.uWind, eased.wind)
    setUniform(u.uRain, eased.rain)
    setUniform(u.uGloom, eased.gloom)
    setUniform(u.uCloud, eased.cloud)
    setUniform(u.uKeyIntensity, sky.keyIntensity)
    setUniform(u.uHemiIntensity, sky.hemiIntensity)
    setUniform(u.uFlash, sky.flash)
    const [x, y, z] = sky.keyDirection
    ;(u.uKeyDir as { value: Vector3 }).value.set(x, y, z)
    // A photogenic moon: its path swings round towards where the camera looks, so the diorama's
    // high, fixed angle still sees it (a true mirror image is mostly behind or off screen).
    const [mx, my, mz] = env.moon
    state.camera.getWorldDirection(look)
    look.y = 0
    look.normalize()
    const lift = Math.max(0.15, Math.min(0.75, (my + 0.6) * 0.5))
    ;(u.uMoonDir as { value: Vector3 }).value
      .set(mx, 0, mz)
      .normalize()
      .lerp(look, 0.75)
      .setY(0)
      .normalize()
      .multiplyScalar(Math.sqrt(1 - lift * lift))
      .setY(lift)
    setUniform(u.uNight, sky.night)
    setUniform(u.uMoon, sky.moonDisc * sky.night)
    setUniform(u.uLamps, sky.lamps * sky.night)
    // The flames nearest what the camera looks at, re-picked twice a second (no per-frame garbage).
    eased.pick -= delta
    if (eased.pick <= 0) {
      eased.pick = 0.5
      nearestFlames(targetOf(state.controls), u.uFlames?.value as Vector4[])
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

const setUniform = (uniform: { value: unknown } | undefined, value: number) => {
  if (uniform) uniform.value = value
}

/** Deep and shallow water (sRGB, softened like the tiles); the sky lights them. */
const DEEP = new Color("#1d6aa6")
const SHALLOW = new Color("#3fb0b8")

const noise = noiseTexture()
const look = new Vector3()

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

function waterMaterial(low: boolean): ShaderMaterial {
  const material = new ShaderMaterial({
    uniforms: UniformsUtils.merge([
      UniformsLib.lights,
      UniformsLib.fog,
      {
        uTime: { value: 0 },
        uNoise: { value: null },
        uShoreHalf: { value: SHORE.half },
        uShoreMax: { value: SHORE.maxDistance },
        uWind: { value: 0.2 },
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
        uWindDir: { value: new Vector2(WIND_DIRECTION.x, WIND_DIRECTION.z) },
      },
    ]),
    vertexShader: waterVertex,
    fragmentShader: waterFragment,
    lights: true,
    fog: true,
    defines: low ? { NATURE_LOW: "", FLAMES } : { FLAMES },
  })
  // UniformsUtils.merge clones values; shared objects (the sky's colours, the noise) are attached
  // after, by reference, so the sky's per-frame writes reach the shader with no copying.
  const u = material.uniforms
  u.uShore = { value: shore ?? OPEN_SEA }
  u.uFlames = { value: Array.from({ length: FLAMES }, () => new Vector4()) }
  u.uMoonColor = { value: sky.moonColor }
  u.uNoise = { value: noise }
  u.uZenith = { value: sky.zenith }
  u.uHorizon = { value: sky.horizon }
  u.uKeyColor = { value: sky.keyColor }
  u.uHemiSky = { value: sky.hemiSky }
  u.uHemiGround = { value: sky.hemiGround }
  u.uDeep = { value: DEEP }
  u.uShallow = { value: SHALLOW }
  return material
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
  gl.setClearColor(clear, alpha)
  gl.shadowMap.autoUpdate = shadows
  target.dispose()
  mask.dispose()

  // readPixels' row 0 is the bottom of the image (z = +half): the layout shoreTexels expects.
  const land = new Uint8Array(size * size)
  for (let i = 0; i < land.length; i++) land[i] = (pixels[i * 4] as number) > 127 ? 1 : 0
  const texture = new DataTexture(shoreTexels(land), size, size, RGBAFormat)
  texture.magFilter = LinearFilter
  texture.minFilter = LinearFilter
  texture.needsUpdate = true
  return texture
}
