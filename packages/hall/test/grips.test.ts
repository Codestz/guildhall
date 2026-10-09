import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { ARCHETYPE_IDS, gearAt, RANKS } from "@guildhall/roster"
import { Bone, Group, Mesh, PropertyBinding, Quaternion, Vector3 } from "three"
import { attachHands } from "../src/scene/activity.ts"
import {
  attachGrip,
  HAND_SLOT,
  isHeldPiece,
  KIT_GRIPS,
  keepUpright,
  NIGHT_LANTERN,
  PROP_GRIPS,
  READING_CLIPS,
  RESTING_MUG,
} from "../src/scene/grips.ts"
import { TOWNSFOLK } from "../src/scene/life/rounds.ts"
import {
  type Behaviour,
  type Held,
  SITE_WORK,
  STATION_WORK,
  stepsOf,
  type Tool,
} from "../src/world/behaviours.ts"
import { SITE_DEFS } from "../src/world/sites.ts"
import { glbJson } from "./support/glb.ts"

/**
 * scene/grips.ts: everything anyone holds has its own grip, so nothing new is ever drawn in its raw
 * model orientation (the pickaxe pointing back over the shoulder, the bow's string turned away).
 */

const assets = join(import.meta.dir, "../public/assets")
const names = (file: string) =>
  new Set(
    (glbJson(join(assets, file)).nodes ?? []).map((node) =>
      PropertyBinding.sanitizeNodeName(node.name ?? ""),
    ),
  )

/** Every kit piece some hand holds, with the hand it is held in. */
function heldPieces(): { piece: string; hand: "right" | "left"; who: string }[] {
  const held: { piece: string; hand: "right" | "left"; who: string }[] = [
    { piece: RESTING_MUG, hand: "right", who: "resting" },
    { piece: NIGHT_LANTERN, hand: "left", who: "night" },
  ]
  for (const id of ARCHETYPE_IDS)
    for (const rank of RANKS) {
      const gear = gearAt(id, rank)
      const who = `${id} (${rank})`
      if (gear.right) held.push({ piece: gear.right, hand: "right", who })
      if (gear.left) held.push({ piece: gear.left, hand: "left", who })
    }
  for (const [site, def] of Object.entries(SITE_DEFS)) {
    if (def.gear?.right) held.push({ piece: def.gear.right, hand: "right", who: site })
    if (def.gear?.left) held.push({ piece: def.gear.left, hand: "left", who: site })
  }
  return held
}

/** Every behaviour anyone runs: the sites', the stations' and the townsfolk's. */
const behaviours = (): [string, Behaviour][] => [
  ...Object.entries(SITE_WORK),
  ...Object.entries(STATION_WORK),
  ...TOWNSFOLK.map((npc): [string, Behaviour] => [npc.id, npc.work]),
]

describe("grips", () => {
  test("every held kit piece has its grip, in the hand that holds it", () => {
    for (const { piece, hand, who } of heldPieces()) {
      expect({ who, piece, gripped: isHeldPiece(piece) }).toEqual({ who, piece, gripped: true })
      if (!isHeldPiece(piece)) continue
      expect({ who, piece, bone: KIT_GRIPS[piece].bone }).toEqual({ who, piece, bone: HAND_SLOT[hand] })
    }
  })

  test("every prop a work loop puts in the hands has its grip", () => {
    for (const [key, behaviour] of behaviours()) {
      const kinds = new Set<Held | Tool>()
      for (const step of stepsOf(behaviour)) if ("clip" in step && step.take) kinds.add(step.take)
      if (behaviour.tool) kinds.add(behaviour.tool)
      for (const kind of kinds)
        expect({ key, kind, gripped: kind in PROP_GRIPS }).toEqual({ key, kind, gripped: true })
    }
  })

  test("the gripped pieces are in kit.glb, and every grip rides a bone the rig has", () => {
    const kit = names("kit.glb")
    for (const piece of Object.keys(KIT_GRIPS))
      expect({ piece, inKit: kit.has(piece) }).toEqual({ piece, inKit: true })
    const rig = names("characters/knight.glb")
    const bones = new Set(
      [...Object.values(KIT_GRIPS), ...Object.values(PROP_GRIPS)].map((grip) => grip.bone),
    )
    for (const bone of bones) expect({ bone, inRig: rig.has(bone) }).toEqual({ bone, inRig: true })
  })

  test("grips are sane: unit-free numbers, a positive scale, an up axis only where kept upright", () => {
    for (const [name, grip] of [...Object.entries(KIT_GRIPS), ...Object.entries(PROP_GRIPS)]) {
      expect({ name, ok: [...grip.position, ...grip.rotation].every(Number.isFinite) }).toEqual({
        name,
        ok: true,
      })
      expect(grip.scale).toBeGreaterThan(0)
      if (grip.up) expect({ name, upright: grip.upright }).toEqual({ name, upright: true })
    }
    // What hangs or stands level whatever the wrist does.
    for (const piece of [RESTING_MUG, NIGHT_LANTERN, "staff", "spellbook_open", "spellbook_closed"] as const)
      expect({ piece, upright: KIT_GRIPS[piece].upright }).toEqual({ piece, upright: true })
    for (const prop of ["bucket", "bow", "spear"] as const)
      expect({ prop, upright: PROP_GRIPS[prop].upright }).toEqual({ prop, upright: true })
    // A book is read open, in the reading clip.
    expect(PROP_GRIPS.book.open?.clips).toBe(READING_CLIPS)
    expect(READING_CLIPS.has("Working_B")).toBe(true)
  })
})

