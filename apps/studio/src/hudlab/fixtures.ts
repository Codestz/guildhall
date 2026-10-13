/**
 * The HUD lab's fixtures: V1's `party` story (legacy/packages/sim/src/scenarios.ts, cursor pagination for
 * GET /users) at about 0:30, cast the V1 way (legacy/packages/roster archetypes: names, banner colours,
 * bodies) with each body as its V2 hero family. Files map to the hex island's places as the demo agents'
 * errands do (hexworld/lifeAgents.ts). Five states: empty, busy, a plea pending, an error, a crowd.
 */
import type {
  ChronicleEntry,
  Family,
  FilePlace,
  HeroView,
  Ledger,
  PartyView,
  PleaView,
  SourceState,
  TimelineMarker,
  TranscriptLine,
} from "@guildhall/ui"

export const STATES = ["empty", "busy", "plea", "error", "crowd"] as const
export type LabState = (typeof STATES)[number]

/** V1's archetypes (roster/archetypes.ts): banner colour and body, the body as a V2 family. */
const CAST = {
  guildmaster: { name: "Guildmaster", banner: "#d4ad3a", family: "mage" },
  architect: { name: "Architect", banner: "#4f8fd6", family: "knight" },
  artisan: { name: "Artisan", banner: "#e0702f", family: "barbarian" },
  warden: { name: "Warden", banner: "#3fae6b", family: "rogue" },
  archivist: { name: "Archivist", banner: "#8b6cd9", family: "mage" },
  scout: { name: "Scout", banner: "#2fa7a0", family: "ranger" },
  herald: { name: "Herald", banner: "#b8864a", family: "knight" },
} as const satisfies Record<string, { name: string; banner: string; family: Family }>

const cast = (who: keyof typeof CAST, hero: Omit<HeroView, "name" | "banner" | "family">): HeroView => ({
  ...CAST[who],
  ...hero,
})

export const PARTY: PartyView = { id: "pagination", name: "Pagination", colour: "#d4ad3a" }
export const REDIS: PartyView = { id: "redis", name: "Redis", colour: "#4f8fd6" }

const BUSY_HEROES: readonly HeroView[] = [
  cast("guildmaster", {
    id: "gm",
    master: true,
    phase: "working",
    doing: "task · Query: keyset pagination",
    place: "Great hall",
    rank: "journeyman",
    party: "pagination",
  }),
  cast("scout", {
    id: "explorer",
    source: "explorer",
    phase: "leaving",
    doing: "quest done",
    place: "Castle gate",
    rank: "apprentice",
    party: "pagination",
  }),
  cast("architect", {
    id: "architect",
    phase: "resting",
    doing: "quest done",
    place: "Tavern",
    rank: "apprentice",
    party: "pagination",
  }),
  cast("artisan", {
    id: "api",
    source: "implementer",
    phase: "working",
    doing: "bash · bun run typecheck",
    place: "Market",
    rank: "apprentice",
    party: "pagination",
  }),
  cast("artisan", {
    id: "query",
    source: "implementer",
    ordinal: 2,
    phase: "working",
    doing: "write · 0042_users_created_at_idx.sql",
    place: "Mine",
    rank: "apprentice",
    party: "pagination",
  }),
  cast("archivist", {
    id: "librarian",
    source: "librarian",
    phase: "loot",
    doing: "quest done",
    place: "Monastery",
    rank: "apprentice",
    party: "pagination",
  }),
]

const at = (s: number) => s * 1000
const line = (
  key: string,
  t: number,
  kind: ChronicleEntry["kind"],
  who: keyof typeof CAST,
  text: string,
  hero: string,
  ordinal = 1,
): ChronicleEntry => ({
  key,
  at: at(t),
  kind,
  who: ordinal > 1 ? `${CAST[who].name} II` : CAST[who].name,
  banner: CAST[who].banner,
  text,
  hero,
  party: "pagination",
})

