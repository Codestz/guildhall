import { activityOf, type Craft, failedDeed, type Model, type Session } from "@guildhall/core"
import { type ArchetypeId, type DeedLook, deedLook, type Rank } from "@guildhall/roster"
import type { SiteId } from "../world/lands.ts"
import {
  HAND_INS,
  HEARTH,
  HEARTH_SEATS,
  hearthSeat,
  type Post,
  type Seat,
  STATIONS,
  type StationId,
  TAVERN,
} from "../world/layout.ts"
import { sitesOf } from "../world/siteMap.ts"
import { destinationOf, FATES, type Fates, SITE_DEFS, siteOf } from "../world/sites.ts"
import { type Names, namedOf, rankOf } from "./casting.ts"
import { Crowd } from "./crowd.ts"
import { type Entrance, EXIT_MS, entranceOf, exitOf } from "./entrances.ts"
import { numbered } from "./ordinals.ts"
import { byJoin, type Party, stageOf } from "./parties.ts"

/**
 * What each adventurer should be doing *now* (`AdventurerView`), derived from the model: pure, so
 * a replay, a seek and a live run all agree. The store (guild/store.ts) calls `viewsOf` on every
 * refresh; the scene only reads views, never raw changes.
 */

export type { Seat }

export type Phase = "working" | "waiting" | "loot" | "resting" | "leaving" | "idle" | "failed"

export interface AdventurerView {
  id: string
  /** OpenCode agent name (`guild-implementer`). */
  agent: string
  /** What the hall calls them: their archetype, numbered when it repeats (`Artisan II`; guild/casting.ts). */
  title: string
  /** The name never numbered (`Artisan`, or `Implementer` with source names). */
  role: string
  /** The source's own name under the title (`implementer`), or empty. */
  subtitle: string
  /** The sigil's two letters. */
  glyph: string
  /** `Artisans`. */
  plural: string
  /** What draws them (roster archetypes.ts): the HUD groups by it. */
  archetype: ArchetypeId
  /** How seasoned they are: gear, dye and the chip's pips (roster ranks.ts). */
  rank: Rank
  /** 1 for the first of a role in the party, 2 for the second to join, …; stable while the session lasts. */
  ordinal: number
  color: string
  /** Character model key (the archetype's). */
  character: string
  master: boolean
  phase: Phase
  /** Where they should be and which way they face there. The scene walks them to it. */
  target: Post
  /** What they sit or lie on when they get there. */
  seat?: Seat
  /** The station they are working at, when they are at one: lights its lamp. */
  station?: StationId
  /** The island job site they work at (ADR 0006), instead of a station. */
  site?: SiteId
  /**
   * A repo island's district they work in (world/districtWork.ts; the townsfolk, ADR 0013): its own
   * posts, with `site` the trade they work there.
   */
  district?: string
  /** Failed: where they were sent (a key of world/sites.ts `DESTINATIONS`). */
  destination?: string
  /** The deed in progress, if any. */
  look?: DeedLook
  /** Its tool name, as the host spells it. */
  tool?: string
  /** What the deed in progress means (@guildhall/core `deedCraft`): what every surface shows it by. */
  craft?: Craft
  thinking: boolean
  /** One line under the name: `edit · routes.ts`. */
  doing: string
  /** Speech or thought, when there is something to say. */
  bubble?: string
  /** A deed just failed: stumble + red puff. */
  stung: boolean
  /** Their party: its guildmaster's (root) session id ("" with no root heard of). */
  party: string
  /** Their party's banner colour (guild/parties.ts BANNERS). */
  banner: string
  /**
   * A newcomer who joined as the hall watched (not one rebuilt by a seek or a load): where they
   * appear and how. Read once, when their figure mounts (scene/Adventurer.tsx).
   */
  enter?: Entrance
}

const LOOT_MS = 3500
/** Done adventurers rest in the tavern this long (run time) before leaving by the gate. */
const REST_MS = 22_000
/** A finished subagent leaves the stage (its `leave` moment) this long after it ended. */
export const GONE_MS = 27_000

/**
 * The newest party (guild/parties.ts): the most recently active root and everyone under it — what
 * the hall showed before several parties shared the island. With no root at all, every session.
 */
export function partyOf(model: Model): Session[] {
  return stageOf(model, Number.POSITIVE_INFINITY).find((p) => p.newest)?.sessions ?? []
}

/**
 * Everyone on stage right now, and where they belong. `fates` says where failures go; `stage` is
 * the parties on the island (guild/parties.ts), each with its guildmaster at its own seat. Posts at
 * the shared sites and stations are handed out across all parties in join order, so a party that
 * arrives later never moves anyone already working.
 *
 * Given the `previous` views, an adventurer whose view is unchanged (every field equal, posts and
 * looks compared by value) gets back the very same object: the scene can memo by reference, and
 * re-renders only those who changed. Views are never mutated after they are made.
 */
