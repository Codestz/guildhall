import { useGLTF } from "@react-three/drei"
import { useFrame } from "@react-three/fiber"
import { useMemo } from "react"
import {
  BoxGeometry,
  type BufferGeometry,
  Color,
  InstancedMesh,
  type Material,
  Matrix4,
  type Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  Quaternion,
  Vector3,
} from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import { FORGE_BUCKETS, workTreesOf } from "../../world/behaviours.ts"
import type { Spot } from "../../world/layout.ts"
import { useWorld } from "../../world/source.ts"
import { KitPiece, plain } from "../Kit.tsx"
import { FOREST_URL } from "../nature/Wilds.tsx"
import { useOwnedMeshes } from "../owned.ts"
import { arrowGeometry } from "./shapes.ts"
import { BEAT_KINDS, beats, RING } from "./work.ts"

/**
 * What working looks like between the results (world/behaviours.ts, ADR 0009): wood chips off an
 * axe, stone chips off a pickaxe, sparks off an anvil, steam from the quench, a splash where the
 * float lands, arrows in flight, pages and motes. Drawn from the beats adventurers write
 * (life/work.ts). Also the props the loops need: the forest's work trees, which shake on every bite,
 * and a second quench bucket at the keep's forge.
 *
 * Nothing here is a result: the piles (Piles.tsx) still grow only from completed deeds. An arrow
 * that lands is gone again in a moment; the arrows that stay in the targets are the hits.
 * Draw calls: particles 1, arrows 1, work trees 1 (+1 in a shadow redraw), bucket 1.
 */
const PARTICLES = 160
const ARROWS = 8
/** Seconds an arrow flies, then stays in the board before it is pulled. */
const FLIGHT_S = 0.42
const STUCK_S = 1.8

interface Recipe {
  count: number
  color: Color
  /** Outward speed, upward speed (world units/s) and gravity (negative: it rises). */
  out: number
  up: number
  gravity: number
  life: number
  size: number
  /** Grows as it ages (puffs) rather than shrinking (chips). */
  grows?: boolean
}

const hdr = (hex: string, by: number): Color => new Color(hex).multiplyScalar(by)

const RECIPES: Record<(typeof BEAT_KINDS)[number], Recipe> = {
  chop: { count: 5, color: new Color("#c9a06a"), out: 2.4, up: 2.6, gravity: 9, life: 0.6, size: 0.1 },
  chip: { count: 6, color: new Color("#a4a4a0"), out: 2.8, up: 3, gravity: 9, life: 0.6, size: 0.11 },
  spark: { count: 8, color: hdr("#ffa640", 4), out: 2.4, up: 3.4, gravity: 9, life: 0.5, size: 0.06 },
  steam: {
    count: 7,
    color: new Color("#dfe6ea"),
    out: 0.35,
    up: 1.1,
    gravity: -0.5,
    life: 1.5,
    size: 0.2,
    grows: true,
  },
  splash: { count: 7, color: new Color("#bfe3f2"), out: 1.4, up: 2.6, gravity: 9, life: 0.55, size: 0.08 },
  arrow: { count: 0, color: new Color("#ffffff"), out: 0, up: 0, gravity: 0, life: 0, size: 0 },
  page: { count: 3, color: new Color("#efe6c8"), out: 0.5, up: 0.9, gravity: -0.3, life: 1.2, size: 0.1 },
  pin: { count: 3, color: new Color("#c94a3a"), out: 0.6, up: 1, gravity: 4, life: 0.6, size: 0.08 },
  magic: { count: 6, color: hdr("#b78cff", 3), out: 0.6, up: 1.4, gravity: -0.8, life: 1, size: 0.08 },
  dust: {
    count: 6,
    color: new Color("#b39a7a"),
    out: 1,
    up: 0.5,
    gravity: 0.5,
    life: 0.8,
    size: 0.15,
    grows: true,
  },
  sawdust: { count: 4, color: new Color("#e6c896"), out: 1.2, up: 1.2, gravity: 6, life: 0.5, size: 0.06 },
}