/** V1's chronicle for `party`, oldest first (the live site at ?story=party&t=0:38). */
const BUSY_LOG: readonly ChronicleEntry[] = [
  line("c1", 0, "join", "guildmaster", "takes the quest: Add cursor pagination to GET /users", "gm"),
  line(
    "c2",
    4,
    "thought",
    "guildmaster",
    "API, service and query layers all move. Map it, plan it, then split the work.",
    "gm",
  ),
  line("c3", 5, "quest", "guildmaster", "sends a quest: Map how GET /users flows from route to query", "gm"),
  line("c4", 6, "join", "scout", "joins: Map how GET /users flows from route to query", "explorer"),
  line("c5", 11, "loot", "scout", "quest complete: routes.ts → service.ts → queries.ts", "explorer"),
  line("c6", 12, "join", "architect", "joins: Design the pagination contract", "architect"),
  line("c7", 21, "loot", "architect", "quest complete: ?cursor&limit → { items, nextCursor }", "architect"),
  line("c8", 22, "join", "artisan", "joins: API: parse cursor + limit, return nextCursor", "api"),
  line("c9", 22, "join", "artisan", "joins: Query: keyset pagination on (created_at, id)", "query", 2),
  line("c10", 23, "deed", "archivist", "context7_query-docs keyset pagination where tuple", "librarian"),
  line("c11", 24, "deed", "artisan", "edit queries.ts", "query", 2),
  line("c12", 24, "deed", "artisan", "edit routes.ts", "api"),
  line("c13", 27, "deed", "artisan", "edit service.ts", "api"),
  line("c14", 27, "deed", "artisan", "write 0042_users_created_at_idx.sql", "query", 2),
  line("c15", 28, "loot", "archivist", "quest complete: use a row-value comparison", "librarian"),
  line("c16", 30, "deed", "artisan", "bash bun run typecheck", "api"),
]

const PLEA_LOG: readonly ChronicleEntry[] = [
  ...BUSY_LOG,
  line("c17", 31, "plea", "artisan", "asks for permission: bash · bun run migrate", "query", 2),
]

const ERROR_LOG: readonly ChronicleEntry[] = [
  ...BUSY_LOG,
  line("c17", 35, "loot", "artisan", "quest complete: findUsers(cursor, limit) with an index", "query", 2),
  line("c18", 36, "join", "warden", "joins: Verify against the contract", "verifier"),
  line("c19", 41, "fail", "warden", "bash bun test users failed: 1 failed", "verifier"),
  line("c20", 44, "thought", "warden", "Last page drops a row: limit + 1 lookahead is missing.", "verifier"),
  line(
    "c21",
    45,
    "fail",
    "warden",
    "FAIL: nextCursor skips the final row on exact page boundaries",
    "verifier",
  ),
]

const mark = (s: number, kind: TimelineMarker["kind"]): TimelineMarker => ({ at: at(s), kind })
const SESSION_MARKS: readonly TimelineMarker[] = [
  mark(5, "quest"),
  mark(11, "loot"),
  mark(12, "quest"),
  mark(21, "loot"),
  mark(22, "quest"),
  mark(28, "loot"),
  mark(31, "plea"),
  mark(41, "fail"),
  mark(45, "fail"),
  mark(52, "quest"),
  mark(62, "loot"),
]

/** Guildhall's own history, as the Repo Chronicle would give it: packages born, releases. */
const day = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d)
export const HISTORY = { start: day(2024, 3, 2), end: day(2026, 10, 12) }
const HISTORY_MARKS: readonly TimelineMarker[] = [
  { at: day(2024, 3, 2), kind: "born", label: "core is born" },
  { at: day(2024, 6, 18), kind: "born", label: "hall is born" },
  { at: day(2024, 11, 4), kind: "release", label: "v0.1" },
  { at: day(2025, 4, 22), kind: "born", label: "roster is born" },
  { at: day(2025, 9, 30), kind: "release", label: "v1.0 · guildhall.codestz.dev" },
  { at: day(2026, 7, 1), kind: "born", label: "world is born (V2)" },
  { at: day(2026, 9, 14), kind: "born", label: "ui is born" },
]

