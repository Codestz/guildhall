import { useGLTF } from "@react-three/drei"
import { useFrame, useThree } from "@react-three/fiber"
import { use, useMemo, useState } from "react"
import {
  BufferGeometry,
  Color,
  type DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedMesh,
  type Material,
  MathUtils,
  Matrix4,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  Quaternion,
  ShaderMaterial,
  type Texture,
  UniformsLib,
  UniformsUtils,
  Vector3,
  type WebGLRenderer,
} from "three"
import type { Tier } from "../../guild/quality.ts"
import { useGuildStore } from "../../guild/useGuild.ts"
import { isWebGPU } from "../../render/backend.ts"
import { LANDS_URL } from "../../world/cast.ts"
import { useWorld } from "../../world/source.ts"
import { handWorld, type World } from "../../world/world.ts"
import { sky } from "../atmosphere/state.ts"
import { wind } from "../atmosphere/wind.ts"
import { useOwnedMeshes } from "../owned.ts"
import { installNodes, TSL } from "../tsl.ts"
import { FLOWERS, scatter, type Tuft } from "./scatter.ts"
import { grassFragment, grassVertex } from "./shaders.ts"

/**
 * Grass and wild flowers on the meadows (ADR 0007, Nature): two InstancedMeshes (tufts, and the
 * few tufts' flowers), two draw calls, sharing one set of uniforms.
 * Every tuft sways on the GPU with the wind; frost and snow settle on the blades below freezing;
 * rain darkens them and gives them a sheen. Low quality grows none.
 *
 * GLSL by default. The same grass as TSL node materials (grassNodes.ts) on WebGPU, always, and on
 * WebGL with `?tsl=1` (scene/tsl.ts), fed the same uniforms; it suspends while that loads.
 */
const DENSITY: Record<Tier, number> = { 0: 0, 1: 150, 2: 240, 3: 340 }

export function Grass({ tier }: { tier: Tier }) {
  const store = useGuildStore()
  const gl = useThree((state) => state.gl)
  const { nodes } = useGLTF(LANDS_URL) as unknown as { nodes: Record<string, Object3D> }
  const world = useWorld()
  const node = isWebGPU(gl) || TSL
  const build = node ? use(nodeGrass(gl)) : glslGrass
  // The node materials' shadow is the key light's own (grassNodes.ts): found once it has a map.
  const [key, setKey] = useState<DirectionalLight | null>(null)
  // Geometry, materials and meshes are this mount's own (scene/owned.ts); the palette is the land's.
  const built = useOwnedMeshes(
    () => {
      if (DENSITY[tier] === 0) return { meshes: [], uniforms: null }
      const uniforms = grassUniforms(paletteOf(nodes))
      const meshes = meadow({ tuft: tuft(), flower: flower() }, build(uniforms, key), DENSITY[tier], world)
      return { meshes, uniforms }
    },
    [nodes, tier, world, build, key],
    "textures",
  )
  const eased = useMemo(() => ({ snow: 0, wet: 0 }), [])

  useFrame((state, delta) => {
    const u = built?.uniforms
    if (!u) return
    if (node && !key?.parent) {
      const found = keyLight(state.scene)
      if (found !== key) setKey(found)
    }
    const env = store.environment
    const snowing = env.weather === "snow" || env.temperature < 0
    // Snow builds up and melts slowly; frost alone (cold, no snow falling) is a light dusting.
    const snow = env.weather === "snow" ? 0.55 + 0.45 * env.precipitation : snowing ? 0.3 : 0
    eased.snow = MathUtils.damp(eased.snow, snow, 0.5, delta)
    eased.wet = MathUtils.damp(eased.wet, snowing ? 0 : Math.min(1, env.precipitation * 1.4), 0.8, delta)
    u.uSnow.value = eased.snow
    u.uWet.value = eased.wet
    u.uKeyIntensity.value = sky.keyIntensity
    u.uHemiIntensity.value = sky.hemiIntensity
    const [x, y, z] = sky.keyDirection
    u.uKeyDir.value.set(x, y, z)
  })

  return (
    <>
      {built?.meshes.map((mesh) => (
        <primitive key={mesh.uuid} object={mesh} />
      ))}
    </>
  )
}

