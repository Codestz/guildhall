import type { Change, CiState, SeaEvent } from "@guildhall/core"
import { type Adventurer, type Chapter, Script } from "./script.ts"

/**
 * The Saga for the hex island (plan-hud-events.md D1): three minutes, unattended, in this repo's own
 * paths, so on Guildhall's island each hero walks to the place of the package it works on. It replaces
 * V1's 26-minute "make Quill work offline" (main:packages/sim/src/saga.ts) with one feature, "heroes
 * walk to their places", told in five acts:
 *
 *   I    Dawn         the Guildmaster is given the quest and plans it in the great hall
 *   II   The forge    three heroes are sent out at once, to three places: the Implementer to
 *                     packages/world (hero spots), the Designer to packages/render (banners), a second
 *                     Implementer to apps/studio (the hall); each settles there and works
 *   III  The storm    the branch is pushed and a pull request opens (a ship); CI's fuzz sweep fails in
 *                     packages/world (a storm)
 *   IV   The mending  the Implementer is called back, reproduces the failure, asks to rewrite the
 *                     goldens (a plea), lands the fix and pushes it; CI passes (the sky clears)
 *   V    Nightfall    the Implementer merges and brings the loot home; the Guildmaster cuts a release
 *                     (a galleon) and ends the quest
 *
 * Nothing is forced: every beat is a change or a GitHub event the hall reads like a live one, and the
 * times the sea keeps (`BEAT`) are exact, so the beats fall in their acts whatever the seed's jitter
 * does (test/stories-saga.test.ts walks them through normalize and reduce).
 *
 * The paths are this repository's (V2's layout). On a repo laid out otherwise, `story` rehomes them
 * onto that repo's own units (rehome.ts), so the three heroes still go to three places.
 */

/** The repository the saga's sea belongs to, unless the story is told for another. */
export const SAGA_REPO = "Codestz/guildhall"

/** The places the saga's heroes work at, as this repo names them. */
export const SAGA_UNITS = {
  world: "packages/world",
  render: "packages/render",
  studio: "apps/studio",
  sim: "packages/sim",
} as const

const QUEST =
  "Heroes walk to their places: give every place hero spots, draw each hero's banner, and show them in the hall"
const BRANCH = "hero-spots"
const PR = 42
const PR_TITLE = "Heroes walk to their places"
const AUTHOR = "codestz"
const TAG = "v0.2.0"

/** CI's timing after a push, ms: queued, running, finished (exact, so the storm lands in its act). */
const CI = { queued: 1500, running: 4000 }
const CI_RED_MS = 11_000
const CI_GREEN_MS = 13_000
const CI_MAIN_MS = 9_000
/** The story runs on this long after its release: the galleon sails in and the heroes go home. */
export const SAGA_TAIL_MS = 20_000

/** The saga's named beats, in story order, with their run time (ms from the start). */
export type SagaBeat =
  | "dispatch"
  | "push"
  | "pr-opened"
  | "ci-red"
  | "plea"
  | "fix"
  | "ci-green"
  | "merged"
  | "loot"
  | "release"
  | "end"

export interface SagaTale {
  changes: Change[]
  sea: SeaEvent[]
  chapters: Chapter[]
  /** The story clock's keyframes: hour of day at a run time, in order. */
  hours: { at: number; hour: number }[]
  /** Where each authored beat fell (run time, ms). */
  beats: { beat: SagaBeat; at: number }[]
}

const w = (file: string) => `${SAGA_UNITS.world}/${file}`
const r = (file: string) => `${SAGA_UNITS.render}/${file}`
const s = (file: string) => `${SAGA_UNITS.studio}/${file}`

/** `bun test`'s tail, as it prints it. */
function bunTest(pass: number, fail: number, files: number, took: string, failures: string[] = []): string {
  return [
    "bun test v1.3.13",
    ...failures.map((name) => `✗ ${name}`),
    "",
    ` ${pass} pass`,
    ` ${fail} fail`,
    `Ran ${pass + fail} tests across ${files} files. [${took}]`,
  ].join("\n")
}

const SWEEP = "hero spots › every place keeps two reachable spots over 80 islands"

