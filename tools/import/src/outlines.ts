/**
 * The pieces' outlines on the ground, for the world's collision layer (world `hex/collide.ts`), in each
 * piece's own frame at scale 1, for every static piece of the house-style packs:
 *
 *   foot    the convex hull of everything from its foot up to BAND (a building's plate and walls): the
 *           ground it must stand on whole;
 *   solids  what people bump into: its triangles cut to the band people walk in (over its floor or plate,
 *           under BAND, so a roof's eaves or a tree's crown overhead are not a wall), drawn on a fine
 *           grid, and each connected part's convex hull: a market's stalls and posts apart, the open
 *           middle of a gate, a range's yard between its targets left free.
 *
 * Simplified to at most MAX_POINTS corners each. Written to `packages/world/src/hex/outlines.ts`; run it
 * again after an import:
 *
 *   bun tools/import/src/outlines.ts            (GUILDHALL_LIBRARY picks another library)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { mat4, Node } from "@gltf-transform/core"
import { inStyle } from "@guildhall/assets"
import { solidToFoot } from "@guildhall/world"
import { paths, REPO } from "./config.ts"
import { gltfIO } from "./read.ts"

/** Metres over a piece's foot that count, at scale 1 (pieces stand at ~0.5: about a person's height). */
const BAND = 2.2
/** A floor or a plate this high (at most) is stood on, not bumped into (at scale 1; a quarter of a low piece). */
const FLOOR = 0.6
/** The grid the solids are drawn on, metres at scale 1. */
const CELL = 0.2
const MAX_POINTS = 8
/** At most this many parts per piece (the biggest). */
const MAX_PARTS = 120

type P = [number, number]
type V = [number, number, number]

function mul(m: mat4, x: number, y: number, z: number): V {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ]
}

/** Andrew's monotone chain, counter-clockwise. */
export function hull(pts: P[]): P[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (p.length < 3) return p
  const cross = (o: P, a: P, b: P) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lo: P[] = []
  for (const q of p) {
    while (lo.length >= 2 && cross(lo[lo.length - 2]!, lo[lo.length - 1]!, q) <= 0) lo.pop()
    lo.push(q)
  }
  const up: P[] = []
  for (const q of p.reverse()) {
    while (up.length >= 2 && cross(up[up.length - 2]!, up[up.length - 1]!, q) <= 0) up.pop()
    up.push(q)
  }
  return [...lo.slice(0, -1), ...up.slice(0, -1)]
}

/** Drops the corner that adds least area until `max` remain (a convex polygon stays convex). */
export function simplify(poly: P[], max: number): P[] {
  const out = [...poly]
  while (out.length > max) {
    let best = 0
    let least = Number.POSITIVE_INFINITY
    for (let i = 0; i < out.length; i++) {
      const a = out[(i + out.length - 1) % out.length]!
      const b = out[i]!
      const c = out[(i + 1) % out.length]!
      const area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))
      if (area < least) {
        least = area
        best = i
      }
    }
    out.splice(best, 1)
  }
  return out
}

/** A 3D polygon cut to y in [y0, y1]. */
function slab(poly: V[], y0: number, y1: number): V[] {
  const cut = (p: V[], keep: (v: V) => number): V[] => {
    const out: V[] = []
    for (let k = 0; k < p.length; k++) {
      const a = p[k]!
      const b = p[(k + 1) % p.length]!
      const da = keep(a)
      const db = keep(b)
      if (da >= 0) out.push(a)
      if (da >= 0 !== db >= 0) {
        const f = da / (da - db)
        out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f])
      }
    }
    return out
  }
  return cut(
    cut(poly, (v) => v[1] - y0),
    (v) => y1 - v[1],
  )
}

/** The cells (on a CELL grid) a convex x/z polygon covers: along its edges and over its inside. */
function cover(poly: P[], mark: (i: number, j: number) => void) {
  const cell = (v: number) => Math.floor(v / CELL)
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k]!
    const b = poly[(k + 1) % poly.length]!
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (CELL / 2)))
    for (let s = 0; s <= n; s++)
      mark(cell(a[0] + ((b[0] - a[0]) * s) / n), cell(a[1] + ((b[1] - a[1]) * s) / n))
  }
  if (poly.length < 3) return
  const xs = poly.map((p) => p[0])
  const zs = poly.map((p) => p[1])
  const inside = (x: number, z: number) => {
    let sign = 0
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k]!
      const b = poly[(k + 1) % poly.length]!
      const c = (b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0])
      if (Math.abs(c) < 1e-12) continue
      const s = c > 0 ? 1 : -1
      if (sign && s !== sign) return false
      sign = s
    }
    return true
  }
  for (let i = cell(Math.min(...xs)); i <= cell(Math.max(...xs)); i++)
    for (let j = cell(Math.min(...zs)); j <= cell(Math.max(...zs)); j++)
      if (inside((i + 0.5) * CELL, (j + 0.5) * CELL)) mark(i, j)
}

