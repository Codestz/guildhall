import type { HudMode } from "../hud/prefs.ts"
import { activeWorld } from "../world/active.ts"
import { parseRepo } from "../world/gen/fetch.ts"
import { GRAVEYARD_PLOT, type LandmarkKind } from "../world/lands.ts"
import { sitesOf } from "../world/siteMap.ts"
import { HOME_ISLAND, showIsland } from "../world/source.ts"
import { handWorld, reachOf, type World } from "../world/world.ts"
import type { Place } from "./director.ts"
import type { Weather } from "./environment.ts"
import { EVENT_KINDS, type EventKind } from "./events.ts"
import type { Tier } from "./quality.ts"
import { RUSH, SCENARIOS, type ScenarioId } from "./store.ts"

/**
 * Deep links: the hall's state from the URL, so an exact moment can be shared, recorded or probed.
 *
 *   ?story=saga&t=11:53&hour=23&weather=clear&look=quarry&hud=hidden&paused=1
 *
 *   story    party | solo | rush | parties | factions | saga | seas
 *   t        mm:ss, a seek into the story (with `act`: counted from that act's start)
 *   act      1–5, a Saga chapter (implies story=saga when no story is given)
 *   n        1–500, how many adventurers `rush` sends out (only with story=rush; 12 without it)
 *   hour     0–24 (decimals allowed), a fixed time of day
 *   weather  clear | cloudy | rain | storm | snow
 *   quality  0–3 (Low, Medium, High, Ultra), for this visit only (not remembered)
 *   hud      minimal | detailed | hidden (`off` is hidden), for this visit only
 *   bard     0 | 1, the director off or on
 *   view     diorama | explore
 *   select   an adventurer's title (`Implementer II`, any case) or session id: followed, dossier open
 *   look     a site, landmark or `x,z`: the camera frames it (and the Bard lets go). Names are the
 *            world's: on a repo's island the story's sites are its mapped districts (world/siteMap.ts),
 *            and every district answers to its name (`react-dom`) or folder (`packages/react-dom`)
 *   paused   1: the story's clock stopped
 *   event    a world event forced now (EVENT_KINDS) — dev and probe builds only
 *   repo     `owner/name` (or a GitHub URL, or `sample`): the island grown from that repo's tree
 *            (world/gen) instead of the guild's own. The Bard directs there as anywhere (with
 *            `bard=0`, the island is framed whole). Bundled fixtures first, else the public GitHub
 *            API; on failure the guild's island stays. A `look` name waits for the island to grow.
 *            `home`: back to the guild's own island. Applied in place, the world swaps live.
 *
 * Every value is validated strictly; anything unknown or invalid is ignored (and listed in
 * `ignored`, for the probe tools to report). Production honours all of it except `event`.
 */
export interface DeepLink {
  story?: ScenarioId
  /** Seek, ms of run time. */
  t?: number
  /** Saga act, 1-based. */
  act?: number
  /** Rush's adventurer count. */
  n?: number
  hour?: number
  weather?: Weather
  quality?: Tier
  hud?: HudMode
  bard?: boolean
  view?: "diorama" | "explore"
  select?: string
  look?: Place
  /**
   * A `look` name to find on the repo's island once it has grown (with `repo` only: before then the
   * island, and so what the name means, is unknown).
   */
  lookName?: string
  paused?: boolean
  event?: EventKind
  /** "sample", "home" (the guild's own island) or "owner/name". */
  repo?: string
}

export interface Parsed {
  link: DeepLink
  /** `key=value` pairs that were not understood, in the order given. */
  ignored: string[]
}