export function sagaTale(seed = 1, repo = SAGA_REPO): SagaTale {
  const script = new Script(seed, { turnMs: 1500 })
  const sea: SeaEvent[] = []
  const beats: SagaTale["beats"] = []
  const beat = (name: SagaBeat, at: number) => beats.push({ beat: name, at })
  let shas = 0
  const sha = () => (++shas).toString(16).padStart(8, "0").repeat(5)

  const push = (at: number, commits: number, branch = BRANCH): string => {
    const head = sha()
    sea.push({
      kind: "push",
      id: `push:${repo}:${branch}:${head}`,
      at,
      repo,
      branch,
      commits,
      author: AUTHOR,
      sha: head,
    })
    return head
  }
  /** One CI run on `head` from `at`: queued, running, then `end` after `ms` more. Returns when it ends. */
  const ci = (at: number, head: string, end: CiState, ms: number, branch = BRANCH): number => {
    const run = 7000 + sea.length
    const done = at + CI.running + ms
    for (const [state, when] of [
      ["queued", at + CI.queued],
      ["running", at + CI.running],
      [end, done],
    ] as [CiState, number][])
      sea.push({
        kind: "ci",
        id: `ci:${repo}:${run}:${state}`,
        at: when,
        repo,
        state,
        name: "check",
        branch,
        sha: head,
      })
    return done
  }
  const pr = (kind: "pr_opened" | "pr_updated" | "pr_merged", at: number) =>
    sea.push({
      kind,
      id: kind === "pr_updated" ? `${kind}:${repo}#${PR}:ready` : `${kind}:${repo}#${PR}`,
      at,
      repo,
      number: PR,
      title: PR_TITLE,
      author: AUTHOR,
      branch: BRANCH,
      ...(kind === "pr_opened" ? { status: "open" as const, size: 486 } : {}),
      ...(kind === "pr_updated" ? { status: "ready" as const } : {}),
    } as SeaEvent)

  // ── I · Dawn ────────────────────────────────────────────────────────────────────
  script.chapter(0, { numeral: "I", title: "Dawn", tagline: "A quest is given", hour: 6 })
  const master = script.guildmaster(QUEST, 0)
  master.think(
    "Three packages move: world reserves the spots, render draws the banners, the studio shows them. Send one hero to each, at once.",
    6000,
  )
  master.deed(
    "todowrite",
    { todos: ["hero spots (world)", "banners (render)", "the hall (studio)", "PR + CI"] },
    900,
  )

  // ── II · The forge ──────────────────────────────────────────────────────────────
  script.chapter(master.clock, {
    numeral: "II",
    title: "The forge",
    tagline: "Three heroes, three places",
    hour: 9,
  })
  beat("dispatch", master.clock)
  const smith = master.quest("guild-implementer", "World: reserve hero spots at every place", spots, {
    wait: false,
  })
  const designer = master.quest("guild-designer", "Render: a banner over every hero", banners, {
    wait: false,
  })
  const studio = master.quest("guild-implementer", "Studio: show the heroes in the hall", hall, {
    wait: false,
  })
  master.waitFor(designer, studio, smith)

  // ── III · The storm ─────────────────────────────────────────────────────────────
  script.chapter(master.clock, { numeral: "III", title: "The storm", tagline: "CI turns red", hour: 13.5 })
  master.deed("bash", { command: `git push -u origin ${BRANCH}` }, 1400, { summary: "pushed" })
  const pushed = master.clock
  beat("push", pushed)
  const first = push(pushed, 3)
  master.deed("bash", { command: "gh pr create --fill" }, 1600, { summary: `#${PR}` })
  pr("pr_opened", master.clock)
  beat("pr-opened", master.clock)
  const red = ci(pushed, first, "failed", CI_RED_MS)
  beat("ci-red", red)
  master.think("Waiting on CI before calling it done.", 2400)
  until(master, red + 600)
  master.think("Red in packages/world: the fuzz sweep. Send the Implementer back with the log.", 1400)

  // ── IV · The mending ────────────────────────────────────────────────────────────
  script.chapter(master.clock, { numeral: "IV", title: "The mending", tagline: "The fix lands", hour: 17 })
  let green = 0
  master.resume(smith, "Fix the red sweep in packages/world, push it, see CI green and merge", (k) => {
    k.deed("bash", { command: "gh run view --log-failed" }, 1500, {
      summary: "exit 0",
      output: `✗ ${SWEEP}\n  seed 13 × 12,000 files: zone 41 (camp) has 1 hero spot, wants 2`,
    })
    k.deed("read", { filePath: w("test/heroes.test.ts") }, 1200)
    k.deed("bash", { command: "bun test packages/world/test/heroes.test.ts" }, 3800, {
      fail: "1 failed",
      summary: "exit 1",
      output: bunTest(41, 1, 1, "3.62s", [SWEEP]),
    })
    k.think(
      "A camp on a cliff edge: its practice yard leaves room for one. Fall back to the yard's rim.",
      2600,
    )
    beat("plea", k.clock)
    k.plea(5200)
    k.deed("edit", { filePath: w("src/hex/heroes.ts") }, 2600)
    k.deed("write", { filePath: w("test/fixtures/hero-spots.json") }, 1200)
    k.deed("bash", { command: "bun test packages/world" }, 4200, {
      summary: "214 pass",
      output: bunTest(214, 0, 23, "8.10s"),
    })
    beat("fix", k.clock)
    k.deed(
      "bash",
      { command: "git commit -am 'A camp on a cliff keeps its two hero spots' && git push" },
      1300,
      {
        summary: "pushed",
      },
    )
    const head = push(k.clock, 1)
    green = ci(k.clock, head, "passed", CI_GREEN_MS)
    beat("ci-green", green)
    pr("pr_updated", green + 200)
    k.deed("bash", { command: `gh pr checks ${PR} --watch` }, Math.round((green - k.clock) * 1.3) + 300, {
      summary: "all passed",
    })
    until(k, green + 500)

    // ── V · Nightfall ────────────────────────────────────────────────────────────
    script.chapter(k.clock, { numeral: "V", title: "Nightfall", tagline: "Merged and released", hour: 20 })
    k.deed("bash", { command: `gh pr merge ${PR} --squash` }, 1400, { summary: "merged" })
    pr("pr_merged", k.clock)
    beat("merged", k.clock)
    k.finish("Fixed and merged: a camp on a cliff falls back to its yard's rim; the sweep holds at 0.", 1400)
    beat("loot", k.clock)
  })
  const merged = beats.find((b) => b.beat === "merged")?.at ?? master.clock
  const main = push(merged + 300, 1, "main")
  const mainGreen = ci(merged + 300, main, "passed", CI_MAIN_MS, "main")
  until(master, mainGreen + 600)
  master.deed("bash", { command: `gh release create ${TAG} --generate-notes` }, 1600, { summary: TAG })
  sea.push({
    kind: "release",
    id: `release:${repo}:${TAG}`,
    at: master.clock,
    repo,
    tag: TAG,
    name: PR_TITLE,
  })
  beat("release", master.clock)
  const released = master.clock
  master.think("Released. Every place has its spots, every hero its banner, and the hall shows them.", 2400)
  until(master, released + SAGA_TAIL_MS - 1600)
  master.finish(
    "Heroes walk to their places now: spots in world, banners in render, the hall in the studio. v0.2.0 is out.",
    1600,
  )
  beat("end", master.clock)

  const changes = script.done()
  const last = Math.max(changes.at(-1)?.at ?? 0, ...sea.map((e) => e.at))
  const hours = [...script.chapters.map(({ at, hour }) => ({ at, hour })), { at: last, hour: 23 }]
  return { changes, sea: sea.sort((a, b) => a.at - b.at), chapters: [...script.chapters], hours, beats }
}

