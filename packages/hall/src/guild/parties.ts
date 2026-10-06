import { type Model, rootOf, type Session } from "@guildhall/core"

/**
 * Parties (roadmap "The harness phase", many conversations at once): every OpenCode conversation
 * (a root session and everyone it sent) is a party, and up to MAX_PARTIES of them share the island,
 * each with its own guildmaster, banner and seat by the quest board. Pure: the same model and clock
 * give the same stage, so a seek lands where playing through would (test/parties.test.ts).
 *
 *   stage      which parties are on the island now, at most MAX_PARTIES: the newest always, then
 *              the working ones in start order (sticky: a newcomer waits for a slot), then idle
 *              ones by recency. A party other than the newest that has been idle
 *              (everyone done) PARTY_IDLE_MS walks home through the gate and is gone PARTY_LEAVE_MS
 *              later.
 *   banner     a colour per party, kept for its whole stay; the first party gets the first banner.
 *   seat       where its guildmaster stands: 0 is the dais, 1 and 2 beside it.
 *   name       a short name from the quest: `Add cursor pagination to GET /users` → `Pagination`.
 *
 * Banners and seats are handed out by replaying the parties' arrivals in start order: each takes
 * the lowest one free when it starts, freed when a party before it had gone home. Only the latest
 * state of each session is known, so a party that comes back after going home is treated as if it
 * never left: in that rare case a party that arrived meanwhile may change seat or banner.
 */

/** At most this many parties on the island at once. */
export const MAX_PARTIES = 3
/** A party other than the newest, idle this long (run time), walks home through the gate. */
export const PARTY_IDLE_MS = 90_000
/** Its guildmaster's walk home: gone from the stage this long after setting out. */
export const PARTY_LEAVE_MS = 14_000
/** A party not heard from this long counts as idle even if it never said it ended (a crashed run). */
export const PARTY_STALE_MS = 10 * 60_000
/** A party idle less than this still holds the island for its guild (OpenCode project). */
export const GUILD_HOLD_MS = 30_000
/** A guildmaster who arrives beside another party this recently walks in from the gate. */
export const ARRIVE_MS = 12_000

/**
 * Banner colours, heraldic and far from each other: the first three are the ones a full island
 * shows. They sit on dark ink plaques and in the world, so each keeps ≥ 3:1 against the ink.
 * Always paired with the party's name and its numeral (never colour alone).
 */
export const BANNERS: readonly { color: string; label: string }[] = [
  { color: "#e0525a", label: "Crimson" },
  { color: "#efe7d2", label: "Ivory" },
  { color: "#4d86f0", label: "Azure" },
  { color: "#3dbb6e", label: "Vert" },
  { color: "#f0a030", label: "Amber" },
  { color: "#b07af0", label: "Purpure" },
]

/** Seats by the quest board (layout.ts STATIONS["quest-board"].posts): the dais, then beside it. */
export const SEATS = 3

export interface Party {
  /** The guildmaster's (root) session id; "" for the rootless crowd (no root heard of yet). */
  id: string
  root: Session | undefined
  /** Everyone in it, in join order. */
  sessions: Session[]
  /** Short name from the quest (`Pagination`), unique on the stage. */
  name: string
  /** Index into BANNERS. */
  banner: number
  color: string
  /** 0 the dais, 1 and 2 beside it. */
  seat: number
  /** When anyone in it was last heard of (`seen`). */
  last: number
  /** When everyone in it went idle, while they are; undefined while anyone works. */
  idleSince: number | undefined
  /** Walking home through the gate. */
  leaving: boolean
  /** Its guildmaster has just arrived beside another party: they walk in from the gate. */
  arriving: boolean
  /** The newest party (the one the hall followed before there were several). */
  newest: boolean
}

