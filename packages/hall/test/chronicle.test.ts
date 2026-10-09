import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  buildDeep,
  type DeepInput,
  parseAuthorLog,
  parseStructureLog,
  pickSnapshots,
} from "../src/world/chronicle/deep.ts"
import {
  activityAt,
  type Chronicle,
  ChronicleError,
  dayOf,
  decodeChronicle,
  encodeChronicle,
  readChronicle,
  weeksOf,
} from "../src/world/chronicle/format.ts"
import { districtOf, districtsAt, unitsAt } from "../src/world/chronicle/reconstruct.ts"
import { type RepoEntry, summarize } from "../src/world/gen/repo.ts"

const T0 = Date.UTC(2020, 0, 6) / 1000
const DAY0 = dayOf(T0 * 1000)
const at = (days: number): number => T0 + days * 86_400

/** A git log's text: "@<header>" lines, each followed by its file lines. */
const log = (commits: [header: string, lines: string[]][]): string =>
  commits.map(([header, lines]) => [`@${header}`, "", ...lines].join("\n")).join("\n")

const OLD = Array.from({ length: 6 }, (_, i) => `old/m${i}.ts`)
const NEW = Array.from({ length: 6 }, (_, i) => `new/m${i}.ts`)

const STRUCTURE = log([
  [`c1 ${at(0)}`, ["A\tREADME.md", "A\tsrc/index.ts", "A\tsrc/util.ts"]],
  [
    `c2 ${at(10)}`,
    ["A\tpackages/core/a.ts", "A\tpackages/core/b.ts", "A\tpackages/ui/x.tsx", "M\tsrc/index.ts"],
  ],
  [`c3 ${at(40)}`, OLD.map((path) => `A\t${path}`)],
  [`c4 ${at(70)}`, [...OLD.map((path) => `D\t${path}`), ...NEW.map((path) => `A\t${path}`)]],
  [`c5 ${at(100)}`, ["A\ttests/a.test.ts", "M\tsrc/util.ts"]],
])
const AUTHORS = log([
  [`c1 ${at(0)} alice@example.com\tAlice Smith`, ["README.md", "src/index.ts", "src/util.ts"]],
  [
    `c2 ${at(10)} 123+bob@users.noreply.github.com\tbob`,
    ["packages/core/a.ts", "packages/core/b.ts", "packages/ui/x.tsx"],
  ],
  [`b1 ${at(12)} bob@work.com\tBob`, ["src/index.ts"]],
  [`c3 ${at(40)} alice@home.org\tAlice Smith`, OLD],
  [`c4 ${at(70)} alice@home.org\tAlice Smith`, [...OLD, ...NEW]],
  [`c5 ${at(100)} alice@example.com\tAlice Smith`, ["tests/a.test.ts", "src/util.ts"]],
])

/** A tree with sizes: path → bytes. */
const tree = (files: Record<string, number>): { entries: RepoEntry[] } => ({
  entries: Object.entries(files).map(([path, size]) => ({ path, type: "blob" as const, size })),
})
const FINAL: Record<string, number> = {
  "README.md": 500,
  "src/index.ts": 1000,
  "src/util.ts": 800,
  "packages/core/a.ts": 300,
  "packages/core/b.ts": 300,
  "packages/ui/x.tsx": 700,
  ...Object.fromEntries(NEW.map((path) => [path, 200])),
  "tests/a.test.ts": 400,
}

const input = (overrides: Partial<DeepInput> = {}): DeepInput => ({
  repo: "acme/tool",
  branch: "main",
  generatedAt: "2026-10-08T00:00:00.000Z",
  meta: { stars: 42, created: "2020-01-06T00:00:00Z", languages: { TypeScript: 900, CSS: 100 } },
  structure: parseStructureLog(STRUCTURE),
  authors: parseAuthorLog(AUTHORS),
  trees: {
    c1: tree({ "README.md": 400, "src/index.ts": 600, "src/util.ts": 600 }),
    c5: tree(FINAL),
  },
  tags: [
    { tag: "v0.1.0", day: DAY0 + 5 },
    { tag: "v1.0.0", day: DAY0 + 50 },
    { tag: "v1.1.0", day: DAY0 + 60 },
    { tag: "v2.0.0-rc.1", day: DAY0 + 90 },
    { tag: "sdk-v1.0.0", day: DAY0 + 95 },
  ],
  logins: { "bob@work.com": "bob" },
  ...overrides,
})

const unit = (c: Chronicle, name: string) => c.units.find((u) => u.name === name)