function paletteOf(nodes: Record<string, Object3D>): Texture | null {
  let map: Texture | null = null
  nodes.hex_grass?.traverse((child) => {
    const mesh = child as Mesh
    if (mesh.isMesh && !map) map = (mesh.material as MeshStandardMaterial).map
  })
  return map
}

/**
 * What the grass is fed, either path (Grass writes them each frame). Shared by reference: the
 * sky's colours, and the one wind (atmosphere/wind.ts).
 */
export function grassUniforms(palette: Texture | null) {
  return {
    ...wind.uniforms,
    uSnow: { value: 0 },
    uWet: { value: 0 },
    uKeyIntensity: { value: 1 },
    uHemiIntensity: { value: 1 },
    uKeyDir: { value: new Vector3(0, 1, 0) },
    uPalette: { value: palette },
    uKeyColor: { value: sky.keyColor },
    uHemiSky: { value: sky.hemiSky },
    uHemiGround: { value: sky.hemiGround },
  }
}
export type GrassUniforms = ReturnType<typeof grassUniforms>

/** The tufts' material and the flowers', both reading the one set of uniforms. */
interface Meadow {
  tuft: Material
  flower: Material
}
type Build = (uniforms: GrassUniforms, key: DirectionalLight | null) => Meadow

/** The GLSL grass (the default on WebGL): one shader, the flowers' twin built with FLOWERS. */
export function glslGrass(uniforms: GrassUniforms): Meadow {
  const shared = Object.assign(UniformsUtils.merge([UniformsLib.lights, UniformsLib.fog]), uniforms)
  const material = (defines: Record<string, string>) =>
    new ShaderMaterial({
      uniforms: shared,
      vertexShader: grassVertex,
      fragmentShader: grassFragment,
      lights: true,
      fog: true,
      side: DoubleSide,
      defines,
    })
  return { tuft: material({}), flower: material({ FLOWERS: "" }) }
}

const nodeBuilds = new WeakMap<object, Promise<Build>>()

/**
 * The node-material grass, once the renderer can draw it (one promise per renderer, for `use`).
 * WebGPU draws node materials natively; WebGL needs the nodes handler first.
 */
function nodeGrass(gl: WebGLRenderer): Promise<Build> {
  let build = nodeBuilds.get(gl)
  if (!build) {
    const ready = isWebGPU(gl) ? Promise.resolve() : installNodes(gl)
    build = ready
      .then(() => import("./grassNodes.ts"))
      .then(({ grassNodeMaterial }) => (uniforms, key) => ({
        tuft: grassNodeMaterial(uniforms, { flowers: false, key }),
        flower: grassNodeMaterial(uniforms, { flowers: true, key }),
      }))
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

/** Exported for tests. */
export function meadow(
  geometries: { tuft: BufferGeometry; flower: BufferGeometry },
  materials: Meadow,
  density: number,
  world: World = handWorld(),
): InstancedMesh[] {
  const tufts = scatter(world.island, density, undefined, world.kind === "hand")
  if (tufts.length === 0) return []
  const flowered = tufts.filter((tuft) => tuft.flower >= 0)
  const grass = new InstancedMesh(geometries.tuft, materials.tuft, tufts.length)
  const flowers = new InstancedMesh(geometries.flower, materials.flower, Math.max(1, flowered.length))
  const tints = new Float32Array(Math.max(1, flowered.length) * 3)
  const colours = FLOWERS.map((hex) => new Color(hex))
  const matrix = new Matrix4()
  const position = new Vector3()
  const rotation = new Quaternion()
  const scale = new Vector3()
  const up = new Vector3(0, 1, 0)
  const place = (mesh: InstancedMesh, i: number, tuft: Tuft, stretch: number) => {
    position.set(tuft.x, 0, tuft.z)
    rotation.setFromAxisAngle(up, tuft.rot)
    scale.set(tuft.scale, tuft.scale * stretch, tuft.scale)
    mesh.setMatrixAt(i, matrix.compose(position, rotation, scale))
  }
  tufts.forEach((tuft, i) => {
    place(grass, i, tuft, 0.8 + 0.4 * ((i * 0.618) % 1))
  })
  flowered.forEach((tuft, i) => {
    place(flowers, i, tuft, 1)
    const colour = colours[tuft.flower] ?? (colours[0] as Color)
    tints[i * 3] = colour.r
    tints[i * 3 + 1] = colour.g
    tints[i * 3 + 2] = colour.b
  })
  flowers.count = flowered.length
  // The flower geometry is shared across tier rebuilds: replacing aTint would orphan the old one's GPU
  // buffer, so free the geometry's buffers first (they upload again on the next draw).
  if (geometries.flower.getAttribute("aTint")) geometries.flower.dispose()
  geometries.flower.setAttribute("aTint", new InstancedBufferAttribute(tints, 3))
  grass.name = "nature-grass"
  flowers.name = "nature-flowers"
  for (const mesh of [grass, flowers]) {
    mesh.castShadow = false
    mesh.receiveShadow = true
    mesh.computeBoundingSphere()
    mesh.instanceMatrix.needsUpdate = true
  }
  return flowered.length > 0 ? [grass, flowers] : [grass]
}

type Push = (x: number, y: number, z: number, h: number, head: number) => void
function builder(): { vertex: Push; done(): BufferGeometry } {
  const positions: number[] = []
  const uvs: number[] = []
  // Straight up, as the GLSL lights them; the node materials' shadow offsets along it (normalBias).
  const normals: number[] = []
  return {
    vertex(x, y, z, h, head) {
      positions.push(x, y, z)
      normals.push(0, 1, 0)
      uvs.push(head, h)
    },
    done() {
      const geometry = new BufferGeometry()
      geometry.setAttribute("position", new Float32BufferAttribute(positions, 3))
      geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3))
      geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2))
      return geometry
    },
  }
}

