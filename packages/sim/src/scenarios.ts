import type { Change } from "@guildhall/core"
import { type Adventurer, Script } from "./script.ts"

/**
 * The stories the website and the Lab play. Each returns the run's changes; the same seed always
 * gives the same run.
 */

/** One implementer, no party: read, edit, test, done. The smallest thing worth watching. */
export function solo(seed = 1): Change[] {
  const script = new Script(seed)
  timezone(script)
  return script.done()
}

/** `solo`'s story, starting at `at`. */
function timezone(script: Script, at = 0): Adventurer {
  const master = script.guildmaster("Fix the timezone bug in formatDate", at)
  master.think("The formatter drops the offset. Read it, fix it, prove it.", 1800)
  master.deed("grep", { pattern: "formatDate", path: "src" }, 600, { summary: "4 matches" })
  master.deed("read", { filePath: "src/date/format.ts" }, 700)
  master.deed("edit", { filePath: "src/date/format.ts" }, 1400)
  master.deed("bash", { command: "bun test date" }, 2600, { fail: "1 failed", summary: "exit 1" })
  master.think("Off by one hour on DST. Use the zone, not the offset.", 1600)
  master.deed("edit", { filePath: "src/date/format.ts" }, 1000)
  master.deed("bash", { command: "bun test date" }, 2200, { summary: "12 pass" })
  master.finish("Fixed: formatDate keeps the zone across DST. Regression test added.")
  return master
}

/**
 * The hero run for the website (~67 s, loops): map → plan → three adventurers in parallel (one
 * raises a plea) → the verifier catches an off-by-one → the query smith is called back from the
 * tavern (resume) → verified → loot home.
 * Every kind of moment the Bard ranks appears at least once.
 */
export function party(seed = 1): Change[] {
  const script = new Script(seed)
  pagination(script)
  return script.done()
}

/** `party`'s story, starting at `at`. */
function pagination(script: Script, at = 0): Adventurer {
  const master = script.guildmaster("Add cursor pagination to GET /users", at)
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
  return master
}

/**
 * Three conversations at once, one island (roadmap "The harness phase"): the pagination party from
 * the start, a quick timezone fix opened 3 s in (done by ~20 s: it goes home through the gate after
 * its idle spell, guild/parties.ts PARTY_IDLE_MS), and a long Redis migration from 9 s with its own
 * plea, a failed verification and a call-back. Each has its own guildmaster at the quest board.
 */
export function parties(seed = 1): Change[] {
  const script = new Script(seed)
  pagination(script, 0)
  timezone(script, 3000)
  redis(script, 9000)
  return script.done()
}