const WEATHERS: readonly Weather[] = ["clear", "cloudy", "rain", "storm", "snow"]
const HUDS: Record<string, HudMode> = {
  minimal: "minimal",
  detailed: "detailed",
  hidden: "hidden",
  off: "hidden",
}
/** Furthest a numeric `look` may be from the island's centre, world units (the sea around it). */
const LOOK_MAX = 200
/** Most adventurers `n` may ask `rush` for: a stress scene, not a denial of service. */
const RUSH_MAX = 500
/** Params owned by other features (`?live`, `?showcase`, the labs): never reported as ignored. */
const OTHERS = new Set([
  "live",
  "tsl",
  "archipelago",
  "repos",
  "island",
  "grow",
  "anyhub",
  "showcase",
  "demo",
  "lab",
  "grips",
  "model",
  "clip",
  "piece",
  "kind",
  "night",
])

/** Parses a location search string. `probe`: a dev or probe build (dev-only params allowed). */
export function parseDeepLink(search: string, probe: boolean): Parsed {
  const link: DeepLink = {}
  const ignored: string[] = []
  for (const [key, raw] of new URLSearchParams(search)) {
    const value = raw.trim()
    if (!take(link, key, value, probe) && !OTHERS.has(key)) ignored.push(`${key}=${raw}`)
  }
  if (link.act !== undefined && link.story === undefined) link.story = "saga"
  if (link.act !== undefined && link.story !== "saga") {
    ignored.push(`act=${link.act}`)
    delete link.act
  }
  if (link.n !== undefined && link.story !== "rush") {
    ignored.push(`n=${link.n}`)
    delete link.n
  }
  if (link.lookName !== undefined) {
    const raw = link.lookName
    // A point means the same on every island; a name is the island's, so with a repo it waits.
    const place = pointOf(raw) ?? (link.repo === undefined ? lookOf(raw) : undefined)
    if (place) link.look = place
    if (place || link.repo === undefined || !LOOK_NAME.test(raw)) delete link.lookName
    if (!place && link.lookName === undefined) ignored.push(`look=${raw}`)
  }
  return { link, ignored }
}

/** Sets one param on the link if it is valid; false if not. */
function take(link: DeepLink, key: string, value: string, probe: boolean): boolean {
  switch (key) {
    case "story":
      if (!(value in SCENARIOS)) return false
      link.story = value as ScenarioId
      return true
    case "t": {
      const ms = clockOf(value)
      if (ms === undefined) return false
      link.t = ms
      return true
    }
    case "act": {
      const act = intOf(value, 1, 5)
      if (act === undefined) return false
      link.act = act
      return true
    }
    case "n": {
      const n = intOf(value, 1, RUSH_MAX)
      if (n === undefined) return false
      link.n = n
      return true
    }
    case "hour": {
      if (!/^\d{1,2}(\.\d+)?$/.test(value)) return false
      const hour = Number(value)
      if (hour > 24) return false
      link.hour = hour
      return true
    }
    case "weather":
      if (!WEATHERS.includes(value as Weather)) return false
      link.weather = value as Weather
      return true
    case "quality": {
      const tier = intOf(value, 0, 3)
      if (tier === undefined) return false
      link.quality = tier as Tier
      return true
    }
    case "hud": {
      const mode = Object.hasOwn(HUDS, value) ? HUDS[value] : undefined
      if (!mode) return false
      link.hud = mode
      return true
    }
    case "bard":
    case "paused": {
      if (value !== "0" && value !== "1") return false
      link[key] = value === "1"
      return true
    }
    case "view":
      if (value !== "diorama" && value !== "explore") return false
      link.view = value
      return true
    case "select":
      if (!/^[\w .:-]{1,64}$/.test(value)) return false
      link.select = value
      return true
    case "look":
      // Resolved once the whole link is read (parseDeepLink): a name may be a repo island's.
      link.lookName = value
      return true
    case "event":
      if (!probe || !EVENT_KINDS.includes(value as EventKind)) return false
      link.event = value as EventKind
      return true
    case "repo":
      if (value === "sample" || value === HOME_ISLAND) {
        link.repo = value
        return true
      }
      try {
        link.repo = parseRepo(value)
        return true
      } catch {
        return false
      }
    default:
      return false
  }
}

