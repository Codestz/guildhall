import { describe, expect, test } from "bun:test"
import { type BufferGeometry, Vector3 } from "three"
import { patchWaters } from "../src/lab/waterPatch.ts"
import { fallsGeometry } from "../src/scene/nature/fallMesh.ts"
import { surfaceGeometry } from "../src/scene/nature/riverMesh.ts"
import { fallNodeMaterial, riverNodeMaterial } from "../src/scene/nature/riverNodes.ts"
import { waterUniforms } from "../src/scene/nature/Water.tsx"
import { cellToWorld } from "../src/world/lands.ts"
import { surfaceY, TERRACE, type Waterways, waterwaysOf } from "../src/world/waterways.ts"

/** The inland water's meshes (scene/nature/riverMesh.ts) and its node materials (riverNodes.ts). */

const DRY: Waterways = { rivers: [], lakes: [], falls: [] }
const waters = patchWaters()

/** Each triangle's face normal. */
function faces(geometry: BufferGeometry): Vector3[] {
  const p = geometry.getAttribute("position")
  const index = geometry.getIndex()?.array ?? []
  const at = (i: number) => new Vector3(p.getX(i), p.getY(i), p.getZ(i))
  const out: Vector3[] = []
  for (let i = 0; i < index.length; i += 3) {
    const a = at(index[i] as number)
    out.push(
      at(index[i + 1] as number)
        .sub(a)
        .cross(at(index[i + 2] as number).sub(a)),
    )
  }
  return out
}

/** The vertex of `geometry` nearest a world xz point, and its attributes. */
function nearestVertex(geometry: BufferGeometry, x: number, z: number) {
  const p = geometry.getAttribute("position")
  let best = 0
  for (let i = 1; i < p.count; i++)
    if (Math.hypot(p.getX(i) - x, p.getZ(i) - z) < Math.hypot(p.getX(best) - x, p.getZ(best) - z)) best = i
  const flow = geometry.getAttribute("aFlow")
  return {
    y: p.getY(best),
    flow: [flow.getX(best), flow.getY(best)],
    shore: geometry.getAttribute("aShore").getX(best),
  }
}

describe("inland water surfaces", () => {
  const surface = surfaceGeometry(waters)

  test("no water, no triangles", () => {
    expect(surfaceGeometry(DRY).getIndex()?.count ?? 0).toBe(0)
    expect(fallsGeometry(DRY).getIndex()?.count ?? 0).toBe(0)
  })

  test("one flat patch per river hex, lake hex and lakeshore hex, every triangle facing up", () => {
    const hexes =
      waters.rivers.reduce((n, reach) => n + reach.hexes.length, 0) +
      waters.lakes.reduce((n, lake) => n + lake.cells.length + lake.shore.length, 0)
    expect(surface.getAttribute("position").count).toBe(hexes * 37)
    expect(faces(surface).every((normal) => normal.y > 0)).toBe(true)
  })

  test("each body lies at its own level's height: a river over its channel, a lake lower", () => {
    expect(surfaceY("river", 2) - surfaceY("lake", 2)).toBeCloseTo(0.51, 2)
    const [x, z] = cellToWorld([0, 0])
    expect(nearestVertex(surface, x, z).y).toBeCloseTo(surfaceY("river", 2))
    const [lx, lz] = cellToWorld([3, 3])
    expect(nearestVertex(surface, lx, lz).y).toBeCloseTo(1 * TERRACE + surfaceY("lake", 0))
  })

  test("a river runs down its course, mid-channel far from its banks; a lake barely drifts", () => {
    // (1,1) → (2,2): a straight run east-south-east, ending at a lip.
    const [x, z] = cellToWorld([1, 1])
    const river = nearestVertex(surface, x, z)
    expect(river.flow[0]).toBeGreaterThan(0.8)
    expect(river.flow[1]).toBeGreaterThan(0.4)
    expect(river.shore).toBeGreaterThan(2)
    const [lx, lz] = cellToWorld([2, 4])
    expect(Math.hypot(...nearestVertex(surface, lx, lz).flow)).toBeLessThan(0.35)
  })

  test("past the banks the shore distance goes negative (under the land)", () => {
    // A corner of a straight river hex, far off its channel.
    const [x, z] = cellToWorld([4, 6])
    expect(nearestVertex(surface, x + 5.77, z).shore).toBeLessThan(0)
  })
})

describe("waterfalls", () => {
  const falls = fallsGeometry(waters)
  const part = falls.getAttribute("aPart")
  const p = falls.getAttribute("position")

  test("a sheet and a crown of spray for every fall", () => {
    let sheet = 0
    let spray = 0
    for (let i = 0; i < part.count; i++) part.getX(i) < 0.5 ? sheet++ : spray++
    expect(sheet).toBe(waters.falls.length * 13 * 7)
    expect(spray).toBe(waters.falls.length * 2 * 13)
  })

  test("each sheet leaves its upper water and pierces its lower one", () => {
    const fall = waters.falls[0]
    expect(fall).toBeDefined()
    if (!fall) return
    const top = surfaceY(fall.source, fall.top)
    const bottom = surfaceY(fall.into === "river" ? "river" : "lake", fall.bottom)
    let high = Number.NEGATIVE_INFINITY
    let low = Number.POSITIVE_INFINITY
    for (let i = 0; i < 13 * 7; i++) {
      high = Math.max(high, p.getY(i))
      low = Math.min(low, p.getY(i))
    }
    expect(high).toBeCloseTo(top + 0.02, 3)
    expect(low).toBeLessThan(bottom)
  })

  test("the sheet faces down the fall: outward where it drops", () => {
    // Fall 1 drops south (+z) from (0,-2) to (0,0).
    const normal = falls.getAttribute("normal")
    const last = 13 * 7 - 4
    expect(normal.getZ(last)).toBeGreaterThan(0.9)
  })

  test("a lake's outlet falls as wide as its edge, a river's as its channel", () => {
    // Fall 1 pours from a river, fall 3 from the lake; each fall is a sheet then its spray.
    const width = (n: number) => falls.getAttribute("aSheet").getY(n * (13 * 7 + 26))
    expect(width(0)).toBeLessThan(width(2))
  })
})

describe("the inland water as node materials (?tsl=1, WebGPU)", () => {
  test("both build for every tier and look, fogged, with or without the key light's shadow", () => {
    for (const low of [false, true])
      for (const v2 of [false, true]) {
        const surface = riverNodeMaterial(waterUniforms(), { low, v2, key: null })
        expect([surface.fog, surface.colorNode !== null]).toEqual([true, true])
      }
    const falls = fallNodeMaterial(waterUniforms(), { key: null })
    expect([falls.fog, falls.colorNode !== null]).toEqual([true, true])
  })
})

describe("a generated river, end to end", () => {
  test("a course over two levels makes one fall's geometry and two reaches of surface", () => {
    const level = (cell: readonly [number, number]) =>
      ({ "0,0": 1, "0,2": 1, "0,4": 0 })[`${cell[0]},${cell[1]}`] as number | undefined
    const made = waterwaysOf({
      level,
      rivers: [
        [
          [0, 0],
          [0, 2],
          [0, 4],
          [0, 6],
        ],
      ],
    })
    expect(surfaceGeometry(made).getAttribute("position").count).toBe(3 * 37)
    expect(fallsGeometry(made).getAttribute("position").count).toBe(13 * 7 + 26)
  })
})
