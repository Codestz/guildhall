import type { Change } from "@guildhall/core"
import { type Adventurer, type Chapter, type Economy, Script } from "./script.ts"

/**
 * The Saga: the showcase's story, five acts, ~26 min of run time (~17 min watched: the Director
 * skips the quiet stretches). One feature, "make Quill work offline", from the quest to the clean
 * sweep, with a smaller bug-fix conversation beside it.
 *
 * Shaped like the recorded OpenCode runs (~/.cache/guildhall/chronicles): a model turn of ~5 s
 * before each step, parallel reads batched in one step, test runs of seconds and e2e runs of tens
 * of seconds, subagents that report back, and a context that goes back every step (~40k tokens a
 * step, so a busy party passes two million tokens inside seven minutes).
 *
 * Nothing is forced: every world event fires because these changes meet guild/events.ts's rules,
 * placed so each lands in its act with the scheduler's gap between them (test/saga.test.ts):
 *
 *   I    Dawn        the quest; the Explorer maps, the Researcher reads, the Architect designs and
 *                    asks the user to approve the plan (a plea)
 *   II   The forge   three Implementers, the Librarian and the Designer build; the treasury passes
 *                    two million tokens (pirates); a bug-fix conversation opens beside them
 *   III  The storm   the Verifier's runs go red; an Implementer fails three commands running (the
 *                    dragon); a plea to wipe the local database; the Verifier and that Implementer
 *                    fall a minute apart (skeletons, the ghost ship)
 *   IV   The mending both are called back (the dead sink), the fixes land, the sky clears (a
 *                    rainbow at dusk), the hundredth deed by night (the comet)
 *   V    Nightfall   the final verification: sixteen deeds, none failed (the festival, fireworks);
 *                    the bug-fix party goes home through the gate; the quest ends
 */

/** A told story: its changes, its chapters, and the hours of its own clock. */
export interface Tale {
  changes: Change[]
  chapters: Chapter[]
  /** The story clock's keyframes: hour of day at a run time (ms from the start), in order. */
  hours: { at: number; hour: number }[]
}

const MAIN_QUEST =
  "Make Quill work offline: keep notes in IndexedDB, queue edits while offline and sync them when the connection returns. Conflicts must never lose text."
const BUG_QUEST =
  "Fix the emoji search bug: searching for “🍜 ramen” throws RangeError: Invalid code point in tokenize()"

/**
 * A model step's cost, as the recorded runs show it: the whole context goes back every step (p50
 * ~40k tokens, growing a few thousand a step), mostly a cache hit. Dollars at a Sonnet-class price.
 */
export const CONTEXT_ECONOMY: Economy = (step) => {
  const tokens = 34_000 + step * 6_500
  return { tokens, cost: tokens * 0.000_000_57 + 0.006 }
}

const MIN = 60_000

/**
 * Where the acts' beats fall (run time, ms). The story keeps to them so the world events stay apart
 * by the scheduler's gap in *watched* time (events.ts: one big show every 150 s, after the
 * Director's fast-forward has skipped the quiet), whatever the jitter does.
 */
const AT = {
  forge: 5 * MIN,
  /** The bug-fix conversation opens: after the main party's purse passed two million tokens. */
  bug: 7.4 * MIN,
  /** The forge's last hands finish, a while after the second party has arrived. */
  forged: 9.0 * MIN,
  storm: 9.5 * MIN,
  /** The Implementer's third red run in a row: the dragon. */
  dragon: 11.9 * MIN,
  /** The Verifier falls, then the Implementer a minute later: the ghost ship. */
  verifierFalls: 15.2 * MIN,
  implementerFalls: 16.1 * MIN,
  /** The browser test keeps failing after the falls: the rain goes on. */
  paragraphs: 17.1 * MIN,
  recovery: 18.9 * MIN,
  /** The called-back Implementer's runs are still red, twice in a row: one last shower... */
  stillRed: 20.4 * MIN,
  /** ...then the fix lands and the Verifier's runs come back clean: the sky clears, a rainbow. */
  green: 21.6 * MIN,
  /** The guild's hundredth deed, by night: the comet. */
  comet: 29.9 * MIN,
  nightfall: 30.7 * MIN,
  /** The bug-fix conversation is done; it goes home through the gate a minute and a half later. */
  bugDone: 31 * MIN,
  /** The final verification comes home clean: the festival. */
  festival: 37.7 * MIN,
}

/** Hold `who` until run time `at`, when it is not there yet: a beat the story keeps to. */
function until(who: Adventurer, at: number): void {
  who.clock = Math.max(who.clock, at)
}

/** The model's turn before each step, ms: recorded p50 4–6 s, p75 5–26 s (long thinking). */
const TURN_MS = 8000

export function saga(seed = 1): Change[] {
  return sagaTale(seed).changes
}

export function sagaTale(seed = 1): Tale {
  const script = new Script(seed, { economy: CONTEXT_ECONOMY, turnMs: TURN_MS })
  const master = script.guildmaster(MAIN_QUEST, 0)
  offline(script, master)
  const changes = script.done()
  const last = changes.at(-1)?.at ?? 0
  // Night falls to near midnight over the final act.
  const hours = [...script.chapters.map(({ at, hour }) => ({ at, hour })), { at: last, hour: 23.3 }]
  return { changes, chapters: [...script.chapters], hours }
}

/** `bun test`'s tail, as it prints it. */
function bunTest(pass: number, fail: number, files: number, took: string, failures: string[] = []): string {
  return [
    "bun test v1.2.21",
    ...failures.map((name) => `✗ ${name}`),
    "",
    ` ${pass} pass`,
    ` ${fail} fail`,
    ` ${pass * 3 + fail * 2} expect() calls`,
    `Ran ${pass + fail} tests across ${files} files. [${took}]`,
  ].join("\n")
}