const round = (h: P[]): P[] => h.map(([x, z]): P => [Math.round(x * 10) / 10, Math.round(z * 10) / 10])

interface PieceOutline {
  top: number
  foot: P[]
  solids: P[][]
}

/** Pieces people walk through the middle of (a gate, a doorway, an arch): the opening is left free. */
const OPENING = /(gate|doorway|arch)/

/** A part whose cells fill less than this share of its hull is kept as boxes. */
const HOLLOW = 0.5

/** Grid cells as few boxes: each row's runs, stacked down while the run below is the same. */
function boxes(cells: [number, number][]): P[][] {
  const rows = new Map<number, number[]>()
  for (const [i, j] of cells) {
    const r = rows.get(j)
    if (r) r.push(i)
    else rows.set(j, [i])
  }
  const runs = new Map<number, [number, number][]>()
  for (const [j, is] of rows) {
    is.sort((a, b) => a - b)
    const out: [number, number][] = []
    for (const i of is) {
      const last = out[out.length - 1]
      if (last && last[1] === i - 1) last[1] = i
      else out.push([i, i])
    }
    runs.set(j, out)
  }
  const out: P[][] = []
  const used = new Set<string>()
  for (const j of [...runs.keys()].sort((a, b) => a - b))
    for (const [i0, i1] of runs.get(j)!) {
      if (used.has(`${j},${i0},${i1}`)) continue
      let j1 = j
      while (runs.get(j1 + 1)?.some(([a, b]) => a === i0 && b === i1)) {
        j1++
        used.add(`${j1},${i0},${i1}`)
      }
      out.push([
        [i0 * CELL, j * CELL],
        [(i1 + 1) * CELL, j * CELL],
        [(i1 + 1) * CELL, (j1 + 1) * CELL],
        [i0 * CELL, (j1 + 1) * CELL],
      ])
    }
  return out
}

