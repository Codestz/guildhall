/**
 * Every query parameter the studio reads, in one registry: its name, how it is parsed, its kind and what
 * it is for. Nothing else reads a URL's query (test/params.test.ts fails on a read outside this module or
 * of a name not declared here).
 *
 * Two kinds:
 *
 * - `public`: always honoured. The links the site hands out (`/?story=saga`, `/town/7?files=12000`,
 *   `/hall/<o>/<r>?t=…`, V1's `/?repo=` redirect), and the state the shipped UI writes into the address
 *   (the Studio's tools, Settings › World, the Viewer's knobs).
 * - `dev`: for the shots, the tests and the perf tooling. Honoured on this machine (localhost, a dev
 *   build, a test) or with `?dev=1`; anywhere else silently read as absent.
 *
 * `where` says whose they are (the site's, the Studio's, both); `view` marks the ones that say what the
 * visitor looks at rather than what the world is built from (a change of them keeps the island built).
 */
import { isLocalHost } from "./env.ts"

export type ParamKind = "public" | "dev"

export interface ParamSpec<T> {
  kind: ParamKind
  where: "site" | "studio" | "any"
  /** One line: what it does. */
  purpose: string
  /** The raw value (null when absent, or a dev param this page does not honour) → what the reader gets. */
  parse(raw: string | null): T
  /** What the visitor looks at, not what the world is built from (`site/routes.ts` `worldKey`). */
  view?: true
}

/** Anything a parameter can be read from: a URLSearchParams, or a screen's query. */
export type QueryLike = Pick<URLSearchParams, "get">

// ── parsers ─────────────────────────────────────────────────────────

/** The value as written. */
const text = (raw: string | null): string | null => raw
/** On unless `=0`. */
const on = (raw: string | null): boolean => raw !== "0"
/** Off unless `=1`. */
const one = (raw: string | null): boolean => raw === "1"
/** A finite number, or null (absent, empty, not a number). */
const num = (raw: string | null): number | null => {
  if (raw === null || raw.trim() === "") return null
  const v = Number(raw)
  return Number.isFinite(v) ? v : null
}
/** A whole act, 1 – 5, or undefined. */
const act = (raw: string | null): number | undefined => {
  const n = Number(raw)
  return raw !== null && Number.isInteger(n) && n >= 1 && n <= 5 ? n : undefined
}
/** One of `values`, or null. */
const oneOf =
  <const T extends string>(values: readonly T[]) =>
  (raw: string | null): T | null =>
    raw !== null && (values as readonly string[]).includes(raw) ? (raw as T) : null

const pub = <T>(
  where: ParamSpec<T>["where"],
  purpose: string,
  parse: (raw: string | null) => T,
  view?: true,
): ParamSpec<T> => ({ kind: "public", where, purpose, parse, ...(view ? { view } : {}) })
const dev = <T>(
  where: ParamSpec<T>["where"],
  purpose: string,
  parse: (raw: string | null) => T,
  view?: true,
): ParamSpec<T> => ({ kind: "dev", where, purpose, parse, ...(view ? { view } : {}) })

// ── the registry ────────────────────────────────────────────────────