/** `mm:ss` → ms; minutes 0–999, seconds 00–59. */
function clockOf(value: string): number | undefined {
  const match = /^(\d{1,3}):([0-5]\d)$/.exec(value)
  if (!match) return undefined
  return (Number(match[1]) * 60 + Number(match[2])) * 1000
}

function intOf(value: string, min: number, max: number): number | undefined {
  if (!/^\d+$/.test(value)) return undefined
  const n = Number(value)
  return n >= min && n <= max ? n : undefined
}

/** Landmark kinds worth a name (one each: the first on the map). Homes and chimneys are many. */
const NAMED_LANDMARKS: readonly LandmarkKind[] = [
  "windmill",
  "watermill",
  "lumbermill",
  "mine",
  "tower",
  "well",
  "market",
  "dock",
]

/** What a `look` name may look like (a district's folder included). */
const LOOK_NAME = /^[\w.@+/ -]{1,80}$/
/** How much ground a district's framing holds, per √hex of it (world units), and its bounds. */
const DISTRICT_SPREAD = 4
const DISTRICT_RADIUS: readonly [number, number] = [10, 28]

/**
 * The places `look` knows by name on `world` (the active one by default): the story's job sites
 * (world/siteMap.ts `sitesOf`, by id), the keep, the island overview, the landmarks; on the hand
 * lands the square and the graveyard, on a repo's island every district by name and by folder.
 * Built once per world.
 */
const named = new WeakMap<World, ReadonlyMap<string, Place>>()
export function lookPlaces(world: World = activeWorld() ?? handWorld()): ReadonlyMap<string, Place> {
  const known = named.get(world)
  if (known) return known
  const places = new Map<string, Place>()
  const put = (name: string, x: number, z: number, radius: number) => {
    const id = name.toLowerCase()
    if (!places.has(id)) places.set(id, { key: `look:${id}`, x, z, radius })
  }
  const hand = world.kind === "hand"
  if (hand) put("island", 0, 10, 60)
  else put("island", 0, 0, reachOf(world))
  put("keep", 0, hand ? 4 : 0, 14)
  if (hand) put("square", 0, 28, 14)
  for (const site of Object.values(sitesOf(world))) put(site.id, site.at[0], site.at[1], 10)
  if (hand) {
    const { x0, x1, z0, z1 } = GRAVEYARD_PLOT
    put("graveyard", (x0 + x1) / 2, (z0 + z1) / 2, 11)
  }
  for (const district of world.repo?.districts ?? []) {
    const [low, high] = DISTRICT_RADIUS
    const radius = Math.min(high, Math.max(low, Math.sqrt(district.hexes) * DISTRICT_SPREAD))
    put(district.label, district.at[0], district.at[1], radius)
    put(district.id, district.at[0], district.at[1], radius)
  }
  for (const kind of NAMED_LANDMARKS) {
    const mark = world.island.landmarks.find((l) => l.kind === kind)
    if (mark) put(kind, mark.x, mark.z, 8)
  }
  named.set(world, places)
  return places
}

/** A named place on `world` (the active one by default), or `x,z` (within LOOK_MAX of the centre). */
export function lookOf(value: string, world?: World): Place | undefined {
  const name = lookPlaces(world).get(value.toLowerCase())
  return name ? { ...name } : pointOf(value)
}

/** `x,z`, world units, within LOOK_MAX of the centre. */
function pointOf(value: string): Place | undefined {
  const match = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(value)
  if (!match) return undefined
  const x = Number(match[1])
  const z = Number(match[2])
  if (Math.abs(x) > LOOK_MAX || Math.abs(z) > LOOK_MAX) return undefined
  return { key: `look:${x},${z}`, x, z, radius: 10 }
}

