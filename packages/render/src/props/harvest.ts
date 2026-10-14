/**
 * The autumn harvest, drawn (world harvest.ts places it): hay bales, heaps of pumpkins, crates and sacks
 * on the farms, as one BatchedMesh: one draw while it shows, none the rest of the year (the mesh is hidden
 * at weight 0, so summer's frame is the frame it was, draw for draw). It casts no shadow (a draw more in each
 * sun cascade, and the cascades keep a heap's shadow after its season is gone) and takes the palette's batch program,
 * linked already for the island's own.
 *
 * `show(w)` is how much of it there is, 0 … 1 (the Studio gives the autumn blend through a smoothstep, so
 * it comes as autumn begins and is gone by winter): each heap grows from its own middle, and the
 * matrices are rewritten only while w moves.
 */
import type { Catalog } from "@guildhall/assets"
import { log } from "@guildhall/core"
import type { HarvestPiece } from "@guildhall/world"
import { BatchedMesh, type BufferGeometry, Euler, Matrix4, Quaternion, Vector3 } from "three"
import { batchGeometry } from "../batchGeometry.ts"
import { paletteMaterial } from "../material.ts"
import { loadPiece } from "../pieces.ts"
import type { Stage } from "../stage.ts"
import { warmPrograms } from "../warm.ts"

const logger = log("render:harvest")

export interface HarvestOpts {
  catalog: Catalog
  /** Library path → where it is served. */
  url: (path: string) => string
}

export interface Harvest {
  /** How much of the harvest shows, 0 … 1 (0: nothing drawn at all). */
  show(w: number): void
  stats(): { pieces: number; heaps: number; shown: number; writes: number; draws: number }
  dispose(): void
}

/** The least weight drawn at all, and the change that rewrites the matrices. */
const MIN = 0.01
const STEP = 0.004

/**
 * A piece's re-tint (palette swatch → swatch): Kenney's sandstone bale is the thatch of the farm's own
 * straw as the tiles place it (tiles.ts KENNEY_WOOD), and the pumpkin's body is orange, not terracotta.
 */
const TINT = (id: string): Record<number, number> =>
  id.startsWith("kenney-graveyard/hay")
    ? { 51: 23, 52: 25, 53: 26 }
    : id.includes("pumpkin")
      ? { 29: 54 }
      : {}

const scratch = {
  m: new Matrix4(),
  q: new Quaternion(),
  e: new Euler(0, 0, 0, "YXZ"),
  p: new Vector3(),
  s: new Vector3(),
}

export async function createHarvest(
  stage: Stage,
  pieces: readonly HarvestPiece[],
  opts: HarvestOpts,
): Promise<Harvest | null> {
  if (pieces.length === 0) return null
  const ids = [...new Set(pieces.map((p) => p.piece))]
  const geometry = new Map<string, BufferGeometry>()
  await Promise.all(
    ids.map(async (id) => {
      const path = opts.catalog.get(id)?.files.glb
      if (!path) {
        logger.warn("harvest piece not in the library", { id })
        return
      }
      geometry.set(id, batchGeometry(await loadPiece(opts.url(path)), TINT(id)))
    }),
  )
  const kept = pieces.filter((p) => geometry.has(p.piece))
  if (kept.length === 0) return null
  const vertices = [...geometry.values()].reduce((n, g) => n + g.getAttribute("position").count, 0)
  const indices = [...geometry.values()].reduce((n, g) => n + (g.index?.count ?? 0), 0)
  const mesh = new BatchedMesh(
    kept.length,
    Math.max(1, vertices),
    Math.max(1, indices),
    paletteMaterial("batched"),
  )
  mesh.name = "world:harvest"
  mesh.perObjectFrustumCulled = true
  mesh.frustumCulled = false
  mesh.sortObjects = false
  mesh.castShadow = false
  mesh.receiveShadow = true
  const geometryId = new Map<string, number>()
  for (const [id, g] of geometry) {
    geometryId.set(id, mesh.addGeometry(g))
    g.dispose()
  }
  // each heap's middle (a piece grows toward it): the mean of its pieces' places, on its lowest
  const heapOf = new Map<string, { x: number; y: number; z: number; n: number }>()
  const key = (p: HarvestPiece) => `${p.tile}:${p.heap}`
  for (const p of kept) {
    const c = heapOf.get(key(p))
    if (c) {
      c.x += p.x
      c.z += p.z
      c.y = Math.min(c.y, p.y)
      c.n++
    } else heapOf.set(key(p), { x: p.x, y: p.y, z: p.z, n: 1 })
  }
  for (const c of heapOf.values()) {
    c.x /= c.n
    c.z /= c.n
  }
  const instances = kept.map((p) => mesh.addInstance(geometryId.get(p.piece) as number))
  const m = scratch.m
  /** The matrices at weight `k`: each piece's offset from its heap's middle, and the piece, grown by k. */
  const write = (k: number) => {
    for (const [j, p] of kept.entries()) {
      const c = heapOf.get(key(p)) as { x: number; y: number; z: number }
      const x = c.x + (p.x - c.x) * k
      const z = c.z + (p.z - c.z) * k
      const y = c.y + (p.y - c.y) * k
      scratch.e.set(0, p.rot, 0, "YXZ")
      scratch.q.setFromEuler(scratch.e)
      mesh.setMatrixAt(
        instances[j] as number,
        m.compose(scratch.p.set(x, y, z), scratch.q, scratch.s.setScalar(p.scale * k)),
      )
    }
  }
  mesh.visible = false
  stage.scene.add(mesh)
  stage.timing?.gpu.tag(mesh, "harvest")
  await warmPrograms(stage, mesh)

  let at = 0
  let writes = 0
  return {
    show(w) {
      const k = Math.max(0, Math.min(1, w))
      if (k < MIN) {
        mesh.visible = false
        at = 0
        return
      }
      if (at === 0 || Math.abs(k - at) > STEP || k === 1) {
        if (k !== at) {
          write(k)
          writes++
          at = k
        }
      }
      mesh.visible = true
    },
    stats: () => ({
      pieces: kept.length,
      heaps: heapOf.size,
      shown: mesh.visible ? kept.length : 0,
      writes,
      draws: mesh.visible ? 1 : 0,
    }),
    dispose() {
      mesh.removeFromParent()
      mesh.dispose()
    },
  }
}
