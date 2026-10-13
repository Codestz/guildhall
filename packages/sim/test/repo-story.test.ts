import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import {
  ageOf,
  type Chronicle,
  DAY_MS,
  erasOf,
  filesAt,
  isMajor,
  isRelease,
  MAX_ERAS,
  repoLegendMarkdown,
  repoLegendOf,
  repoRecapOf,
  spanOf,
} from "../src/index.ts"
import { chronicle, REPO_DIR, REPOS, type RepoName } from "./repo-fixtures.ts"

/**
 * The repository's story (story/repo) on V1's bundled chronicles. The goldens
 * (`fixtures/repo/<name>.story.md`) are the whole book and card as text: read them, they are the
 * product. `UPDATE_GOLDEN=1 bun test packages/sim/test/repo-story.test.ts` rewrites them after a
 * deliberate change in the words.
 */

const day = (iso: string) => Math.floor(Date.parse(iso) / DAY_MS)

function told(c: Chronicle): string {
  const legend = repoLegendOf(c)
  const recap = repoRecapOf(c)
  const eras = legend.eras.map(
    (e) =>
      `- ${e.numeral} ${e.title} | ${e.span}${e.release ? ` | ${e.release}` : ""} | ${e.files} files${
        e.commits !== undefined ? ` | ${e.commits} commits` : ""
      }`,
  )
  return [
    `<!-- rule: ${legend.rule} -->`,
    repoLegendMarkdown(legend),
    "## Eras",
    "",
    ...eras,
    "",
    "## The card",
    "",
    `**The Chronicle of ${recap.title}** · ${recap.subtitle}`,
    "",
    recap.numbers.map((n) => `${n.value} ${n.label}`).join(" · "),
    "",
    ...recap.lines.map((l) => `- (${l.kind}) ${l.parts.map((p) => p.text).join("")}`),
    "",
    `${recap.hero.label}: ${recap.hero.mark} · ${recap.link}`,
    "",
  ].join("\n")
}

describe("the repo story's goldens", () => {
  for (const name of REPOS)
    test(name, async () => {
      const text = told(await chronicle(name))
      const file = join(REPO_DIR, `${name}.story.md`)
      if (process.env.UPDATE_GOLDEN) await Bun.write(file, text)
      expect(text).toBe(await Bun.file(file).text())
    })
})

describe("the era rule", () => {
  const rules: Record<RepoName, [string, number]> = {
    react: ["release", 6],
    opencode: ["quarter", 6],
    guildhall: ["day", 3],
    cockpit: ["day", 7],
  }
  for (const name of REPOS)
    test(`${name}: ${rules[name][0]}, ${rules[name][1]} eras, end to end with no gap`, async () => {
      const c = await chronicle(name)
      const { rule, spans } = erasOf(c)
      expect([rule, spans.length]).toEqual(rules[name])
      expect(spans[0]?.from).toBe(c.start)
      expect(spans.at(-1)?.to).toBe(c.end)
      spans.forEach((s, i) => {
        expect(s.to).toBeGreaterThanOrEqual(s.from)
        if (i > 0) expect(s.from).toBe((spans[i - 1]?.to ?? 0) + 1)
      })
    })

  test("react's eras open on its majors, v15 to v19", async () => {
    const { spans } = erasOf(await chronicle("react"))
    expect(spans.map((s) => s.opens?.tag)).toEqual([
      undefined,
      "v15.0.0",
      "v16.0.0",
      "v17.0.0",
      "v18.0.0",
      "v19.0.0",
    ])
  })

  function synthetic(years: number, majors: string[] = []): Chronicle {
    const start = day("2010-01-01")
    const end = day(`${2010 + years - 1}-12-31`)
    const weeks = Math.floor((end - start) / 7) + 1
    return {
      v: 1,
      depth: "deep",
      generatedAt: "2026-10-09T00:00:00Z",
      repo: { name: "a/b", branch: "main", languages: [], files: 10, bytes: 10, contributors: 1 },
      start,
      end,
      snapshots: { day: [start, end], files: [1, 10], bytes: [1, 10] },
      units: [],
      weekly: { commits: Array.from({ length: weeks }, (_, w) => (w % 52 < 4 ? 1 : 10)) },
      contributors: [],
      releases: majors.map((tag, i) => ({ tag, day: start + 400 * (i + 1) })),
      milestones: [],
    }
  }

  test("a long calendar history merges to at most ten eras", () => {
    const { rule, spans } = erasOf(synthetic(20))
    expect(rule).toBe("year")
    expect(spans.length).toBe(MAX_ERAS)
  })

  test("two majors are not enough to cut by release; three are", () => {
    expect(erasOf(synthetic(8, ["v1.0.0", "v2.0.0"])).rule).toBe("year")
    expect(erasOf(synthetic(8, ["v1.0.0", "v2.0.0", "v3.0.0"])).rule).toBe("release")
    // prereleases, 0.x and a package's own tags never cut
    expect(erasOf(synthetic(8, ["v1.0.0", "v2.0.0-rc.1", "0.3.0", "x@3.0.0"])).rule).toBe("year")
  })
})

