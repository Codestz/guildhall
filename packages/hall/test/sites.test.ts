import { describe, expect, test } from "bun:test"
import { apply, emptyModel, type Model } from "@guildhall/core"
import { ROLES, STRANGER } from "@guildhall/roster"
import { viewsOf } from "../src/guild/store.ts"
import { island, SITES } from "../src/world/lands.ts"
import { INFIRMARY, INFIRMARY_MATS } from "../src/world/layout.ts"
import { DESTINATIONS, FATES, type Fates, SITE_DEFS, siteOf } from "../src/world/sites.ts"

/** A guildmaster and `n` subagents of `agent`, each failed at `failedAt[i]` (ms) after starting at 0. */
function failedParty(agent: string, failedAt: readonly number[]): Model {
  const model = emptyModel()
  apply(model, { type: "session", id: "m", agent: "guild-master", title: "t", at: 0 })
  apply(model, { type: "status", id: "m", status: "busy", at: 0 })
  failedAt.forEach((at, i) => {
    const id = `k${i}`
    apply(model, { type: "session", id, parentID: "m", agent, title: "x", at: i })
    apply(model, { type: "status", id, status: "busy", at: i })
    apply(model, { type: "status", id, status: "failed", error: "boom", at })
  })
  return model
}

describe("site registry", () => {
  test("every site on the map has an entry, built on its map data", () => {
    expect(Object.keys(SITE_DEFS).sort()).toEqual(Object.keys(SITES).sort())
    for (const [id, def] of Object.entries(SITE_DEFS)) {
      expect(def.id).toBe(id as keyof typeof SITES)
      expect(def.posts).toBe(SITES[def.id].posts)
    }
  })

  test("role → site is the roster's: guild roles by their own site, strangers at the quarry", () => {
    expect(siteOf("guild-implementer")).toBe("yard")
    expect(siteOf("guild-explorer")).toBe("forest")
    expect(siteOf("guild-researcher")).toBe("river")
    expect(siteOf("guild-verifier")).toBe("proving")
    expect(siteOf("guild-librarian")).toBe("tower")
    expect(siteOf("guild-architect")).toBeUndefined()
    expect(siteOf("guild-master")).toBeUndefined()
    expect(siteOf("general")).toBe("quarry")
    for (const role of [...ROLES, STRANGER]) if (role.site) expect(SITE_DEFS[role.site]).toBeDefined()
  })

  test("each site's trade: its loop works the trade, and the trade's deeds steer it", () => {
    const loop = (id: keyof typeof SITE_DEFS) =>
      SITE_DEFS[id].work.loop.flatMap((step) => ("clip" in step ? [step.clip] : []))
    expect(loop("yard")).toEqual(expect.arrayContaining(["Hammering", "Sawing"]))
    expect(loop("forest")).toContain("Chopping")
    expect(loop("river")).toEqual(expect.arrayContaining(["Fishing_Cast", "Fishing_Reeling"]))
    expect(loop("proving")).toEqual(expect.arrayContaining(["Ranged_Bow_Draw", "Ranged_Bow_Release"]))
    expect(loop("quarry")).toContain("Pickaxing")
    expect(loop("tower")).toContain("Ranged_Magic_Spellcasting")
    const steers = (id: keyof typeof SITE_DEFS, tool: string) =>
      SITE_DEFS[id].work.steer?.some((rule) => rule.tools === true || rule.tools.has(tool)) ?? false
    expect([steers("yard", "write"), steers("forest", "grep"), steers("river", "webfetch")]).toEqual([
      true,
      true,
      true,
    ])
    expect([steers("proving", "bash"), steers("quarry", "anything"), steers("forest", "edit")]).toEqual([
      true,
      true,
      false,
    ])
  })

  test("a site's landmark, where the Life layer has one, is marked as that site's", () => {
    const owner = new Map(Object.values(SITE_DEFS).map((def) => [def.landmark, def.id]))
    const marked = island().landmarks.filter((mark) => mark.piece && owner.has(mark.piece))
    expect(marked.length).toBeGreaterThanOrEqual(4)
    for (const mark of marked) expect(mark.site).toBe(owner.get(mark.piece) as keyof typeof SITES)
  })
})

describe("failure destinations", () => {
  test("today every failure goes to the infirmary: beds first, then mats, then they share", () => {
    const views = viewsOf(failedParty("guild-implementer", [10, 10, 10, 10, 10, 10, 10]), 20)
    const failed = views.filter((v) => v.phase === "failed")
    expect(failed).toHaveLength(7)
    expect(failed.every((v) => v.destination === "infirmary" && v.site === undefined)).toBe(true)
    expect(failed.map((v) => v.seat)).toEqual(["bed", "bed", "bed", "floor", "floor", "floor", "floor"])
    expect(failed.map((v) => v.target)).toEqual([...INFIRMARY, ...INFIRMARY_MATS, INFIRMARY_MATS[0]])
    expect(DESTINATIONS.infirmary?.clip).toBe("Lie_Idle")
  })

  test("failed adventurers stay in the infirmary however long ago they failed", () => {
    const views = viewsOf(failedParty("general", [10]), 3_600_000)
    expect(views.find((v) => v.id === "k0")?.phase).toBe("failed")
  })

  test("a destination plugs in as data: its rule picks who goes, each place counts its own", () => {
    const LONG = 60_000
    const fates: Fates = {
      destinations: {
        ...FATES.destinations,
        graveyard: { label: "Graveyard", berth: (n) => ({ target: [100 + n, 0, 0] }), clip: "Lie_Idle" },
      },
      rules: [{ to: "graveyard", when: ({ session }) => (session.ended ?? 0) - session.started > LONG }],
      fallback: "infirmary",
    }
    const views = viewsOf(failedParty("guild-verifier", [10, LONG + 10, 20, LONG + 20]), LONG + 30, fates)
    const where = views
      .filter((v) => v.phase === "failed")
      .map((v) => [v.id, v.destination, v.target, v.seat])
    expect(where).toEqual([
      ["k0", "infirmary", INFIRMARY[0], "bed"],
      ["k1", "graveyard", [100, 0, 0], undefined],
      ["k2", "infirmary", INFIRMARY[1], "bed"],
      ["k3", "graveyard", [101, 0, 0], undefined],
    ])
  })
})