async function outlineOf(file: string, opening: boolean): Promise<PieceOutline | null> {
  const io = await gltfIO()
  const doc = await io.read(file)
  const tris: V[][] = []
  const verts: V[] = []
  const visit = (node: Node) => {
    const mesh = node.getMesh()
    if (mesh) {
      const m = node.getWorldMatrix()
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute("POSITION")
        if (!pos) continue
        const el: number[] = []
        const local: V[] = []
        for (let i = 0; i < pos.getCount(); i++) {
          pos.getElement(i, el)
          const v = mul(m, el[0] ?? 0, el[1] ?? 0, el[2] ?? 0)
          local.push(v)
          verts.push(v)
        }
        const idx = prim.getIndices()
        const n = idx ? idx.getCount() : local.length
        for (let k = 0; k + 2 < n; k += 3) {
          const at = (q: number) => local[idx ? idx.getScalar(q) : q]!
          tris.push([at(k), at(k + 1), at(k + 2)])
        }
      }
    }
    for (const c of node.listChildren()) visit(c)
  }
  for (const scene of doc.getRoot().listScenes()) for (const n of scene.listChildren()) visit(n)
  if (!verts.length) return null
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY
  for (const v of verts) {
    lo = Math.min(lo, v[1])
    hi = Math.max(hi, v[1])
  }
  const foot = simplify(hull(verts.filter((v) => v[1] <= lo + BAND).map((v): P => [v[0], v[2]])), MAX_POINTS)
  // the solids: triangles cut to the band over the floor, drawn on the grid, each part's hull
  const floor = lo + Math.min(FLOOR, (hi - lo) * 0.25)
  const cells = new Set<string>()
  for (const t of tris) {
    const cut = slab(t, floor, lo + BAND)
    if (cut.length >= 2)
      cover(
        cut.map((v): P => [v[0], v[2]]),
        (i, j) => cells.add(`${i},${j}`),
      )
  }
  if (opening) {
    // the opening runs across the piece's long axis at its middle: as wide as the nearest vertex to the
    // middle at a walker's knee to waist (the floor and the arch or a raised grate over it do not count)
    const xs = foot.map((p) => p[0])
    const zs = foot.map((p) => p[1])
    const long = Math.max(...xs) - Math.min(...xs) >= Math.max(...zs) - Math.min(...zs) ? 0 : 1
    const knee = verts.filter((v) => v[1] >= floor && v[1] <= lo + 1.0)
    // a shut gate (its leaf across the way) is still a way through: people open it
    const span = long ? Math.max(...zs) - Math.min(...zs) : Math.max(...xs) - Math.min(...xs)
    let gap = Math.min(...knee.map((v) => Math.abs(long ? v[2] : v[0])))
    if (!(gap > 0.3)) gap = span * 0.3
    if (gap > 0.3)
      for (const key of [...cells]) {
        const [i, j] = key.split(",").map(Number) as [number, number]
        const c = ((long ? j : i) + 0.5) * CELL
        if (Math.abs(c) < gap) cells.delete(key)
      }
  }
  const seen = new Set<string>()
  const parts: P[][] = []
  const area = (h: P[]) => {
    let a = 0
    for (let k = 0; k < h.length; k++) {
      const p = h[k]!
      const q = h[(k + 1) % h.length]!
      a += p[0] * q[1] - q[0] * p[1]
    }
    return Math.abs(a) / 2
  }
  for (const start of cells) {
    if (seen.has(start)) continue
    const part: P[] = []
    const mine: [number, number][] = []
    const queue = [start]
    seen.add(start)
    while (queue.length) {
      const key = queue.pop()!
      const [i, j] = key.split(",").map(Number) as [number, number]
      mine.push([i, j])
      part.push(
        [i * CELL, j * CELL],
        [(i + 1) * CELL, j * CELL],
        [(i + 1) * CELL, (j + 1) * CELL],
        [i * CELL, (j + 1) * CELL],
      )
      for (let di = -1; di <= 1; di++)
        for (let dj = -1; dj <= 1; dj++) {
          const nk = `${i + di},${j + dj}`
          if (!cells.has(nk) || seen.has(nk)) continue
          seen.add(nk)
          queue.push(nk)
        }
    }
    const whole = simplify(hull(part), MAX_POINTS)
    // a part far from convex (a fence round a yard, a ring of walls) is its cells, as boxes: its hull
    // would close the yard it stands round
    if (mine.length > 6 && mine.length * CELL * CELL < area(whole) * HOLLOW) parts.push(...boxes(mine))
    else parts.push(whole)
  }
  parts.sort((a, b) => area(b) - area(a))
  return { top: hi - lo, foot: round(foot), solids: parts.slice(0, MAX_PARTS).map(round) }
}

async function main() {
  const { library } = paths()
  const index = join(library, "catalog/index.json")
  if (!existsSync(index)) throw new Error(`outlines: no library at ${library}`)
  const packs = (JSON.parse(readFileSync(index, "utf8")) as { packs: { id: string }[] }).packs.map(
    (p) => p.id,
  )
  const out: Record<string, PieceOutline> = {}
  for (const pack of packs) {
    if (!inStyle(pack)) continue
    const entries = JSON.parse(readFileSync(join(library, "catalog", `${pack}.json`), "utf8")) as {
      id: string
      kind: string
      files: { glb: string }
    }[]
    for (const e of entries) {
      if (e.kind !== "static") continue
      const o = await outlineOf(join(library, e.files.glb), OPENING.test(e.id))
      // a closed building is solid to its foot (world collide.ts): its parts are not needed
      if (o && solidToFoot(e.id)) o.solids = []
      if (o) out[e.id] = o
    }
  }
  const file = join(REPO, "packages/world/src/hex/outlines.ts")
  const ring = (h: P[]) => h.map(([x, z]) => `${x},${z}`).join(" ")
  const lines = Object.entries(out)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(
      ([k, v]) => `${k} ${Math.round(v.top * 10) / 10} ${ring(v.foot)} || ${v.solids.map(ring).join(" | ")}`,
    )
  writeFileSync(
    file,
    [
      "/**",
      " * Generated by `bun tools/import/src/outlines.ts` from the library: per piece, its height, the outline of",
      " * its foot, then (after ||) the outlines of the parts people bump into, split by |. Convex, x,z metres",
      " * at scale 1 in the piece's own frame. Do not edit.",
      " */",
      "export const OUTLINE_DATA = `",
      ...lines,
      "`",
      "",
    ].join("\n"),
  )
  console.log(`outlines: ${Object.keys(out).length} pieces → ${file}`)
}

if (import.meta.main) await main()