/** Which of the forest's work trees a "chop" at (x, z) bites, if any. */
function treeAt(trees: readonly Spot[], x: number, z: number): number {
  let best = -1
  let distance = 2.5
  trees.forEach((tree, i) => {
    const d = Math.hypot(tree[0] - x, tree[1] - z)
    if (d < distance) {
      distance = d
      best = i
    }
  })
  return best
}

export function WorkFx() {
  const { nodes } = useGLTF(FOREST_URL) as unknown as { nodes: Record<string, Object3D> }
  // The forest's work trees stand by its posts on whichever island is drawn (world/behaviours.ts).
  const treeSpots = workTreesOf(useWorld())
  // Particles and arrows are this mount's own (scene/owned.ts).
  const built = useOwnedMeshes(() => {
    const material = new MeshBasicMaterial({ toneMapped: false })
    const particles = new InstancedMesh(new BoxGeometry(1, 1, 1), material, PARTICLES)
    particles.frustumCulled = false
    for (let i = 0; i < PARTICLES; i++) {
      particles.setMatrixAt(i, HIDDEN)
      particles.setColorAt(i, WHITE)
    }
    const arrows = new InstancedMesh(
      arrowGeometry(),
      new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 }),
      ARROWS,
    )
    arrows.frustumCulled = false
    for (let i = 0; i < ARROWS; i++) arrows.setMatrixAt(i, HIDDEN)
    return { meshes: [particles, arrows] }
  }, [])
  // The work trees: the pack's geometry (own) in the pack's material (borrowed).
  const trees = useOwnedMeshes(
    () => ({ meshes: workTrees(nodes, treeSpots) }),
    [nodes, treeSpots],
    "materials",
  )
  const state = useMemo(
    () => ({
      read: beats.written,
      age: new Float32Array(PARTICLES).fill(99),
      life: new Float32Array(PARTICLES),
      size: new Float32Array(PARTICLES),
      grows: new Uint8Array(PARTICLES),
      p: new Float32Array(PARTICLES * 3),
      v: new Float32Array(PARTICLES * 3),
      gravity: new Float32Array(PARTICLES),
      next: 0,
      seed: 0,
      arrowAge: new Float32Array(ARROWS).fill(99),
      arrow: new Float32Array(ARROWS * 6),
      nextArrow: 0,
      shake: new Float32Array(treeSpots.length),
      lean: new Float32Array(treeSpots.length * 2),
    }),
    [treeSpots],
  )

  useFrame((_, delta) => {
    const particles = built?.meshes[0] as InstancedMesh | undefined
    const arrows = built?.meshes[1] as InstancedMesh | undefined
    if (!particles || !arrows) return
    const dt = Math.min(delta, 0.05)

    // New beats since last frame (a long stall drops the oldest: they were never seen anyway).
    if (beats.written - state.read > RING) state.read = beats.written - RING
    for (; state.read < beats.written; state.read++) {
      const i = state.read % RING
      const kind = BEAT_KINDS[beats.kind[i] ?? 0] ?? "dust"
      const x = beats.at[i * 6] ?? 0
      const y = beats.at[i * 6 + 1] ?? 0
      const z = beats.at[i * 6 + 2] ?? 0
      if (kind === "arrow") {
        const a = state.nextArrow
        state.nextArrow = (a + 1) % ARROWS
        state.arrowAge[a] = 0
        for (let k = 0; k < 6; k++) state.arrow[a * 6 + k] = beats.at[i * 6 + ((k + 3) % 6)] ?? 0
        continue
      }
      if (kind === "chop") {
        const tree = treeAt(treeSpots, x, z)
        if (tree >= 0) {
          state.shake[tree] = 1
          // Leans away from the axe: from the swing's side (the beat's `from`) through the trunk.
          const tx = treeSpots[tree]?.[0] ?? x
          const tz = treeSpots[tree]?.[1] ?? z
          const fx = tx - (beats.at[i * 6 + 3] ?? tx)
          const fz = tz - (beats.at[i * 6 + 5] ?? tz)
          const length = Math.hypot(fx, fz) || 1
          state.lean[tree * 2] = fx / length
          state.lean[tree * 2 + 1] = fz / length
        }
      }
      spawn(state, particles, RECIPES[kind], x, y, z)
    }
    if (particles.instanceColor) particles.instanceColor.needsUpdate = true

    for (let i = 0; i < PARTICLES; i++) {
      const span = state.life[i] ?? 0
      let age = state.age[i] ?? 99
      if (age > span) continue
      age += dt
      state.age[i] = age
      if (age > span) {
        particles.setMatrixAt(i, HIDDEN)
        continue
      }
      state.v[i * 3 + 1] = (state.v[i * 3 + 1] ?? 0) - (state.gravity[i] ?? 0) * dt
      for (let a = 0; a < 3; a++)
        state.p[i * 3 + a] = (state.p[i * 3 + a] ?? 0) + (state.v[i * 3 + a] ?? 0) * dt
      const k = age / span
      const size = (state.size[i] ?? 0) * (state.grows[i] ? 1 + k * 1.6 : 1 - k * 0.8)
      position.set(state.p[i * 3] ?? 0, Math.max(0.02, state.p[i * 3 + 1] ?? 0), state.p[i * 3 + 2] ?? 0)
      scale.setScalar(size)
      particles.setMatrixAt(i, matrix.compose(position, IDENTITY, scale))
    }
    particles.instanceMatrix.needsUpdate = true

    for (let a = 0; a < ARROWS; a++) {
      let age = state.arrowAge[a] ?? 99
      if (age > FLIGHT_S + STUCK_S + 0.3) continue
      age += dt
      state.arrowAge[a] = age
      const o = a * 6
      const fx = state.arrow[o] ?? 0
      const fy = state.arrow[o + 1] ?? 0
      const fz = state.arrow[o + 2] ?? 0
      const tx = state.arrow[o + 3] ?? 0
      const ty = state.arrow[o + 4] ?? 0
      const tz = state.arrow[o + 5] ?? 0
      const u = Math.min(1, age / FLIGHT_S)
      const lift = Math.sin(Math.PI * u) * 0.35
      position.set(fx + (tx - fx) * u, fy + (ty - fy) * u + lift, fz + (tz - fz) * u)
      // The arrow's tip leads (its geometry points along −z): along the flight, tipping down.
      heading.set(tx - fx, ty - fy + Math.cos(Math.PI * u) * 0.35 * Math.PI, tz - fz).normalize()
      rotation.setFromUnitVectors(BACK, heading)
      const out = age - FLIGHT_S - STUCK_S
      scale.setScalar(out > 0 ? Math.max(0.001, 1 - out / 0.3) : 1)
      arrows.setMatrixAt(a, out > 0.3 ? HIDDEN : matrix.compose(position, rotation, scale))
    }
    arrows.instanceMatrix.needsUpdate = true

    const forest = trees?.meshes[0] as InstancedMesh | undefined
    if (forest) {
      for (let t = 0; t < treeSpots.length; t++) {
        const shake = state.shake[t] ?? 0
        if (shake <= 0) continue
        const next = Math.max(0, shake - dt * 1.8)
        state.shake[t] = next
        const swing = Math.sin((1 - next) * 30) * next * 0.07
        // Tilt about the horizontal axis across the lean (y × lean).
        axis.set(state.lean[t * 2 + 1] ?? 0, 0, -(state.lean[t * 2] ?? 1))
        if (axis.lengthSq() < 1e-6) axis.set(1, 0, 0)
        forest.setMatrixAt(t, treeMatrix(treeSpots, t, rotation.setFromAxisAngle(axis.normalize(), swing)))
      }
      forest.instanceMatrix.needsUpdate = true
    }
  })

  return (
    <>
      {built?.meshes.map((mesh) => (
        <primitive key={mesh.uuid} object={mesh} />
      ))}
      {trees?.meshes[0] && <primitive object={trees.meshes[0]} />}
      {FORGE_BUCKETS.map(([x, z]) => (
        <KitPiece key={`${x},${z}`} placement={{ piece: "bucket_metal", x, z, rot: -0.4 }} />
      ))}
    </>
  )
}

