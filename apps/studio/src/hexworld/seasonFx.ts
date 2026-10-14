/**
 * The season's particles (season.ts), in the work FX's one draw (render workfx: no draw of their own, and
 * none at all while nothing is alive): leaves let go by the trees in autumn, petals off the blossoming
 * trees in spring (the ones the shader flowers: `treeHash` past `BLOSSOM_FROM`), smoke off the chimneys
 * in winter. Only near the camera: every half second the trees and chimneys within `NEAR` metres of where
 * it looks are gathered, and each frame a few of them, by the season's weight, let go a burst (the work
 * FX skip what is off the screen or too far). Summer: nothing is gathered, nothing emitted.
 *
 * A chimney is found on the piece itself: the top of its stone (the highest stone-swatch vertices high on
 * the piece, KayKit's grey stacks), measured once per building piece, the first winter it is needed.
 */
import { BLOSSOM_FROM, type SeasonWeights, type Stage, treeHash, type WorkFx } from "@guildhall/render"
import type { PlacedPiece } from "@guildhall/world"

/** Metres round the camera's target the season's particles come from. */
const NEAR = 32
/** The trees nearest the focus that let go leaves (or petals). */
const NEAREST = 14
/** Seconds between gathering what is near. */
const GATHER_S = 0.5
/** Bursts a second at a whole season: leaves (from any tree near), petals, a chimney's puffs. */
const LEAVES_PER_S = 6
const PETALS_PER_S = 2.4
const SMOKE_EVERY_S = 1.7

/** Trees whose crowns colour and drop leaves: KayKit's leafy trees (not the bare ones, not pines). */
export const isLeafTree = (piece: string): boolean => /^kaykit-forest\/tree-[123]-/.test(piece)
/** Buildings that may have a chimney (found on the piece: `chimneyOf`). */
export const isChimneyBuilding = (piece: string): boolean =>
  /^kaykit-hexagon\/building-(home|blacksmith)/.test(piece)

/** The stone, grey and iron swatches a chimney is built of. */
const STONE = new Set([15, 16, 18, 19, 20, 42, 60, 61, 62])

type V3 = [number, number, number]

/** A piece as loaded: its meshes' positions and swatches, in the piece's own space (scale 1). */
export interface PieceVertices {
  position: ArrayLike<number>
  swatch: ArrayLike<number>
}

/**
 * Where a piece's chimney smokes from, in its own space: the middle of the top of its highest stone,
 * when that stands in the top fifth of the piece; else null (no chimney).
 */
export function chimneyOf(parts: readonly PieceVertices[]): V3 | null {
  let top = Number.NEGATIVE_INFINITY
  let topStone = Number.NEGATIVE_INFINITY
  for (const p of parts)
    for (let v = 0; v < p.swatch.length; v++) {
      const y = p.position[v * 3 + 1] as number
      if (y > top) top = y
      if (STONE.has(Math.round(p.swatch[v] as number)) && y > topStone) topStone = y
    }
  if (!Number.isFinite(topStone) || topStone < top * 0.8) return null
  let x = 0
  let z = 0
  let n = 0
  for (const p of parts)
    for (let v = 0; v < p.swatch.length; v++) {
      if (!STONE.has(Math.round(p.swatch[v] as number))) continue
      if ((p.position[v * 3 + 1] as number) < topStone - 0.05) continue
      x += p.position[v * 3] as number
      z += p.position[v * 3 + 2] as number
      n++
    }
  return n ? [x / n, topStone, z / n] : null
}

/** A local point of a placed piece in the world (its `rot` about +y, uniform `scale`; no lean). */
export function placedPoint(piece: Pick<PlacedPiece, "x" | "y" | "z" | "rot" | "scale">, local: V3): V3 {
  const c = Math.cos(piece.rot)
  const s = Math.sin(piece.rot)
  const [lx, ly, lz] = local
  return [
    piece.x + (lx * c + lz * s) * piece.scale,
    piece.y + ly * piece.scale,
    piece.z + (-lx * s + lz * c) * piece.scale,
  ]
}

export interface SeasonFx {
  stats(): { trees: number; chimneys: number; emitted: number; ms: number }
  /** How many leafy trees stand within `r` metres of (x, z) (shots: where a wood is). */
  treesWithin(x: number, z: number, r: number): number
  /** The chimneys near the camera now, world metres (shots). */
  chimneys(): readonly (readonly [number, number, number])[]
  dispose(): void
}

