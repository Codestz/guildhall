import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { PropertyBinding } from "three"
import { BEHAVIOURS, clipsOf } from "../src/world/behaviours.ts"
import { DESTINATIONS } from "../src/world/sites.ts"
import { glbJson } from "./support/glb.ts"

/**
 * The clips the hall asks for by name must be in anims.glb: a misspelt clip silently plays
 * Idle_A (Adventurer `play` falls back), which is exactly how a busy worker ends up standing idle.
 */
const ANIMS = glbJson(join(import.meta.dir, "../public/assets/anims.glb"))
const CLIPS = new Set((ANIMS.animations ?? []).map((clip) => clip.name))

describe("anims.glb", () => {
  test("holds every clip each behaviour's loop, pauses and steers play", () => {
    for (const [key, behaviour] of Object.entries(BEHAVIOURS)) {
      const missing = clipsOf(behaviour).filter((clip) => !CLIPS.has(clip))
      expect({ key, missing }).toEqual({ key, missing: [] })
    }
  })

  test("holds the walk, carry and phase clips the Adventurer plays", () => {
    const used = [
      "Idle_A",
      "Walking_A",
      "Running_A",
      "Holding_A",
      "Hit_A",
      "Waving",
      "Cheering",
      "Sit_Chair_Idle",
      "Sit_Floor_Idle",
      ...Object.values(DESTINATIONS).map((d) => d.clip),
    ]
    expect(used.filter((clip) => !CLIPS.has(clip))).toEqual([])
  })

  test("the rig's hand slots are found under the names three gives them", () => {
    // GLTFLoader sanitises node names (`handslot.r` → `handslotr`): asking three for the glTF
    // name finds nothing, and every adventurer's gear silently stayed off (the regression).
    const nodes = new Set(
      (ANIMS.nodes ?? []).map((node) => PropertyBinding.sanitizeNodeName(node.name ?? "")),
    )
    expect(nodes.has("handslotr")).toBe(true)
    expect(nodes.has("handslotl")).toBe(true)
    expect(nodes.has("chest")).toBe(true)
  })
})
