import type { Change, CiState, SeaEvent } from "@guildhall/core"
import { type Adventurer, type Chapter, type Economy, Script } from "./script.ts"

/**
 * "World events" (the demos' tour of every show, plan .probe/v1events): about four minutes in which one
 * guild's session earns each of the world's shows in turn, by the engine's own rules (sim
 * story/worldEvents.ts), with room to watch each:
 *
 *   I    Dawn              a guild at work: three heroes out at once; the branch is pushed, CI runs
 *                          (the lighthouse turns amber)
 *   II   Red skies         CI fails (a storm, the lamp red, a skeleton claws up in the graveyard); the
 *                          Implementer's build fails three times in a row (the dragon circles the peaks)
 *                          until it builds; the fix is pushed, CI passes (the lamp warm), the storm clears
 *                          (a rainbow), and the Guildmaster, who watched CI turn from the hall, walks to
 *                          the graveyard by it and strikes the grave
 *   III  The hundredth deed  the heroes called back and two more, many hands: the guild's 100th deed (a
 *                          comet)
 *   IV   The deep          two Scouts sent into the old backlog fall within two minutes (the ghost ship
 *                          glides past the graveyard's coast, a grave for each); an Oracle thinks hard
 *                          and dear (the party's purse passes $10: pirates anchor off the quay)
 *   V    Nightfall         merged; main's CI passes and v0.3.0 is released (the galleon); the Chronicler
 *                          writes the notes, fifteen clean deeds (the festival, gold fireworks by night);
 *                          the quest ends and the pirates sail off
 *
 * Nothing is forced: every show is earned by its rule. Only the spacing is the demo's: a live hall
 * holds 150 s between two big shows (`SHOW_RULES.gapMs`), which would stretch this tour past fifteen
 * minutes, so the story asks for `EVENTS_SHOW_RULES` (20 s) through `Story.showRules`. The CI times
 * are exact and the deeds' jitter small, so the shows fall in their acts whatever the seed
 * (test/stories-events.test.ts).
 */

export const EVENTS_REPO = "Codestz/guildhall"

/** The demo's spacing between two big shows (a live hall's is 150 s): see the top of this file. */
export const EVENTS_SHOW_RULES = { gapMs: 20_000 } as const

/** The story's named beats, in story order. */
export type EventsBeat =
  | "push"
  | "ci-red"
  | "dragon"
  | "built"
  | "ci-green"
  | "hundredth"
  | "dear"
  | "fall"
  | "fall-2"
  | "release"
  | "chronicled"
  | "end"

export interface EventsTale {
  changes: Change[]
  sea: SeaEvent[]
  chapters: Chapter[]
  beats: { beat: EventsBeat; at: number }[]
}

const W = "packages/world"
const R = "packages/render"
const S = "apps/studio"
const M = "packages/sim"
const BRANCH = "world-events"
const PR = 57
const PR_TITLE = "Every world event on stage"
const AUTHOR = "codestz"
const TAG = "v0.3.0"
/** CI's timing after a push, ms (exact). */
const CI = { queued: 1200, running: 3000 }
/** The Oracle's every step: dear (a big model, a long context). */
const DEAR = { tokens: 380_000, cost: 2.6 }
/** The raid's leaving once its quest ends (story/worldEvents.ts `SHOW_RULES.leaveMs.raid`), and a breath. */
const RAID_LEAVE_MS = 22_000
/** Between the two Scouts' falls (the ghost ship wants two inside 2 min). */
const FALLS_MS = 5000
/** The guild's 100th deed: the comet's milestone. */
const HUNDREDTH = 100