export function viewsOf(
  model: Model,
  now: number,
  fates: Fates = FATES,
  stage: readonly Party[] = stageOf(model, now),
  entering: ReadonlySet<string> = NO_ONE,
  previous: readonly AdventurerView[] = [],
  names: Names = "world",
): AdventurerView[] {
  const partyOfId = new Map<string, Party>()
  for (const party of stage) for (const s of party.sessions) partyOfId.set(s.id, party)
  const sessions = stage.flatMap((party) => party.sessions).sort(byJoin)
  /** How many of each role have joined each party so far: counted before anyone leaves, so numbers never shift. */
  const joined = new Map<string, number>()
  const taken = new Map<StationId, number>()
  let stools = 0
  let floor = 0
  /** How many have been sent to each failure destination so far. */
  const sent = new Map<string, number>()
  const atSite = new Map<SiteId, number>()
  /** Whoever rests or lies past a place's own seats takes free floor round it (guild/crowd.ts). */
  const crowd = new Crowd()
  const views: AdventurerView[] = []

  for (const s of sessions) {
    const party = partyOfId.get(s.id) as Party
    const isMaster = s === party.root
    // The root session is the guildmaster whatever agent runs it (OpenCode's `build`, a user's own).
    const named = namedOf(s, names, isMaster)
    const { archetype } = named
    const counted = `${party.id}\u0000${named.name}`
    const ordinal = (joined.get(counted) ?? 0) + 1
    joined.set(counted, ordinal)
    const activity = activityOf(s)
    const since = s.ended !== undefined ? now - s.ended : 0
    // Gone (GONE_MS, the `leave` moment) is through the gate; the walk down the avenue and the
    // dissolve take EXIT_MS more before the stage lets them go.
    if (!isMaster && s.status === "done" && since > GONE_MS + EXIT_MS) continue

    const running = activity.kind === "tool" ? activity.tool : undefined
    const craft = activity.kind === "tool" ? activity.craft : undefined
    const look = craft ? deedLook(craft) : undefined
    const lastTool = s.entries.findLast((entry) => entry.kind === "tool")
    const stung = lastTool?.kind === "tool" && failedDeed(lastTool) && now - (lastTool.ended ?? 0) < 1400

    let phase: Phase = "working"
    let target: Post
    let station: StationId | undefined
    let site: SiteId | undefined
    let seat: Seat | undefined
    let destination: string | undefined
    const home = isMaster ? undefined : archetype.site
    const dais = SEAT_POSTS[party.seat] ?? MASTER_POST
    if (isMaster && party.leaving) {
      // The party goes home: its guildmaster walks out through the gate and down the avenue.
      phase = "leaving"
      target = exitOf(s.id)
    } else if (isMaster) {
      station = "quest-board"
      target = dais
      phase = s.status === "done" ? "idle" : s.status === "waiting" ? "waiting" : "working"
    } else if (s.status === "done") {
      if (since < LOOT_MS) {
        phase = "loot"
        target = HAND_INS[party.seat] ?? HAND_INS[0] ?? dais
      } else if (since < REST_MS) {
        phase = "resting"
        const stool = TAVERN[stools++]
        seat = stool ? "stool" : "floor"
        target = stool ?? (floor < HEARTH_SEATS ? hearthSeat(floor++) : crowd.near(HEARTH))
      } else {
        phase = "leaving"
        target = exitOf(s.id)
      }
    } else if (s.status === "failed") {
      phase = "failed"
      // The destination says where (the infirmary: beds first, then bedrolls on the floor).
      const sessionOf = (id: string) => model.sessions.get(id)
      const to = destinationOf({ session: s, now, sessionOf }, fates)
      const place = fates.destinations[to]
      const n = sent.get(to) ?? 0
      sent.set(to, n + 1)
      const berth = place?.berth(n)
      destination = to
      seat = berth?.seat
      target = berth?.target ?? (place?.crowd ? crowd.near(place.crowd) : MASTER_POST)
    } else if (home) {
      // Island workers stay at their site for the whole quest: no jogging back on every deed.
      site = home
      phase = s.status === "waiting" ? "waiting" : "working"
      const n = atSite.get(home) ?? 0
      atSite.set(home, n + 1)
      // The site's posts on the island drawn now (world/siteMap.ts: a repo's districts, or the hand map's).
      const posts = sitesOf()[home].posts
      // Past the posts they share them: the scene sets each extra worker beside the post's first
      // (scene/activity.ts reserve, world/behaviours.ts shifted), routine and all.
      target = posts[n % posts.length] ?? MASTER_POST
    } else if (look?.goTo === "quest-board") {
      // A quest of their own: sent from their party's place at the board.
      station = look.goTo
      target = dais
    } else if (look?.goTo) {
      station = look.goTo
      const posts = STATIONS[look.goTo].posts
      target = posts[posts.length - 1] ?? MASTER_POST
    } else {
      phase = s.status === "waiting" ? "waiting" : "working"
      station = archetype.station
      target = postAt(archetype.station, taken)
    }

    views.push({
      id: s.id,
      agent: s.agent,
      title: numbered(named.name, ordinal),
      role: named.name,
      subtitle: named.subtitle,
      glyph: named.glyph,
      plural: named.plural,
      archetype: archetype.id,
      rank: rankOf(s),
      ordinal,
      color: archetype.color,
      character: archetype.model,
      master: isMaster,
      phase,
      target,
      ...(station ? { station } : {}),
      ...(site ? { site } : {}),
      ...(destination ? { destination } : {}),
      ...(seat ? { seat } : {}),
      ...(look ? { look } : {}),
      ...(running ? { tool: running } : {}),
      ...(craft ? { craft } : {}),
      thinking: activity.kind === "thinking",
      doing: doingOf(s, activity.kind, activity.tool, activity.text),
      ...bubbleOf(s, activity.kind, now),
      stung,
      party: party.id,
      banner: party.color,
      ...(entering.has(s.id) ? { enter: entranceOf(s.id, party, isMaster) } : {}),
    })
  }
  return previous.length > 0 ? kept(previous, views) : views
}