describe("the read book", () => {
  test("shows open while it is read, closed otherwise (scene/activity.ts Hands)", () => {
    const body = new Group()
    const slot = new Bone()
    slot.name = HAND_SLOT.right
    body.add(slot)
    const hands = attachHands(body, STATION_WORK.library)
    const book = slot.children[0]
    const [closed, open] = book?.children ?? []
    if (!book || !closed || !open) throw new Error("the library's book is not in the right hand")
    hands.show("book", true, "Working_B")
    expect([book.visible, closed.visible, open.visible]).toEqual([true, false, true])
    hands.show("book", true, "Carry_Walk")
    expect([book.visible, closed.visible, open.visible]).toEqual([true, true, false])
    hands.show(null, true, "Working_B")
    expect(book.visible).toBe(false)
    hands.dispose()
  })
})

describe("keepUpright", () => {
  /** A hand slot twisted every which way, under a body turned too. */
  function twistedHand(): { body: Group; hand: Bone } {
    const body = new Group()
    body.rotation.set(0, 1.1, 0)
    body.position.set(3, 0, -2)
    const hand = new Bone()
    hand.position.set(0.4, 0.8, 0.2)
    hand.rotation.set(0.9, -0.4, 2.2)
    body.add(hand)
    body.updateMatrixWorld(true)
    return { body, hand }
  }

  test("levels what hangs from an upright grip, the handle staying in the fist", () => {
    const { body, hand } = twistedHand()
    const mug = new Mesh()
    const root = attachGrip(hand, mug, KIT_GRIPS[RESTING_MUG])
    expect(root).not.toBe(mug)
    keepUpright(root)
    body.updateMatrixWorld(true)
    const up = new Vector3(0, 1, 0).applyQuaternion(mug.getWorldQuaternion(new Quaternion()))
    expect(up.y).toBeCloseTo(1, 5)
    // The pivot sits on the hand slot itself: the levelling turns about the fist.
    expect(root.getWorldPosition(new Vector3()).distanceTo(hand.getWorldPosition(new Vector3()))).toBeCloseTo(
      0,
      6,
    )
  })

  test("an open book keeps its own up axis (its pages) to the sky", () => {
    const { body, hand } = twistedHand()
    const book = new Mesh()
    const root = attachGrip(hand, book, KIT_GRIPS.spellbook_open)
    keepUpright(root)
    body.updateMatrixWorld(true)
    const pages = new Vector3(0, 0, 1).applyQuaternion(book.getWorldQuaternion(new Quaternion()))
    expect(pages.y).toBeCloseTo(1, 5)
  })

  test("held gear never casts into the static shadow map, however it was cloned", () => {
    const { hand } = twistedHand()
    const lantern = new Group()
    const glass = new Mesh()
    glass.castShadow = true
    lantern.add(glass)
    lantern.castShadow = true
    attachGrip(hand, lantern, KIT_GRIPS[NIGHT_LANTERN])
    expect(glass.castShadow).toBe(false)
    expect(lantern.castShadow).toBe(false)
  })

  test("a fixed grip is the object itself, and keepUpright leaves it alone", () => {
    const { hand } = twistedHand()
    const pick = new Mesh()
    const root = attachGrip(hand, pick, KIT_GRIPS.pickaxe)
    expect(root).toBe(pick)
    const before = pick.quaternion.clone()
    keepUpright(root)
    expect(pick.quaternion.equals(before)).toBe(true)
  })
})
