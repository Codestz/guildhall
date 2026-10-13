#!/usr/bin/env bun
/**
 * Door anchors for the hex buildings (decisions.md "doors are dynamic"): finds each hex
 * building's front door in its mesh and writes them to `packages/world/src/hex/doorways.ts`, once.
 *
 *   bun tools/import/src/doors.ts <pack>     (re-run after a re-import changes a building)
 *
 * A door in these packs is a flat timber slab of its own (palette swatches timber-dark…light, 21–23): a piece of
 * the mesh whose faces all look one way, level, and that stands at the foot of the building's wall. Of
 * the slabs a building has, its door is the one that reaches lowest, looks closest to the front (+z, the
 * way the tiles turn a building's front), and is biggest. Its rectangle (centre of its foot, width,
 * height, the way it looks) is recorded in the piece's own space, as the library imports it.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Mesh, Vector3 } from "three"
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { paths } from "./config.ts"

const TIMBER = new Set([21, 22, 23])

export interface Doorway {
  /** The middle of the door's foot, on its face (piece space, metres as imported). */
  x: number
  y: number
  z: number
  w: number
  h: number
  /** The way the door looks out, radians about +y (0 = +z). */
  facing: number
}

interface Slab {
  min: Vector3
  max: Vector3
  facing: number
  area: number
  /** The face's distance along the way it looks. */
  plane: number
}

/** The flat one-way timber slabs of a mesh. */
async function slabs(file: string): Promise<{ slabs: Slab[]; floor: number }> {
  const buf = readFileSync(file)
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  const gltf = await loader.parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "")
  gltf.scene.updateMatrixWorld(true)
  const tris: { v: Vector3[]; n: Vector3; area: number }[] = []
  let floor = Number.POSITIVE_INFINITY
  gltf.scene.traverse((node) => {
    if (!(node instanceof Mesh)) return
    const g = node.geometry
    const p = g.getAttribute("position")
    const s = g.getAttribute("_swatch")
    const idx = g.index
    const count = idx ? idx.count / 3 : p.count / 3
    for (let t = 0; t < count; t++) {
      const ii = [0, 1, 2].map((k) => (idx ? idx.getX(t * 3 + k) : t * 3 + k))
      const v = ii.map((i) => new Vector3().fromBufferAttribute(p, i).applyMatrix4(node.matrixWorld))
      for (const q of v) floor = Math.min(floor, q.y)
      if (!s || !TIMBER.has(Math.round(s.getX(ii[0] ?? 0)))) continue
      const [a, b, c] = v as [Vector3, Vector3, Vector3]
      const n = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a))
      const area = n.length() / 2
      if (area < 1e-7) continue
      tris.push({ v, n: n.normalize(), area })
    }
  })
  // pieces of the mesh: triangles joined by a shared corner
  const parent = tris.map((_, k) => k)
  const find = (k: number): number => {
    let r = k
    while (parent[r] !== r) r = parent[r]!
    while (parent[k] !== r) {
      const next = parent[k]!
      parent[k] = r
      k = next
    }
    return r
  }
  const seen = new Map<string, number>()
  tris.forEach((t, k) => {
    for (const v of t.v) {
      const key = `${Math.round(v.x * 200)},${Math.round(v.y * 200)},${Math.round(v.z * 200)}`
      const o = seen.get(key)
      if (o === undefined) seen.set(key, k)
      else parent[find(k)] = find(o)
    }
  })
  const parts = new Map<number, number[]>()
  tris.forEach((_, k) => {
    const r = find(k)
    if (!parts.has(r)) parts.set(r, [])
    parts.get(r)!.push(k)
  })
  const out: Slab[] = []
  for (const ks of parts.values()) {
    const min = new Vector3(1e9, 1e9, 1e9)
    const max = new Vector3(-1e9, -1e9, -1e9)
    const look = new Vector3()
    let area = 0
    for (const k of ks) {
      const t = tris[k]!
      for (const v of t.v) {
        min.min(v)
        max.max(v)
      }
      look.addScaledVector(t.n, t.area)
      area += t.area
    }
    // every face one way, and that way level: a slab, not a beam or a box
    if (area < 0.5 || look.length() < 0.85 * area || Math.abs(look.y) > 0.2 * area) continue
    const facing = Math.atan2(look.x, look.z)
    const nx = Math.sin(facing)
    const nz = Math.cos(facing)
    // its size across (along the face) and up
    const across = Math.abs(nz) * (max.x - min.x) + Math.abs(nx) * (max.z - min.z)
    const deep = Math.abs(nx) * (max.x - min.x) + Math.abs(nz) * (max.z - min.z)
    const up = max.y - min.y
    if (deep > 0.3 || across < 0.9 || across > 3.2 || up < 1.8 || up > 4.6) continue
    const cx = (min.x + max.x) / 2
    const cz = (min.z + max.z) / 2
    out.push({ min, max, facing, area, plane: cx * nx + cz * nz })
  }
  return { slabs: out, floor }
}