const NO_ONE: ReadonlySet<string> = new Set()

/** `views`, with each one equal to its previous view swapped for that (see `viewsOf`). */
function kept(previous: readonly AdventurerView[], views: AdventurerView[]): AdventurerView[] {
  const before = new Map(previous.map((view) => [view.id, view]))
  for (let i = 0; i < views.length; i++) {
    const view = views[i] as AdventurerView
    const was = before.get(view.id)
    if (was && same(was, view)) views[i] = was
  }
  return views
}

/** Equal by value: views are plain data (strings, numbers, booleans, posts, looks, entrances). */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  for (const key of keys)
    if (!same((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) return false
  return true
}

/** Completed deeds that grow a site's building (the yard's: edits and writes). */
export function progressOf(sessions: Iterable<Session>): number {
  let done = 0
  for (const s of sessions) {
    const site = siteOf(s.agent, s.archetype)
    const builds = site && SITE_DEFS[site].builds
    if (!builds) continue
    for (const entry of s.entries)
      if (entry.kind === "tool" && entry.state === "completed" && builds.has(entry.name)) done++
  }
  return done
}

const MASTER_POST: Post = STATIONS["quest-board"].posts[0] ?? [0, -7.4, 0]
/** Each party's guildmaster's place: the dais, then the seats beside it (guild/parties.ts). */
const SEAT_POSTS: readonly Post[] = STATIONS["quest-board"].posts

/**
 * A station's next free post, then the overflow bench's; past those they share the bench's posts,
 * and the scene sets each beside the post's first (as at a site).
 */
function postAt(id: StationId, taken: Map<StationId, number>): Post {
  const n = taken.get(id) ?? 0
  const posts = STATIONS[id].posts
  const post = posts[n]
  if (post) {
    taken.set(id, n + 1)
    return post
  }
  const overflow = taken.get("overflow") ?? 0
  taken.set("overflow", overflow + 1)
  const extra = STATIONS.overflow.posts
  return extra[overflow % extra.length] ?? MASTER_POST
}

function doingOf(s: Session, kind: string, tool: string | undefined, text: string): string {
  if (kind === "tool" && tool) return text ? `${tool} · ${shorten(text, 28)}` : tool
  if (kind === "done") return s.parentID ? "quest done" : "resting"
  return text
}

function bubbleOf(s: Session, kind: string, now: number): { bubble?: string } {
  if (kind === "thinking") {
    const thought = s.entries.findLast((entry) => entry.kind === "thinking")
    return { bubble: thought?.kind === "thinking" && thought.text ? shorten(thought.text, 70) : "…" }
  }
  const reply = s.entries.findLast((entry) => entry.kind === "reply")
  if (reply?.kind === "reply" && reply.done && now - reply.at < 3500)
    return { bubble: shorten(reply.text, 80) }
  return {}
}

export function shorten(text: string, max: number): string {
  const line = text.replace(/\s+/g, " ").trim()
  const base = line.split("/").at(-1) ?? line
  const picked = line.includes("/") && !line.includes(" ") ? base : line
  return picked.length > max ? `${picked.slice(0, max - 1)}…` : picked
}
