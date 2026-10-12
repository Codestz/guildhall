import { describe, expect, test } from "bun:test"
import { lightAt } from "@guildhall/render"
import { hexGroundFine, hexIsland, hexWorld, hexZones, LEVEL_STEP } from "@guildhall/world"
import { sideLit } from "../src/hexworld/index.ts"
import {
  type FromWorker,
  heightsAt,
  runHexJob,
  sinkPools,
  transferables,
  unpack,
} from "../src/hexworld/job.ts"

/** The hex island's opening camera sees the sun from the side, so its shadows read (V1's look). */

describe("sideLit", () => {
  test("the camera looks 75° off the sun's heading, whatever the hour", () => {
    for (const hour of [8, 12, 15.5, 17.5, 18.4]) {
      const sun = lightAt(hour).sunDir
      const az = (sideLit(sun) * Math.PI) / 180
      // The rig looks along (-sin az, -cos az).
      const look = [-Math.sin(az), -Math.cos(az)]
      const heading = Math.hypot(sun[0], sun[2])
      const cos = (look[0]! * sun[0] + look[1]! * sun[2]) / heading
      expect((Math.acos(cos) * 180) / Math.PI).toBeCloseTo(75, 0)
    }
  })

  test("the old fixed azimuth (30°) at 15:30 had the sun straight behind the camera", () => {
    const sun = lightAt(15.5).sunDir
    const az = (30 * Math.PI) / 180
    const cos = (-Math.sin(az) * sun[0] - Math.cos(az) * sun[2]) / Math.hypot(sun[0], sun[2])
    expect(cos).toBeLessThan(-0.95)
  })
})

/** The island's build off the main thread: what each stage carries, and that it matches the world. */
describe("runHexJob", () => {
  const spec = { seed: 1, files: 600, ground: "fine" as const, step: LEVEL_STEP, paint: true, tiles: null }
  const run = () => {
    const msgs: FromWorker[] = []
    runHexJob(spec, (m) => msgs.push(m))
    return msgs
  }
  const msgs = run()
  const map = msgs[0]?.type === "map" ? msgs[0].map : null
  const ground = msgs[1]?.type === "ground" ? msgs[1].ground : null
  const placed = msgs[2]?.type === "pieces" ? msgs[2].pieces : null
  const shore = msgs[3]?.type === "shore" ? msgs[3].shore : null

  test("posts the map, the ground, the pieces and the shore field, in that order and nothing else", () => {
    expect(msgs.map((m) => m.type)).toEqual(["map", "ground", "pieces", "shore"])
  })

  test("the ground stage's heights answer as the fine ground's heightAt does ", () => {
    const h = hexIsland({ seed: 1, files: 600 })
    const w = hexWorld(h, hexZones(h))
    const at = heightsAt(ground!.heights)
    const grey: [number, number, number] = [0, 0, 0]
    const fine = hexGroundFine(h, sinkPools(w).sunk, {
      top: { grass: grey },
      side: {},
      sideLand: grey,
      slope: grey,
    })
    let landed = 0
    for (let x = -60; x <= 60; x += 1.7)
      for (let z = -60; z <= 60; z += 2.3) {
        expect(at(x, z)).toBe(fine.heightAt(x, z))
        if (at(x, z) > 0) landed++
      }
    expect(landed).toBeGreaterThan(100)
    expect(at(1e4, 1e4)).toBe(0)
  })

  test("the packed pieces unpack to the world's pieces, the lanterns lit", () => {
    const pieces = unpack(placed!)
    const h = hexIsland({ seed: 1, files: 600 })
    const w = hexWorld(h, hexZones(h))
    expect(pieces.map((p) => p.piece)).toEqual(w.pieces.map((p) => p.piece))
    expect(pieces[0]!.x).toBeCloseTo(w.pieces[0]!.x, 4)
    const lanterns = pieces.filter((p) => p.piece === "kaykit-halloween/post-lantern").length
    expect(map!.lamps.length).toBe(lanterns)
  })

  test("the shore field is 0 on land and grows out to the open sea", () => {
    const { min, size, res, data } = shore!
    expect(data.length).toBe(res * res)
    const at = (x: number, z: number) =>
      data[Math.floor(((z - min[1]) / size) * res) * res + Math.floor(((x - min[0]) / size) * res)]
    const heart = map!.heart!
    expect(at(heart[0], heart[2])).toBe(0)
    expect(at(min[0] + 0.1, min[1] + 0.1)).toBe(255)
  })

  test("every array of a stage is handed over, not copied", () => {
    const fresh = run()
    const buffers = fresh.flatMap(transferables)
    expect(buffers.length).toBeGreaterThanOrEqual(9)
    expect(new Set(buffers).size).toBe(buffers.length)
  })

  test("the hex ground sends prisms instead of a mesh", () => {
    const out: FromWorker[] = []
    runHexJob({ ...spec, ground: "hex" }, (m) => out.push(m))
    const tiles = out[0]?.type === "map" ? out[0].map.stats.tiles : 0
    const g = out[1]?.type === "ground" ? out[1].ground : null
    expect(g?.mesh).toBeNull()
    expect(g?.prisms?.length).toBe(tiles)
  })
})