export interface DossierFixture {
  quest: string
  ledger: Ledger
  model: string
  files: FilePlace[]
  transcript: TranscriptLine[]
}

/** Artisan II, the query smith: in `plea` it waits on `bun run migrate`. */
function smith(waiting: boolean): DossierFixture {
  return {
    quest: "Query: keyset pagination on (created_at, id)",
    ledger: { tokens: 18_420, cost: 0.031, deeds: 3, ms: 9_400 },
    model: "claude-opus-5-5",
    files: [
      { path: "src/users/queries.ts", place: "Mine", deeds: 2 },
      { path: "migrations/0042_users_created_at_idx.sql", place: "Harbour", deeds: 1 },
    ],
    transcript: [
      { kind: "prompt", key: "p", first: true, text: "Query: keyset pagination on (created_at, id)" },
      { kind: "tool", key: "t1", name: "read", target: "users/queries.ts", state: "completed" },
      {
        kind: "thinking",
        key: "k1",
        text: "findUsers returns every row. Keyset on (created_at, id), and an index to back it.",
      },
      {
        kind: "tool",
        key: "t2",
        name: "edit",
        target: "users/queries.ts",
        state: "completed",
        note: "+18 −4",
      },
      {
        kind: "tool",
        key: "t3",
        name: "write",
        target: "migrations/0042_users_created_at_idx.sql",
        state: "completed",
      },
      waiting
        ? {
            kind: "tool",
            key: "t4",
            name: "bash",
            target: "bun run migrate",
            state: "pending",
            note: "Waiting for permission to run",
          }
        : { kind: "tool", key: "t4", name: "bash", target: "bun run migrate", state: "running" },
    ],
  }
}

/** The Warden: its verification failed. */
const VERIFIER: DossierFixture = {
  quest: "Verify against the contract",
  ledger: { tokens: 9_870, cost: 0.017, deeds: 2, ms: 9_100 },
  model: "claude-opus-5-5",
  files: [
    { path: "docs/plan/pagination.md", place: "Monastery", deeds: 1 },
    { path: "test/users.test.ts", place: "Camp", deeds: 1 },
  ],
  transcript: [
    { kind: "prompt", key: "p", first: true, text: "Verify against the contract" },
    { kind: "tool", key: "t1", name: "read", target: "plan/pagination.md", state: "completed" },
    {
      kind: "tool",
      key: "t2",
      name: "bash",
      target: "bun test users",
      state: "failed",
      note: "1 failed · exit 1",
    },
    { kind: "thinking", key: "k1", text: "Last page drops a row: limit + 1 lookahead is missing." },
    { kind: "reply", key: "r1", text: "FAIL: nextCursor skips the final row on exact page boundaries." },
  ],
}

export interface Fixture {
  name: string
  source: SourceState
  heroes: readonly HeroView[]
  parties: readonly PartyView[]
  log: readonly ChronicleEntry[]
  pleas: readonly PleaView[]
  places: number
  /** Session time now, ms. */
  time: number
  session: { end: number; live?: boolean; marks: readonly TimelineMarker[] }
  /** Where the history playhead stands. */
  historyAt: number
  historyUnavailable?: string
  dossiers: Readonly<Record<string, DossierFixture>>
  /** The hero the lab opens on with `?pick=1`. */
  pick: string | null
}

const busyDossiers = { query: smith(false), verifier: VERIFIER }

