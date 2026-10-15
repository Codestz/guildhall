/**
 * The agents on the hex island (plan-hud-events.md L2): what draws them reads, an `AgentSource` (who
 * they are, where each is at a second of life's clock), made from a guild's events planned on the walk
 * graph (sim life: `planAgents`, in the build worker: lifePlan.ts).
 *
 * The demo is a StoryFeed preset: a little scripted guild (`demoStory`, the wire a real session sends)
 * that goes through the same pipe as a recorded or a live one (normalize → EventLog → itineraries).
 * Three heroes, a class each (decisions.md "Hex plan go": Claude = mage, Warden knight, Scout ranger),
 * with their banner colours: Claude, the Guildmaster, sends Warden to the tests (the camp) and Scout to
 * the assets (the harbour) and then the scripts (the mine), sits in the Guildhall's gathering while
 * they work, and once they are home goes to the app (the market) and the docs (the monastery) itself.
 * The script is told with sim's Script DSL (D1); a saga can stand in for it, the pipe stays.
 */
import type { GuildEvent } from "@guildhall/core"
import {
  type Adventurer,
  type AgentInfo,
  EventLog,
  type GuildWorld,
  type Itinerary,
  type PlannedAgents,
  poseAt,
  Script,
  toEvents,
  type WorldEvent,
} from "@guildhall/sim"
import type { HexWalk, HexZones, LifePose, ZoneKind } from "@guildhall/world"
import type { ChipView } from "./chips.ts"

/** How a hero is drawn: its banner and its body. */
export interface HeroLook {
  id: string
  name: string
  /** KayKit adventurer: mage, knight, ranger, barbarian, rogue (a catalog id). */
  hero: string
  /** The NPC recipe its props and clips come from (data/npcs). */
  recipe: string
  colour: string
}

/**
 * What life draws the agents from (L2): who they are, and where each is at `secs`, seconds on life's
 * agent clock (`?lifeT=` sets where it starts); null while one is not on the island.
 */
export interface AgentSource {
  list(): readonly HeroLook[]
  poseAt(id: string, secs: number): LifePose | null
  /** Grows when `list()` changes (a session's new heroes); a source without it never changes. */
  version?(): number
  /** Once a frame, before any pose (a source that plans as its session's log grows). */
  tick?(): void
  /**
   * The guild's world where the heroes are at `secs` and its clock there (ms), for their chips
   * (chips.ts: who they are, what they do and say); null when there is none yet.
   */
  worldAt?(secs: number): { world: GuildWorld; t: number } | null
  /** Its looks name and colour the heroes over the world (the demo's Claude, Warden and Scout). */
  ownNames?: boolean
  /** Hero `id`'s itinerary as planned (shots and probes read what it does when). */
  itinerary?(id: string): Itinerary | undefined
  /**
   * The chips' views at `secs` drawn from the source itself, not from a guild's world (the hall's
   * residents: residents.ts, who have no session to tell of); read like `worldAt`'s, a few times a second.
   */
  chipViews?(secs: number, walking: (id: string) => boolean): Map<string, ChipView>
}

/** Which agents the island shows (the job's spec): the demo story, or a recorded guild's wire. */
export type AgentFeed = { kind: "story" } | { kind: "wire"; name: string; wire: GuildEvent[] }

/**
 * A guild planned for life (lifePlan.ts): the cast, their itineraries, how long a round is (ms), and the
 * world events they were planned from (what the heroes' chips read).
 */
export type AgentPlan = PlannedAgents & { feed: AgentFeed["kind"]; period: number; events: WorldEvent[] }

/** The demo's heroes, in the story's join order: the bodies and banners they always had. */
export const DEMO_AGENTS: readonly HeroLook[] = [
  { id: "claude", name: "Claude", hero: "kaykit-adventurers/mage", recipe: "mage", colour: "#d97757" },
  { id: "warden", name: "Warden", hero: "kaykit-adventurers/knight", recipe: "guard", colour: "#4f7cc9" },
  { id: "scout", name: "Scout", hero: "kaykit-adventurers/ranger", recipe: "archer", colour: "#5f9e4a" },
]

/** The recipe each body's props and clips come from. */
const RECIPE: Readonly<Record<string, string>> = {
  mage: "mage",
  knight: "guard",
  ranger: "archer",
  barbarian: "smith",
  rogue: "merchant",
}

/** The recipe a body's heroes wear (their props and clips). */
export const recipeOf = (body: string): string => RECIPE[body] ?? "guard"

/**
 * How the cast's `k`th hero (in join order) is drawn: in the demo story, the demo's own look (Claude,
 * Warden, Scout: its banner and body, under the session's id); else by its body and its role's colour.
 */
export function lookOf(info: AgentInfo, k: number, feed: AgentFeed["kind"]): HeroLook {
  const demo = feed === "story" ? DEMO_AGENTS[k] : undefined
  if (demo) return { ...demo, id: info.id }
  return {
    id: info.id,
    name: info.name,
    hero: `kaykit-adventurers/${info.body}`,
    recipe: recipeOf(info.body),
    colour: info.color,
  }
}

