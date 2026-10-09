import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { gunzipSync } from "node:zlib"
import { type BatchedMesh, Matrix4, MeshBasicMaterial } from "three"
import { GrowthDriver } from "../src/scene/growth/drive.ts"
import { RiseWriter, riseMaskOf } from "../src/scene/growth/mask.ts"
import { growables, marksOf } from "../src/scene/growth/registry.ts"
import { reliefLayer } from "../src/scene/terrain/reliefMeshes.ts"
import { decodeChronicle } from "../src/world/chronicle/format.ts"
import { planGrowth } from "../src/world/chronicle/growth.ts"
import { growthAt } from "../src/world/chronicle/growthFrame.ts"
import { DEPTH } from "../src/world/chronicle/growthPieces.ts"
import { massifBirth, mountainUp, RELIEF_LAG_S } from "../src/world/chronicle/growthRelief.ts"
import { chunksOf } from "../src/world/chunks.ts"
import { cellAt, key } from "../src/world/gen/hex.ts"
import { islandFromTree } from "../src/world/gen/islandFromTree.ts"
import { type RepoEntry, summarize } from "../src/world/gen/repo.ts"
import { repoWorld } from "../src/world/world.ts"
import REACT from "./fixtures/repos/facebook__react.json"

/** The gen 2 film's mountains and inland water (growthRelief.ts, scene/growth): land first, then both. */

const react = decodeChronicle(
  gunzipSync(readFileSync(join(import.meta.dir, "../public/chronicles/react__react.json.gz"))).toString(),
)
const entries = REACT.entries as RepoEntry[]
const made = islandFromTree(entries, 0, 2)
const g = planGrowth({ chronicle: react, shape: summarize(entries), plan: made.plan })
const world = repoWorld(made, { repo: "fixture/react", source: "fixture", gen: 2, relief: "d" } as never)
const relief = world.relief
if (!relief) throw new Error("React at gen 2 has no relief")
const chunks = chunksOf(world)
const layer = reliefLayer(relief, new MeshBasicMaterial(), false, chunks)
const mesh = layer.meshes[0] as BatchedMesh
const marks = marksOf(mesh)
if (!marks) throw new Error("the relief's instances are not marked growable")
// What useGrowable does when the layer mounts.
marks.base = new Float32Array(marks.ids.length * 16)
marks.ids.forEach((id, i) => {
  mesh.getMatrixAt(id, new Matrix4()).toArray(marks.base as Float32Array, i * 16)
})
const times = Array.from({ length: Math.floor(g.duration / 0.1) + 1 }, (_, i) => i * 0.1)

describe("a mountain's rise", () => {
  test("never falls back, and is up before the film ends", () => {
    for (const massif of relief.massifs) {
      const born = massifBirth(g, massif.keys)
      let last = 0
      for (const t of times) {
        const up = mountainUp(t, born)
        expect(up).toBeGreaterThanOrEqual(last)
        last = up
      }
      expect(last).toBe(1)
    }
  })

  test("waits for the majority of its land, then a beat more", () => {
    for (const massif of relief.massifs) {
      const firsts = [...massif.keys].map((id) => (g.any[g.index.get(id) as number] as number[])[0] as number)
      const born = massifBirth(g, massif.keys)
      expect(born).toBeGreaterThanOrEqual(Math.min(...firsts))
      // At least half of its hexes are up by its birth.
      expect(firsts.filter((first) => first <= born).length * 2).toBeGreaterThanOrEqual(firsts.length)
      expect(mountainUp(born + RELIEF_LAG_S * 0.5, born)).toBe(0)
    }
  })
})

