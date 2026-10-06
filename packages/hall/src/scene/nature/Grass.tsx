import { useGLTF } from "@react-three/drei"
import { useFrame } from "@react-three/fiber"
import { useMemo } from "react"
import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedMesh,
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
} from "three"
import type { Tier } from "../../guild/quality.ts"
import { useGuildStore } from "../../guild/useGuild.ts"
import { LANDS_URL } from "../../world/cast.ts"
import { island } from "../../world/lands.ts"
import { sky } from "../atmosphere/state.ts"
import { wind } from "../atmosphere/wind.ts"
import { useOwnedMeshes } from "../owned.ts"
import { FLOWERS, scatter, type Tuft } from "./scatter.ts"
import { grassFragment, grassVertex } from "./shaders.ts"

/**
 * Grass and wild flowers on the meadows (ADR 0007, Nature): two InstancedMeshes (tufts, and the
 * few tufts' flowers), two draw calls, sharing one set of uniforms.
 * Every tuft sways on the GPU with the wind; frost and snow settle on the blades below freezing;
 * rain darkens them and gives them a sheen. Low quality grows none.
 */
const DENSITY: Record<Tier, number> = { 0: 0, 1: 150, 2: 240, 3: 340 }

export function Grass({ tier }: { tier: Tier }) {
  const store = useGuildStore()
  const { nodes } = useGLTF(LANDS_URL) as unknown as { nodes: Record<string, Object3D> }
  // Geometry, materials and meshes are this mount's own (scene/owned.ts); the palette is the land's.
  const built = useOwnedMeshes(
    () => {
      if (DENSITY[tier] === 0) return { meshes: [], material: null }
      const material = grassMaterial(paletteOf(nodes))
      return { meshes: meadow({ tuft: tuft(), flower: flower() }, material, DENSITY[tier]), material }
    },
    [nodes, tier],
    "textures",
  )
  const eased = useMemo(() => ({ snow: 0, wet: 0 }), [])

  useFrame((_, delta) => {
    const material = built?.material
    if (!material) return
    const env = store.environment
    const u = material.uniforms
    const snowing = env.weather === "snow" || env.temperature < 0
    // Snow builds up and melts slowly; frost alone (cold, no snow falling) is a light dusting.
    const snow = env.weather === "snow" ? 0.55 + 0.45 * env.precipitation : snowing ? 0.3 : 0
    eased.snow = MathUtils.damp(eased.snow, snow, 0.5, delta)
    eased.wet = MathUtils.damp(eased.wet, snowing ? 0 : Math.min(1, env.precipitation * 1.4), 0.8, delta)
    ;(u.uSnow as { value: number }).value = eased.snow
    ;(u.uWet as { value: number }).value = eased.wet
    ;(u.uKeyIntensity as { value: number }).value = sky.keyIntensity
    ;(u.uHemiIntensity as { value: number }).value = sky.hemiIntensity
    const [x, y, z] = sky.keyDirection
    ;(u.uKeyDir as { value: Vector3 }).value.set(x, y, z)
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

function grassMaterial(palette: Texture | null): ShaderMaterial {
  const material = new ShaderMaterial({
    uniforms: UniformsUtils.merge([
      UniformsLib.lights,
      UniformsLib.fog,
      {
        uSnow: { value: 0 },
        uWet: { value: 0 },
        uKeyIntensity: { value: 1 },
        uHemiIntensity: { value: 1 },
        uKeyDir: { value: new Vector3(0, 1, 0) },
      },
    ]),
    vertexShader: grassVertex,
    fragmentShader: grassFragment,
    lights: true,
    fog: true,
    side: DoubleSide,
  })
  // Shared by reference: the sky's colours, and the one wind (atmosphere/wind.ts).
  const u = material.uniforms
  Object.assign(u, wind.uniforms)
  u.uPalette = { value: palette }
  u.uKeyColor = { value: sky.keyColor }
  u.uHemiSky = { value: sky.hemiSky }
  u.uHemiGround = { value: sky.hemiGround }
  return material
}

/** Each grass material's flower twin: same shaders and the very same uniforms object. */
const flowerMaterials = new WeakMap<ShaderMaterial, ShaderMaterial>()
function flowerMaterialOf(material: ShaderMaterial): ShaderMaterial {
  let twin = flowerMaterials.get(material)
  if (!twin) {
    twin = new ShaderMaterial({
      uniforms: material.uniforms,
      vertexShader: grassVertex,
      fragmentShader: grassFragment,
      lights: true,
      fog: true,
      side: DoubleSide,
      defines: { FLOWERS: "" },
    })
    flowerMaterials.set(material, twin)
  }
  return twin
}

/** Exported for tests. */
export function meadow(
  geometries: { tuft: BufferGeometry; flower: BufferGeometry },
  material: ShaderMaterial,
  density: number,
): InstancedMesh[] {
  const tufts = scatter(island(), density)
  if (tufts.length === 0) return []
  const flowered = tufts.filter((tuft) => tuft.flower >= 0)
  const grass = new InstancedMesh(geometries.tuft, material, tufts.length)
  const flowers = new InstancedMesh(
    geometries.flower,
    flowerMaterialOf(material),
    Math.max(1, flowered.length),
  )
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
  return {
    vertex(x, y, z, h, head) {
      positions.push(x, y, z)
      uvs.push(head, h)
    },
    done() {
      const geometry = new BufferGeometry()
      geometry.setAttribute("position", new Float32BufferAttribute(positions, 3))
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
