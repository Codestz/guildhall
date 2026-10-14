/**
 * What work leaves, drawn (game feel, task B): every stock life plans (world routines.ts `Stock`: a
 * fisher's basket, a log pile, an ore cart on its rail and the heap at its end, planks, crates, bars,
 * arrows in the butts, baskets at a stall) as one BatchedMesh, plus the fishers' floats in it and their
 * lines as one LineSegments: two draws for all of it.
 *
 * A stock is laid out again only when its level changes (stockLayout.ts: a few levels, never per unit);
 * a cart moves along its rail only while it rolls. The floats and the lines are the caller's to set
 * every frame for the fishers it draws (`float`, `line`).
 */
import type { Catalog } from "@guildhall/assets"
import { log } from "@guildhall/core"
import { type Stock, type StockSample, spotFrame } from "@guildhall/world"
import {
  BatchedMesh,
  BufferAttribute,
  type BufferGeometry,
  DynamicDrawUsage,
  Euler,
  BufferGeometry as Geometry,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  type MeshStandardMaterial,
  Quaternion,
  Vector3,
} from "three"
import { batchGeometry } from "../batchGeometry.ts"
import { paletteMaterial } from "../material.ts"
import { loadPiece } from "../pieces.ts"
import type { Stage } from "../stage.ts"
import { warmPrograms } from "../warm.ts"
import { builtOf, builtPath } from "./built.ts"
import { LINE_SEGMENTS, sagLine } from "./line.ts"
import {
  CART,
  type DrawnKind,
  FLOAT,
  LEVELS,
  railPieces,
  type StockPiece,
  stockLayout,
  stockLevel,
  TRACK,
} from "./stockLayout.ts"

const logger = log("render:stocks")

type V3 = readonly [number, number, number]

export interface StocksOpts {
  catalog: Catalog
  /** Library path → where it is served. */
  url: (path: string) => string
  /** The ground (or a deck) under a point, metres; none: each stock's own height. */
  ground?: (x: number, z: number) => number
  /** Floats to keep room for (one per fisher drawn at once). */
  floats?: number
  /** Lines to keep room for. */
  lines?: number
}

export interface StocksStats {
  stocks: number
  /** Instances in the batch, and shown now. */
  instances: number
  shown: number
  /** Lay-outs since the start (a level changed), and cart moves. */
  relayouts: number
  rolls: number
  lines: number
}

export interface Stocks {
  /** Draws stock k (the plan's order) at its sample: laid out again only when its level changed. */
  set(k: number, sample: StockSample): void
  /** Float i at `at`, turned `yaw`, or hidden (null). */
  float(i: number, at: V3 | null, yaw?: number): void
  /** The lines this frame: begin, one per fisher (tip to float, sagging), end. */
  beginLines(): void
  line(a: V3, b: V3, sag: number): void
  endLines(): void
  /** How opaque all of it is drawn (0–1): faded in when it arrives after the island is shown. */
  opacity(a: number): void
  stats(): StocksStats
  dispose(): void
}

interface Drawn {
  stock: Stock
  kind: DrawnKind
  /** Instances, in layout order (the full level's), and how many are shown. */
  instances: number[]
  geometries: number[]
  shown: number
  level: number
  /** Its ground (feet) height. */
  y: number
  /** A cart: its instance, and where it is on the rail now (−1: never placed). */
  cart?: { instance: number; roll: number; y0: number; y1: number; at: StockPiece[] }
}

const scratch = {
  m: new Matrix4(),
  q: new Quaternion(),
  e: new Euler(0, 0, 0, "YXZ"),
  p: new Vector3(),
  s: new Vector3(),
}

/** A piece's matrix in a stock's frame placed at (ax, ay, az) facing `f`. */
function frameMatrix(ax: number, ay: number, az: number, f: number, p: StockPiece, out: Matrix4): Matrix4 {
  const [wx, wz] = spotFrame(ax, az, f, p.at[0], p.at[2])
  scratch.e.set(p.tilt ?? 0, f + p.yaw, 0, "YXZ")
  scratch.q.setFromEuler(scratch.e)
  return out.compose(scratch.p.set(wx, ay + p.at[1], wz), scratch.q, scratch.s.setScalar(p.scale))
}

