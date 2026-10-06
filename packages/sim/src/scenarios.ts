import type { Change } from "@guildhall/core"
import { Script } from "./script.ts"

/**
 * The stories the website and the Lab play. Each returns the run's changes; the same seed always
 * gives the same run.
 */

/** One implementer, no party: read, edit, test, done. The smallest thing worth watching. */
export function solo(seed = 1): Change[] {
  const script = new Script(seed)
  const master = script.guildmaster("Fix the timezone bug in formatDate")
  master.think("The formatter drops the offset. Read it, fix it, prove it.", 1800)
  master.deed("grep", { pattern: "formatDate", path: "src" }, 600, { summary: "4 matches" })
  master.deed("read", { filePath: "src/date/format.ts" }, 700)
  master.deed("edit", { filePath: "src/date/format.ts" }, 1400)
  master.deed("bash", { command: "bun test date" }, 2600, { fail: "1 failed", summary: "exit 1" })
  master.think("Off by one hour on DST. Use the zone, not the offset.", 1600)
  master.deed("edit", { filePath: "src/date/format.ts" }, 1000)
  master.deed("bash", { command: "bun test date" }, 2200, { summary: "12 pass" })
  master.finish("Fixed: formatDate keeps the zone across DST. Regression test added.")
  return script.done()
}

/**
 * The hero run for the website (~67 s, loops): map → plan → three adventurers in parallel (one
 * raises a plea) → the verifier catches an off-by-one → the query smith is called back from the
 * tavern (resume) → verified → loot home.
 * Every kind of moment the Bard ranks appears at least once.
 */
export function party(seed = 1): Change[] {
  const script = new Script(seed)
  const master = script.guildmaster("Add cursor pagination to GET /users")
  master.think("API, service and query layers all move. Map it, plan it, then split the work.", 3500)
  master.deed("todowrite", { todos: ["map", "plan", "build", "verify"] }, 800)

  master.quest("guild-explorer", "Map how GET /users flows from route to query", (explorer) => {
    explorer.deed("glob", { pattern: "src/users/**" }, 1000, { summary: "7 files" })
    explorer.deed("grep", { pattern: "findUsers", path: "src" }, 1100, { summary: "3 matches" })
    explorer.deed("read", { filePath: "src/users/routes.ts" }, 1400)
    explorer.deed("read", { filePath: "src/users/queries.ts" }, 1400)
    explorer.finish("routes.ts → service.ts → queries.ts; findUsers returns every row.")
  })

  master.quest("guild-architect", "Design the pagination contract", (architect) => {
    architect.deed("webfetch", { url: "https://example.com/cursor-vs-offset" }, 3800)
    architect.think("Offset breaks under inserts. Opaque cursor on (created_at, id), limit ≤ 100.", 4200)
    architect.deed("write", { filePath: "docs/plan/pagination.md" }, 2200)
    architect.finish("Contract: ?cursor&limit → { items, nextCursor }. Two tasks: API, query.")
  })

  const api = master.quest(
    "guild-implementer",
    "API: parse cursor + limit, return nextCursor",
    (smith) => {
      smith.deed("read", { filePath: "src/users/routes.ts" }, 1100)
      smith.deed("edit", { filePath: "src/users/routes.ts" }, 3500)
      smith.deed("edit", { filePath: "src/users/service.ts" }, 2900)
      smith.deed("bash", { command: "bun run typecheck" }, 3800, { summary: "ok" })
      smith.finish("Route takes cursor & limit, encodes nextCursor.")
    },
    { wait: false },
  )
  const query = master.quest(
    "guild-implementer",
    "Query: keyset pagination on (created_at, id)",
    (smith) => {
      smith.deed("read", { filePath: "src/users/queries.ts" }, 1100)
      smith.deed("edit", { filePath: "src/users/queries.ts" }, 3200)
      smith.deed("write", { filePath: "migrations/0042_users_created_at_idx.sql" }, 1900)
      smith.plea(7200)
      smith.deed("bash", { command: "bun run migrate" }, 3200, { summary: "1 applied" })
      smith.finish("findUsers(cursor, limit) with an index on (created_at, id).")
    },
    { wait: false },
  )
  const docs = master.quest(
    "guild-librarian",
    "Check the ORM's keyset API",
    (librarian) => {
      librarian.deed("context7_query-docs", { query: "keyset pagination where tuple" }, 4200)
      librarian.finish("Use a row-value comparison: (created_at, id) > ($1, $2).")
    },
    { wait: false },
  )
  master.waitFor(api, query, docs)

  master.quest("guild-verifier", "Verify against the contract", (verifier) => {
    verifier.deed("read", { filePath: "docs/plan/pagination.md" }, 1300)
    verifier.deed("bash", { command: "bun test users" }, 4800, { fail: "1 failed", summary: "exit 1" })
    verifier.think("Last page drops a row: limit + 1 lookahead is missing.", 2900)
    verifier.finish("FAIL: nextCursor skips the final row on exact page boundaries.")
  })

  // The query smith still has the context: call them back from the tavern instead of a new hire.
  master.resume(query, "Fix: fetch limit + 1 to detect the next page", (smith) => {
    smith.deed("edit", { filePath: "src/users/queries.ts" }, 2600)
    smith.deed("bash", { command: "bun test users" }, 3800, { summary: "18 pass" })
    smith.finish("Lookahead row added; boundary test passes.")
  })

  master.quest("guild-verifier", "Re-verify", (verifier) => {
    verifier.deed("bash", { command: "bun test" }, 5100, { summary: "214 pass" })
    verifier.finish("PASS: contract holds, boundaries covered.")
  })

  master.finish("GET /users now pages by cursor: ?cursor&limit → { items, nextCursor }. All 214 tests pass.")
  return script.done()
}

/** Stress: one guildmaster sends `count` adventurers out at once. For crowding and frame rate. */
export function rush(count = 12, seed = 1): Change[] {
  const script = new Script(seed)
  const master = script.guildmaster(`Sweep the repo: ${count} parallel quests`)
  master.think("Fan out. Everyone takes a module.", 1200)
  const roles = [
    "guild-implementer",
    "guild-explorer",
    "guild-verifier",
    "guild-librarian",
    "guild-researcher",
  ]
  const tools = ["read", "grep", "edit", "bash", "glob", "webfetch", "context7_query-docs"] as const
  const children = Array.from({ length: count }, (_, i) =>
    master.quest(
      script.pick(roles),
      `Module ${i + 1}`,
      (child) => {
        child.wait(i * 150)
        for (let step = 0; step < 6; step++) child.deed(script.pick(tools), { path: `src/mod${i + 1}` }, 900)
        child.finish(`Module ${i + 1} done.`)
      },
      { wait: false },
    ),
  )
  master.waitFor(...children).finish(`All ${count} modules swept.`)
  return script.done()
}
