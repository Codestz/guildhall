/**
 * The sea's life on an island (render sea/, world events Task D): merchants on their laps, the quay's
 * rowboat, a push's cargo ship, a release's galleon, the ghost ship and the raid, the lighthouse's lamp.
 * Mounted with the event FX (a hall, `?fx=`) or with `?sea=`; off, nothing of it exists. A hall's
 * session drives it (hall/sea.ts); without one, `?sea=` shows it for a look:
 *
 *   ?sea=1                         the merchants and the quay's rowboat, at rest
 *   ?sea=merchants                 the same
 *   ?sea=cargo                     a push: a cargo ship casts off now (`cargo=5`: five crates)
 *   ?sea=galleon                   a release: the galleon sails in now
 *   ?sea=ghost                     the ghost ship's show, now (past the coast the camera looks at)
 *   ?sea=raid                      the raid's show, now, until it is ended (`ext.sea.endRaid()`)
 *   ?sea=lighthouse=red|amber|warm the lamp: failed, running, passed
 *   ?sea=cargo,lighthouse=amber    together (`,` or `;`); listing any but `merchants` leaves them off
 *   ?sea=0                         off, even in a hall
 *
 * `window.guildhall.ext.sea` drives it for shots: `push(commits?)`, `release()`, `ghost(near?)`,
 * `raid()`, `endRaid()`, `lighthouse(state)`, `ambient(on)`, `advance(s)`, `rate(r?)`, `view()`,
 * `stats()`, `sites`, `ready()`, and `life` itself.
 */
import type { CiState } from "@guildhall/core"
import {
  createSeaLife,
  type DayLight,
  type EventSites,
  type SeaLife,
  type SeaLifeOpts,
  type SeaShow,
  type SeaSites,
  type Stage,
} from "@guildhall/render"
import type { HallSession } from "../hall/feeds/session.ts"

export interface SeaSpec {
  merchants: boolean
  cargo: number
  galleon: boolean
  ghost: boolean
  raid: boolean
  lighthouse: CiState | null
}

const LAMPS: Record<string, CiState> = { red: "failed", amber: "running", warm: "passed" }

/** `?sea=`: null when absent, "off" for `0`. */
export function seaOf(query: Pick<URLSearchParams, "get">): SeaSpec | "off" | null {
  const raw = query.get("sea")
  if (raw === null) return null
  if (raw === "0") return "off"
  const spec: SeaSpec = {
    merchants: false,
    cargo: 0,
    galleon: false,
    ghost: false,
    raid: false,
    lighthouse: null,
  }
  let any = false
  for (const part of raw.split(/[,;]/)) {
    const [k, v = ""] = part.split("=") as [string, string?]
    if (k === "1" || k === "merchants" || k === "all") spec.merchants = true
    else if (k === "cargo") spec.cargo = Math.max(1, Math.min(6, Math.floor(Number(v) || 3)))
    else if (k === "galleon") spec.galleon = true
    else if (k === "ghost") spec.ghost = true
    else if (k === "raid") spec.raid = true
    else if (k === "lighthouse")
      spec.lighthouse =
        LAMPS[v] ?? (v in { failed: 1, running: 1, passed: 1, queued: 1 } ? (v as CiState) : "passed")
    else continue
    any = true
  }
  if (!any) spec.merchants = true
  return spec
}

/** Whether the sea is on: with `?sea=` (not `0`), or with the event FX (a hall, `?fx=`). */
export function seaOn(spec: SeaSpec | "off" | null, fx: boolean): spec is SeaSpec | null {
  return spec !== "off" && (spec !== null || fx)
}

export interface SeaMount {
  life: SeaLife
  dispose(): void
}

/** The sea on an island: `sites` from the worker, `berths` the harbour ships' (kept clear of). */
export function mountSea(parts: {
  stage: Stage
  sites: SeaSites
  events: EventSites | null
  load: SeaLifeOpts["load"]
  light: () => DayLight
  spec: SeaSpec | null
  /** The coast the world events' ghost ship passes: the graveyard's (world graveyard.ts), xz. */
  ghostNear?: readonly [number, number] | null
  /** A session plays on the island: its clock and its harbour drive the sea (hall/sea.ts) once it is up. */
  session?: (() => HallSession | null) | boolean
}): SeaMount {
  const { stage, sites, spec } = parts
  const berths = (parts.events?.harbours ?? []).flatMap((h) =>
    h.berths.map((b) => [b.at[0], b.at[2]] as [number, number]),
  )
  const life = createSeaLife(stage, {
    sites,
    load: parts.load,
    keepOff: berths,
    light: parts.light,
    ghostNear: parts.ghostNear ?? null,
  })
  let shows: SeaShow[] = []
  const setShows = (next: SeaShow[]) => {
    shows = next
    life.setShows(shows)
  }
  const ghost = (near?: readonly [number, number]) => {
    const [x, , z] = stage.getCamera().target
    setShows([
      ...shows.filter((s) => s.kind !== "ghostship"),
      { kind: "ghostship", start: life.now(), params: { near: near ?? [x, z] } },
    ])
  }
  const raid = () =>
    setShows([...shows.filter((s) => s.kind !== "raid"), { kind: "raid", start: life.now() }])
  const endRaid = () =>
    setShows(shows.map((s) => (s.kind === "raid" && s.end === undefined ? { ...s, end: life.now() } : s)))
  if (spec) {
    life.setAmbient(spec.merchants)
    if (spec.cargo) life.push({ commits: spec.cargo })
    if (spec.galleon) life.release()
    if (spec.ghost) ghost()
    if (spec.raid) raid()
    if (spec.lighthouse) life.setLighthouse(spec.lighthouse)
  }
  // a session, once its HUD has started it (looked for until it is there), drives the sea
  let undrive = () => {}
  let disposed = false
  if (parts.session)
    void Promise.all([
      typeof parts.session === "function"
        ? Promise.resolve(parts.session)
        : import("../hall/hud/mount.tsx").then((m) => m.hallSession),
      import("../hall/sea.ts"),
    ]).then(([sessionOf, { driveSea }]) => {
      const look = (tries: number) => {
        if (disposed) return
        const playing = sessionOf()
        if (playing)
          undrive = driveSea(life, playing, { level: sites.sea, ghostNear: parts.ghostNear ?? null })
        else if (tries > 0) setTimeout(() => look(tries - 1), 200)
      }
      look(300)
    })
  const ext = window.guildhall?.ext
  if (ext)
    ext.sea = {
      life,
      sites,
      push: (commits = 3) => life.push({ commits }),
      release: () => life.release(),
      ghost,
      raid,
      endRaid,
      lighthouse: (state: CiState | null) => life.setLighthouse(state),
      ambient: (on: boolean) => life.setAmbient(on),
      advance: (s: number) => life.advance(s),
      rate: (r?: number) => (r === undefined ? life.rate() : life.setRate(r)),
      view: () => life.view(),
      stats: () => life.stats(),
      ready: () => life.ready,
    }
  return {
    life,
    dispose() {
      disposed = true
      undrive()
      life.dispose()
      if (ext?.sea && (ext.sea as { life?: SeaLife }).life === life) delete ext.sea
    },
  }
}