/** Hold `who` until run time `at`, when it is not there yet: a beat the story keeps to. */
function until(who: Adventurer, at: number): void {
  who.clock = Math.max(who.clock, at)
}

/** The Implementer in packages/world: hero spots beside every place's work. */
function spots(k: Adventurer): void {
  k.deed("read", { filePath: w("src/hex/life.ts") }, 1800)
  k.deed("read", { filePath: w("src/hex/zones.ts") }, 1400, { batch: true })
  k.think("Spots go beside what each place works at, reachable from a walk node, off the roads.", 2600)
  k.deed("write", { filePath: w("src/hex/heroes.ts") }, 5200)
  k.deed("edit", { filePath: w("src/hex/life.ts") }, 3400)
  k.deed("write", { filePath: w("test/heroes.test.ts") }, 4200)
  k.deed("bash", { command: "bun test packages/world" }, 5200, {
    summary: "213 pass",
    output: bunTest(213, 0, 23, "7.84s"),
  })
  k.deed("edit", { filePath: w("src/index.ts") }, 1200)
  k.deed("read", { filePath: w("src/hex/heroes.ts") }, 1600)
  k.deed("bash", { command: "bun run typecheck" }, 3600, { summary: "ok" })
  k.finish("Every place keeps max(k, 2) hero spots beside its work; the Guildhall up to 2k in its courts.")
}

/** The Designer in packages/render: a banner over every hero, in its role's colour. */
function banners(k: Adventurer): void {
  k.deed("read", { filePath: r("src/crowd/heroes.ts") }, 1600)
  k.deed("read", { filePath: r("src/crowd/crowd.ts") }, 1200, { batch: true })
  k.think("One instanced quad per banner, coloured by role, lifted over the head; no new draw call.", 3000)
  k.deed("write", { filePath: r("src/crowd/banners.ts") }, 5400)
  k.deed("edit", { filePath: r("src/crowd/heroes.ts") }, 3200)
  k.deed("bash", { command: "bun shots hall --spot gate" }, 6200, { summary: "3 shots" })
  k.deed("edit", { filePath: r("src/crowd/banners.ts") }, 2600)
  k.deed("bash", { command: "bun test packages/render" }, 3800, { summary: "96 pass" })
  k.finish("Banners float over every hero in its role's colour, drawn with the crowd: no new draw call.")
}

/** The second Implementer in apps/studio: the hall reads the heroes off the world. */
function hall(k: Adventurer): void {
  k.deed("read", { filePath: `${SAGA_UNITS.sim}/src/events/select.ts` }, 1500)
  k.deed("read", { filePath: s("src/hall/index.ts") }, 1600)
  k.deed("write", { filePath: s("src/hall/heroes.ts") }, 4800)
  k.deed("edit", { filePath: s("src/hexworld/life.ts") }, 3800)
  k.deed("edit", { filePath: s("src/hall/index.ts") }, 2400)
  k.deed("bash", { command: "bun run typecheck" }, 3400, { summary: "ok" })
  k.deed("bash", { command: "bun test apps/studio" }, 4600, { summary: "152 pass" })
  k.finish("The hall walks each hero to its place's spot and back to the castle with its loot.")
}