export const PARAMS = {
  // the site's links
  repo: pub(
    "site",
    "The repo a hall opens, owner/repo (the path /hall/<o>/<r>; V1's /?repo= redirects to it)",
    text,
  ),
  story: pub(
    "site",
    "The demo story the island plays (/?story=saga): the demo cards, the Next story pill",
    text,
    true,
  ),
  act: pub("site", "The act a story opens at, 1–5 (the Demos picker's act links)", act, true),
  t: pub(
    "any",
    "A moment: a hall's day (YYYY-MM-DD, or 0–1 of its history; the hall writes it at rest); a clip's time in the Studio",
    text,
    true,
  ),
  season: pub("any", "A pinned season (spring, summer, autumn, winter): Settings › World writes it", text),
  hour: pub(
    "any",
    "The hour the island opens at, 0–24 (the Night demo's ?hour=22): Settings › World writes it",
    num,
  ),
  weather: pub("any", "A pinned weather (clear, rain, storm, snow: the Night demo's ?weather=storm)", text),
  files: pub(
    "any",
    "The island's size, as a repo of that many files (/town/7?files=12000): Settings › World writes it",
    num,
  ),
  town: pub(
    "studio",
    "The town screen's seed (the path /town/<seed>; old /lab/hexworld?seed= moves here)",
    text,
  ),
  seed: pub(
    "any",
    "A seed: the island's (a hall's comes from its name), the NPC builder's, a story feed's",
    num,
  ),
  name: pub(
    "site",
    "The island's name on its card and cover (the site sets it: the repo, or Guildhall)",
    text,
  ),
  feed: pub(
    "site",
    "A hall's session: live (localhost, README), replay or story",
    oneOf(["live", "replay", "story"] as const),
  ),
  guild: pub(
    "site",
    "The guild a hall's session follows when its folder has another name (README &guild=)",
    text,
  ),
  try: pub("any", "A fresh build of the same link (a hall's Try again; the composer's try-on, =1)", text),
  screen: pub("any", "Old deep links (?screen=pieces): the shell rewrites them to the path", text),
  dev: pub(
    "any",
    "?dev=1 honours the dev params off localhost; on the site, the Viewer's tools over the world",
    one,
  ),

  // the Studio's tools: state their own UI writes into the address
  id: pub("studio", "The piece open in Pieces (the path /pieces/<pack>/<slug>)", text),
  q: pub("studio", "Pieces' search text", text),
  pack: pub("studio", "Pieces' pack filter", text),
  cat: pub("studio", "Pieces' category filter", text),
  flag: pub("studio", "Pieces' flag filter, a comma list", text),
  misfit: pub("studio", "Pieces: only those with a piece or scale flag (=1)", one),
  clip: pub("studio", "The clip playing: a piece's (Pieces), an NPC's, the grip editor's", text),
  recipe: pub("studio", "The NPC builder's recipe (the path /npcs/<recipe>)", text),
  strip: pub("studio", "The NPC builder's strip of variants", text),
  cam: pub("studio", "The camera: the NPC builder's map view (=map); free flight on a world (=free)", text),
  piece: dev("studio", "The grip editor's prop (the path /grips/editor/<pack>/<slug>)", text),
  body: dev("studio", "The body a grip is checked on (grip editor, grip matrix)", text),
  axes: dev("studio", "The grip matrix's hand axes (=1)", one),
  clips: dev("studio", "The grip matrix's clips, a comma list", text),
  yaw: dev("studio", "The grip matrix's view yaw in degrees (a side view)", num),
  props: dev("studio", "The grip matrix's props, a comma list (held: only those held)", text),
  tile: pub(
    "studio",
    "The tile prefab open (the composer's path /composer/<tile>; the tile prefabs' one tile)",
    text,
  ),
  around: pub("studio", "The composer's neighbours round the tile", text),
  view: pub("studio", "The hex map's view: plain, grid or growth", text),
  zones: pub("studio", "The hex map's zones overlay", text),
  group: pub("studio", "The tile prefabs' group", text),
  // the island's knobs (the Viewer's Inspector writes them: hexworld/knobs.ts)
  coast: pub("studio", "The island's coast shape (knob)", num),
  hills: pub("studio", "The island's hill levels (knob)", num),
  rain: pub("studio", "The island's rivers (knob)", num),
  forest: pub("studio", "The island's forest share (knob)", num),
  tree: pub("studio", "Leaf trees' size, ×0.1–4 (knob)", num),
  pine: pub("studio", "Pines' size, ×0.1–4 (knob)", num),
  bush: pub("studio", "Bushes' size, ×0.1–4 (knob)", num),
  rock: pub("studio", "Rocks' size, ×0.1–4 (knob)", num),
  grass: pub("studio", "Grass's size, ×0.1–4 (knob)", num),
  flower: pub("studio", "Flowers' size, ×0.1–4 (knob)", num),
  woods: pub("studio", "Woods density, ×0.1–4 (knob)", num),
  wild: pub("studio", "The wild share, ×0.1–4 (knob)", num),
  ground: pub("studio", "The ground: fine, hex or soft (knob)", text),
  step: pub("studio", "A level's height, metres (knob)", num),
  detail: pub("studio", "The ground's painted detail (knob; =0 off)", on),
  post: pub("studio", "The post pipeline (knob; =0 off: the perf bench's variant)", on),
  aa: pub("studio", "Anti-aliasing: smaa, msaa or none (knob)", text),
  shadow: pub("studio", "The shadow's strength, 0–2 (knob)", num),
  fill: pub("studio", "The fill light, 0–2 (knob)", num),
  atmo: pub("studio", "The haze and the cloud deck (knob; =0 off: the perf bench's variant)", on),
  haze: pub("studio", "The horizon haze, ×0–2 (knob)", num),
  clouds: pub("studio", "The cloud deck's cover, ×0–2 (knob)", num),
  life: pub("studio", "Townsfolk and agents (knob; =0 none: the perf bench's variant)", on),
  spots: pub("studio", "The activity spots overlay (knob)", one),
  collide: pub("studio", "The collision layer overlay (knob)", one),

  // dev: the shots, the tests, the perf tooling
  hud: dev("any", "=perf: the perf HUD from the first frame (tools/shots)", text, true),
  log: dev("any", "The log's levels and scopes (core configureLog)", text, true),
  bar: dev("any", "=0: no top bar, a bare screen (tools/shots thumbs)", on, true),
  ui: dev("any", "=0: no Viewer chrome round the stage (tools/shots thumbs)", on, true),
  loader: dev("any", "=0: no loading cover, the island shown as it builds (tools/shots loading.ts)", on),
  labels: dev("site", "=0: no name plates (tools/shots thumbs)", on),
  timers: dev("any", "=1: GPU timer queries (perf bench; they cost ~1.3 ms a frame)", one),
  dpr: dev("any", "A fixed device pixel ratio (perf bench, trace.ts, the shot sets)", text),
  lod: dev("any", "=0: every piece at full detail (the perf bench's reference)", on),
  sheet: dev("studio", "=1 with ?tile=: a tile prefab's review sheet (tools/shots prefabs.ts)", one),
  play: dev("site", "=0: a story opens paused (tools/shots thumbs)", on, true),
  next: dev("site", "=0: a story stays at its end, no Next story pill (tools/shots living.ts)", on, true),
  st: dev("site", "A story opened at this many seconds (tests)", num, true),
  fx: dev("any", "The event FX on a world without a session (tools/shots weather.ts)", text),
  workfx: dev("any", "The work FX's knobs (tools/shots polish1.ts)", text),
  src: dev("site", "The recording a replay feed plays (tests)", text),
  hub: dev("site", "The hub a live feed dials, a ws:// on this machine (tests)", text),
  director: dev("site", "=0 / =1: the Bard off or on from the first frame (tests)", text),
  sea: dev("any", "The sea's life: its ships and lighthouse, or =0 none (tests)", text),
  undead: dev("any", "A graveyard scene on its own clock (tools/shots undead.ts)", text),
  docket: dev("any", "The quest board with that many issues (tests)", text),
  agents: dev("any", "=0: no agents on the island (tests)", text),
  packs: dev("studio", "=all: every imported pack, not only the house style's (a full-library build)", text),
  heroSpots: dev("any", "=1: the heroes' spots marked over the island (the drills' checks)", one),
} as const satisfies Record<string, ParamSpec<unknown>>

