/**
 * A repo's hall HUD in history mode (hall/hud/view.ts): the Brand's figures, the Places list, a place's
 * dossier and the Chronicle feed, read from V1's bundled Repo Chronicles of react and Guildhall.
 */
import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { type Chronicle, readChronicle, repoLegendOf, unitsAt } from "@guildhall/sim"
import { poseFor } from "../src/hall/hud/HallHud.tsx"
import {
  brandOf,
  dateOf,
  feedOf,
  feedPick,
  feedStamp,
  monthOf,
  placeDossier,
  placeOfUnit,
  placeRows,
  plain,
  short,
} from "../src/hall/hud/view.ts"
import { type HallRepo, repoOf } from "../src/hexworld/hall.ts"
import type { BuiltPlace } from "../src/hexworld/job.ts"

const REPO_DIR = join(import.meta.dir, "../public/lab/repo")
const read = async (name: string) =>
  readChronicle(new Uint8Array(await Bun.file(join(REPO_DIR, `${name}.json.gz`)).arrayBuffer()))

/** The places as the island would build them from the repo's specs (kinds as zones, a heart each). */
function built(repo: HallRepo): BuiltPlace[] {
  if (repo.kind !== "chronicled") return []
  return repo.places.map((p, k) => ({
    id: p.id,
    label: p.label,
    kind: p.capital ? "town" : p.kind === "settlement" ? (p.tier === 1 ? "hamlet" : "farm") : p.kind,
    files: p.files,
    tiles: 10 + k,
    at: [k, 2, -k] as [number, number, number],
  }))
}

let react: Chronicle
let reactRepo: HallRepo
let guildhall: Chronicle

