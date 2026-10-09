import { useGLTF } from "@react-three/drei"
import { useFrame } from "@react-three/fiber"
import { useMemo } from "react"
import { InstancedMesh, Matrix4, type Mesh, type Object3D, Quaternion, Vector3 } from "three"
import { DEPTH, type PieceState, pieceAt, roleOf, saltOf } from "../../world/chronicle/growthPieces.ts"
import LANDS from "../../world/lands.json"
import { HEX_SCALE } from "../../world/lands.ts"
import type { World } from "../../world/world.ts"
import { bakeNode } from "../events/common.ts"
import { FRAME } from "../frame.ts"
import { useOwnedMeshes } from "../owned.ts"
import type { GrowthDriver } from "./drive.ts"

/** The timelapse's own pieces (scripts/assets.ts `growth`): loaded only with `?grow`. */
export const GROWTH_URL = `${import.meta.env.BASE_URL}assets/growth.glb`

/** The Survival Kit's pieces are half a unit across; these size them to the island. */
const STRUCTURE = 0.5
const PLANKS = 4
const TENT = 5

interface Site {
  x: number
  z: number
  rot: number
  hex: number
  salt: number
  /** A building's footprint and height, world units (tents: unused). */
  w: number
  h: number
  d: number
}

/**
 * Construction on the growing island (ADR 0021): a wooden scaffold round every building as it goes
 * up, with a stack of planks beside it, and tents pitched on a ghost district's borrowed land. Three
 * instanced meshes, three draw calls, written once a frame from the driver's frame (scene/growth/
 * drive.ts) with growthPieces' stages; no shadows (the static shadow map is the island's).
 */
export function Builders({ driver, world }: { driver: GrowthDriver; world: World }) {
  const { nodes } = useGLTF(GROWTH_URL) as unknown as { nodes: Record<string, Object3D> }
  const { buildings, tents } = useMemo(() => sitesOf(world, driver), [world, driver])
  const built = useOwnedMeshes(
    () => {
      const make = (name: string, count: number): InstancedMesh | null => {
        const node = nodes[name]
        const baked = node ? bakeNode(node) : null
        if (!baked || count === 0) return null
        const mesh = new InstancedMesh(baked.geometry, baked.material, count)
        mesh.count = 0
        mesh.frustumCulled = false
        mesh.receiveShadow = true
        return mesh
      }
      const scaffolds = make("structure", buildings.length)
      const planks = make("resource-planks", buildings.length)
      const camps = make("tent-canvas", tents.length)
      return {
        meshes: [scaffolds, planks, camps].filter((m) => m !== null) as Mesh[],
        scaffolds,
        planks,
        camps,
      }
    },
    [nodes, buildings, tents],
    "materials",
  )
  const state = useMemo<PieceState>(() => ({ visible: false, rise: 0, scale: 1, scaleY: 1, scaffold: 0 }), [])

  useFrame(() => {
    if (!built) return
    const f = driver.frame
    let n = 0
    for (const site of buildings) {
      const h = site.hex
      pieceAt("build", f.rise[h] as number, f.up[h] as number, f.built[h] as number, site.salt, state)
      if (state.scaffold <= 0.01) continue
      const y = state.rise * DEPTH
      const s = state.scaffold
      place(
        site,
        y,
        (site.w / STRUCTURE) * 1.08 * s,
        (site.h / STRUCTURE) * s,
        (site.d / STRUCTURE) * 1.08 * s,
      )
      built.scaffolds?.setMatrixAt(n, matrix)
      const side = site.w / 2 + 1.3
      place(
        { ...site, x: site.x + Math.cos(site.rot) * side, z: site.z - Math.sin(site.rot) * side },
        y,
        PLANKS * s,
        PLANKS * s,
        PLANKS * s,
      )
      built.planks?.setMatrixAt(n, matrix)
      n++
    }
    for (const mesh of [built.scaffolds, built.planks]) {
      if (!mesh) continue
      mesh.count = n
      mesh.instanceMatrix.needsUpdate = true
    }
    let m = 0
    for (const site of tents) {
      const h = site.hex
      if (!f.ghost[h] || (f.up[h] as number) <= 0) continue
      const grown = Math.min(1, Math.max(0, ((f.since[h] as number) - 0.2 - site.salt * 0.4) / 0.3))
      if (grown <= 0) continue
      place(site, (f.rise[h] as number) * DEPTH, TENT * grown, TENT * grown, TENT * grown)
      built.camps?.setMatrixAt(m++, matrix)
    }
    if (built.camps) {
      built.camps.count = m
      built.camps.instanceMatrix.needsUpdate = true
    }
  }, FRAME.WORLD)

  if (!built) return null
  return (
    <group name="growth-builders">
      {built.meshes.map((mesh) => (
        <primitive key={mesh.uuid} object={mesh} />
      ))}
    </group>
  )
}

const matrix = new Matrix4()
const position = new Vector3()
const rotation = new Quaternion()
const scale = new Vector3()
const UP = new Vector3(0, 1, 0)
function place(site: Pick<Site, "x" | "z" | "rot">, y: number, sx: number, sy: number, sz: number): void {
  rotation.setFromAxisAngle(UP, site.rot)
  matrix.compose(position.set(site.x, y, site.z), rotation, scale.set(sx, sy, sz))
}

type Bounds = Record<string, { size: number[] }>

/** Every building of today's island (with its footprint), and a tent on every third ghost hex. */
function sitesOf(world: World, driver: GrowthDriver): { buildings: Site[]; tents: Site[] } {
  const buildings: Site[] = []
  for (const piece of world.island.decor) {
    if (roleOf(piece.piece) !== "build") continue
    const size = (LANDS as Bounds)[piece.piece]?.size ?? [1, 1, 1]
    const k = HEX_SCALE * (piece.scale ?? 1)
    buildings.push({
      x: piece.x,
      z: piece.z,
      rot: piece.rot ?? 0,
      hex: driver.hexAt(piece.x, piece.z),
      salt: saltOf(piece.x, piece.z),
      w: (size[0] ?? 1) * k,
      h: Math.min(6, (size[1] ?? 1) * k),
      d: (size[2] ?? 1) * k,
    })
  }
  const tents: Site[] = []
  const seen = new Set<number>()
  for (const ghost of driver.g.ghosts)
    ghost.hexes.forEach((h, i) => {
      if (i % 3 !== 0 || seen.has(h)) return
      seen.add(h)
      const x = driver.g.spots[h * 2] as number
      const z = driver.g.spots[h * 2 + 1] as number
      const salt = saltOf(x, z)
      tents.push({
        x: x + (salt - 0.5) * 3,
        z: z + (salt - 0.5) * 2,
        rot: salt * 6.28,
        hex: h,
        salt,
        w: 0,
        h: 0,
        d: 0,
      })
    })
  return { buildings, tents }
}
