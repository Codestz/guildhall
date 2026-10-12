import { describe, expect, test } from "bun:test"
import { poseToCamera } from "@guildhall/render"
import { rowPose } from "../src/scenes/frame.ts"
import { scalePicks } from "../src/scenes/picks.ts"
import { catalogOf, entry } from "./entries.ts"

const VENDORS = { kk: "kaykit", ke: "kenney", qu: "quaternius" }
const tall = (h: number) => [2, h, 2] as [number, number, number]

describe("scalePicks", () => {
  const catalog = catalogOf(
    [
      entry("kk/knight", { category: "character", size: tall(2.2), tags: ["scale-ref"] }),
      entry("kk/home-a", { category: "building", size: tall(7), tags: ["house"] }),
      entry("kk/home-b", { category: "building", size: tall(10), tags: ["house", "scale-ref"] }),
      entry("kk/tree-big", { category: "tree", size: tall(12) }),
      entry("kk/tree-mid", { category: "tree", size: tall(6.4) }),
      entry("ke/door", { category: "door", size: tall(2.42) }),
      entry("ke/castle-door", { category: "door", size: tall(7.5), tags: ["door", "scale-ref"] }),
      entry("ke/wall-doorway", { category: "wall", size: tall(5.2), tags: ["door", "scale-ref"] }),
      entry("ke/wall-door", { category: "wall", size: tall(3), tags: ["door", "scale-ref"] }),
      entry("ke/pine", { category: "tree", size: tall(6.7) }),
      entry("qu/dead-tree-1", { name: "DeadTree_1", category: "tree", size: tall(6.5) }),
      entry("qu/maple", { category: "tree", size: tall(6.6), tags: ["scale-ref"] }),
    ],
    VENDORS,
  )
  const picks = Object.fromEntries(scalePicks(catalog).map((p) => [p.label, p.entry?.id ?? null]))

  test("the hero and the door: a character reference, a door leaf with its top in the band", () => {
    expect(picks.hero).toBe("kk/knight")
    expect(picks.door).toBe("ke/door")
  })

  test("a house per vendor: the house reference, else the doored storey reference, else none", () => {
    expect(picks["KayKit house"]).toBe("kk/home-b")
    expect(picks["Kenney house"]).toBe("ke/wall-door")
    expect(picks["Quaternius house"]).toBeNull()
  })

  test("a leafy tree per vendor: the reference first, else the one nearest mid band", () => {
    expect(picks["KayKit tree"]).toBe("kk/tree-mid")
    expect(picks["Kenney tree"]).toBe("ke/pine")
    expect(picks["Quaternius tree"]).toBe("qu/maple")
  })

  test("the cast runs left to right: hero, door, houses, trees", () => {
    expect(Object.keys(picks)).toEqual([
      "hero",
      "door",
      "KayKit house",
      "Kenney house",
      "Quaternius house",
      "KayKit tree",
      "Kenney tree",
      "Quaternius tree",
    ])
  })

  test("no character in the library: the silhouette alone stands for the hero", () => {
    const only = scalePicks(catalogOf([entry("kk/home", { category: "building", tags: ["house"] })], VENDORS))
    expect(only.map((p) => p.label)).not.toContain("hero")
  })
})

describe("rowPose", () => {
  const view = { fov: 40, aspect: 16 / 9, azimuth: 0, elevation: 0, margin: 1 }

  test("a long row fits its length across the view", () => {
    const pose = rowPose({ minX: 0, maxX: 40, height: 10, depth: 0 }, view)
    const [x, , z] = poseToCamera(pose)
    const halfH = Math.atan(Math.tan((20 * Math.PI) / 180) * view.aspect)
    // Looking straight down -z from the middle, the row's ends touch the frame's sides.
    expect(x).toBeCloseTo(20)
    expect(Math.atan(20 / z)).toBeCloseTo(halfH)
  })

  test("a tall short row fits its height instead", () => {
    const pose = rowPose({ minX: 0, maxX: 2, height: 30, depth: 4 }, view)
    expect(pose.distance).toBeCloseTo(15 / Math.tan((20 * Math.PI) / 180) + 2)
  })
})