/** One tuft: seven blades leaning out from the centre. `uv.y` is height (0 root, 1 tip). */
function tuft(): BufferGeometry {
  const { vertex, done } = builder()
  const BLADES = 7
  for (let b = 0; b < BLADES; b++) {
    const a = (b / BLADES) * Math.PI * 2 + (b % 2) * 0.4
    const r = 0.06 + (b % 3) * 0.06
    const height = 0.5 + ((b * 37) % 5) * 0.08
    const lean = 0.14 + (b % 2) * 0.12
    const cx = Math.cos(a)
    const sz = Math.sin(a)
    // The blade's face lies across the radial direction.
    const wx = -sz * 0.07
    const wz = cx * 0.07
    const bx = cx * r
    const bz = sz * r
    vertex(bx - wx, 0, bz - wz, 0, 0)
    vertex(bx + wx, 0, bz + wz, 0, 0)
    vertex(bx + cx * lean, height, bz + sz * lean, 1, 0)
  }
  return done()
}

/** A flower: a thin stalk and a five-petal star facing up (what a high camera sees). */
function flower(): BufferGeometry {
  const { vertex, done } = builder()
  const stalk = 0.55
  const [cx, cz] = [0.04, 0.02]
  vertex(-0.02, 0, 0, 0, 0)
  vertex(0.02, 0, 0, 0, 0)
  vertex(cx, stalk, cz, 1, 0)
  const head = 0.17
  const PETALS = 5
  for (let k = 0; k < PETALS; k++) {
    const a1 = ((k + 0.5) / PETALS) * Math.PI * 2
    const a0 = (k / PETALS) * Math.PI * 2
    const a2 = ((k + 1) / PETALS) * Math.PI * 2
    const tip: [number, number, number] = [cx + Math.cos(a1) * head, stalk, cz + Math.sin(a1) * head]
    vertex(cx + Math.cos(a0) * head * 0.3, stalk + 0.02, cz + Math.sin(a0) * head * 0.3, 1, 1)
    vertex(...tip, 1, 1)
    vertex(cx + Math.cos(a2) * head * 0.3, stalk + 0.02, cz + Math.sin(a2) * head * 0.3, 1, 1)
  }
  // The centre, a touch higher so it reads as a disc.
  for (let k = 0; k < PETALS; k++) {
    const a0 = (k / PETALS) * Math.PI * 2
    const a2 = ((k + 1) / PETALS) * Math.PI * 2
    vertex(cx, stalk + 0.04, cz, 1, 1)
    vertex(cx + Math.cos(a2) * head * 0.3, stalk + 0.02, cz + Math.sin(a2) * head * 0.3, 1, 1)
    vertex(cx + Math.cos(a0) * head * 0.3, stalk + 0.02, cz + Math.sin(a0) * head * 0.3, 1, 1)
  }
  return done()
}