describe("format", () => {
  test("a chronicle survives encoding, as JSON and as gzip", async () => {
    const chronicle = buildDeep(input())
    const text = encodeChronicle(chronicle)
    expect(decodeChronicle(text)).toEqual(chronicle)
    expect(await readChronicle(Bun.gzipSync(new TextEncoder().encode(text)))).toEqual(chronicle)
    expect(await readChronicle(new TextEncoder().encode(text))).toEqual(chronicle)
  })

  test("another version, or a page that isn't one, is refused", async () => {
    const text = encodeChronicle({ ...buildDeep(input()), v: 2 as 1 })
    expect(() => decodeChronicle(text)).toThrow(ChronicleError)
    await expect(readChronicle(new TextEncoder().encode("<!doctype html>"))).rejects.toThrow(ChronicleError)
  })
})

describe("deep builder", () => {
  test("the same history always makes the same chronicle", () => {
    expect(encodeChronicle(buildDeep(input()))).toBe(encodeChronicle(buildDeep(input())))
  })

  test("units are born and die on the exact day, renames become milestones", () => {
    const c = buildDeep(input())
    expect(c.start).toBe(DAY0)
    expect(c.end).toBe(DAY0 + 100)
    expect(unit(c, "src")?.born).toBe(DAY0)
    expect(unit(c, "packages/core")).toMatchObject({ born: DAY0 + 10, group: "packages" })
    expect(unit(c, "old")).toMatchObject({ born: DAY0 + 40, died: DAY0 + 70 })
    expect(unit(c, "new")?.born).toBe(DAY0 + 70)
    expect(unit(c, "new")?.died).toBeUndefined()
    expect(c.milestones).toContainEqual({
      day: DAY0 + 70,
      kind: "rename",
      text: "old/ becomes new/",
      unit: "new",
    })
    expect(c.milestones[0]).toEqual({ day: DAY0, kind: "first-commit", text: "First commit, by Alice Smith" })
  })

  test("sizes come from the sampled trees, estimated where a tree is missing", () => {
    const c = buildDeep(input())
    const last = c.snapshots.day.length - 1
    expect(c.snapshots.files[last]).toBe(Object.keys(FINAL).length)
    expect(c.snapshots.bytes[last]).toBe(Object.values(FINAL).reduce((a, b) => a + b, 0))
    expect(c.repo).toMatchObject({ files: 13, bytes: 5200, stars: 42, commits: 6 })
    // c2's tree is missing: src's bytes per file (600) from the nearest sample with one.
    expect(unit(c, "src")?.bytes[1]).toBe(1200)
    expect(c.partial).toEqual(["bytes"])
    expect(c.weekly.files?.at(-1)).toBe(13)
    expect(c.weekly.commits?.reduce((a, b) => a + b, 0)).toBe(6)
  })

  test("authors are joined by login and by full name; home is the unit they touch most", () => {
    const c = buildDeep(input())
    expect(c.contributors.map((p) => [p.name, p.commits, p.login])).toEqual([
      ["Alice Smith", 4, undefined],
      ["Bob", 2, "bob"],
    ])
    const alice = c.contributors[0]!
    expect(alice.home).toBe("old")
    expect(alice.also).toEqual(["src", "/"])
    expect(alice.first).toBe(DAY0)
    expect(activityAt(alice, 0)).toBe(1)
    expect(activityAt(alice, 10)).toBe(1)
    expect(alice.weeks).toHaveLength(15)
  })

  test("releases are tidied and new majors marked, on the main line only", () => {
    const c = buildDeep(input())
    expect(c.releases.map((r) => [r.tag, !!r.major, !!r.prerelease])).toEqual([
      ["v0.1.0", true, false],
      ["v1.0.0", true, false],
      ["v1.1.0", false, false],
      ["v2.0.0-rc.1", false, true],
      ["sdk-v1.0.0", false, false],
    ])
  })

  test("samples are spread over the history, the first and last always kept", () => {
    const structure = Array.from({ length: 500 }, (_, k) => ({
      sha: `s${k}`,
      day: DAY0 + k,
      changes: [["A", `f${k}`]] as [string, string][],
    }))
    const picks = pickSnapshots(structure)
    expect(picks[0]).toBe(0)
    expect(picks.at(-1)).toBe(499)
    expect(picks.length).toBeGreaterThanOrEqual(24)
    expect(picks.length).toBeLessThanOrEqual(40)
  })

  test("history bunched into a few days still gets its samples", () => {
    const structure = Array.from({ length: 70 }, (_, k) => ({
      sha: `s${k}`,
      day: k < 68 ? DAY0 + (k % 2) : DAY0 + 136,
      changes: [["A", `f${k}`]] as [string, string][],
    }))
    const picks = pickSnapshots(structure)
    expect(picks.length).toBeGreaterThanOrEqual(24)
    expect(picks.length).toBeLessThanOrEqual(40)
  })
})