/** Join order: start time, then id, so two sessions started in the same millisecond keep one order. */
export function byJoin(a: Session, b: Session): number {
  return a.started - b.started || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

const working = (s: Session) => s.status === "starting" || s.status === "running" || s.status === "waiting"

interface Tree {
  root: Session
  sessions: Session[]
  last: number
  idleSince: number | undefined
}

/**
 * Every party the model knows, newest root last, with when it was last heard of and since when idle.
 * `orphans` gets the sessions whose root was never heard of (a hub restarted after it began).
 */
function treesOf(model: Model, now: number, orphans: Session[] = []): Tree[] {
  const trees = new Map<string, Tree>()
  for (const s of model.sessions.values())
    if (!s.parentID) trees.set(s.id, { root: s, sessions: [], last: 0, idleSince: undefined })
  for (const s of model.sessions.values()) {
    const tree = trees.get(s.parentID ? rootOf(model, s.id) : s.id)
    if (tree) tree.sessions.push(s)
    else orphans.push(s)
  }
  for (const tree of trees.values()) {
    tree.sessions.sort(byJoin)
    let last = 0
    let ended = 0
    let busy = false
    for (const s of tree.sessions) {
      last = Math.max(last, s.seen)
      ended = Math.max(ended, s.ended ?? s.seen)
      if (working(s)) busy = true
    }
    tree.last = last
    tree.idleSince = !busy ? ended : now - last > PARTY_STALE_MS ? last : undefined
  }
  return [...trees.values()].sort((a, b) => byJoin(a.root, b.root))
}

/**
 * The parties on the island now, in seat order (the dais first). With no root session at all,
 * one rootless party of everyone (an orphan stream: the hall still shows what it heard).
 *
 * `guildOf` says which guild (OpenCode project) a session was heard from, when known (live): only
 * the newest party's guild is on the island — other projects' backlog stays off it (one island per
 * project is the archipelago, later).
 */
export function stageOf(model: Model, now: number, guildOf?: (id: string) => string | undefined): Party[] {
  const orphans: Session[] = []
  let trees = treesOf(model, now, orphans)
  if (trees.length === 0) {
    if (model.sessions.size === 0) return []
    const sessions = [...model.sessions.values()].sort(byJoin)
    return [
      {
        id: "",
        root: undefined,
        sessions,
        name: "",
        banner: 0,
        color: BANNERS[0]?.color ?? "#e0525a",
        seat: 0,
        last: Math.max(...sessions.map((s) => s.seen)),
        idleSince: undefined,
        leaving: false,
        arriving: false,
        newest: true,
      },
    ]
  }
  // Sticky, not by recency (review-2 #8: four busy conversations, or two busy projects, reshuffled
  // the island about once a second). The island's guild is the guild of the latest-started party
  // still holding (working, or idle less than GUILD_HOLD_MS): a conversation opened in another
  // project takes the island once, and the island goes back only after that one has been quiet for
  // GUILD_HOLD_MS while the other works on. With nobody holding, the most recently active party's.
  const recent = (list: readonly Tree[]) =>
    list.reduce((best, t) => (t.last > best.last || t.last === best.last ? t : best))
  const holding = (t: Tree) => t.idleSince === undefined || now - t.idleSince < GUILD_HOLD_MS
  const anchor = trees.findLast(holding) ?? recent(trees)
  const guild = guildOf?.(anchor.root.id)
  if (guild !== undefined) trees = trees.filter((t) => guildOf?.(t.root.id) === guild)
  // On stage, working parties first by start (those already here keep their place: a newcomer waits
  // for one of them to go idle), then idle ones by recency (a newcomer replaces only those).
  const busy = trees.filter((t) => t.idleSince === undefined).slice(0, MAX_PARTIES)
  // The newest: the latest-started working party on stage; with nobody working, the most recently
  // active (the one the single-party hall followed). It never goes home.
  const newest = busy.at(-1) ?? recent(trees)
  const endOf = (t: Tree) =>
    t === newest || t.idleSince === undefined
      ? Number.POSITIVE_INFINITY
      : t.idleSince + PARTY_IDLE_MS + PARTY_LEAVE_MS
  // Arrivals in start order: each takes the lowest free banner and seat.
  const banners = new Map<Tree, number>()
  const seats = new Map<Tree, number>()
  const present: Tree[] = []
  for (const t of trees) {
    for (let i = present.length - 1; i >= 0; i--)
      if (endOf(present[i] as Tree) <= t.root.started) present.splice(i, 1)
    banners.set(
      t,
      lowestFree(
        present.map((p) => banners.get(p) ?? 0),
        BANNERS.length,
      ),
    )
    seats.set(
      t,
      lowestFree(
        present.map((p) => seats.get(p) ?? 0),
        SEATS,
      ),
    )
    present.push(t)
  }

  // On stage: the newest, then the working by start, then whoever else is still here by recency.
  const rank = (t: Tree) => (t === newest ? 0 : t.idleSince === undefined ? 1 : 2)
  const here = trees
    .filter((t) => t === newest || now < endOf(t))
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (rank(a) === 1 ? byJoin(a.root, b.root) : b.last - a.last || byJoin(b.root, a.root)),
    )
    .slice(0, MAX_PARTIES)

  // Seats and banners unique on the stage (a rare crowding can collide): older parties keep theirs.
  here.sort((a, b) => byJoin(a.root, b.root))
  const seatTaken = new Set<number>()
  const bannerTaken = new Set<number>()
  const parties: Party[] = here.map((t) => {
    let seat = seats.get(t) ?? 0
    if (seatTaken.has(seat)) seat = lowestFree([...seatTaken], SEATS)
    seatTaken.add(seat)
    let banner = banners.get(t) ?? 0
    if (bannerTaken.has(banner)) banner = lowestFree([...bannerTaken], BANNERS.length)
    bannerTaken.add(banner)
    const leaving = t !== newest && t.idleSince !== undefined && now - t.idleSince >= PARTY_IDLE_MS
    return {
      id: t.root.id,
      root: t.root,
      sessions: t.sessions,
      name: "",
      banner,
      color: BANNERS[banner]?.color ?? "#e0525a",
      seat,
      last: t.last,
      idleSince: t.idleSince,
      leaving,
      arriving: false,
      newest: t === newest,
    }
  })
  // Subagents whose root was never heard of (review-2 #21: they were dropped whenever any root was
  // known) gather as the rootless crowd, when the island has room and they are of its guild.
  const crowd = orphans
    .filter((s) => guild === undefined || guildOf?.(s.id) === guild)
    .filter((s) => working(s) || now - s.seen < PARTY_IDLE_MS)
    .sort(byJoin)
  if (crowd.length > 0 && parties.length < MAX_PARTIES) {
    const seat = lowestFree(
      parties.map((p) => p.seat),
      SEATS,
    )
    const banner = lowestFree(
      parties.map((p) => p.banner),
      BANNERS.length,
    )
    parties.push({
      id: "",
      root: undefined,
      sessions: crowd,
      name: "",
      banner,
      color: BANNERS[banner]?.color ?? "#e0525a",
      seat,
      last: Math.max(...crowd.map((s) => s.seen)),
      idleSince: undefined,
      leaving: false,
      arriving: false,
      newest: false,
    })
  }
  // Alone on the island, a party keeps its seat (review-2 #14: forcing it onto the dais moved it
  // there and back as others came and went); one that arrived alone has the dais anyway.
  if (parties.length > 1) for (const p of parties) p.arriving = now - (p.root?.started ?? 0) < ARRIVE_MS
  nameAll(parties)
  return parties.sort((a, b) => a.seat - b.seat)
}

