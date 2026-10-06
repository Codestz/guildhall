import type { Session } from "@guildhall/core"
import { roleOf } from "@guildhall/roster"
import { type Behaviour, SITE_WORK } from "./behaviours.ts"
import type { Piece } from "./furniture.ts"
import { SITES, type Site, type SiteId } from "./lands.ts"
import { INFIRMARY, INFIRMARY_MATS, type Post, type Seat } from "./layout.ts"
import type { Mix } from "./wilds.ts"

/**
 * The site registry (ADR 0008): every fact about a job site that code used to switch on, as data.
 * Where a site is (its spot, posts and landmark) is map data in `lands.ts` `SITES`; this adds what
 * happens there. Everything that varies by site reads it: the work loop and gear (scene/Adventurer), the
 * traces (scene/life/traces), the machines (scene/life/state), the yard's growth (guild/store) and
 * the wilds (world/wilds).
 *
 * Adding a site: an id in `SiteId`, its map entry in `SITES` (spot, posts, landmark — its art), and
 * its entry here; the compiler asks for each. Which roles go there is the roster's (`Role.site`).
 */

/** Trace piles (scene/life/traces.ts `Traces`). */
export type Pile = "logs" | "stones" | "fish" | "books" | "hits" | "misses"
/** Life-layer machines a site's workers keep running (scene/life/state.ts). */
export type Machine = "forging" | "sawing" | "fishing"

export interface SiteDef extends Site {
  /**
   * The work loop its adventurers run while their session is busy, thinking or calling tools
   * (world/behaviours.ts `SITE_WORK`, ADR 0009): the site sets the trade, a deed steers it.
   */
  work: Behaviour
  /** Tools of the trade, held instead of the role's own gear while working here. */
  gear?: { right?: Piece; left?: Piece }
  /**
   * What finished work leaves here: a `pile` item per completed deed of `tools` (`true`: every
   * tool), and a `missed` item per failed deed when set.
   */
  trace?: { pile: Pile; tools: ReadonlySet<string> | true; missed?: Pile }
  /** The landmark machine its working adventurers run. */
  machine?: Machine
  /** Completed tools that grow the site's building (the yard: `progress`). */
  builds?: ReadonlySet<string>
  /** What grows round it (world/wilds.ts); trees are dead ones when `barren`. */
  wilds: { mix: Mix; barren?: boolean }
}

export const SITE_DEFS: Record<SiteId, SiteDef> = {
  yard: {
    ...SITES.yard,
    work: SITE_WORK.yard,
    machine: "forging",
    builds: new Set(["edit", "write"]),
    wilds: { mix: { bush: 0.4, grass: 0.35, rock: 0.25 } },
  },
  forest: {
    ...SITES.forest,
    work: SITE_WORK.forest,
    gear: { right: "axe" },
    trace: { pile: "logs", tools: new Set(["grep", "glob", "list"]) },
    machine: "sawing",
    wilds: { mix: { tree: 0.45, bush: 0.35, grass: 0.2 } },
  },
  river: {
    ...SITES.river,
    work: SITE_WORK.river,
    // Both hands for the rod (the routine's own tool).
    gear: {},
    trace: { pile: "fish", tools: new Set(["webfetch", "websearch"]) },
    machine: "fishing",
    wilds: { mix: { bush: 0.35, grass: 0.45, rock: 0.2 } },
  },
  proving: {
    ...SITES.proving,
    work: SITE_WORK.proving,
    // The bow is the routine's own tool, in the left hand; the right draws the string.
    gear: {},
    trace: { pile: "hits", tools: new Set(["bash", "shell"]), missed: "misses" },
    wilds: { mix: { bush: 0.45, grass: 0.4, tree: 0.15 } },
  },
  quarry: {
    ...SITES.quarry,
    work: SITE_WORK.quarry,
    gear: { right: "pickaxe" },
    trace: { pile: "stones", tools: true },
    wilds: { mix: { rock: 0.6, grass: 0.25, tree: 0.15 }, barren: true },
  },
  tower: {
    ...SITES.tower,
    work: SITE_WORK.tower,
    trace: { pile: "books", tools: true },
    wilds: { mix: { tree: 0.35, rock: 0.3, grass: 0.35 }, barren: true },
  },
}

/**
 * The site an agent works at for a quest (ADR 0006: chosen once per quest, by role). The roster
 * says (`Role.site`); agents it does not know work the quarry, the keep's roles none.
 */
export function siteOf(agent: string): SiteId | undefined {
  return roleOf(agent).site
}

// ---- Failure destinations ------------------------------------------------------------------------

/** Where a failed adventurer is sent, and how they lie there. */
export interface Destination {
  label: string
  /** The n-th adventurer sent here (0-based, in join order): where they go and on what. */
  berth(n: number): { target: Post | undefined; seat?: Seat }
  /** What they play once there. */
  clip: string
}

/** What a failure rule may look at. */
export interface Failure {
  session: Session
  /** The model's clock, ms since the epoch (the store's `now`). */
  now: number
  sessionOf(id: string): Session | undefined
}

/** Sends the failures it matches to `to`. */
export interface FailureRule {
  /** A key of `Fates.destinations`. */
  to: string
  when(failure: Failure): boolean
}

export const DESTINATIONS: Record<string, Destination> = {
  /** The keep's infirmary: beds first, then bedrolls on the floor; past that they share. */
  infirmary: {
    label: "Infirmary",
    berth: (n) =>
      n < INFIRMARY.length
        ? { target: INFIRMARY[n], seat: "bed" }
        : { target: INFIRMARY_MATS[(n - INFIRMARY.length) % INFIRMARY_MATS.length], seat: "floor" },
    clip: "Lie_Idle",
  },
}

/** Where failures go: the first matching rule wins, else `fallback`. */
export interface Fates {
  destinations: Record<string, Destination>
  rules: readonly FailureRule[]
  /** A key of `destinations`. */
  fallback: string
}

/**
 * Today every failure goes to the infirmary. A graveyard plugs in as a destination plus a rule, e.g.
 * `{ to: "graveyard", when: ({ session, now }) => now - session.started > 10 * 60_000 }`.
 */
export const FATES: Fates = { destinations: DESTINATIONS, rules: [], fallback: "infirmary" }

export function destinationOf(failure: Failure, fates: Fates = FATES): string {
  return fates.rules.find((rule) => rule.when(failure))?.to ?? fates.fallback
}