const REPLAY = "engine › replays queued edits once after reconnect"
const ORDER = "engine › keeps order across two reconnects"
const TITLE = "conflict › keeps the remote title when only the body conflicts"

// ─────────────────────────────── the main quest ───────────────────────────────

function offline(script: Script, master: Adventurer): void {
  // ── Act I · Dawn ────────────────────────────────────────────────────────────────
  script.chapter(0, { numeral: "I", title: "Dawn", tagline: "A quest is given", hour: 5.6 })
  master.wait(4000)
  master.think(
    "Three unknowns: where notes live today, how a browser behaves offline, and how two edits to one note merge. Map the code and read up in parallel, then design before anyone builds.",
    7000,
  )
  master.deed(
    "todowrite",
    {
      todos: [
        "map notes load/save",
        "research offline storage",
        "design sync + conflicts",
        "build",
        "verify",
      ],
    },
    600,
  )

  const explorer = master.quest(
    "guild-explorer",
    "Map how notes are loaded and saved today",
    (x) => {
      x.think("Start from the API client and follow every caller.", 2400)
      x.deed("glob", { pattern: "src/**/*.{ts,tsx}" }, 300, { summary: "84 files" })
      x.deed("grep", { pattern: "fetch\\(|/api/notes", path: "src" }, 300, { summary: "17 matches" })
      x.deed("read", { filePath: "src/notes/api.ts" }, 200)
      x.deed("read", { filePath: "src/notes/store.ts" }, 200, { batch: true })
      x.deed("read", { filePath: "src/notes/useNotes.ts" }, 200, { batch: true })
      x.think(
        "Every save is a PUT straight from store.ts; nothing is kept locally. Who sets updatedAt?",
        4600,
      )
      x.deed("grep", { pattern: "updatedAt", path: "src" }, 300, { summary: "9 matches" })
      x.deed("read", { filePath: "src/notes/types.ts" }, 200)
      x.deed("read", { filePath: "server/routes/notes.ts" }, 200, { batch: true })
      x.wait(9000)
      x.deed("grep", { pattern: 'addEventListener\\("(online|focus)"', path: "src" }, 300, {
        summary: "2 matches",
      })
      x.deed("read", { filePath: "src/app/App.tsx" }, 200)
      x.wait(16_000)
      x.finish(
        "Saves are a PUT /api/notes/:id from store.ts with no local copy; updatedAt is set by the server; useNotes refetches on window focus. Nothing queues a failed save, and nothing retries one.",
        3200,
      )
    },
    { wait: false },
  )
  const researcher = master.quest(
    "guild-researcher",
    "Research offline storage and sync in the browser",
    (r) => {
      r.deed("webfetch", { url: "https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API" }, 3800)
      r.deed("webfetch", { url: "https://web.dev/articles/offline-cookbook" }, 4600)
      r.think("Background Sync would be ideal, but only Chromium ships it. Check the support table.", 4800)
      r.deed("webfetch", { url: "https://caniuse.com/background-sync" }, 3200)
      r.deed("webfetch", { url: "https://developer.mozilla.org/en-US/docs/Web/API/Navigator/onLine" }, 3000)
      r.think(
        "navigator.onLine only says there is a network, not that the API answers. A failed fetch is the real signal.",
        5400,
      )
      r.wait(14_000)
      r.finish(
        "IndexedDB via idb for notes and an outbox. Background Sync is Chromium-only: flush the outbox on `online`, on focus and on a timer. navigator.onLine lies; treat a failed fetch as offline.",
        3600,
      )
    },
    { wait: false },
  )
  master.waitFor(explorer, researcher)
  master.think(
    "Saves go straight to the server and nothing is queued. Storage is settled. Conflicts need a design, and the user should see it before anyone builds.",
    6200,
  )

  master.quest("guild-architect", "Design offline sync: storage, outbox, conflicts", (a) => {
    a.deed("read", { filePath: "src/notes/store.ts" }, 200)
    a.deed("read", { filePath: "src/notes/types.ts" }, 200, { batch: true })
    a.think(
      "Last-writer-wins on the whole note drops text. Keep the version each edit was based on; on a conflict merge the body three ways and let the newest title win.",
      9000,
    )
    a.deed("webfetch", { url: "https://www.npmjs.com/package/node-diff3" }, 2600)
    a.wait(14_000)
    a.deed("write", { filePath: "docs/plan/offline-sync.md" }, 3800)
    a.wait(10_000)
    a.deed("write", { filePath: "docs/adr/0007-offline-sync.md" }, 3000)
    a.think("Four tasks, three of them independent. Ask before handing them out.", 2800)
    // The plan waits on the user: "Approve this plan before I hand it out?"
    a.plea(26_000)
    a.finish(
      "Plan approved: (1) idb store + outbox, (2) sync engine with base versions and an op id per edit, (3) three-way merge for bodies, newest title wins, (4) an offline badge. Three can run at once.",
      3000,
    )
  })

  // ── Act II · The forge ──────────────────────────────────────────────────────────
  until(master, AT.forge)
  script.chapter(master.clock, {
    numeral: "II",
    title: "The forge",
    tagline: "Many hands at work",
    hour: 8.4,
  })
  master.wait(3000)
  master.think("Storage, engine, merge and the badge touch different files: send them all at once.", 3600)
  master.deed(
    "todowrite",
    { todos: ["storage (idb + outbox)", "sync engine", "three-way merge", "offline badge", "verify"] },
    600,
  )

  const storage = master.quest(
    "guild-implementer",
    "Storage: notes and the outbox in IndexedDB (src/sync/db.ts, src/sync/outbox.ts)",
    (s) => {
      s.deed("read", { filePath: "docs/plan/offline-sync.md" }, 200)
      s.deed("read", { filePath: "src/notes/store.ts" }, 200, { batch: true })
      s.think("One database, two stores: notes by id, the outbox by op id with an index on noteId.", 4200)
      s.deed("bash", { command: "bun add idb" }, 3400, { summary: "installed idb@8.0.3" })
      s.deed("write", { filePath: "src/sync/db.ts" }, 2200)
      s.wait(24_000)
      s.deed("write", { filePath: "src/sync/outbox.ts" }, 2400)
      s.deed(
        "edit",
        {
          filePath: "src/notes/store.ts",
          oldString: "await api.put(note)",
          newString: "await outbox.push(edit)",
        },
        800,
      )
      s.wait(9000)
      s.wait(10_000)
      s.deed("write", { filePath: "src/sync/outbox.test.ts" }, 2000)
      s.deed("bash", { command: "bun test src/sync/outbox.test.ts" }, 2400, {
        summary: "7 pass",
        output: bunTest(7, 0, 1, "212ms"),
      })
      until(s, AT.forged - 50_000)
      s.deed("bash", { command: "bun run typecheck" }, 6400, { summary: "ok" })
      s.finish(
        "Notes and the outbox live in IndexedDB; store.ts writes locally first and queues the edit.",
        2400,
      )
    },
    { wait: false },
  )
  const engine = master.quest(
    "guild-implementer",
    "Sync engine: flush the outbox, pull changes since the last cursor (src/sync/engine.ts)",
    (s) => {
      s.wait(1200)
      s.deed("read", { filePath: "docs/plan/offline-sync.md" }, 200)
      s.deed("read", { filePath: "src/notes/api.ts" }, 200, { batch: true })
      s.deed("read", { filePath: "server/routes/notes.ts" }, 200, { batch: true })
      s.think(
        "Push the outbox in order, then pull since the cursor. Retry with backoff, never in parallel.",
        6400,
      )
      s.deed("write", { filePath: "src/sync/engine.ts" }, 2600)
      s.wait(30_000)
      s.deed(
        "edit",
        {
          filePath: "src/notes/api.ts",
          oldString: "export async function put(note: Note)",
          newString: "export async function push(ops: Op[], cursor: string)",
        },
        900,
      )
      s.deed("edit", { filePath: "server/routes/notes.ts", newString: "router.post('/sync', sync)" }, 900)
      s.wait(14_000)
      s.wait(12_000)
      s.deed("write", { filePath: "src/sync/engine.test.ts" }, 2200)
      s.deed("bash", { command: "bun test src/sync/engine.test.ts" }, 2600, {
        summary: "9 pass",
        output: bunTest(9, 0, 1, "388ms"),
      })
      until(s, AT.forged)
      s.think("Backoff caps at 30 s; a reconnect resets it.", 3000)
      s.finish(
        "Engine flushes the outbox in order and pulls since the cursor, with backoff on failure.",
        2400,
      )
    },
    { wait: false },
  )
  const merge = master.quest(
    "guild-implementer",
    "Conflicts: three-way merge of note bodies (src/sync/conflict.ts)",
    (s) => {
      s.wait(2400)
      s.deed("read", { filePath: "docs/adr/0007-offline-sync.md" }, 200)
      s.deed("read", { filePath: "src/notes/types.ts" }, 200, { batch: true })
      s.think("diff3 on lines; a conflicting hunk keeps both sides rather than dropping one.", 7000)
      s.deed("bash", { command: "bun add node-diff3" }, 3000, { summary: "installed node-diff3@3.1.2" })
      s.deed("write", { filePath: "src/sync/conflict.ts" }, 2400)
      s.wait(34_000)
      s.deed("write", { filePath: "src/sync/conflict.test.ts" }, 2000)
      s.deed("bash", { command: "bun test src/sync/conflict.test.ts" }, 2400, {
        summary: "11 pass",
        output: bunTest(11, 0, 1, "96ms"),
      })
      s.wait(12_000)
      until(s, AT.forged - 30_000)
      s.deed(
        "edit",
        { filePath: "src/sync/engine.ts", newString: "const merged = merge(base, local, remote)" },
        900,
      )
      s.finish("merge(base, local, remote): line-level diff3 for bodies; the newest title wins.", 2400)
    },
    { wait: false },
  )
  const librarian = master.quest(
    "guild-librarian",
    "Check idb's transaction API and how diff3 reports conflicts",
    (l) => {
      l.wait(800)
      l.deed("context7_query-docs", { query: "idb openDB upgrade transaction store index" }, 5200)
      l.deed("context7_query-docs", { query: "node-diff3 merge conflict hunks" }, 4800)
      l.think("A transaction closes as soon as you await anything outside it: no fetch inside one.", 4000)
      l.deed("webfetch", { url: "https://github.com/jakearchibald/idb#transaction-lifetime" }, 3400)
      l.wait(8000)
      l.finish(
        "idb: never await a fetch inside a transaction (it auto-commits). diff3: merge() returns conflict hunks with both sides; keep them, don't pick one.",
        2800,
      )
    },
    { wait: false },
  )
  const designer = master.quest(
    "guild-designer",
    "Offline badge and pending-changes count in the header",
    (d) => {
      d.wait(4200)
      d.deed("read", { filePath: "src/app/Header.tsx" }, 200)
      d.deed("read", { filePath: "src/app/theme.css" }, 200, { batch: true })
      d.think("Quiet when online. Offline: a grey cloud and “3 changes waiting”, never red.", 5200)
      d.deed("write", { filePath: "src/ui/OfflineBadge.tsx" }, 2400)
      d.wait(26_000)
      d.deed("edit", { filePath: "src/app/Header.tsx", newString: "<OfflineBadge pending={pending} />" }, 800)
      d.deed(
        "edit",
        { filePath: "src/app/theme.css", newString: ".offline-badge { color: var(--ink-2) }" },
        800,
      )
      until(d, AT.forged - 70_000)
      d.think("Check the contrast of the grey on both themes before calling it done.", 3600)
      d.finish("The header shows a quiet cloud badge with the pending count while offline.", 2400)
    },
    { wait: false },
  )

  const shell = master.quest(
    "guild-implementer",
    "Service worker: cache the app shell so Quill opens with no network (src/sw/service-worker.ts)",
    (s) => {
      s.wait(3200)
      s.deed("read", { filePath: "vite.config.ts" }, 200)
      s.deed("read", { filePath: "index.html" }, 200, { batch: true })
      s.think("Precache the built shell, network-first for /api, never cache /api/sync.", 5600)
      s.deed("bash", { command: "bun add -d vite-plugin-pwa" }, 3600, {
        summary: "installed vite-plugin-pwa@1.0.2",
      })
      s.deed("write", { filePath: "src/sw/service-worker.ts" }, 2400)
      s.wait(20_000)
      s.deed(
        "edit",
        { filePath: "vite.config.ts", newString: "VitePWA({ strategies: 'injectManifest' })" },
        900,
      )
      s.wait(28_000)
      s.deed("bash", { command: "bun run build" }, 9800, { summary: "built in 3.4s · sw.js 41 kB" })
      until(s, AT.forged - 40_000)
      s.deed("bash", { command: "bun run typecheck" }, 6200, { summary: "ok" })
      s.finish(
        "The app shell is precached: Quill opens with no network; /api stays network-first and /sync is never cached.",
        2600,
      )
    },
    { wait: false },
  )

  // The bug-fix conversation opens beside the forge.
  emojiBug(script.guildmaster(BUG_QUEST, AT.bug))

  master.waitFor(storage, engine, merge, librarian, designer, shell)
  master.wait(8000)
  master.think("All four parts are in. Before anything else, verify it end to end.", 4600)

  // ── Act III · The storm ─────────────────────────────────────────────────────────
  until(master, AT.storm)
  script.chapter(master.clock, {
    numeral: "III",
    title: "The storm",
    tagline: "The tests turn red",
    hour: 13.4,
  })
  const verifier = master.quest("guild-verifier", "Verify offline sync end to end", (v) => {
    v.deed("read", { filePath: "docs/plan/offline-sync.md" }, 200)
    v.deed("read", { filePath: "src/sync/engine.ts" }, 200, { batch: true })
    v.deed("bash", { command: "bun test src/sync" }, 3200, {
      fail: `3 failed: ${REPLAY}`,
      summary: "exit 1",
      output: bunTest(38, 3, 4, "1.84s", [REPLAY, ORDER, TITLE]),
    })
    v.think("Edits arrive twice after a reconnect, and a merge loses the remote title.", 5200)
    v.deed("read", { filePath: "src/sync/conflict.ts" }, 300)
    v.finish(
      "FAIL: 3 of 41. (1) After a reconnect the outbox replays ops the server already applied: duplicates. (2) merge() drops the remote title when only the body conflicts.",
      3000,
    )
  })

  master.think("Two separate bugs, both in fresh code. Call their authors back with the failing tests.", 5400)
  master.resume(
    engine,
    "Fix: after a reconnect the outbox replays ops the server already applied (engine.test, offline.spec:41)",
    (s) => {
      s.deed("read", { filePath: "src/sync/engine.test.ts" }, 200)
      s.deed("edit", { filePath: "src/sync/engine.ts", newString: "if (op.sentAt) continue" }, 900)
      s.deed("bash", { command: "bun test src/sync/engine.test.ts" }, 2600, {
        fail: `1 failed: ${REPLAY}`,
        summary: "exit 1",
        output: bunTest(8, 1, 1, "402ms", [REPLAY]),
      })
      s.think(
        "sentAt is set before the response comes back, so a dropped response still marks it sent.",
        4600,
      )
      s.deed("edit", { filePath: "src/sync/engine.ts", newString: "op.sentAt = undefined" }, 900)
      s.deed("bash", { command: "bun test src/sync/engine.test.ts" }, 2600, {
        fail: `2 failed: ${ORDER}`,
        summary: "exit 1",
        output: bunTest(7, 2, 1, "415ms", [REPLAY, ORDER]),
      })
      s.deed(
        "edit",
        { filePath: "src/sync/outbox.ts", newString: "await tx.store.put({ ...op, attempt })" },
        900,
      )
      until(s, AT.dragon - 11_000)
      s.deed("bash", { command: "bun test src/sync/engine.test.ts" }, 2600, {
        fail: `2 failed: ${REPLAY}`,
        summary: "exit 1",
        output: bunTest(7, 2, 1, "398ms", [REPLAY, ORDER]),
      })
      s.think(
        "Still doubled. The server applies the op and the client cannot tell. Read the whole trace.",
        9800,
      )
      s.deed("bash", { command: "bun test src/sync --rerun-each 5" }, 9200, {
        fail: `10 failed: ${REPLAY}`,
        summary: "exit 1",
      })
      s.wait(22_000)
      s.deed("grep", { pattern: "POST /sync", path: "test-results" }, 900, { summary: "1,284 matches" })
      s.wait(20_000)
      s.deed("read", { filePath: "test-results/offline-spec/network.har" }, 1400)
      until(s, AT.implementerFalls)
      s.fail("ContextOverflowError: prompt is too long: 211,840 tokens > 200,000 maximum")
    },
    { wait: false },
  )
  master.resume(
    merge,
    "Fix: merge() drops the remote title when only the body conflicts (conflict.test, offline.spec:77)",
    (s) => {
      until(s, AT.dragon + 40_000)
      s.deed("read", { filePath: "src/sync/conflict.ts" }, 200)
      s.deed(
        "edit",
        { filePath: "src/sync/conflict.ts", newString: "title: newest(local, remote).title" },
        900,
      )
      s.deed("bash", { command: "bun test src/sync/conflict.test.ts" }, 2400, {
        fail: "1 failed: conflict › merges two offline edits to one note",
        summary: "exit 1",
      })
      s.think("The fixture's notes share a stale local database. Reset it before trusting this test.", 6800)
      s.deed("read", { filePath: "package.json" }, 200)
      // A risky command waits on the user: it wipes the local database.
      s.plea(36_000)
      s.deed("bash", { command: "rm -rf .quill-data && bun run db:reset --force" }, 5200, {
        summary: "dropped quill_dev · migrated 14 · seeded 120 notes",
      })
      s.deed("bash", { command: "bun test src/sync/conflict.test.ts" }, 2400, {
        summary: "12 pass",
        output: bunTest(12, 0, 1, "104ms"),
      })
      s.think("Unit test green. Now the browser case: two offline edits to one paragraph.", 5200)
      until(s, AT.paragraphs)
      s.deed("bash", { command: "bunx playwright test e2e/offline.spec.ts -g 'both paragraphs'" }, 9000, {
        fail: "1 failed: offline.spec.ts:77 › a conflict keeps both paragraphs",
        summary: "exit 1",
      })
      s.deed("edit", { filePath: "src/sync/conflict.ts", newString: "return hunks.flatMap(keepBoth)" }, 900)
      until(s, AT.paragraphs + 76_000)
      s.deed(
        "bash",
        { command: "bunx playwright test e2e/offline.spec.ts -g 'both paragraphs' --repeat-each 3" },
        16_000,
        {
          fail: "3 failed: offline.spec.ts:77 › a conflict keeps both paragraphs",
          summary: "exit 1",
        },
      )
      s.think(
        "The merge is right; the paragraph arrives twice. It's the same duplicate replay, not the merge.",
        6400,
      )
      s.finish(
        "Title merge fixed; the stale dev database was the flake. offline.spec:77 still fails, but from duplicate replays, not the merge: it waits on the engine fix.",
        2600,
      )
    },
    { wait: false },
  )
  until(master, AT.dragon + 40_000)
  master.think(
    "The duplicates go deeper than one guard. Have the Verifier bisect for the commit that began them.",
    4200,
  )
  master.resume(
    verifier,
    "Bisect: which commit started the duplicate replays?",
    (v) => {
      v.deed("bash", { command: "git bisect start HEAD main -- src/sync" }, 1400, {
        summary: "bisecting: 6 revisions",
      })
      v.deed("bash", { command: "git bisect run bun test src/sync/engine.test.ts" }, 34_000, {
        fail: "bisect run failed: exit code 2 from 'bun test' is neither 0, 1 nor 125",
        summary: "exit 2",
      })
      v.think("Some revisions don't build. Skip them and run it again.", 5200)
      v.deed(
        "bash",
        { command: "git bisect skip && git bisect run bun test src/sync/engine.test.ts" },
        28_000,
        {
          fail: `2 failed: ${REPLAY}`,
          summary: "exit 1",
        },
      )
      until(v, AT.verifierFalls)
      v.fail("ProviderError: overloaded_error (529): the model is at capacity, retries exhausted")
    },
    { wait: false },
  )
  master.waitFor(engine, merge, verifier)

  // ── Act IV · The mending ───────────────────────────────────────────────────────────
  until(master, AT.recovery)
  script.chapter(master.clock, {
    numeral: "IV",
    title: "The mending",
    tagline: "Called back from the graveyard",
    hour: 15.8,
  })
  master.think(
    "One drowned in a 200k-token trace, the provider cut the other off, and the e2e failure is the same duplicate bug. Call both back with less to read: the failing assertion, nothing else.",
    7400,
  )
  master.resume(
    engine,
    "Dedupe replays: give every op an id and let the server skip ids it has applied. Only the failing assertion is attached.",
    (s) => {
      s.deed("read", { filePath: "src/sync/engine.ts" }, 200)
      s.deed(
        "edit",
        { filePath: "src/sync/outbox.ts", newString: "const op = { id: crypto.randomUUID(), ...edit }" },
        900,
      )
      s.deed(
        "edit",
        { filePath: "server/routes/notes.ts", newString: "if (applied.has(op.id)) continue" },
        900,
      )
      s.deed("bash", { command: "bun test src/sync/engine.test.ts" }, 2600, {
        fail: `1 failed: ${ORDER}`,
        summary: "exit 1",
        output: bunTest(11, 1, 1, "380ms", [ORDER]),
      })
      s.think(
        "Duplicates are gone. Order breaks because the cursor moves on even when a batch half fails.",
        7400,
      )
      s.deed("edit", { filePath: "src/sync/engine.ts", newString: "cursor = res.lastAppliedId" }, 900)
      s.deed("bash", { command: "bun run typecheck" }, 6000, { summary: "ok" })
      until(s, AT.stillRed - 10_000)
      s.deed("bash", { command: "bun test src/sync/engine.test.ts" }, 2600, {
        fail: `1 failed: ${ORDER}`,
        summary: "exit 1",
        output: bunTest(11, 1, 1, "377ms", [ORDER]),
      })
      s.deed("bash", { command: "bun test src/sync" }, 3000, {
        fail: `2 failed: ${ORDER}`,
        summary: "exit 1",
        output: bunTest(42, 2, 4, "1.66s", [ORDER, "outbox › drains after a partial batch"]),
      })
      s.think("The server must say which ops it applied; the cursor follows that, not the batch.", 6000)
      s.deed("write", { filePath: "server/migrations/0015_applied_ops.sql" }, 1400)
      until(s, AT.green - 40_000)
      s.deed("bash", { command: "bun test src/sync/engine.test.ts" }, 2600, {
        summary: "12 pass",
        output: bunTest(12, 0, 1, "371ms"),
      })
      s.deed("bash", { command: "bun run typecheck" }, 6200, { summary: "ok" })
      s.finish(
        "Replays are idempotent: ops carry an id, the server skips ids it has applied, and the cursor only moves on what was applied.",
        2600,
      )
    },
    { wait: false },
  )
  master.resume(
    verifier,
    "Pick up where you were cut off: once the engine fix lands, run the sync suite and the e2e again",
    (v) => {
      v.deed("bash", { command: "git bisect reset" }, 1200, { summary: "ok" })
      until(v, AT.green)
      v.deed("read", { filePath: "src/sync/engine.ts" }, 200)
      v.deed("bash", { command: "bun test src/sync" }, 3200, {
        summary: "44 pass",
        output: bunTest(44, 0, 4, "1.61s"),
      })
      v.deed("bash", { command: "bunx playwright test e2e/offline.spec.ts" }, 19_000, {
        summary: "6 passed",
        output: "Running 6 tests using 3 workers\n  6 passed (19.8s)",
      })
      v.finish(
        "PASS: 44 unit, 6 e2e, including offline.spec:77. No duplicates after three forced reconnects.",
        2600,
      )
    },
    { wait: false },
  )
  master.waitFor(engine, verifier)
  master.think(
    "Green again. What is left: the notes for users, Safari's storage, and any save that skips the outbox.",
    5200,
  )
  const owner = master.quest(
    "guild-product-owner",
    "Write the offline note for users and the upgrade note for self-hosters",
    (o) => {
      o.deed("read", { filePath: "docs/plan/offline-sync.md" }, 200)
      o.think(
        "Lead with what users notice: it just works offline. Then the one thing self-hosters must do.",
        5600,
      )
      o.deed("write", { filePath: "docs/offline.md" }, 2400)
      o.wait(40_000)
      o.deed(
        "edit",
        {
          filePath: "docs/self-hosting.md",
          newString: "Run `bun run migrate` before upgrading: it adds applied_ops.",
        },
        900,
      )
      o.wait(30_000)
      o.deed(
        "edit",
        { filePath: "CHANGELOG.md", newString: "- Quill works offline: edits sync when you reconnect." },
        900,
      )
      o.finish(
        "docs/offline.md for users; self-hosters must run the applied_ops migration (in the changelog).",
        2400,
      )
    },
    { wait: false },
  )
  const quirks = master.quest(
    "guild-librarian",
    "Check how Safari evicts IndexedDB data",
    (l) => {
      l.wait(20_000)
      l.deed("context7_query-docs", { query: "webkit storage eviction indexeddb 7 days persist" }, 5200)
      l.deed("webfetch", { url: "https://webkit.org/blog/14403/updates-to-storage-policy/" }, 4200)
      l.think(
        "Safari may clear script-written storage after seven days without a visit: ask for persistence.",
        5200,
      )
      l.wait(20_000)
      l.finish(
        "Safari can evict after 7 idle days: call navigator.storage.persist() and keep the outbox small.",
        2600,
      )
    },
    { wait: false },
  )
  const sweep = master.quest(
    "guild-explorer",
    "Find any save that still bypasses the outbox",
    (x) => {
      x.wait(40_000)
      x.deed("grep", { pattern: "api\\.put\\(", path: "src" }, 300, { summary: "0 matches" })
      x.deed("grep", { pattern: 'fetch\\("/api/notes', path: "src" }, 300, { summary: "1 match" })
      x.deed("read", { filePath: "src/notes/importer.ts" }, 200)
      x.finish(
        "One left: the importer still POSTs directly. Harmless offline (it needs the file picker), but worth queuing.",
        2400,
      )
    },
    { wait: false },
  )
  master.waitFor(owner, quirks, sweep)
  master.think(
    "Persistence for Safari, and the importer through the outbox: two small changes, mine to make.",
    4600,
  )
  master.deed("edit", { filePath: "src/sync/db.ts", newString: "await navigator.storage?.persist?.()" }, 900)
  master.deed(
    "edit",
    { filePath: "src/notes/importer.ts", newString: "await outbox.push(...notes.map(toOp))" },
    900,
  )
  until(master, AT.comet - 30_000)
  master.deed("read", { filePath: "src/sync/outbox.ts" }, 200)
  master.deed("read", { filePath: "src/sync/conflict.ts" }, 200, { batch: true })
  master.deed("read", { filePath: "src/ui/OfflineBadge.tsx" }, 200)
  master.deed("bash", { command: "git status --short" }, 900, { summary: "21 files" })
  master.wait(12_000)

  // ── Act V · Nightfall ───────────────────────────────────────────────────────────
  until(master, AT.nightfall)
  script.chapter(master.clock, { numeral: "V", title: "Nightfall", tagline: "The clean sweep", hour: 20.7 })
  master.think(
    "Everything is in. The final pass: every check there is, and nothing may fail. Meanwhile, the PR.",
    4400,
  )
  master.quest(
    "guild-product-owner",
    "Write the pull request description: what changed, how to try it offline, what self-hosters run",
    (o) => {
      o.wait(30_000)
      o.deed("read", { filePath: "docs/offline.md" }, 200)
      o.deed("bash", { command: "git log --oneline main..HEAD" }, 900, { summary: "14 commits" })
      o.think("Three parts: what users get, how to try it (devtools → offline), and the migration.", 5200)
      o.wait(40_000)
      o.deed("write", { filePath: ".github/pr/offline-sync.md" }, 1600)
      o.finish(
        "PR description written: try it with devtools offline; self-hosters run `bun run migrate`.",
        2400,
      )
    },
    { wait: false },
  )
  master.quest(
    "guild-designer",
    "Screenshots of the offline badge for the PR: online, offline with pending edits, syncing",
    (d) => {
      d.wait(90_000)
      d.deed("bash", { command: "bunx playwright test e2e/screenshots.spec.ts --update-snapshots" }, 14_000, {
        summary: "3 screenshots",
      })
      d.deed("read", { filePath: "e2e/__screenshots__/badge-offline.png" }, 200)
      d.wait(30_000)
      d.finish(
        "Three screenshots: online (no badge), offline with 3 waiting, syncing. Attached to the PR.",
        2400,
      )
    },
    { wait: false },
  )
  master.resume(
    verifier,
    "Final verification: every suite, types, lint, build, e2e and the offline smoke test",
    (v) => {
      v.deed("read", { filePath: "docs/plan/offline-sync.md" }, 200)
      v.deed("glob", { pattern: "src/sync/**" }, 300, { summary: "9 files" })
      v.deed("read", { filePath: "src/sync/outbox.ts" }, 200)
      v.deed("read", { filePath: "src/sync/conflict.ts" }, 200, { batch: true })
      v.deed("bash", { command: "bun test" }, 4600, {
        summary: "231 pass",
        output: bunTest(231, 0, 38, "4.92s"),
      })
      v.deed("bash", { command: "bun test --coverage src/sync" }, 3800, { summary: "96.4% lines" })
      v.deed("bash", { command: "bun run typecheck" }, 6400, { summary: "ok" })
      v.deed("bash", { command: "bunx biome check ." }, 2200, {
        summary: "Checked 214 files. No fixes applied.",
      })
      v.think(
        "Unit and static checks are clean. Now the browser: build, e2e, then the offline smoke test.",
        4200,
      )
      v.deed("bash", { command: "bun run build" }, 9800, { summary: "built in 3.2s" })
      v.deed("bash", { command: "bunx playwright test" }, 24_000, {
        summary: "18 passed",
        output: "Running 18 tests using 4 workers\n  18 passed (24.1s)",
      })
      v.deed("bash", { command: "bun run smoke:offline -- --reconnects 20" }, 14_000, {
        summary: "20 reconnects · 0 duplicates · 0 lost edits",
      })
      v.deed("grep", { pattern: "TODO|FIXME", path: "src/sync" }, 300, { summary: "0 matches" })
      v.deed("read", { filePath: "e2e/offline.spec.ts" }, 200)
      v.deed("read", { filePath: "docs/offline.md" }, 200, { batch: true })
      v.deed("bash", { command: "git diff --check" }, 900, { summary: "ok" })
      until(v, AT.festival - 8000)
      v.think("Nothing failed, nothing skipped.", 2600)
      v.finish(
        "PASS, clean: 231 tests, 18 e2e, 96.4% coverage on src/sync, types and lint clean, 20 forced reconnects with no duplicates and no lost edits.",
        3400,
      )
    },
  )
  master.deed("bash", { command: "git diff --stat" }, 1200, {
    summary: "19 files changed, 1146 insertions(+), 38 deletions(-)",
  })
  master.think("Say what changed, what they must run, and what is left for later.", 9000)
  master.deed("bash", { command: "gh pr create --fill --body-file .github/pr/offline-sync.md" }, 4200, {
    summary: "https://github.com/quill-notes/quill/pull/424",
  })
  master.wait(20_000)
  master.finish(
    "Quill works offline. Notes live in IndexedDB; edits queue in an outbox and sync on reconnect, idempotent by op id; conflicting bodies merge three ways and keep both sides. 231 tests and 18 e2e pass. PR #424 is up. Self-hosters: run `bun run migrate`.",
    7000,
  )
  // The user has read it.
  master.wait(66_000)
  master.prompt("Ship it.")
  master.deed("bash", { command: "gh pr merge 424 --squash --delete-branch" }, 5200, {
    summary: "merged into main",
  })
  master.finish("Merged #424 into main. Quill works offline.", 3000)
  master.wait(50_000)
  master.prompt("Thank you. Close #398 with a link to the PR, and that's the day.")
  master.deed(
    "bash",
    { command: 'gh issue close 398 --comment "Shipped in #424: Quill works offline."' },
    2400,
    {
      summary: "closed #398",
    },
  )
  master.finish("Closed #398. Good night.", 2400)
  // The host's last word on the session's totals, a little after the end: the film holds the night.
  master.wait(90_000)
  script.emit({ type: "usage", id: master.id, at: master.clock })
}