type Particles = {
  age: Float32Array
  life: Float32Array
  size: Float32Array
  grows: Uint8Array
  p: Float32Array
  v: Float32Array
  gravity: Float32Array
  next: number
  seed: number
}

function spawn(state: Particles, mesh: InstancedMesh, recipe: Recipe, x: number, y: number, z: number): void {
  for (let n = 0; n < recipe.count; n++) {
    const i = state.next
    state.next = (i + 1) % PARTICLES
    const seed = ++state.seed
    const angle = rand(seed) * Math.PI * 2
    const out = recipe.out * (0.5 + rand(seed + 1) * 0.7)
    state.age[i] = 0
    state.life[i] = recipe.life * (0.7 + rand(seed + 2) * 0.5)
    state.size[i] = recipe.size * (0.7 + rand(seed + 3) * 0.6)
    state.grows[i] = recipe.grows ? 1 : 0
    state.gravity[i] = recipe.gravity
    state.p[i * 3] = x + Math.cos(angle) * 0.1
    state.p[i * 3 + 1] = y
    state.p[i * 3 + 2] = z + Math.sin(angle) * 0.1
    state.v[i * 3] = Math.cos(angle) * out
    state.v[i * 3 + 1] = recipe.up * (0.6 + rand(seed + 4) * 0.6)
    state.v[i * 3 + 2] = Math.sin(angle) * out
    mesh.setColorAt(i, recipe.color)
  }
}