describe("the film's relief instances, frame by frame", () => {
  const driver = new GrowthDriver(g)
  growables.batches.add(mesh)
  const lift = (id: number): number => mesh.getMatrixAt(id, new Matrix4()).elements[13] as number
  const frames = times.map((t) => {
    driver.apply(t)
    return { t, y: marks.ids.map(lift), shown: marks.ids.map((id) => mesh.getVisibleAt(id)) }
  })

  test("every chunk only ever rises, and once shown stays shown", () => {
    expect(marks.ids.length).toBeGreaterThan(0)
    marks.ids.forEach((_, i) => {
      for (let f = 1; f < frames.length; f++) {
        // (A hidden instance's matrix is not written: it is read once it is shown.)
        if (!frames[f - 1]?.shown[i]) continue
        expect(frames[f]?.shown[i]).toBe(true)
        expect(frames[f]?.y[i] as number).toBeGreaterThanOrEqual((frames[f - 1]?.y[i] as number) - 1e-6)
      }
    })
  })

  test("the flicker's root cause: the hex under a chunk's middle does sink and rise again", () => {
    // Riding that hex (as the film once did) made a standing mountain sink and reappear.
    const sinks = marks.ids.filter((_, i) => {
      const h = driver.hexAt(marks.spots[i * 2] as number, marks.spots[i * 2 + 1] as number)
      const ups = times.map((t) => growthAt(g, t)).map((f) => f.up[h] as number)
      return ups.some((up, k) => k > 0 && up < (ups[k - 1] as number) - 0.05)
    })
    expect(sinks.length).toBeGreaterThan(0)
  })

  test("the chunks of one massif rise as one", () => {
    const own = new Map<ReadonlySet<string>, number[]>()
    marks.massifs.forEach((list, i) => {
      const massif = list?.length === 1 ? (list[0] as ReadonlySet<string>) : undefined
      if (massif) own.set(massif, [...(own.get(massif) ?? []), i])
    })
    // How far down each instance is, as a share of its own sink (DEPTH + its base height).
    const risen = (i: number, f: number): number => {
      const base = marks.base?.[i * 16 + 13] as number
      return ((frames[f]?.y[i] as number) - base) / (DEPTH + base)
    }
    let split = 0
    for (const group of own.values()) {
      if (group.length < 2) continue
      split++
      for (let f = 0; f < frames.length; f++)
        for (const i of group) {
          expect(frames[f]?.shown[i]).toBe(frames[f]?.shown[group[0] as number])
          if (frames[f]?.shown[i]) expect(risen(i, f)).toBeCloseTo(risen(group[0] as number, f), 5)
        }
    }
    expect(split).toBeGreaterThan(0)
  })
})

describe("water after land", () => {
  const rise = riseMaskOf(world)
  const writer = new RiseWriter(g, rise)
  const driver = new GrowthDriver(g)
  const rivers = world.island.tiles.filter((tile) => tile.piece.startsWith("hex_river"))
  const blueAt = (x: number, z: number): number => {
    const size = rise.mask.image.width
    const column = Math.floor(((x + rise.half) / (2 * rise.half)) * size)
    const row = Math.floor(((rise.half - z) / (2 * rise.half)) * size)
    return (rise.mask.image.data as Uint8Array)[(row * size + column) * 4 + 2] as number
  }
  const massifHex = new Set([...relief.keys].map((id) => g.index.get(id)))

  test("a river's hex shows its water only once its land is up, and from then on", () => {
    expect(rivers.length).toBeGreaterThan(0)
    let shownEver = 0
    for (const t of times) {
      driver.apply(t)
      const f = driver.frame
      writer.write(f.up, driver.green, driver.land)
      for (const tile of rivers) {
        const h = g.index.get(key(cellAt([tile.x, tile.z]))) as number
        const shown = blueAt(tile.x, tile.z) >= 128
        if (shown) shownEver++
        if (massifHex.has(h)) continue
        if (shown) expect(f.up[h] as number).toBeGreaterThanOrEqual(0.49)
        if ((f.up[h] as number) >= 0.99) expect(shown).toBe(true)
      }
    }
    expect(shownEver).toBeGreaterThan(0)
  })

  test("a mountain's hexes are land for the water only as the mountain stands", () => {
    for (const massif of relief.massifs) {
      const born = massifBirth(g, massif.keys)
      for (const t of times) {
        driver.apply(t)
        for (const id of massif.keys) {
          const h = g.index.get(id)
          if (h !== undefined) expect(driver.land[h]).toBeCloseTo(mountainUp(t, born), 5)
        }
      }
    }
  })
})