describe("the hall's HUD, told from a chronicle", async () => {
  react = await read("react")
  reactRepo = repoOf(react, "cdn")
  guildhall = await read("guildhall")

  test("the brand's figures are the chronicle's: files, commits, hands, years, places", () => {
    if (reactRepo.kind !== "chronicled") throw new Error("react should be chronicled")
    const b = brandOf(reactRepo, "facebook/react", 37, react)
    expect(b.name).toBe(react.repo.name)
    expect(b.source.kind).toBe("history")
    const by = Object.fromEntries(b.stats.map((s) => [s.label, s.value]))
    expect(by.files).toBe(short(reactRepo.files))
    expect(by.commits).toBe(short(react.repo.commits ?? 0))
    expect(by.hands).toBe(short(react.repo.contributors))
    expect(by.years).toBe(13)
    expect(by.places).toBe(37)
    expect(b.status).toBe("2013–2026")
    expect(b.description).toBe(react.repo.description)
    expect(b.built).toStartWith("Chronicle built 20")
  })

  test("a repo with no chronicle is a sketch, said so, with no figures", () => {
    const b = brandOf({ kind: "sketch", name: "torvalds/linux", why: "not-chronicled" }, "torvalds/linux", 0)
    expect(b.source.kind).toBe("sketch")
    expect(b.stats).toEqual([])
    expect(b.sketch).toEqual({ why: "not-chronicled" })
    expect(brandOf(null, "a/b", 0).name).toBe("a/b")
  })

  test("figures fit a narrow card", () => {
    expect(short(7252)).toBe("7,252")
    expect(short(19117)).toBe("19.1k")
    expect(short(250753)).toBe("251k")
    expect(short(1_200_000)).toBe("1.2M")
  })

  test("the places list holds every place, biggest first, and points back at the built one", () => {
    const places = built(reactRepo)
    const rows = placeRows(places, reactRepo)
    expect(rows.length).toBe(places.length)
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1]!.files).toBeGreaterThanOrEqual(rows[i]!.files)
    for (const r of rows) expect(places[r.index]?.id).toBe(r.id)
    expect(rows.reduce((s, r) => s + r.share, 0)).toBeCloseTo(1, 5)
    // the capital is the biggest unit, and says so
    expect(rows[0]?.kind).toBe("capital")
  })

  test("a place's dossier: its unit, size, birth, its files over time and its annals", () => {
    const places = built(reactRepo)
    const at = places.findIndex((p) => p.id === "packages/react-dom")
    expect(at).toBeGreaterThanOrEqual(0)
    const place = places[at]!
    const legend = repoLegendOf(react)
    const d = placeDossier(place, reactRepo, react, legend)
    const unit = unitsAt(react, react.end).find((u) => u.name === "packages/react-dom")!
    expect(d.place.name).toBe(place.label)
    expect(d.place.package).toBe("packages/react-dom")
    const facts = Object.fromEntries(d.facts.map((f) => [f.label, f.value]))
    expect(facts.Born).toBe(dateOf(unit.born))
    expect(facts.Language).toBe(unit.language)
    expect(facts.Files).toBe(place.files.toLocaleString("en-US"))
    // the sparkline starts where the unit had its first files and ends at today's sample
    expect(d.activity.length).toBeGreaterThan(2)
    expect(d.activity[0]).toBeGreaterThan(0)
    expect(d.activityLabel).toContain(monthOf(react.end * 86_400_000))
    expect(d.files.map((f) => f.path)).toEqual(["packages/react-dom"])
    // its founding is in its annals, code marks taken out
    expect(d.annals.some((a) => a.text.includes("packages/react-dom") && !a.text.includes("`"))).toBe(true)
  })

  test("a pooled place lists the units it holds", () => {
    const repo = repoOf(react, "cdn")
    if (repo.kind !== "chronicled") throw new Error("chronicled")
    const pooled = repo.places.find((p) => p.pooled?.length)
    if (!pooled) return // react has room for every unit: nothing pooled
    const places = built(repo)
    const d = placeDossier(places.find((p) => p.id === pooled.id)!, repo, react, null)
    expect(d.files.map((f) => f.path)).toEqual(pooled.pooled!)
  })

  test("the chronicle feed: each era opens with its title, then its milestones; a place's milestone opens it", () => {
    const places = built(reactRepo)
    const legend = repoLegendOf(react)
    const feed = feedOf(legend, placeOfUnit(places, reactRepo))
    const eras = feed.filter((e) => e.key.startsWith("era-"))
    expect(eras.length).toBe(legend.eras.length)
    for (let i = 1; i < feed.length; i++) expect(feed[i - 1]!.at).toBeLessThanOrEqual(feed[i]!.at)
    expect(eras[0]?.who).toStartWith("I. ")
    const toPlace = feed.filter((e) => e.hero?.startsWith("place:"))
    expect(toPlace.length).toBeGreaterThan(0)
    for (const e of toPlace) {
      const pick = feedPick(e.hero!)
      expect(pick?.kind).toBe("place")
      if (pick?.kind === "place") expect(places[pick.index]).toBeDefined()
    }
    expect(feedPick("era:x")).toEqual({ kind: "era", id: "x" })
    expect(feedPick("nothing")).toBeNull()
    expect(feed.every((e) => !e.text.includes("`"))).toBe(true)
    expect(feedStamp(react)).toBe("2013–2026")
  })

  test("a short history (Guildhall's days) still tells its feed and its stamp", () => {
    const repo = repoOf(guildhall, "cdn")
    const legend = repoLegendOf(guildhall)
    const feed = feedOf(legend, placeOfUnit(built(repo), repo))
    expect(feed.length).toBeGreaterThan(legend.eras.length)
    expect(feedStamp(guildhall)).toMatch(/^\d{4}(–\d{4})?$/)
  })

  test("a place picked flies the camera over its heart, keeping the way it looks", () => {
    const pose = poseFor(
      { at: [10, 2, -4], tiles: 25 },
      { target: [0, 0, 0], azimuth: 120, elevation: 70, distance: 300 },
    )
    expect(pose.target).toEqual([10, 2, -4])
    expect(pose.azimuth).toBe(120)
    expect(pose.elevation).toBeLessThanOrEqual(52)
    expect(pose.distance).toBeLessThan(300)
    // beside a right-hand sheet the target moves right of the place, across the view (the place shows left)
    const from = { target: [0, 0, 0] as [number, number, number], azimuth: 0, elevation: 40, distance: 80 }
    const beside = poseFor({ at: [0, 0, 0], tiles: 25 }, from, "right")
    expect(beside.target[0]).toBeGreaterThan(0)
    expect(beside.target[2]).toBeCloseTo(0, 6)
    // over a phone's bottom sheet it moves toward the camera (the place shows higher up)
    const over = poseFor({ at: [0, 0, 0], tiles: 25 }, from, "bottom")
    expect(over.target[0]).toBeCloseTo(0, 6)
    expect(over.target[2]).toBeGreaterThan(0)
  })

  test("code marks are taken out of a line drawn without them", () => {
    expect(plain("`v16.0.0` set sail from `packages/react`")).toBe("v16.0.0 set sail from packages/react")
  })
})