/** Integer → [0, 1), stable. */
function rand(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

/** A slim pine from the Forest Nature Pack: character scale, a trunk an axe can reach. */
const TREE = "Tree_4_A"
const TREE_SCALE = 0.8

function workTrees(nodes: Record<string, Object3D>, treeSpots: readonly Spot[]): InstancedMesh[] {
  const source = nodes[TREE]
  if (!source) return []
  source.updateMatrixWorld(true)
  const inverse = source.matrixWorld.clone().invert()
  const parts: BufferGeometry[] = []
  let material: Material | undefined
  source.traverse((child) => {
    const mesh = child as Mesh
    if (!mesh.isMesh) return
    material ??= mesh.material as Material
    parts.push(plain(mesh.geometry).applyMatrix4(inverse.clone().multiply(mesh.matrixWorld)))
  })
  const geometry = parts.length === 1 ? parts[0] : mergeGeometries(parts)
  if (!geometry || !material) return []
  if (geometry !== parts[0]) for (const part of parts) part.dispose()
  const mesh = new InstancedMesh(geometry, material, treeSpots.length)
  for (let t = 0; t < treeSpots.length; t++) mesh.setMatrixAt(t, treeMatrix(treeSpots, t, IDENTITY))
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.computeBoundingSphere()
  mesh.frustumCulled = false
  return [mesh]
}

function treeMatrix(trees: readonly Spot[], t: number, tilt: Quaternion): Matrix4 {
  const [x, z] = trees[t] ?? [0, 0]
  turn.setFromAxisAngle(UP, t * 2.1).premultiply(tilt)
  position.set(x, 0, z)
  scale.setScalar(TREE_SCALE)
  return matrix.compose(position, turn, scale)
}

const WHITE = new Color("#ffffff")
const HIDDEN = new Matrix4().makeScale(0, 0, 0)
const IDENTITY = new Quaternion()
const UP = new Vector3(0, 1, 0)
const BACK = new Vector3(0, 0, -1)
const position = new Vector3()
const heading = new Vector3()
const axis = new Vector3()
const scale = new Vector3()
const rotation = new Quaternion()
const turn = new Quaternion()
const matrix = new Matrix4()