export type ParamName = keyof typeof PARAMS
export type ParamValue<N extends ParamName> = ReturnType<(typeof PARAMS)[N]["parse"]>

export const isParam = (name: string): name is ParamName => Object.hasOwn(PARAMS, name)

/** The names a page may write into its address, and a link handed to someone else may carry. */
export type PublicParam = {
  [N in ParamName]: (typeof PARAMS)[N]["kind"] extends "public" ? N : never
}[ParamName]

// ── the dev gate ────────────────────────────────────────────────────

/** Where the page is: what the dev gate reads. */
export interface ParamEnv {
  /** A dev build (vite's `import.meta.env.DEV`), or no page at all (a test, a worker). */
  devBuild: boolean
  hostname?: string
  /** The page's own query (`location.search`), for its `?dev=1`. */
  search?: string
}

/** Whether a page in `env` honours the dev params: this machine, a dev build, or `?dev=1`. Pure. */
export function devHonoured(env: ParamEnv): boolean {
  if (env.devBuild) return true
  if (env.hostname === undefined || isLocalHost(env.hostname)) return true
  return new URLSearchParams(env.search ?? "").get("dev") === "1"
}

let pinned: ParamEnv | null = null

/** Pins the gate's view of the page (tests); null reads the page again. */
export function setParamEnv(env: ParamEnv | null): void {
  pinned = env
}

let seen: { search: string; host: string; on: boolean } | null = null

/** This page's gate, read once per address. */
export function devOn(): boolean {
  if (pinned) return devHonoured(pinned)
  if (typeof location === "undefined") return true
  const devBuild = import.meta.env.DEV === true
  if (seen && seen.search === location.search && seen.host === location.hostname) return seen.on
  const on = devHonoured({ devBuild, hostname: location.hostname, search: location.search })
  seen = { search: location.search, host: location.hostname, on }
  return on
}

/** Whether `name` is honoured on this page with `query` (a `?dev=1` in either opens the dev ones). */
function honoured(query: QueryLike, name: ParamName): boolean {
  return PARAMS[name].kind === "public" || devOn() || query.get("dev") === "1"
}

// ── reading ─────────────────────────────────────────────────────────

/** The raw value as this page honours it: null when absent or a dev param it ignores. */
function rawOf(query: QueryLike, name: ParamName): string | null {
  return honoured(query, name) ? query.get(name) : null
}

/** The honoured raw value, for a caller whose key is one of several (the router's path ids). */
export const rawParam = (query: QueryLike, name: ParamName): string | null => rawOf(query, name)

/** A parameter, parsed (its declared parser over the honoured raw value). */
export function param<N extends ParamName>(query: QueryLike, name: N): ParamValue<N> {
  return PARAMS[name].parse(rawOf(query, name)) as ParamValue<N>
}

/** Whether the query gives the parameter at all (any value, `?x=` too), as this page honours it. */
export function hasParam(query: QueryLike, name: ParamName): boolean {
  return rawOf(query, name) !== null
}

/**
 * The parameters that build the world (registered, honoured, not `view`), as sorted `k=v` pairs: what
 * `worldKey` keys a site screen's mount on.
 */
export function worldEntries(query: URLSearchParams): string[] {
  const out: string[] = []
  for (const [k, v] of query) {
    if (!isParam(k) || PARAMS[k].view || !honoured(query, k)) continue
    out.push(`${k}=${v}`)
  }
  return out.sort()
}

/** Only the public parameters of `query`, in its order: what a link handed to someone else carries. */
export function publicOnly(query: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams()
  for (const [k, v] of query) if (isParam(k) && PARAMS[k].kind === "public" && k !== "dev") out.append(k, v)
  return out
}
