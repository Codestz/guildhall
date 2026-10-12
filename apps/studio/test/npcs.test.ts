import { describe, expect, test } from "bun:test"
import {
  type CatalogEntry,
  createCatalog,
  type Mount,
  PALETTE,
  resolveNpc,
  SKIN_RAMPS,
  validateNpc,
} from "@guildhall/assets"
import {
  blank,
  clothRamps,
  hideable,
  outfitTargets,
  parseQuery,
  problems,
  propChoices,
  setHand,
  setHead,
  setOutfit,
  setVary,
  TEMPLATES,
  toggle,
} from "../src/npcs/model.ts"

const swatchesOf = (...ramps: string[]): number[] =>
  PALETTE.ramps.filter((r) => ramps.includes(r.name)).map((r) => r.tones.base)

const grip = (over: Partial<Mount> = {}): Mount => ({
  slot: "hand.r",
  hands: 1,
  handle: [0, 0, 0],
  axis: [0, 1, 0],
  edge: [1, 0, 0],
  ...over,
})

function entry(id: string, over: Partial<CatalogEntry> = {}): CatalogEntry {
  const [pack = "", slug = ""] = id.split("/")
  return {
    id,
    pack,
    source: `${slug}.glb`,
    name: slug,
    kind: "static",
    category: "prop",
    tags: [],
    size: [1, 1, 1],
    footprint: { w: 1, d: 1 },
    tris: 1,
    verts: 1,
    bytes: 1,
    swatches: [],
    scale: { factor: 1, rule: "factor", confidence: "pack", flags: [] },
    flags: [],
    compose: { front: null, streetEdge: null, attach: "free", anchors: [], source: "placeholder" },
    files: { glb: `pieces/${id}.glb`, thumb: `thumbs/${id}.webp` },
    hash: "0",
    ...over,
  }
}
const body = (id: string, rig = "rig-medium") =>
  entry(id, {
    kind: "character",
    swatches: swatchesOf("timber", "terracotta", ...SKIN_RAMPS),
    character: { rig, clips: [], bones: 23 },
  })
const held = (id: string, mount?: Mount) =>
  entry(id, {
    compose: {
      front: null,
      streetEdge: null,
      attach: "held",
      anchors: [],
      source: "pack",
      ...(mount && { mount }),
    },
  })

const clips = [
  "Digging",
  "Idle_A",
  "Idle_B",
  "Walking_A",
  "Walking_B",
  "Walking_C",
  "Holding_A",
  "Interact",
  "Melee_Blocking",
]
const catalog = createCatalog(
  {
    version: 1,
    palette: "test",
    importer: "test",
    packs: [],
    rigs: [
      { id: "rig-medium", file: "rigs/rig-medium.glb", clips: clips.map((name) => ({ name, seconds: 1 })) },
    ],
  } as never,
  [
    [
      ...["barbarian", "knight", "mage", "ranger", "rogue", "rogue-hooded"].map((b) =>
        body(`kaykit-adventurers/${b}`),
      ),
      body("quaternius-animals/cow", "quaternius-animal-cow"),
      held("kaykit-tools/lantern", grip({ upright: { up: [0, 1, 0] } })),
      held("kaykit-weapons/sword-a", grip({ alt: ["hand.l"] })),
      held("kaykit-tools/shovel"),
      entry("kaykit-tools/hat", { compose: { ...entry("x/y").compose, mount: grip({ slot: "head" }) } }),
    ],
  ],
)

describe("npc builder query", () => {
  test("reads the deep link", () => {
    const q = parseQuery(new URLSearchParams("recipe=guard&seed=7&strip=4&clip=work&t=0.25&cam=map"))
    expect(q).toEqual({ role: "guard", seed: 7, strip: 4, clip: "work", t: 0.25, map: true })
  })

  test("falls back for anything missing or unreadable", () => {
    const q = parseQuery(new URLSearchParams("recipe=Bad/Id&seed=-1&strip=x&clip=dance&t="))
    expect(q).toEqual({ role: "farmer", seed: 1, strip: 8, clip: "idle", t: null, map: false })
  })
})

