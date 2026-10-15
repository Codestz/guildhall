/**
 * The knights' shields (data/mounts.json, assets npc/resolve.ts, hexworld life.ts): put away while
 * seated or lying, as the swords are (the mount's per-clip `hide`), and never held in the two-handed
 * guard: a shield-bearer stands idle on its plain idle, while a duel, a drill and the block keep theirs.
 */
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  holdsShield,
  type Mount,
  type MountsFile,
  type NpcRecipe,
  resolveNpc,
  standClip,
  TWO_HANDED_GUARD,
} from "@guildhall/assets"
import { catalogOf, entry } from "./entries.ts"

const DATA = join(import.meta.dir, "../../../data")
const mounts = (JSON.parse(readFileSync(join(DATA, "mounts.json"), "utf8")) as MountsFile).mounts
const recipes = readdirSync(join(DATA, "npcs"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(DATA, "npcs", f), "utf8")) as NpcRecipe)

/** The rig's seated and lying clips (KayKit rig-medium), getting down and up included. */
const SEATED = [
  "Sit_Chair_Down",
  "Sit_Chair_Idle",
  "Sit_Chair_StandUp",
  "Sit_Floor_Down",
  "Sit_Floor_Idle",
  "Sit_Floor_StandUp",
  "Lie_Down",
  "Lie_Idle",
  "Lie_StandUp",
]
const SHIELDS = Object.keys(mounts).filter((id) => holdsShield([{ piece: id }]))

describe("a shield is put away while seated, as the sword is", () => {
  test("the sword hides seated by its mount's clip override: the same mechanism the shields use", () => {
    expect(mounts["kaykit-adventurers/sword-1handed"]?.clips?.Sit_Chair_Idle?.hide).toBe(true)
  })

  test("every shield hides on every sit and lie clip, and shows standing, walking and fighting", () => {
    expect(SHIELDS.length).toBeGreaterThanOrEqual(3)
    for (const id of SHIELDS) {
      const clips = mounts[id]?.clips ?? {}
      for (const clip of SEATED) expect([id, clip, clips[clip]?.hide]).toEqual([id, clip, true])
      for (const clip of ["Idle_A", "Idle_B", "Walking_A", "Melee_Blocking", "Melee_1H_Attack_Chop"])
        expect([id, clip, clips[clip]?.hide]).toEqual([id, clip, undefined])
    }
  })
})

describe("a shield-bearer idles plain, never in the two-handed guard", () => {
  const mounted = Object.entries(mounts).map(([id, m]) =>
    entry(id, {
      compose: {
        front: null,
        streetEdge: null,
        attach: "held",
        anchors: [],
        source: "pack",
        mount: m as Mount,
      },
    }),
  )
  const catalog = catalogOf([
    entry("kaykit-adventurers/knight", {
      kind: "character",
      character: { rig: "rig-medium", clips: [], bones: 23 },
    }),
    ...mounted,
  ])
  const SEEDS = Array.from({ length: 200 }, (_, i) => i)
  const shielded = recipes.filter((r) => r.hands?.l?.some((p) => holdsShield([{ piece: p }])))

  test("the knight, the guard and the soldier carry shields and never draw the guard as their idle", () => {
    expect(shielded.map((r) => r.id).sort()).toEqual(["guard", "knight", "soldier"])
    for (const r of shielded) {
      const plain = r.activity.idle.filter((c) => c !== TWO_HANDED_GUARD)
      for (const seed of SEEDS) {
        const look = resolveNpc(r, seed, catalog)
        expect(holdsShield(look.mounts)).toBe(true)
        expect(plain).toContain(look.clips.idle)
        // their work is still the block
        expect(look.clips.work).toBe(r.activity.work)
      }
    }
  })

  test("a holder with no shield (a two-handed sword) keeps the guard among its idles", () => {
    const greatsword: NpcRecipe = {
      ...shielded[0]!,
      id: "greatsword",
      hands: { r: ["kaykit-weapons/sword-a"] },
      activity: { work: "Melee_Blocking", idle: [TWO_HANDED_GUARD], walk: "Walking_A" },
    }
    for (const seed of SEEDS.slice(0, 20)) {
      const look = resolveNpc(greatsword, seed, catalog)
      expect(look.clips.idle).toBe(TWO_HANDED_GUARD)
      expect(standClip(TWO_HANDED_GUARD, look)).toBe(TWO_HANDED_GUARD)
    }
  })

  test("a recipe whose only idle is the guard idles on Idle_A once it has a shield", () => {
    const only: NpcRecipe = {
      ...shielded[0]!,
      activity: { ...shielded[0]!.activity, idle: [TWO_HANDED_GUARD] },
    }
    expect(resolveNpc(only, 1, catalog).clips.idle).toBe("Idle_A")
  })

  test("a spot asking for the guard (the barracks' post) stands a shield-bearer on its plain idle", () => {
    const barracks = JSON.parse(readFileSync(join(DATA, "tiles/barracks.json"), "utf8")) as {
      spots: { clip?: string; roles?: string[] }[]
    }
    const post = barracks.spots.find((s) => s.clip === TWO_HANDED_GUARD)
    expect(post?.roles).toContain("guard")
    const guard = resolveNpc(recipes.find((r) => r.id === "guard")!, 3, catalog)
    expect(standClip(TWO_HANDED_GUARD, guard)).toBe(guard.clips.idle)
    expect(guard.clips.idle).not.toBe(TWO_HANDED_GUARD)
    // the combat clips are the shield-bearer's own still
    for (const clip of ["Melee_Blocking", "Melee_Block_Hit", "Melee_1H_Attack_Chop", "Melee_2H_Attack_Chop"])
      expect(standClip(clip, guard)).toBe(clip)
    // without the shield, the guard is the guard
    expect(standClip(TWO_HANDED_GUARD, { ...guard, mounts: [] })).toBe(TWO_HANDED_GUARD)
  })
})