/** What applying a link needs from the hall: the store and two levers that live outside it. */
export interface Hall {
  store: {
    scenario: ScenarioId
    startAt: number
    chapters: readonly { at: number }[]
    views: readonly { id: string; title: string }[]
    load(scenario: ScenarioId): void
    seek(time: number): void
    setEnvironment(settings: { time?: "fixed"; hour?: number; weather?: Weather }): void
    setSpeed(speed: number): void
    setBard(on: boolean): void
    setView(view: "diorama" | "explore"): void
    select(id: string | null): void
    frame(place: Place | null): void
    subscribe(listener: () => void): () => void
  }
  /** Pin a quality tier for this visit (not remembered). */
  quality(tier: Tier): void
  /** Set the HUD mode for this visit (not remembered). */
  hud(mode: HudMode): void
  /** Force a world event (dev and probe builds only). */
  force?(kind: EventKind): void
}

/** How long a `select` waits for its adventurer to arrive on stage before giving up, ms. */
export const SELECT_WAIT_MS = 30_000

/**
 * Applies a link, in a fixed order: the story first (loading resets), then the seek, the clock and
 * weather, the levers, the camera and the pick. Returns the problems found only now (an act the
 * story doesn't have, nobody of that name on stage yet) — a pick of someone still to arrive is
 * kept waiting for SELECT_WAIT_MS.
 */
export function applyDeepLink(link: DeepLink, hall: Hall): string[] {
  const { store } = hall
  const problems: string[] = []
  if (link.story === "rush" && link.n !== RUSH.count) {
    // A different crowd is a different story: reload even when rush is already playing.
    RUSH.count = link.n
    store.load("rush")
  } else if (link.story && link.story !== store.scenario) store.load(link.story)
  let at: number | undefined
  if (link.act !== undefined) {
    const chapter = store.chapters[link.act - 1]
    if (chapter) at = chapter.at + (link.t ?? 0)
    else problems.push(`act=${link.act}: the story has ${store.chapters.length} acts`)
  } else if (link.t !== undefined) at = link.t
  if (at !== undefined) {
    store.seek(at)
    store.startAt = at
  }
  if (link.hour !== undefined || link.weather !== undefined)
    store.setEnvironment({
      ...(link.hour !== undefined ? { time: "fixed" as const, hour: link.hour } : {}),
      ...(link.weather !== undefined ? { weather: link.weather } : {}),
    })
  if (link.quality !== undefined) hall.quality(link.quality)
  if (link.hud !== undefined) hall.hud(link.hud)
  if (link.view !== undefined) store.setView(link.view)
  if (link.paused !== undefined) store.setSpeed(link.paused ? 0 : 1)
  if (link.look) store.frame(link.look)
  if (link.repo !== undefined) {
    // What a name means waits for the island; with the Bard off and nothing named, it is framed whole.
    const { look, lookName, bard } = link
    void showIsland(link.repo).then((world) => {
      const place =
        (lookName !== undefined ? lookOf(lookName, world) : undefined) ??
        (bard === false && !look ? lookOf("island", world) : undefined)
      if (!place) return
      store.frame(place)
      // Framing hands the Bard off: an explicit bard=1 still wins.
      if (bard === true) store.setBard(true)
    })
  }
  if (link.bard !== undefined) store.setBard(link.bard)
  if (link.event && hall.force) hall.force(link.event)
  if (link.select !== undefined) {
    const wanted = link.select
    const found = pick(store.views, wanted)
    if (found) store.select(found)
    else {
      problems.push(`select=${wanted}: not on stage yet, waiting`)
      const off = store.subscribe(() => {
        const id = pick(store.views, wanted)
        if (!id) return
        off()
        clearTimeout(timer)
        store.select(id)
      })
      const timer = setTimeout(off, SELECT_WAIT_MS)
    }
  }
  return problems
}

/** An adventurer by session id, else by title (any case), else by the first title that starts so. */
export function pick(views: readonly { id: string; title: string }[], wanted: string): string | undefined {
  const lower = wanted.toLowerCase()
  return (
    views.find((v) => v.id === wanted) ??
    views.find((v) => v.title.toLowerCase() === lower) ??
    views.find((v) => v.title.toLowerCase().startsWith(lower))
  )?.id
}