describe("npc builder templates", () => {
  test("every template is a valid recipe with no problems against the catalog", () => {
    for (const r of Object.values(TEMPLATES)) {
      expect(validateNpc(r, PALETTE)).toEqual([])
      expect(problems(r, catalog, PALETTE)).toEqual([])
    }
  })

  test("an unknown role starts as a plain townsperson under that id", () => {
    const r = blank("baker")
    expect([r.id, r.role]).toEqual(["baker", "baker"])
    expect(validateNpc(r, PALETTE)).toEqual([])
  })

  test("8 farmer seeds re-tint timber, never skin", () => {
    const looks = Array.from({ length: 8 }, (_, seed) => resolveNpc(TEMPLATES.farmer as never, seed, catalog))
    expect(looks.every((l) => l.rampMap.timber && l.rampMap.timber !== "timber")).toBe(true)
    for (const l of looks) for (const skin of SKIN_RAMPS) expect(l.rampMap[skin]).toBeUndefined()
  })
})

describe("npc builder options", () => {
  test("cloth ramps are the bodies' ramps without skin; targets never include skin", () => {
    expect(clothRamps(blank("x"), catalog, PALETTE)).toEqual(["timber", "terracotta"])
    for (const skin of SKIN_RAMPS) expect(outfitTargets(PALETTE)).not.toContain(skin)
  })

  test("a hand offers props with a mount for it; the rest need one", () => {
    expect(propChoices(catalog.all(), "hand.r")).toEqual({
      mounted: ["kaykit-tools/lantern", "kaykit-weapons/sword-a"],
      needs: ["kaykit-tools/shovel"],
    })
    expect(propChoices(catalog.all(), "hand.l").mounted).toEqual(["kaykit-weapons/sword-a"])
    expect(propChoices(catalog.all(), "head").mounted).toEqual(["kaykit-tools/hat"])
  })

  test("only accessory parts are offered for hiding", () => {
    expect(hideable(["Barbarian_Body", "Barbarian_BearHat", "Skeleton_Mage_Jaw", "Knight_Cape"])).toEqual([
      "Barbarian_BearHat",
      "Knight_Cape",
    ])
  })
})

describe("npc builder edits", () => {
  test("emptying a hand drops it, and no hands drops `hands`", () => {
    const r = setHand(setHand(blank("x"), "r", ["kaykit-tools/lantern", ""]), "l", ["kaykit-weapons/sword-a"])
    expect(r.hands).toEqual({ r: ["kaykit-tools/lantern", ""], l: ["kaykit-weapons/sword-a"] })
    expect(setHand(setHand(r, "r", []), "l", []).hands).toBeUndefined()
  })

  test("outfit rows come and go; headwear drops with its last piece", () => {
    const r = setOutfit(blank("x"), "timber", toggle(["timber"], "dirt"))
    expect(r.outfit).toEqual({ timber: ["timber", "dirt"] })
    expect(setOutfit(r, "timber", null).outfit).toEqual({})
    expect(setHead(setHead(r, ["kaykit-tools/hat"], 0.3), [], 0.3).head).toBeUndefined()
  })

  test("variation ends round to the slider's 1%", () => {
    expect(setVary(blank("x"), "height", 1, 1.0449).vary.height).toEqual([0.96, 1.04])
  })
})

describe("npc builder problems", () => {
  test("names clips the rig lacks, off-rig bodies and props with no mount for the slot", () => {
    const r = setHand(
      {
        ...blank("x"),
        body: ["quaternius-animals/cow"],
        activity: { work: "Dance", idle: ["Idle_A"], walk: "Walking_A" },
      },
      "l",
      ["kaykit-tools/lantern"],
    )
    expect(problems(r, catalog, PALETTE)).toEqual([
      'body: "quaternius-animals/cow" is not on rig-medium',
      'activity.work: rig-medium has no clip "Dance"',
      'hands.l[0]: "kaykit-tools/lantern" needs a mount for hand.l',
    ])
  })

  test("an outfit entry for skin is flagged", () => {
    const skin = SKIN_RAMPS[0] as string
    expect(problems(setOutfit(blank("x"), skin, ["timber"]), catalog, PALETTE)).toContain(
      `outfit.${skin}: skin is never re-tinted; remove it`,
    )
  })
})