/** The building's door: the slab that reaches lowest, then looks nearest the front, then is biggest. */
function pick(found: Slab[]): Slab | undefined {
  const score = (s: Slab) => -s.min.y * 2 - Math.abs(s.facing) * 0.8 + s.area * 0.1
  return [...found].sort((a, b) => score(b) - score(a))[0]
}

const round = (v: number) => Math.round(v * 1000) / 1000

if (import.meta.main) {
  const { library } = paths()
  const pack = process.argv[2]
  if (!pack) throw new Error("usage: bun tools/import/src/doors.ts <pack> (the hex buildings' pack)")
  const dir = join(library, "pieces", pack)
  const files = readdirSync(dir).filter(
    (f) =>
      f.startsWith("building-") &&
      f.endsWith(".glb") &&
      !/-(blue|green|yellow)\.glb$/.test(f) &&
      !/bridge|well|dirt|grain|scaffolding|stage|destroyed/.test(f),
  )
  const rows: string[] = []
  for (const f of files.sort()) {
    const { slabs: found, floor } = await slabs(join(dir, f))
    const door = pick(found)
    const name = `${pack}/${f.replace(/-red\.glb$|\.glb$/, "")}`
    if (!door) {
      console.log(`${name}: no door`)
      continue
    }
    const d: Doorway = {
      x: round((door.min.x + door.max.x) / 2),
      y: round(door.min.y),
      z: round((door.min.z + door.max.z) / 2),
      w: round(
        Math.abs(Math.cos(door.facing)) * (door.max.x - door.min.x) +
          Math.abs(Math.sin(door.facing)) * (door.max.z - door.min.z),
      ),
      h: round(door.max.y - door.min.y),
      facing: round(door.facing),
    }
    console.log(`${name}: ${JSON.stringify(d)} (floor ${floor.toFixed(2)}, ${found.length} slabs)`)
    rows.push(
      `  "${name}": ${JSON.stringify(d)
        .replace(/"(\w+)":/g, "$1: ")
        .replace(/,/g, ", ")},`,
    )
  }
  const out = join(import.meta.dir, "../../../packages/world/src/hex/doorways.ts")
  writeFileSync(
    out,
    `/**
 * Where each hex building's door is (decisions.md "doors are dynamic"), in the piece's own space
 * as the library imports it: the middle of the door's foot on its face, its width and height (metres),
 * and the way it looks (radians about +y, 0 = +z). Written by \`bun tools/import/src/doors.ts <pack>\` from
 * the meshes; do not edit by hand.
 */
export interface Doorway {
  x: number
  y: number
  z: number
  w: number
  h: number
  facing: number
}

/** By piece id without its colour. */
export const DOORWAYS: Readonly<Record<string, Doorway>> = {
${rows.join("\n")}
}

/** A building piece's door (any colour), or undefined for one with none found. */
export const doorwayOf = (piece: string): Doorway | undefined =>
  DOORWAYS[piece] ?? DOORWAYS[piece.replace(/-(red|blue|green|yellow)$/, "")]
`,
  )
  console.log(out)
}
