/**
 * The docket's plates over the quay (hexworld/docket.ts): the oldest open issues, "#133 · awaiting", up
 * to four, the rest counted on a "+N" plate that takes the last row; two on a phone. And the seas story's
 * docket read through the session's pipe: its backlog brings a petitioner per open issue, and the issues
 * that close serve the first come, the same at a moment however the log is read.
 */
import { describe, expect, test } from "bun:test"
import { EventLog, flush, harbourOf, normalize, normalizer, story } from "@guildhall/sim"
import { DOCKET_PLATES, DOCKET_PLATES_PHONE, docketOf, docketPlates } from "../src/hexworld/docket.ts"

const issues = (n: number) => Array.from({ length: n }, (_, k) => ({ n: 131 + k, title: `Issue ${k}` }))

describe("docketPlates", () => {
  test("three open issues: three plates, oldest first, awaiting", () => {
    expect(docketPlates(issues(3))).toEqual({
      rows: [
        { n: 131, title: "Issue 0", word: "awaiting" },
        { n: 132, title: "Issue 1", word: "awaiting" },
        { n: 133, title: "Issue 2", word: "awaiting" },
      ],
      more: 0,
    })
  })
  test("as many as fit show; beyond, the last row counts the rest", () => {
    expect(docketPlates(issues(DOCKET_PLATES)).rows).toHaveLength(DOCKET_PLATES)
    const many = docketPlates(issues(13))
    expect(many.rows.map((r) => r.n)).toEqual([131, 132, 133])
    expect(many.more).toBe(10)
    const phone = docketPlates(issues(13), DOCKET_PLATES_PHONE)
    expect(phone.rows).toHaveLength(1)
    expect(phone.more).toBe(12)
    expect(docketPlates([])).toEqual({ rows: [], more: 0 })
  })
  test("?docket= opens a look with that many issues", () => {
    const q = (v: string | null) => ({ get: () => v })
    expect(docketOf(q(null))).toBeNull()
    expect(docketOf(q("0"))).toBeNull()
    expect(docketOf(q("3"))).toBe(3)
    expect(docketOf(q("x"))).toBe(3)
    expect(docketOf(q("99"))).toBe(30)
  })
})

describe("the seas story's docket", () => {
  const told = story("seas", { seed: 1, start: 0 })
  const ctx = normalizer()
  const log = new EventLog()
  const all = [
    ...told.events.map((e) => ({ at: e.change.at, e })),
    ...told.seas.map((e) => ({ at: e.at, e })),
  ].sort((a, b) => a.at - b.at)
  for (const { e } of all) log.append(...normalize(e, ctx))
  log.append(...flush(ctx, log.head.at + 1))

  test("a petitioner for each open issue; two closings serve the first two come", () => {
    const early = harbourOf(log.stateAt(10_000))
    expect(early.issues).toHaveLength(12)
    expect(early.petitioners.waiting).toHaveLength(12)
    const late = harbourOf(log.head)
    expect(late.issues.map((i) => i.n)).not.toContain(134)
    expect(late.issues.map((i) => i.n)).not.toContain(141)
    expect(late.petitioners.served).toBe(2)
    expect(late.petitioners.waiting).toHaveLength(11)
    expect(JSON.stringify(harbourOf(log.stateAt(71_000)))).toBe(
      JSON.stringify(harbourOf(log.stateAt(71_000))),
    )
  })
})