/** The demo's folders and the places they are at on an island with no repo (the seed's own zones). */
export const DEMO_FOLDERS: Readonly<Record<string, ZoneKind>> = {
  app: "market",
  docs: "monastery",
  test: "camp",
  assets: "harbour",
  scripts: "mine",
}

const DEMO_ROOT = "/demo/guildhall"

/**
 * The demo's binding: a path's folder (`/demo/guildhall/test/…`) is the first place of its kind with a
 * way to it (as the old errands chose); none when the island has no such place.
 */
export function demoPlaceOf(
  z: HexZones,
  walk: Pick<HexWalk, "hearts">,
): (path: string) => number | undefined {
  const zoneOf = new Map<string, number>()
  for (const [folder, kind] of Object.entries(DEMO_FOLDERS)) {
    const zi = z.zones.findIndex((zz, i) => zz.kind === kind && (walk.hearts[i] ?? -1) >= 0)
    if (zi >= 0) zoneOf.set(folder, zi)
  }
  return (path) =>
    path.startsWith(`${DEMO_ROOT}/`)
      ? zoneOf.get(path.slice(DEMO_ROOT.length + 1).split("/")[0] ?? "")
      : undefined
}

/** The demo story's jitter seed (sim `Script`). */
const DEMO_SEED = 7

/** About `secs` of work on a folder's files: mostly edits, now and then a read, ~4 s each. */
function workOn(hero: Adventurer, folder: string, files: readonly string[], secs: number): void {
  const until = hero.clock + secs * 1000
  for (let k = 0; hero.clock < until; k++) {
    const filePath = `${DEMO_ROOT}/${folder}/${files[k % files.length]}`
    if (k % 3 === 2) hero.deed("read", { filePath }, 2500)
    else hero.deed("edit", { filePath, oldString: "…", newString: "…" }, 3500)
  }
}

/**
 * The demo story's wire, told with sim's Script DSL (stories/script.ts, D1): the Guildmaster sends two
 * subagents out together (the camp's tests; the harbour's assets, then the mine's scripts), waits for
 * both in the Guildhall, then works the market's app and the monastery's docs itself and finishes. Its
 * cast in join order is Claude, Warden, Scout (`DEMO_AGENTS`). A thin script: D1's saga can stand in.
 */
export function demoStory(): GuildEvent[] {
  const s = new Script(DEMO_SEED)
  const claude = s.guildmaster("Ship the harbour release", 0)
  const warden = claude.quest(
    "guild-tester",
    "Make the camp's tests pass",
    (w) => {
      workOn(w, "test", ["arena.test.ts", "drill.test.ts", "watch.test.ts"], 95)
      w.finish("The camp's tests pass.")
    },
    { wait: false },
  )
  claude.wait(1500)
  const scout = claude.quest(
    "explore",
    "Pack the harbour's assets",
    (sc) => {
      workOn(sc, "assets", ["sails.png", "ropes.glb", "map.json"], 70)
      workOn(sc, "scripts", ["pack.ts", "ship.ts"], 75)
      sc.finish("Packed and shipped.")
    },
    { wait: false },
  )
  claude.waitFor(warden, scout)
  workOn(claude, "app", ["market.tsx", "stall.tsx", "prices.ts"], 80)
  workOn(claude, "docs", ["guide.md", "harbour.md"], 75)
  claude.finish("The harbour release is out.")
  return toEvents(s.done(), "demo")
}

/**
 * The agents a page asks for: none with `?agents=0`, else the demo story. (A hall playing a session,
 * `?feed=`, draws that session's heroes instead: sessionAgents.ts.)
 */
export function agentFeedOf(param: string | null): Promise<AgentFeed | null> {
  return Promise.resolve(param === "0" ? null : { kind: "story" })
}

/** A planned guild on life's clock (seconds): it plays from its first event and loops every `period`. */
export function agentSource(plan: AgentPlan): AgentSource {
  const looks = plan.cast.map((info, k) => lookOf(info, k, plan.feed))
  const byId = new Map(plan.itineraries.map((it) => [it.id, it]))
  const [start] = plan.span
  const p = plan.period
  const at = (secs: number) => start + ((((secs * 1000) % p) + p) % p)
  // the log the plan was made from, folded here the first time a chip asks (checkpoints: a seek is cheap)
  let log: EventLog | null = null
  let folded = -1
  let world: GuildWorld | null = null
  return {
    list: () => looks,
    ownNames: plan.feed === "story",
    poseAt(id, secs) {
      const it = byId.get(id)
      return it ? poseAt(it, at(secs)) : null
    },
    worldAt(secs) {
      if (!plan.events?.length) return null
      if (!log) {
        log = new EventLog()
        log.append(...plan.events)
      }
      const t = at(secs)
      // the same events folded: the same world (so its readers know nothing changed)
      const n = log.countAt(t)
      if (n !== folded || !world) {
        folded = n
        world = log.stateAt(t)
      }
      return { world, t }
    },
  }
}