/** The long party: sessions move from memory to Redis. */
function redis(script: Script, at: number): Adventurer {
  const master = script.guildmaster("Move the session store from memory to Redis", at)
  master.think(
    "Every read and write of the session map moves. Find them, pick a client, then split it.",
    3200,
  )
  master.quest("guild-explorer", "Find every read and write of the session map", (explorer) => {
    explorer.deed("grep", { pattern: "sessions.get|sessions.set", path: "src" }, 1400, {
      summary: "11 matches",
    })
    explorer.deed("read", { filePath: "src/auth/session.ts" }, 1800)
    explorer.deed("read", { filePath: "src/auth/expiry.ts" }, 1600)
    explorer.deed("glob", { pattern: "src/**/*.session.ts" }, 900, { summary: "4 files" })
    explorer.finish("Sessions live in one Map in session.ts; expiry.ts sweeps it every minute.")
  })
  master.quest("guild-researcher", "Compare node-redis and ioredis for pooling", (researcher) => {
    researcher.deed("webfetch", { url: "https://example.com/node-redis-vs-ioredis" }, 4200)
    researcher.deed("context7_query-docs", { query: "ioredis connection pool cluster" }, 3800)
    researcher.think("ioredis pipelines and reconnects on its own. Use it.", 2600)
    researcher.finish("ioredis: auto-reconnect, pipelining, cluster-ready. One shared client.")
  })
  master.think("Two halves: the store adapter and the expiry sweep. TTLs replace the sweep.", 2600)
  const adapter = master.quest(
    "guild-implementer",
    "Write the RedisSessionStore adapter",
    (smith) => {
      smith.deed("read", { filePath: "src/auth/session.ts" }, 1300)
      smith.deed("write", { filePath: "src/auth/redis-store.ts" }, 4600)
      smith.deed("edit", { filePath: "src/auth/session.ts" }, 3400)
      smith.deed("bash", { command: "bun run typecheck" }, 4200, { summary: "ok" })
      smith.finish("RedisSessionStore: get/set/destroy over one ioredis client.")
    },
    { wait: false },
  )
  const expiry = master.quest(
    "guild-implementer",
    "Port the expiry sweep to Redis TTLs",
    (smith) => {
      smith.deed("read", { filePath: "src/auth/expiry.ts" }, 1200)
      smith.deed("edit", { filePath: "src/auth/expiry.ts" }, 3600)
      smith.plea(6800)
      smith.deed("bash", { command: "docker compose up -d redis" }, 3400, { summary: "started" })
      smith.deed("bash", { command: "bun test expiry" }, 4200, { summary: "6 pass" })
      smith.finish("Sweep removed: SET with EX does it; touch() refreshes the TTL.")
    },
    { wait: false },
  )
  const ttl = master.quest(
    "guild-librarian",
    "Check how EXPIRE behaves on overwrite",
    (librarian) => {
      librarian.deed("context7_query-docs", { query: "redis SET EX overwrite ttl KEEPTTL" }, 5200)
      librarian.finish("A plain SET clears the TTL: always pass EX (or KEEPTTL).")
    },
    { wait: false },
  )
  master.waitFor(adapter, expiry, ttl)
  master.quest("guild-verifier", "Load-test sessions under Redis", (verifier) => {
    verifier.deed("read", { filePath: "src/auth/redis-store.ts" }, 1500)
    verifier.deed("bash", { command: "bun test auth" }, 7200, { fail: "2 failed", summary: "exit 1" })
    verifier.think("Dates come back as strings: expiresAt is never a Date after a round trip.", 3000)
    verifier.finish("FAIL: expiresAt is a string after GET; two auth tests fail.")
  })
  master.resume(adapter, "Fix: revive dates when reading a session", (smith) => {
    smith.deed("edit", { filePath: "src/auth/redis-store.ts" }, 2800)
    smith.deed("bash", { command: "bun test auth" }, 4400, { summary: "41 pass" })
    smith.finish("Dates revived on read; auth suite green.")
  })
  master.quest("guild-verifier", "Re-verify under load", (verifier) => {
    verifier.deed("bash", { command: "bun test" }, 6200, { summary: "214 pass" })
    verifier.deed("bash", { command: "bun run bench:sessions" }, 7400, { summary: "p99 3.1 ms" })
    verifier.finish("PASS: suite green, p99 3.1 ms at 2k rps.")
  })
  master.quest("guild-product-owner", "Write the upgrade note: Redis is now required", (owner) => {
    owner.deed("write", { filePath: "docs/upgrading.md" }, 5200)
    owner.think("Say it first: REDIS_URL is required. Then how to run it locally.", 2400)
    owner.finish("Upgrade note written: REDIS_URL required, docker compose line included.")
  })
  master.deed("bash", { command: "git diff --stat" }, 1400, { summary: "9 files changed" })
  master.think("Read the whole change once more before saying it is done: adapter, TTLs, the note.", 9000)
  master.deed("read", { filePath: "src/auth/redis-store.ts" }, 4200)
  master.deed("read", { filePath: "docs/upgrading.md" }, 3600)
  master.think("It holds. Tell them what changed and what they must do.", 4200)
  master.finish(
    "Sessions live in Redis now: TTLs replace the sweep, dates survive the round trip, p99 3.1 ms.",
  )
  return master
}

/** The rush's quitters by default: indices of the quests that fail; the second is retried and recovers. */
const FALLEN = [2, 7]

/**
 * Stress: one guildmaster sends `count` adventurers out at once. For crowding and frame rate.
 * Two of them give up halfway (a session failure: the graveyard's undead rise); the guildmaster
 * calls the second back once the sweep is done, and it recovers.
 */
export function rush(count = 12, seed = 1, fallen: readonly number[] = FALLEN): Change[] {
  const script = new Script(seed)
  const master = script.guildmaster(`Sweep the repo: ${count} parallel quests`)
  master.think("Fan out. Everyone takes a module.", 1200)
  const roles = [
    "guild-implementer",
    "guild-explorer",
    "guild-verifier",
    "guild-librarian",
    "guild-researcher",
    // OpenCode's own subagent, not one of the guild's: it works the quarry.
    "general",
  ]
  const tools = ["read", "grep", "edit", "bash", "glob", "webfetch", "context7_query-docs"] as const
  const children = Array.from({ length: count }, (_, i) =>
    master.quest(
      roles[i % roles.length] ?? "general",
      `Module ${i + 1}`,
      (child) => {
        child.wait(i * 150)
        const gives = fallen.includes(i)
        for (let step = 0; step < (gives ? 4 : 8); step++)
          child.deed(script.pick(tools), { path: `src/mod${i + 1}` }, 2600)
        if (gives) {
          child.deed("bash", { command: `bun test mod${i + 1}` }, 2200, {
            fail: "3 failed",
            summary: "exit 1",
          })
          child.fail("Gave up: the module's tests keep failing")
        } else child.finish(`Module ${i + 1} done.`)
      },
      { wait: false },
    ),
  )
  master.waitFor(...children)
  const retried = fallen[1]
  const retry = retried === undefined ? undefined : children[retried]
  if (retry && retried !== undefined)
    master.resume(retry, `Retry module ${retried + 1}: fix the failing tests`, (child) => {
      child.deed("edit", { filePath: `src/mod${retried + 1}/index.ts` }, 2400)
      child.deed("bash", { command: `bun test mod${retried + 1}` }, 2400, { summary: "9 pass" })
      child.finish("Fixed and passing.")
    })
  master.finish(`All ${count} modules swept.`)
  return script.done()
}