export function mountSeasonFx(parts: {
  stage: Pick<Stage, "onFrame" | "getCamera">
  workfx: Pick<WorkFx, "emit">
  pieces: readonly PlacedPiece[]
  weights: () => SeasonWeights
  /** A piece's height at scale 1, metres (the catalog's size). */
  heightOf: (piece: string) => number
  /** A piece's vertices (for its chimney), loaded on first need. */
  vertices: (piece: string) => Promise<PieceVertices[]>
}): SeasonFx {
  const trees = parts.pieces.filter((p) => isLeafTree(p.piece))
  const blossom = trees.filter((p) => treeHash(p.x, p.z) > BLOSSOM_FROM)
  const buildings = parts.pieces.filter((p) => isChimneyBuilding(p.piece))
  /** Chimneys by piece id: measured (a local point or null), or being measured. */
  const chimneys = new Map<string, V3 | null | "loading">()
  let nearTrees: PlacedPiece[] = []
  let nearBlossom: PlacedPiece[] = []
  let nearChimneys: V3[] = []
  let gather = 0
  let leafDebt = 0
  let petalDebt = 0
  let smokeDebt = 0
  let seed = 1
  let emitted = 0
  let costs = 0
  let frames = 0

  const near = (list: readonly PlacedPiece[], cx: number, cz: number) =>
    list.filter((p) => (p.x - cx) * (p.x - cx) + (p.z - cz) * (p.z - cz) < NEAR * NEAR)

  /** The few nearest the focus: what is looked at is where the leaves are seen to fall. */
  const nearest = (list: PlacedPiece[], cx: number, cz: number) =>
    list.length <= NEAREST
      ? list
      : list
          .sort((a, b) => (a.x - cx) ** 2 + (a.z - cz) ** 2 - ((b.x - cx) ** 2 + (b.z - cz) ** 2))
          .slice(0, NEAREST)

  const crown = (p: PlacedPiece): { at: V3; over: number } => {
    const h = parts.heightOf(p.piece) * p.scale
    return { at: [p.x, p.y + h * 0.62, p.z], over: h * 0.62 }
  }

  const pickOf = <T>(list: readonly T[]): T | undefined => list[Math.floor(Math.random() * list.length)]

  const off = parts.stage.onFrame((dt) => {
    const w = parts.weights()
    if (w.autumn === 0 && w.spring === 0 && w.winter === 0) {
      leafDebt = petalDebt = smokeDebt = 0
      return
    }
    const t0 = performance.now()
    gather -= dt
    if (gather <= 0) {
      gather = GATHER_S
      const [cx, , cz] = parts.stage.getCamera().target
      nearTrees = w.autumn > 0.3 ? nearest(near(trees, cx, cz), cx, cz) : []
      nearBlossom = w.spring > 0.3 ? nearest(near(blossom, cx, cz), cx, cz) : []
      nearChimneys = []
      if (w.winter > 0.3)
        for (const b of near(buildings, cx, cz)) {
          const c = chimneys.get(b.piece)
          if (c === undefined) {
            chimneys.set(b.piece, "loading")
            void parts
              .vertices(b.piece)
              .then((v) => chimneys.set(b.piece, chimneyOf(v)))
              .catch(() => chimneys.set(b.piece, null))
          } else if (c && c !== "loading") nearChimneys.push(placedPoint(b, c))
        }
    }
    // leaves and petals: a share of a burst a frame, by the season's weight
    leafDebt += dt * LEAVES_PER_S * Math.max(0, (w.autumn - 0.3) / 0.7) * Math.min(1, nearTrees.length / 3)
    petalDebt += dt * PETALS_PER_S * Math.max(0, (w.spring - 0.3) / 0.7) * Math.min(1, nearBlossom.length)
    smokeDebt += (dt / SMOKE_EVERY_S) * Math.max(0, (w.winter - 0.3) / 0.7)
    while (leafDebt >= 1) {
      leafDebt -= 1
      const p = pickOf(nearTrees)
      if (!p) break
      const c = crown(p)
      emitted += parts.workfx.emit("leaf", c.at, { yaw: c.over, seed: seed++ }) > 0 ? 1 : 0
    }
    while (petalDebt >= 1) {
      petalDebt -= 1
      const p = pickOf(nearBlossom)
      if (!p) break
      const c = crown(p)
      emitted += parts.workfx.emit("petal", c.at, { yaw: c.over, seed: seed++ }) > 0 ? 1 : 0
    }
    if (smokeDebt >= 1) {
      smokeDebt -= 1
      for (const at of nearChimneys)
        emitted += parts.workfx.emit("smoke", at, { seed: seed++, scale: 1 }) > 0 ? 1 : 0
    }
    costs += performance.now() - t0
    frames++
  })

  return {
    stats: () => ({
      trees: nearTrees.length,
      chimneys: nearChimneys.length,
      emitted,
      ms: frames ? costs / frames : 0,
    }),
    treesWithin: (x, z, r) => trees.filter((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < r * r).length,
    chimneys: () => nearChimneys,
    dispose: off,
  }
}