function crowd(): HeroView[] {
  const kinds = Object.keys(CAST) as (keyof typeof CAST)[]
  const out: HeroView[] = [
    cast("guildmaster", {
      id: "gm",
      master: true,
      phase: "working",
      doing: "task · Move sessions to Redis",
      party: "redis",
    }),
  ]
  for (let i = 0; i < 39; i++) {
    const who = kinds[1 + (i % (kinds.length - 1))] ?? "scout"
    const phase = i === 6 || i === 17 ? "waiting" : i === 11 ? "failed" : i % 4 === 0 ? "resting" : "working"
    out.push(
      cast(who, {
        id: `c${i}`,
        source: ["implementer", "explorer", "verifier", "librarian"][i % 4],
        ordinal: Math.floor(i / (kinds.length - 1)) + 1,
        phase,
        doing:
          phase === "waiting"
            ? "bash · redis-cli FLUSHDB"
            : phase === "resting"
              ? "quest done"
              : "edit · session/store.ts",
        party: i % 3 === 0 ? "pagination" : "redis",
      }),
    )
  }
  return out
}

export function fixture(state: LabState): Fixture {
  const base = {
    name: "Codestz/guildhall",
    parties: [PARTY],
    places: 14,
    historyAt: day(2025, 9, 30),
  }
  switch (state) {
    case "empty":
      return {
        ...base,
        source: { kind: "live", link: "connecting" },
        heroes: [],
        log: [],
        pleas: [],
        places: 0,
        time: 0,
        session: { end: 0, live: true, marks: [] },
        dossiers: {},
        pick: null,
      }
    case "busy":
      return {
        ...base,
        source: { kind: "replay", name: "party.jsonl" },
        heroes: BUSY_HEROES,
        log: BUSY_LOG,
        pleas: [],
        time: at(30),
        session: { end: at(67), marks: SESSION_MARKS },
        dossiers: busyDossiers,
        pick: "query",
      }
    case "plea": {
      const heroes = BUSY_HEROES.map((h) =>
        h.id === "query" ? { ...h, phase: "waiting" as const, doing: "bash · bun run migrate" } : h,
      )
      const waiting = heroes.find((h) => h.id === "query")
      return {
        ...base,
        source: { kind: "live", link: "connected", name: "Codestz/guildhall" },
        heroes,
        log: PLEA_LOG,
        pleas: waiting ? [{ hero: waiting, ask: "bash · bun run migrate" }] : [],
        time: at(38),
        session: { end: at(38), live: true, marks: SESSION_MARKS.filter((m) => m.at <= at(38)) },
        dossiers: { query: smith(true), verifier: VERIFIER },
        pick: "query",
      }
    }
    case "error": {
      const heroes = [
        ...BUSY_HEROES.map((h) =>
          h.id === "query" ? { ...h, phase: "resting" as const, doing: "quest done" } : h,
        ),
        cast("warden", {
          id: "verifier",
          source: "verifier",
          phase: "failed",
          doing: "bash · bun test users",
          place: "Camp",
          rank: "apprentice",
          party: "pagination",
        }),
      ]
      return {
        ...base,
        source: { kind: "live", link: "lost", name: "Codestz/guildhall" },
        heroes,
        log: ERROR_LOG,
        pleas: [],
        time: at(46),
        session: { end: at(52), live: true, marks: SESSION_MARKS.filter((m) => m.at <= at(52)) },
        historyUnavailable: "No history for this repo yet: the chronicle is still being read",
        dossiers: busyDossiers,
        pick: "verifier",
      }
    }
    case "crowd": {
      const heroes = crowd()
      return {
        ...base,
        source: { kind: "story", name: "rush · 40" },
        heroes,
        parties: [PARTY, REDIS],
        log: BUSY_LOG,
        pleas: heroes.filter((h) => h.phase === "waiting").map((hero) => ({ hero, ask: hero.doing })),
        time: at(30),
        session: { end: at(67), marks: SESSION_MARKS },
        dossiers: busyDossiers,
        pick: null,
      }
    }
  }
}

export const HISTORY_MARKERS = HISTORY_MARKS