export function eventsTale(seed = 1, repo = EVENTS_REPO): EventsTale {
  let dear = false
  const flat: Economy = (_, ms) => ({ tokens: Math.round(ms * 2.5), cost: ms * 0.000004 })
  const script = new Script(seed, { economy: (step, ms) => (dear ? DEAR : flat(step, ms)) })
  const sea: SeaEvent[] = []
  const beats: EventsTale["beats"] = []
  const beat = (name: EventsBeat, at: number) => beats.push({ beat: name, at })
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
  const ci = (at: number, head: string, end: CiState, ms: number, branch = BRANCH): number => {
    const run = 8000 + sea.length
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
  const pr = (kind: "pr_opened" | "pr_merged", at: number) =>
    sea.push({
      kind,
      id: `${kind}:${repo}#${PR}`,
      at,
      repo,
      number: PR,
      title: PR_TITLE,
      author: AUTHOR,
      branch: BRANCH,
      ...(kind === "pr_opened" ? { status: "open" as const, size: 640 } : {}),
    } as SeaEvent)

  // ── I · Dawn ─────────────────────────────────────────────────────────────────
  script.chapter(0, { numeral: "I", title: "Dawn", tagline: "A guild at work", hour: 6.5 })
  const master = script.guildmaster(
    "Every world event on stage: the graveyard, the sky's shows and the sea's, each from its rule",
    0,
  )
  master.think("World, render and the studio move together. One hero to each, now.", 3200)
  master.deed("todowrite", { todos: ["world: graveyard", "render: shows", "studio: wiring", "PR + CI"] }, 700)
  const smith = master.quest(
    "guild-implementer",
    "World: a graveyard by the Guildhall",
    (k) => {
      work(k, [
        ["read", W, "src/hex/sites.ts"],
        ["read", W, "src/hex/zones.ts"],
        ["write", W, "src/hex/graveyard.ts"],
        ["edit", W, "src/hex/sites.ts"],
        ["write", W, "test/graveyard.test.ts"],
        ["edit", W, "src/index.ts"],
        ["read", W, "src/hex/graveyard.ts"],
      ])
      more(k, W, ["src/hex/graveyard.ts", "test/graveyard.test.ts"], 5)
      k.finish("Eight graves by the Guildhall, a gate on the path, facing the sea.", 900)
    },
    { wait: false },
  )
  const designer = master.quest(
    "guild-designer",
    "Render: the dragon, the comet and the festival",
    (k) => {
      work(k, [
        ["read", R, "src/shows/show.ts"],
        ["read", R, "src/shows/flight.ts"],
        ["write", R, "src/shows/dragon.ts"],
        ["write", R, "src/shows/comet.ts"],
        ["edit", R, "src/shows/festival.ts"],
        ["edit", R, "src/shows/index.ts"],
        ["read", R, "src/shows/dragon.ts"],
        ["edit", R, "src/shows/dragon.ts"],
      ])
      more(k, R, ["src/shows/comet.ts", "src/shows/festival.ts"], 4)
      k.finish("A faceted dragon, a comet by day and a shower by night, bunting on the square.", 900)
    },
    { wait: false },
  )
  const scout = master.quest(
    "guild-implementer",
    "Studio: the hall plays every show",
    (k) => {
      work(k, [
        ["read", S, "src/hall/events.ts"],
        ["read", S, "src/hall/camera.ts"],
        ["write", S, "src/hall/shows.ts"],
        ["edit", S, "src/hexworld/shows.ts"],
        ["edit", S, "src/hall/sea.ts"],
        ["read", S, "src/hall/shows.ts"],
        ["edit", S, "src/hall/events.ts"],
      ])
      more(k, S, ["src/hall/shows.ts", "src/hall/sea.ts"], 5)
      k.finish("The hall plays the engine's shows on its clock; the camera films each.", 900)
    },
    { wait: false },
  )
  master.waitFor(smith, designer, scout)
  master.deed("bash", { command: `git push -u origin ${BRANCH}` }, 1100, { summary: "pushed" })
  const pushed = master.clock
  beat("push", pushed)
  const first = push(pushed, 3)
  master.deed("bash", { command: "gh pr create --fill" }, 1200, { summary: `#${PR}` })
  pr("pr_opened", master.clock)
  const red = ci(pushed, first, "failed", 9000)
  beat("ci-red", red)
  master.think("Waiting on CI.", 1200)
  until(master, red + 400)

  // ── II · Red skies ───────────────────────────────────────────────────────────
  script.chapter(red, { numeral: "II", title: "Red skies", tagline: "Red CI, a dragon", hour: 10 })
  master.think("Red on the build. Send the Implementer back.", 900)
  let green = 0
  master.resume(smith, "The build is red: fix it, push it, see CI green", (k) => {
    k.deed("bash", { command: "gh run view --log-failed" }, 1100, {
      summary: "exit 0",
      output: "error TS2322: Grave['facing'] is number, got [number, number]",
    })
    // three failed builds in a row: the dragon
    for (const n of [1, 2, 3]) {
      k.deed("bash", { command: "bun run build" }, 1800, {
        fail: "exit 2",
        summary: "exit 2",
        output: `error TS2322 (${n} of ${4 - n} left)`,
      })
      if (n === 3) beat("dragon", k.clock)
      k.think(
        n < 3
          ? "Still red. The facing again."
          : "It is the tuple everywhere. Change the type, not the callers.",
        1400,
      )
    }
    k.deed("read", { filePath: `${W}/src/hex/graveyard.ts` }, 1400)
    k.think("A facing is one angle. Every caller already passes one.", 5200)
    k.deed("edit", { filePath: `${W}/src/hex/graveyard.ts` }, 2600)
    k.deed("read", { filePath: `${W}/test/graveyard.test.ts` }, 1600)
    k.deed("edit", { filePath: `${W}/test/graveyard.test.ts` }, 2200)
    k.think("Build it.", 3200)
    k.deed("bash", { command: "bun run build" }, 2400, { summary: "built" })
    beat("built", k.clock)
    k.deed("bash", { command: "git commit -am 'A grave faces one way' && git push" }, 1000, {
      summary: "pushed",
    })
    const head = push(k.clock, 1)
    green = ci(k.clock, head, "passed", 8000)
    beat("ci-green", green)
    k.finish("Pushed: a grave faces one way. CI will tell.", 900)
  })
  // the Guildmaster watches CI from the hall, by the graveyard: the last good deed before it turns
  // green, so it is the one who mends the red grave and walks over to strike it (story/worldEvents.ts)
  until(master, green - 6000)
  master.deed("bash", { command: `gh run watch` }, 5400, { summary: "running" })
  until(master, green + 400)
  master.deed("bash", { command: `gh pr checks ${PR}` }, 900, { summary: "all passed" })
  // the rainbow plays out (32 s) before the many hands earn the comet
  until(master, green + 18_000)

  // ── III · The hundredth deed ─────────────────────────────────────────────────
  script.chapter(master.clock, {
    numeral: "III",
    title: "The hundredth deed",
    tagline: "Many hands",
    hour: 13.5,
  })
  master.think("Now the polish, all hands: shots, captions, the sounds.", 1200)
  const hands: Adventurer[] = []
  const lists: [string, string, string][][] = [
    [
      ["read", R, "src/shows/festival.ts"],
      ["edit", R, "src/shows/festival.ts"],
      ["read", R, "src/shows/rainbow.ts"],
      ["edit", R, "src/shows/rainbow.ts"],
      ["read", R, "src/sea/life.ts"],
      ["edit", R, "src/sea/life.ts"],
      ["read", R, "src/sea/plan.ts"],
      ["edit", R, "src/sea/plan.ts"],
      ["read", R, "src/undead/index.ts"],
      ["edit", R, "src/undead/index.ts"],
      ["read", R, "src/shows/comet.ts"],
      ["edit", R, "src/shows/comet.ts"],
      ["read", R, "src/shows/index.ts"],
    ],
    [
      ["read", S, "src/audio/engine.ts"],
      ["edit", S, "src/audio/engine.ts"],
      ["read", S, "src/hall/camera.ts"],
      ["edit", S, "src/hall/camera.ts"],
      ["read", S, "src/hall/hud/HallHud.tsx"],
      ["edit", S, "src/hall/hud/HallHud.tsx"],
      ["read", S, "src/site/stories.ts"],
      ["edit", S, "src/site/stories.ts"],
      ["read", S, "src/hall/events.ts"],
      ["edit", S, "src/hall/events.ts"],
      ["read", S, "src/hall/sea.ts"],
      ["edit", S, "src/hall/sea.ts"],
      ["read", S, "src/hexworld/undead.ts"],
    ],
    [
      ["read", M, "src/story/worldEvents.ts"],
      ["edit", M, "src/story/worldEvents.ts"],
      ["read", M, "src/story/renown.ts"],
      ["edit", M, "src/story/renown.ts"],
      ["read", M, "src/story/story.ts"],
      ["edit", M, "src/story/story.ts"],
      ["read", M, "test/world-events.test.ts"],
      ["edit", M, "test/world-events.test.ts"],
      ["read", M, "src/story/graveyard.ts"],
      ["edit", M, "src/story/graveyard.ts"],
      ["read", M, "src/index.ts"],
      ["edit", M, "src/index.ts"],
      ["read", M, "src/story/index.ts"],
    ],
  ]
  hands.push(
    master.resume(designer, "Polish the shows and the sea", (k) => work(k, lists[0] ?? [], 1100), {
      wait: false,
    }),
  )
  hands.push(
    master.resume(scout, "Sounds and captions for every show", (k) => work(k, lists[1] ?? [], 1100), {
      wait: false,
    }),
  )
  hands.push(
    // a new hand for the engine's words
    master.quest(
      "guild-implementer",
      "The engine's words for every show",
      (k) => work(k, lists[2] ?? [], 1100),
      {
        wait: false,
      },
    ),
  )
  hands.push(
    master.quest(
      "guild-verifier",
      "Shoot every show and check its frame",
      (k) => {
        k.deed("bash", { command: "bun shots demos events" }, 1600, { summary: "8 shots" })
        more(k, S, ["src/site/stories.ts", "src/hall/camera.ts", "src/hall/shows.ts"], 11, 1100)
      },
      { wait: false },
    ),
  )
  for (const file of ["README.md", "RELEASE_NOTES.md", `${S}/src/site/stories.ts`])
    master.deed("read", { filePath: file }, 900, { batch: true })
  const hundredth = nth(script, HUNDREDTH)
  if (hundredth !== undefined) beat("hundredth", hundredth)
  for (const h of hands) h.finish("Done, and polished.", 900)
  master.waitFor(...hands)

  // ── IV · The deep ────────────────────────────────────────────────────────────
  script.chapter(master.clock, {
    numeral: "IV",
    title: "The deep",
    tagline: "Dear thoughts, two falls",
    hour: 17,
  })
  master.think("Two last questions: the raid's purse, and the backlog nobody has read.", 1000)
  const oracle = master.quest(
    "guild-architect",
    "Think through the raid's treasury: tokens, cost, time",
    (k) => {
      k.think("Tokens, cost or time: which does a treasury count, and as of when?", 16_000)
      dear = true
      k.deed("read", { filePath: `${M}/src/story/renown.ts` }, 2400)
      k.deed("read", { filePath: `${M}/src/guild/model.ts` }, 2400)
      k.deed("read", { filePath: `${M}/src/story/worldEvents.ts` }, 2400)
      k.deed("webfetch", { url: "https://docs.anthropic.com/en/docs/about-claude/pricing" }, 2600)
      beat("dear", k.clock)
      k.deed("read", { filePath: `${M}/src/story/purse.ts` }, 2400)
      dear = false
      k.think("The purse is the party's, read as of each moment: a seek back reads it as it was.", 4000)
      k.finish("A raid answers ≥ 2M tokens, ≥ $10 or 45 minutes, by the party's purse at the time.", 1200)
    },
    { wait: false },
  )
  const lost = (task: string, at: number) =>
    master.quest(
      "guild-explorer",
      task,
      (k) => {
        k.deed("glob", { pattern: `${S}/src/legacy/**` }, 1400, { summary: "1,204 files" })
        k.deed("read", { filePath: `${S}/src/legacy/README.md` }, 1600)
        k.think("The old backlog goes on and on…", 2000)
        until(k, at)
        k.fail("context window exceeded")
      },
      { wait: false },
    )
  // the falls come a little before the ghost ship's slot (the demo's 20 s after the comet): their graves
  // are glanced at first, then the ship
  const fallAt = master.clock + 8000
  const one = lost("Map the old backlog's world events", fallAt)
  const two = lost("Map the old backlog's sea", fallAt + FALLS_MS)
  beat("fall", fallAt)
  beat("fall-2", fallAt + FALLS_MS)
  master.waitFor(oracle)
  // the ghost ship passes and the pirates come in (the demo's 20 s after it), filmed, before nightfall
  until(master, fallAt + FALLS_MS + 34_000)
  master.think("Two lost in the backlog. Let it lie; the rest is ready.", 1200)
  void one
  void two

  // ── V · Nightfall ────────────────────────────────────────────────────────────
  script.chapter(master.clock, {
    numeral: "V",
    title: "Nightfall",
    tagline: "Released, and a festival",
    hour: 20.5,
  })
  master.deed("bash", { command: `gh pr merge ${PR} --squash` }, 1100, { summary: "merged" })
  pr("pr_merged", master.clock)
  const main = push(master.clock + 300, 1, "main")
  const mainGreen = ci(master.clock + 300, main, "passed", 5000, "main")
  const chronicler = master.quest(
    "guild-librarian",
    "Write v0.3.0's notes: every world event",
    (k) => {
      work(
        k,
        [
          ["read", S, "src/site/stories.ts"],
          ["read", M, "src/story/worldEvents.ts"],
          ["read", M, "src/story/renown.ts"],
          ["read", R, "src/shows/index.ts"],
          ["read", R, "src/sea/life.ts"],
          ["read", R, "src/undead/index.ts"],
          ["write", S, "src/site/notes/v0.3.0.md"],
          ["edit", S, "src/site/notes/v0.3.0.md"],
          ["read", S, "src/site/notes/v0.3.0.md"],
          ["edit", S, "src/site/notes/v0.3.0.md"],
          ["edit", S, "src/site/stories.ts"],
          ["read", S, "src/site/stories.ts"],
          ["edit", S, "src/site/notes/v0.3.0.md"],
          ["read", S, "src/site/notes/v0.3.0.md"],
          ["edit", S, "src/site/notes/v0.3.0.md"],
        ],
        1000,
      )
      k.finish(
        "v0.3.0's notes: the graveyard, the dragon, the comet, the rainbow, the festival and the sea.",
        900,
      )
    },
    { wait: false },
  )
  until(master, mainGreen + 400)
  master.deed("bash", { command: `gh release create ${TAG} --generate-notes` }, 1200, { summary: TAG })
  sea.push({
    kind: "release",
    id: `release:${repo}:${TAG}`,
    at: master.clock,
    repo,
    tag: TAG,
    name: PR_TITLE,
  })
  beat("release", master.clock)
  master.waitFor(chronicler)
  beat("chronicled", chronicler.clock)
  // the festival plays its 42 s before the quest ends (and the pirates weigh anchor)
  until(master, chronicler.clock + 46_000)
  master.finish("Every world event is on stage, each from its rule. v0.3.0 is out.", 1200)
  beat("end", master.clock)
  // the coda: the quest over, the pirates weigh anchor (20 s) as the notes ship to main
  push(master.clock + RAID_LEAVE_MS, 1, "main")

  return {
    changes: script.done(),
    sea: sea.sort((a, b) => a.at - b.at),
    chapters: [...script.chapters],
    beats: beats.sort((a, b) => a.at - b.at),
  }
}

/** Hold `who` until run time `at`, when it is not there yet. */
function until(who: Adventurer, at: number): void {
  who.clock = Math.max(who.clock, at)
}

/** Quick deeds at `unit`'s files, `ms` each (jittered). */
function work(k: Adventurer, list: readonly (readonly [string, string, string])[], ms = 1300): void {
  for (const [tool, unit, file] of list) k.deed(tool, { filePath: `${unit}/${file}` }, ms)
}

/** `n` quick deeds at `unit`'s `files`, a read then an edit, round and round. */
function more(k: Adventurer, unit: string, files: readonly string[], n: number, ms = 1200): void {
  for (let i = 0; i < n; i++)
    k.deed(i % 2 ? "edit" : "read", { filePath: `${unit}/${files[Math.floor(i / 2) % files.length]}` }, ms)
}

/** When the guild's `n`th deed (completed, not a quest) ended, as scripted so far. */
function nth(script: Script, n: number): number | undefined {
  const tasks = new Set<string>()
  for (const c of script.changes)
    if (c.type === "tool" && c.state === "running" && c.name === "task") tasks.add(c.call)
  const ends = script.changes
    .filter((c) => c.type === "tool" && c.state === "completed" && !tasks.has(c.call))
    .map((c) => c.at)
    .sort((a, b) => a - b)
  return ends[n - 1]
}