describe("reconstruction", () => {
  const c = buildDeep(input())
  const shape = summarize(tree(FINAL).entries)

  test("a unit exists exactly from its birth to its death", () => {
    for (let day = c.start - 1; day <= c.end + 1; day++) {
      const alive = new Set(unitsAt(c, day).map((u) => u.name))
      for (const u of c.units)
        expect(alive.has(u.name)).toBe(day >= u.born && (u.died === undefined || day < u.died))
    }
  })

  test("sizes match the samples on sample days and stay between them", () => {
    const src = unit(c, "src")!
    c.snapshots.day.forEach((day, i) => {
      expect(unitsAt(c, day).find((u) => u.name === "src")?.files).toBe(src.files[i])
    })
    expect(unitsAt(c, DAY0 + 85).find((u) => u.name === "new")?.files).toBe(6)
    expect(unitsAt(c, DAY0 + 99).find((u) => u.name === "tests")).toBeUndefined()
  })

  test("districts grow into today's island, and end on it exactly", () => {
    const end = districtsAt(c, shape, c.end)
    for (const folder of [shape.root, ...shape.folders])
      expect(end.districts.get(folder.name)).toMatchObject({ files: folder.files, bytes: folder.bytes })
    const early = districtsAt(c, shape, DAY0 + 5)
    expect(early.districts.get("packages/core")).toEqual({ files: 0, bytes: 0, born: DAY0 + 10 })
    expect(early.districts.get("src")?.files).toBe(2)
    let last = 0
    for (let day = c.start; day <= c.end; day += 3) {
      const files = [...districtsAt(c, shape, day).districts.values()].reduce((sum, d) => sum + d.files, 0)
      expect(files).toBeGreaterThanOrEqual(last)
      last = files
    }
  })

  test("a unit gone by today is a ghost while it lived", () => {
    expect(districtOf(c, shape).has("old")).toBe(false)
    expect(districtsAt(c, shape, DAY0 + 50).ghosts.map((u) => u.name)).toEqual(["old"])
    expect(districtsAt(c, shape, DAY0 + 80).ghosts).toEqual([])
  })
})

describe("privacy", () => {
  const SECRETS = ["docs", ".claude", ".agents", "CONTEXT", "skills-lock", "Private Person"]

  test("this repo's private paths never reach its chronicle", () => {
    const structure = parseStructureLog(
      log([
        [`p0 ${at(-3)}`, ["A\tdocs/plan.md", "A\tCONTEXT.md"]],
        [
          `c1 ${at(0)}`,
          ["A\tREADME.md", "A\tsrc/index.ts", "A\t.claude/settings.json", "A\tskills-lock.json"],
        ],
        [`c2 ${at(20)}`, ["A\t.agents/a.md", "A\tdocs/adr/1.md", "A\tsrc/b.ts"]],
      ]),
    )
    const authors = parseAuthorLog(
      log([
        [`p0 ${at(-3)} private@example.com\tPrivate Person`, ["docs/plan.md", "CONTEXT.md"]],
        [
          `c1 ${at(0)} alice@example.com\tAlice Smith`,
          ["README.md", "src/index.ts", ".claude/settings.json"],
        ],
        [`c2 ${at(20)} alice@example.com\tAlice Smith`, [".agents/a.md", "docs/adr/1.md", "src/b.ts"]],
      ]),
    )
    const c = buildDeep({
      ...input({ repo: "Codestz/guildhall", structure, authors, tags: [] }),
      trees: {
        c2: tree({
          "README.md": 10,
          "src/index.ts": 10,
          "src/b.ts": 10,
          "docs/plan.md": 99,
          "CONTEXT.md": 9,
        }),
      },
    })
    const text = encodeChronicle(c)
    for (const secret of SECRETS) expect(text).not.toContain(secret)
    expect(c.start).toBe(DAY0)
    expect(c.repo.files).toBe(3)
    expect(c.repo.bytes).toBe(30)
    expect(c.repo.contributors).toBe(1)
  })

  test("the bundled chronicles decode, and this repo's keeps its private paths out", async () => {
    const dir = join(import.meta.dir, "../public/chronicles")
    const files = readdirSync(dir).filter((file) => file.endsWith(".json.gz"))
    for (const file of files) {
      const c = await readChronicle(readFileSync(join(dir, file)))
      expect(c.depth).toBe("deep")
      expect(c.snapshots.day.length).toBeGreaterThan(0)
      expect(c.weekly.commits).toHaveLength(weeksOf(c))
      if (file === "codestz__guildhall.json.gz") {
        const text = encodeChronicle(c)
        for (const secret of ["docs", ".claude", ".agents", "CONTEXT.md", "skills-lock"])
          expect(text).not.toContain(secret)
      }
    }
  })
})