// ─────────────────────────────── the bug fix beside it ───────────────────────────────

/** The second conversation: a small bug fix, then the PR, a red CI, and the changelog. */
function emojiBug(master: Adventurer): void {
  master.think(
    "A RangeError in tokenize() on an emoji smells like slicing a surrogate pair. Find it first.",
    5200,
  )
  master.quest("guild-explorer", "Find where search tokenizes note titles", (x) => {
    x.deed("grep", { pattern: "tokenize\\(", path: "src/search" }, 300, { summary: "5 matches" })
    x.deed("read", { filePath: "src/search/tokenize.ts" }, 200)
    x.deed("read", { filePath: "src/search/indexer.ts" }, 200, { batch: true })
    x.think("It walks UTF-16 indices and slices: a 🍜 is two code units, so the slice cuts it in half.", 5600)
    x.deed("grep", { pattern: "fromCodePoint", path: "src" }, 300, { summary: "1 match" })
    x.finish(
      "tokenize() slices titles by UTF-16 index; an emoji is a surrogate pair, the slice splits it and String.fromCodePoint throws.",
      2400,
    )
  })
  const smith = master.quest(
    "guild-implementer",
    "Reproduce with a failing test, then make tokenize() walk code points",
    (s) => {
      s.deed("write", { filePath: "src/search/tokenize.test.ts" }, 1600)
      s.deed("bash", { command: "bun test src/search/tokenize.test.ts" }, 2200, {
        fail: "1 failed: tokenize › keeps emoji whole",
        summary: "exit 1",
        output: "✗ tokenize › keeps emoji whole\n  RangeError: Invalid code point 55356\n\n 6 pass\n 1 fail",
      })
      s.think("Red, as it should be. Iterate with for…of: it yields whole code points.", 4400)
      s.deed("edit", { filePath: "src/search/tokenize.ts", newString: "for (const ch of title) {" }, 900)
      s.deed("bash", { command: "bun test src/search" }, 2400, {
        summary: "23 pass",
        output: bunTest(23, 0, 3, "88ms"),
      })
      s.finish("tokenize() walks code points; “🍜 ramen” indexes as two tokens. Regression test added.", 2400)
    },
  )
  master.finish(
    "Fixed: search no longer throws on emoji titles. tokenize() walks code points; regression test added.",
    2600,
  )

  // The user reads it and asks for the PR.
  master.wait(62_000)
  master.prompt("Thanks! Open a PR against release/2.4 too.")
  master.think("Branch, commit, push, then the PR against the release branch.", 3200)
  master.deed("bash", { command: "git switch -c fix/emoji-search" }, 900, {
    summary: "Switched to a new branch",
  })
  master.deed("bash", { command: 'git commit -am "fix(search): tokenize by code point"' }, 1100, {
    summary: "2 files changed",
  })
  master.deed("bash", { command: "git push -u origin fix/emoji-search" }, 3800, { summary: "pushed" })
  master.deed("bash", { command: "gh pr create --base release/2.4 --fill" }, 4200, {
    summary: "https://github.com/quill-notes/quill/pull/418",
  })
  master.finish("Opened #418 against release/2.4.", 2000)

  // CI answers: red. (`gh pr checks` exits non-zero and says why; the call itself succeeds.)
  master.wait(66_000)
  master.prompt("CI is red on #418, can you look?")
  master.deed("bash", { command: "gh pr checks 418" }, 2600, {
    summary: "exit 8",
    output: "✓ lint\n✓ typecheck\nX test (node 18)  ReferenceError: Intl.Segmenter is not defined",
  })
  master.quest("guild-verifier", "Find why #418 fails on the Node 18 runner", (v) => {
    v.deed("bash", { command: "gh run view --log-failed" }, 3400, { summary: "1 failing job" })
    v.deed("read", { filePath: ".github/workflows/ci.yml" }, 200)
    v.deed("grep", { pattern: "Segmenter", path: "src" }, 300, { summary: "1 match" })
    v.finish(
      "indexer.ts still calls Intl.Segmenter for word breaks; Node 18 on the release branch lacks it.",
      2400,
    )
  })
  master.resume(
    smith,
    "Drop Intl.Segmenter from indexer.ts: split words on Unicode whitespace instead",
    (s) => {
      s.deed("edit", { filePath: "src/search/indexer.ts", newString: "title.split(/\\s+/u)" }, 900)
      s.deed("bash", { command: "bun test src/search" }, 2200, { summary: "24 pass" })
      s.finish("indexer.ts splits on Unicode whitespace; no Intl.Segmenter.", 2000)
    },
  )
  master.deed(
    "bash",
    { command: 'git commit -am "fix(search): no Intl.Segmenter on node 18" && git push' },
    3600,
    {
      summary: "pushed",
    },
  )
  // CI takes its time: the watch holds until every job has reported.
  master.deed("bash", { command: "gh pr checks 418 --watch" }, 190_000, { summary: "all checks passed" })
  master.finish("CI is green on #418.", 2000)

  // Merged: the backport and the changelog, and the conversation is done.
  master.wait(60_000)
  master.prompt("Merged, thanks. Backport it to release/2.3 as well, and add it to the changelog.")
  master.deed("bash", { command: "git switch release/2.3 && git switch -c fix/emoji-search-2.3" }, 1200, {
    summary: "Switched to a new branch",
  })
  master.deed("bash", { command: "git cherry-pick 3f9c2e1 a71d0b4" }, 1600, { summary: "2 commits applied" })
  master.deed("bash", { command: "bun test src/search" }, 2200, { summary: "24 pass" })
  master.deed(
    "edit",
    { filePath: "CHANGELOG.md", newString: "- Search no longer throws on emoji titles (#418)." },
    900,
  )
  master.deed(
    "bash",
    { command: "git push -u origin fix/emoji-search-2.3 && gh pr create --base release/2.3 --fill" },
    4800,
    {
      summary: "https://github.com/quill-notes/quill/pull/421",
    },
  )
  until(master, AT.bugDone - 150_000)
  master.deed("bash", { command: "gh pr checks 421 --watch" }, 120_000, { summary: "all checks passed" })
  master.deed("bash", { command: 'gh issue close 412 --comment "Fixed in #418, backported in #421"' }, 2200, {
    summary: "closed #412",
  })
  master.finish("Backported in #421 (green), changelog updated, #412 closed.", 2400)
}