export async function createStocks(
  stage: Stage,
  stocks: readonly Stock[],
  opts: StocksOpts,
): Promise<Stocks> {
  const { catalog, url } = opts
  const floats = opts.floats ?? 0
  const maxLines = opts.lines ?? floats
  // the pieces: every stock's unit and container at its full level, the cart, the rail, the float
  const full = stocks.map((s) => stockLayout(s.kind, LEVELS[s.kind].length - 1, s.piece))
  const ids = new Set<string>(full.flat().map((p) => p.piece))
  if (stocks.some((s) => s.kind === "ore-cart")) {
    ids.add(CART)
    ids.add(TRACK)
  }
  if (floats > 0) ids.add(FLOAT)
  const geometry = new Map<string, BufferGeometry>()
  await Promise.all(
    [...ids].map(async (id) => {
      const built = builtOf(`${id}.glb`)
      const path = built ? builtPath(built) : catalog.get(id)?.files.glb
      if (!path) {
        logger.warn("stock piece not in the library", { id })
        return
      }
      geometry.set(id, batchGeometry(await loadPiece(url(path))))
    }),
  )
  const rails = stocks.map((s) => (s.kind === "ore-cart" && s.rail ? railPieces(s.at, s.rail) : []))
  const count =
    full.reduce((n, l) => n + l.length, 0) +
    rails.reduce((n, r) => n + r.length, 0) +
    stocks.filter((s) => s.kind === "ore-cart").length +
    floats
  const vertices = [...geometry.values()].reduce((n, g) => n + g.getAttribute("position").count, 0)
  const indices = [...geometry.values()].reduce((n, g) => n + (g.index?.count ?? 0), 0)
  const mesh = new BatchedMesh(
    Math.max(1, count),
    Math.max(1, vertices),
    Math.max(1, indices),
    paletteMaterial(),
  )
  mesh.name = "life:stocks"
  mesh.perObjectFrustumCulled = true
  // culled per instance: the batch's own sphere would be the one at its first draw (crowd.ts)
  mesh.frustumCulled = false
  mesh.sortObjects = false
  mesh.castShadow = false
  mesh.receiveShadow = true
  const geometryId = new Map<string, number>()
  for (const [id, g] of geometry) {
    geometryId.set(id, mesh.addGeometry(g))
    g.dispose()
  }
  /** The ground under a point, or the stock's own height where that is far off it (a dock over the sea bed). */
  const ground = (x: number, z: number, own: number) => {
    const g = opts.ground?.(x, z)
    return g === undefined || Math.abs(g - own) > 0.6 ? own : g
  }
  const m = scratch.m

  const drawn: Drawn[] = stocks.map((stock, k) => {
    const layout = full[k] ?? []
    const geometries: number[] = []
    const instances: number[] = []
    for (const p of layout) {
      const g = geometryId.get(p.piece)
      if (g === undefined) continue
      geometries.push(g)
      const i = mesh.addInstance(g)
      mesh.setVisibleAt(i, false)
      instances.push(i)
    }
    const y = ground(stock.at[0], stock.at[2], stock.at[1])
    const d: Drawn = { stock, kind: stock.kind, instances, geometries, shown: 0, level: -1, y }
    // a cart and its rail
    const cartG = geometryId.get(CART)
    const trackG = geometryId.get(TRACK)
    if (stock.kind === "ore-cart" && stock.rail && cartG !== undefined) {
      if (trackG !== undefined)
        for (const r of rails[k] ?? []) {
          const i = mesh.addInstance(trackG)
          const ty = ground(r.at[0], r.at[1], stock.at[1])
          scratch.q.setFromAxisAngle(scratch.p.set(0, 1, 0), r.yaw)
          mesh.setMatrixAt(
            i,
            m.compose(scratch.p.set(r.at[0], ty, r.at[1]), scratch.q, scratch.s.setScalar(1)),
          )
        }
      const i = mesh.addInstance(cartG)
      d.cart = {
        instance: i,
        roll: -1,
        y0: y,
        y1: ground(stock.rail[0], stock.rail[2], stock.rail[1]),
        at: [],
      }
    }
    return d
  })
  const floatIds = Array.from({ length: floats }, () => {
    const g = geometryId.get(FLOAT)
    if (g === undefined) return -1
    const i = mesh.addInstance(g)
    mesh.setVisibleAt(i, false)
    return i
  })

  // the lines: one LineSegments, its buffer rewritten for the fishers drawn this frame
  const perLine = LINE_SEGMENTS * 6
  const positions = new Float32Array(Math.max(1, maxLines) * perLine)
  const lineGeometry = new Geometry()
  const attr = new BufferAttribute(positions, 3)
  attr.setUsage(DynamicDrawUsage)
  lineGeometry.setAttribute("position", attr)
  lineGeometry.setDrawRange(0, 0)
  const lineMaterial = new LineBasicMaterial({ color: 0xe9e4d4, transparent: true, opacity: 0.85 })
  const lines = new LineSegments(lineGeometry, lineMaterial)
  lines.name = "life:lines"
  lines.frustumCulled = false
  lines.visible = false
  let lineCount = 0

  // the same light see-through while it fades in (the palette's program, blended)
  const solid = mesh.material as MeshStandardMaterial
  const faded = solid.clone()
  faded.onBeforeCompile = solid.onBeforeCompile
  faded.transparent = true
  faded.opacity = 1
  const lineOpacity = lineMaterial.opacity

  stage.scene.add(mesh, lines)
  stage.timing?.gpu.tag(mesh, "stocks")
  stage.timing?.gpu.tag(lines, "stocks")
  mesh.visible = false
  await warmPrograms(stage, mesh, [faded])
  mesh.visible = true

  let relayouts = 0
  let rolls = 0

  /** Where a cart stands at `roll` along its rail, and its ore with it. */
  const placeCart = (d: Drawn, roll: number) => {
    const c = d.cart
    const s = d.stock
    if (!c || !s.rail) return
    const x = s.at[0] + (s.rail[0] - s.at[0]) * roll
    const z = s.at[2] + (s.rail[2] - s.at[2]) * roll
    const y = c.y0 + (c.y1 - c.y0) * roll + 0.06
    const yaw = Math.atan2(s.rail[0] - s.at[0], s.rail[2] - s.at[2])
    scratch.q.setFromAxisAngle(scratch.p.set(0, 1, 0), yaw)
    mesh.setMatrixAt(c.instance, m.compose(scratch.p.set(x, y, z), scratch.q, scratch.s.setScalar(1)))
    // the ore in it, in the cart's own frame
    const layout = stockLayout(d.kind, d.level, s.piece)
    for (const [j, p] of layout.entries()) {
      const i = d.instances[j]
      if (i !== undefined) mesh.setMatrixAt(i, frameMatrix(x, y, z, yaw, p, m))
    }
    c.roll = roll
    rolls++
  }

  return {
    set(k, sample) {
      const d = drawn[k]
      if (!d) return
      const level = stockLevel(d.kind, sample.count, d.stock.cap)
      const roll = sample.roll ?? 0
      if (level !== d.level) {
        d.level = level
        const layout = stockLayout(d.kind, level, d.stock.piece)
        const s = d.stock
        for (const [j, i] of d.instances.entries()) {
          const p = layout[j]
          const on = p !== undefined && p.piece !== undefined
          mesh.setVisibleAt(i, on)
          if (on && !d.cart) mesh.setMatrixAt(i, frameMatrix(s.at[0], d.y, s.at[2], s.facing, p, m))
        }
        d.shown = layout.length
        relayouts++
        if (d.cart) placeCart(d, roll)
      } else if (d.cart && Math.abs(roll - d.cart.roll) > 1e-4) placeCart(d, roll)
    },
    float(i, at, yaw = 0) {
      const id = floatIds[i]
      if (id === undefined || id < 0) return
      if (!at) {
        mesh.setVisibleAt(id, false)
        return
      }
      scratch.q.setFromAxisAngle(scratch.p.set(0, 1, 0), yaw)
      mesh.setMatrixAt(id, m.compose(scratch.p.set(at[0], at[1], at[2]), scratch.q, scratch.s.setScalar(1)))
      mesh.setVisibleAt(id, true)
    },
    beginLines() {
      lineCount = 0
    },
    line(a, b, sag) {
      if (lineCount >= maxLines) return
      sagLine(a, b, sag, positions, lineCount * perLine)
      lineCount++
    },
    endLines() {
      lineGeometry.setDrawRange(0, lineCount * LINE_SEGMENTS * 2)
      if (lineCount > 0) {
        attr.clearUpdateRanges()
        attr.addUpdateRange(0, lineCount * perLine)
        attr.needsUpdate = true
      }
      lines.visible = lineCount > 0
    },
    opacity(a) {
      const o = Math.max(0, Math.min(1, a))
      mesh.material = o < 1 ? faded : solid
      faded.opacity = o
      mesh.visible = o > 0
      lineMaterial.opacity = lineOpacity * o
    },
    stats: () => ({
      stocks: stocks.length,
      instances: count,
      shown: drawn.reduce((n, d) => n + d.shown, 0),
      relayouts,
      rolls,
      lines: lineCount,
    }),
    dispose() {
      mesh.removeFromParent()
      lines.removeFromParent()
      mesh.dispose()
      lineGeometry.dispose()
      lineMaterial.dispose()
      faded.dispose()
    },
  }
}
