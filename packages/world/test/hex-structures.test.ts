import { describe, expect, test } from "bun:test"
import { HEX_TILE_SIZE, hexIsland, hexStructures, hexWorld, hexZones, LEVEL_STEP } from "../src/hex/index.ts"

const built = [1, 2, 3].map((seed) => {
  const h = hexIsland({ seed, files: 4000 })
  return hexWorld(h, hexZones(h))
})
const E = (HEX_TILE_SIZE * Math.sqrt(3)) / 2

describe("hex stairs and bridges", () => {
  test("stairs start on a hex edge's midpoint and run straight out along the road, inside the lower tile", () => {
    for (const w of built) {
      expect(w.stairs.length).toBeGreaterThan(0)
      for (const st of w.stairs) {
        const len = Math.hypot(st.bx - st.ax, st.bz - st.az)
        expect(len).toBeLessThan(E)
        expect(st.ay - st.by).toBeGreaterThan(0.29)
        // the flight's direction is one of the six road directions (multiples of 60°)
        const a = (Math.atan2(-(st.bz - st.az), st.bx - st.ax) * 180) / Math.PI
        expect(Math.abs(a / 60 - Math.round(a / 60))).toBeLessThan(1e-6)
        // the walker stands on the treads: the first flush with the upper road, the last a step over the
        // lower one, and past the flight on the lower road
        const n = st.steps ?? 2
        const ux = (st.bx - st.ax) / len
        const uz = (st.bz - st.az) / len
        expect(w.stairAt(st.ax, st.az)).toBeCloseTo(st.ay, 5)
        expect(w.stairAt(st.bx - ux * 0.01, st.bz - uz * 0.01)).toBeCloseTo(st.by + (st.ay - st.by) / n, 5)
        expect(w.stairAt(st.bx + ux * 0.2, st.bz + uz * 0.2)).toBeNull()
      }
    }
  })

  test("a bridge's deck meets its banks' road and the walker walks on it", () => {
    for (const w of built)
      for (const b of w.bridges)
        for (const leg of b.legs) {
          expect(leg.by).toBeGreaterThan(b.bed)
          expect(w.stairAt((leg.ax + leg.bx) / 2, (leg.az + leg.bz) / 2)).toBeCloseTo(
            (leg.ay + leg.by) / 2,
            5,
          )
        }
  })

  test("they build as one triangle mesh, and the default step is the lower one", () => {
    const m = hexStructures(built[0]!)
    expect(m.position.length % 9).toBe(0)
    expect(m.position.length).toBe(m.color.length)
    expect(LEVEL_STEP).toBe(0.8)
    expect(built[0]!.step).toBe(LEVEL_STEP)
  })
})
