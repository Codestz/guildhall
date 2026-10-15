import { describe, expect, test } from "bun:test"
import { HEX_TILE_SIZE, hexAt, hexCentre, pickGround } from "../src/index.ts"

/**
 * The hex pick (hex/pick.ts): the pointer's ray meets the ground's height field and the hex under that
 * point is the tile, by grid maths alone. Pointy-top hexes: the border between (0,0) and (1,0) is the
 * vertical line x = √3/2 tiles; (0,0) and (0,1) meet along the slanted edges below the centre.
 */

const R = HEX_TILE_SIZE
const SQ3 = Math.sqrt(3)
const flat = () => 0
const OPTS = { tile: R, minY: -1, maxY: 4 }
/** A ray straight down onto world (x, z), from 50 m up. */
const down = (x: number, z: number) => pickGround([x, 50, z], [0, -1, 0], flat, OPTS)

describe("pickGround on flat ground", () => {
  test("straight down on a tile's centre picks that tile, where the ray meets the ground", () => {
    for (const h of [
      { q: 0, r: 0 },
      { q: 3, r: -2 },
      { q: -5, r: 4 },
    ]) {
      const [cx, cz] = hexCentre(h)
      const hit = down(cx * R, cz * R)
      expect(hit && { q: hit.q, r: hit.r }).toEqual(h)
      expect(hit?.y).toBeCloseTo(0, 2)
      expect(hit?.x).toBeCloseTo(cx * R, 6)
    }
  })

  test("either side of the border between two tiles picks each, a hair apart", () => {
    const border = (SQ3 / 2) * R
    const eps = 1e-3
    expect(down(border - eps, 0)).toMatchObject({ q: 0, r: 0 })
    expect(down(border + eps, 0)).toMatchObject({ q: 1, r: 0 })
    // the slanted edge under the centre: between (0,0) and (0,1) at the edge's middle
    const [mx, mz] = [((SQ3 / 2) * 0.5 + 0) * R, 0.75 * R]
    const n = { x: 0.5, z: SQ3 / 2 }
    expect(down(mx - n.x * eps, mz - n.z * eps)).toMatchObject({ q: 0, r: 0 })
    expect(down(mx + n.x * eps, mz + n.z * eps)).toMatchObject({ q: 0, r: 1 })
  })

  test("on a border, a corner where three meet: one tile, the same as hexAt's, never off the three", () => {
    const border = (SQ3 / 2) * R
    const hit = down(border, 0)
    expect(hit).not.toBeNull()
    expect(hit && { q: hit.q, r: hit.r }).toEqual(hexAt(border / R, 0))
    expect([0, 1]).toContain(hit?.q ?? -9)
    // the corner straight below (0,0)'s centre: (0,0), (0,1) and (-1,1) meet
    const corner = down(0, R)
    const three = [
      { q: 0, r: 0 },
      { q: 0, r: 1 },
      { q: -1, r: 1 },
    ]
    expect(three).toContainEqual(corner && { q: corner.q, r: corner.r })
  })

  test("a slanted ray picks where it lands, not where it starts", () => {
    // from over (0,0), looking 45° toward +x: it lands 50 m on, over a tile far east
    const hit = pickGround([0, 50, 0], [1, -1, 0], flat, OPTS)
    expect(hit?.x).toBeCloseTo(50, 1)
    expect(hit && { q: hit.q, r: hit.r }).toEqual(hexAt(50 / R, 0))
  })

  test("a ray that looks up, or runs out before the ground, picks nothing", () => {
    expect(pickGround([0, 50, 0], [0, 1, 0], flat, OPTS)).toBeNull()
    expect(pickGround([0, 50, 0], [1, 0, 0], flat, OPTS)).toBeNull()
    expect(pickGround([0, 50, 0], [1, -0.01, 0], flat, { ...OPTS, far: 200 })).toBeNull()
    expect(pickGround([0, 50, 0], [0, 0, 0], flat, OPTS)).toBeNull()
  })
})

describe("pickGround on stepped ground", () => {
  /** Tile (1,0) and every tile east of its border stand 3 m up: a cliff along x = √3/2 tiles. */
  const border = (SQ3 / 2) * R
  const cliff = (x: number) => (x >= border ? 3 : 0)

  test("a ray that meets the raised tile's side picks the raised tile, not the low one in front", () => {
    // low over (0,0), looking east: it would land on the low ground far beyond if the cliff were not there
    const hit = pickGround([-2, 1.5, 0], [1, -0.02, 0], (x) => cliff(x), OPTS)
    expect(hit).not.toBeNull()
    expect(hit?.x).toBeGreaterThanOrEqual(border)
    expect(hit?.x).toBeCloseTo(border, 2)
    expect(hit).toMatchObject({ q: 1, r: 0 })
    expect(hit?.y).toBeLessThan(3)
  })

  test("a ray that clears the cliff's top lands on the raised tile's top", () => {
    const hit = pickGround([-2, 20, 0], [1, -1, 0], (x) => cliff(x), OPTS)
    expect(hit?.y).toBeCloseTo(3, 2)
    expect(hit && { q: hit.q, r: hit.r }).toEqual(hexAt((hit?.x ?? 0) / R, 0))
  })

  test("a ray from inside the band (a low camera) starts marching where it is", () => {
    const hit = pickGround([0, 1, 0], [0, -1, 0], (x) => cliff(x), OPTS)
    expect(hit).toMatchObject({ q: 0, r: 0 })
    expect(hit?.y).toBeCloseTo(0, 2)
  })
})