describe("files(t), the growth clock", () => {
  test("guildhall's island at the end of each day, from its samples", async () => {
    const c = await chronicle("guildhall")
    expect([c.start - 1, c.start, c.start + 1, c.end].map((d) => filesAt(c, d))).toEqual([0, 292, 345, 495])
  })

  test("react's tree drop of 2017 lands in its week, read off the weekly counts", async () => {
    const c = await chronicle("react")
    expect(filesAt(c, c.end)).toBe(c.repo.files)
    // v16.0.0 shipped on 26 September 2017 with the old tree still standing; it fell in October
    expect(filesAt(c, day("2017-09-25"))).toBeGreaterThan(1100)
    expect(filesAt(c, day("2017-10-20"))).toBeLessThan(800)
  })

  test("each era's island is files(t) at its end, and the last is today's", async () => {
    for (const name of REPOS) {
      const c = await chronicle(name)
      const legend = repoLegendOf(c)
      for (const e of legend.eras) expect(e.files).toBe(filesAt(c, Math.floor(e.end / DAY_MS)))
      expect(legend.eras.at(-1)?.files).toBe(c.repo.files)
    }
  })
})

describe("the book", () => {
  test("titles never repeat, the first is the founding, every era has words", async () => {
    for (const name of REPOS) {
      const legend = repoLegendOf(await chronicle(name))
      const titles = legend.eras.map((e) => e.title)
      expect(new Set(titles).size).toBe(titles.length)
      expect(titles[0]).toBe("The First Stones")
      for (const e of legend.eras) {
        expect(e.lede.length).toBeGreaterThan(20)
        expect(e.milestones.length).toBeGreaterThan(0)
        expect(e.milestones.length).toBeLessThanOrEqual(12)
      }
    }
  })

  test("the same chronicle reads the same, word for word", async () => {
    const c = await chronicle("react")
    expect(repoLegendOf(c)).toEqual(repoLegendOf(structuredClone(c)))
    expect(repoRecapOf(c)).toEqual(repoRecapOf(structuredClone(c)))
  })

  test("the hall's places name the founding when it knows them", async () => {
    const c = await chronicle("react")
    const placeOf = (unit: string) => (unit === "compiler" ? "the Workshop" : undefined)
    const recap = repoRecapOf(c, { placeOf })
    expect(recap.lines[0]?.text).toBe(
      "In 2024 the Workshop rose when `compiler` was founded; today it holds 4,251 files.",
    )
    const era = repoLegendOf(c, { placeOf }).eras.find((e) => e.title === "The Rise of `compiler`")
    expect(
      era?.milestones.some((m) => m.text.startsWith("`compiler` was founded, and the Workshop rose")),
    ).toBe(true)
  })

  test("a quiet history is told as quiet", async () => {
    const c = await chronicle("react")
    expect(repoLegendOf(c, { today: c.end + 400 }).closing).toBe(
      "The island has lain quiet since October 2026: 7,252 files in 37 places, and a harbour that waits.",
    )
  })
})

describe("the card", () => {
  test("six figures, three highlights, the hall's link", async () => {
    for (const name of REPOS) {
      const recap = repoRecapOf(await chronicle(name))
      expect(recap.numbers.length).toBe(6)
      expect(recap.lines.length).toBe(3)
      expect(recap.link).toBe(`guildhall.codestz.dev/hall/${recap.repo}`)
      for (const l of recap.lines) expect(l.parts.map((p) => p.text).join("")).not.toContain("`")
    }
  })
})

describe("words", () => {
  test("spans as precise as their length", () => {
    expect(spanOf(day("2026-10-06"), day("2026-10-06"))).toBe("6 October 2026")
    expect(spanOf(day("2026-10-06"), day("2026-10-08"))).toBe("6 – 8 October 2026")
    expect(spanOf(day("2026-09-17"), day("2026-10-02"))).toBe("17 September – 2 October 2026")
    expect(spanOf(day("2025-03-21"), day("2025-06-30"))).toBe("March – June 2025")
    expect(spanOf(day("2013-05-29"), day("2016-04-07"))).toBe("May 2013 – April 2016")
    expect(spanOf(day("2017-01-01"), day("2017-12-31"), true)).toBe("2017")
  })

  test("ages", () => {
    expect([1, 3, 20, 120, 567, 4880].map((d) => ageOf(d).text)).toEqual([
      "one day",
      "three days",
      "three weeks",
      "four months",
      "19 months",
      "13 years",
    ])
  })

  test("what counts as a release, and as a major", () => {
    const tags = ["v16.0.0", "16.1.0", "eslint-plugin-react-hooks@5.0.0", "v16.0.0-rc.2", "latest", "status"]
    expect(tags.filter((tag) => isRelease({ tag }))).toEqual([
      "v16.0.0",
      "16.1.0",
      "eslint-plugin-react-hooks@5.0.0",
    ])
    expect(
      ["v16.0.0", "2.0.0", "v0.14.0", "react-devtools@8.0.0", "v1.0.0"].filter((tag) => isMajor({ tag })),
    ).toEqual(["v16.0.0", "2.0.0", "v1.0.0"])
    expect(isMajor({ tag: "v3.0.0", prerelease: true })).toBe(false)
  })
})