function lowestFree(taken: readonly number[], size: number): number {
  for (let i = 0; i < size; i++) if (!taken.includes(i)) return i
  return taken.length % size
}

// ───────────────────────────── names ─────────────────────────────

/** Words that open a request without saying what it is about. */
const LEAD = new Set(
  "add fix make build create implement update refactor write sweep improve remove delete rename move check debug investigate review help please can could would you i we let lets let's the a an our my some new get set up do go try use run find look explore plan design migrate port clean tidy speed support handle".split(
    " ",
  ),
)
/** Words that end the subject: `pagination` **to** GET /users. */
const STOP = new Set(
  "to for in on of with from into at by so that and but when then across via about over under is are be it this".split(
    " ",
  ),
)
/** A last word too plain to stand alone: `timezone bug`, not `bug`. */
const PLAIN = new Set(
  "bug bugs issue issues error errors problem problems feature features page pages test tests flow flows thing things stuff module modules code file files api endpoint endpoints quests quest work store stores service services system layer handler model table cache client server job script config".split(
    " ",
  ),
)
/** OpenCode's placeholder title before a conversation is named. */
const UNTITLED = /^(new session|untitled|session)\b/i

/**
 * A party's short name from what it was asked: the subject of the request, one or two words.
 * `Add cursor pagination to GET /users` → `Pagination`; `Fix the timezone bug in formatDate` →
 * `Timezone bug`; `Sweep the repo: 12 parallel quests` → `Repo`. Empty when nothing fits.
 */
export function partyNameOf(text: string | undefined): string {
  if (!text) return ""
  const head = text.split(/[\n:.;!?—–(]/)[0] ?? ""
  const words = head
    .replace(/[^\p{L}\p{N}\s'/-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
  let i = 0
  while (i < words.length && LEAD.has((words[i] ?? "").toLowerCase())) i++
  const phrase: string[] = []
  for (; i < words.length; i++) {
    const word = words[i] ?? ""
    const lower = word.toLowerCase()
    if (STOP.has(lower)) {
      if (phrase.length > 0) break
      continue
    }
    if (/^\d+$/.test(word) || word.includes("/")) {
      if (phrase.length > 0) break
      continue
    }
    phrase.push(word)
    if (phrase.length === 3) break
  }
  if (phrase.length === 0) return ""
  const last = phrase.at(-1) ?? ""
  const picked = PLAIN.has(last.toLowerCase()) && phrase.length > 1 ? phrase.slice(-2) : [last]
  const name = picked.join(" ")
  const short = name.length > 22 ? `${name.slice(0, 21)}…` : name
  // Keep a word's own capitals (formatDate, OAuth); otherwise capitalise the first letter.
  return short.charAt(0).toUpperCase() + short.slice(1)
}

/** What a party is about: OpenCode's title once it has named the conversation, else the first prompt. */
function aboutOf(root: Session | undefined): string | undefined {
  if (!root) return undefined
  const title = root.title.replace(/ \(@.*\)$/, "").trim()
  return title && !UNTITLED.test(title) ? title : (root.task ?? title)
}

/** Names every party, unique on the stage: a repeat gets its banner's numeral (`Pagination II`). */
function nameAll(parties: Party[]): void {
  const seen = new Map<string, number>()
  const joined = (a: Party, b: Party) =>
    a.root && b.root ? byJoin(a.root, b.root) : a.root ? -1 : b.root ? 1 : 0
  for (const p of [...parties].sort(joined)) {
    const base = partyNameOf(aboutOf(p.root)) || `Party ${ROMAN[p.banner] ?? p.banner + 1}`
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    p.name = n > 1 ? `${base} ${ROMAN[n - 1] ?? n}` : base
  }
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"]

/** The party's numeral (I, II, III), by seat: what the key and the chips print beside the banner. */
export function numeralOf(seat: number): string {
  return ROMAN[seat] ?? String(seat + 1)
}
