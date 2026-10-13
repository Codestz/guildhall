/**
 * The island's event FX (render events/, task F1), mounted when a screen asks for them: CI weather over
 * the sky, pull-request ships at the harbour, scaffolds at the busy places. A hall drives them from its
 * world (`HudParts.fx`); without a feed, `?fx=` shows them for a look:
 *
 *   ?fx=storm | cloudy | clear        the weather (eased in, as a CI run would)
 *   ?fx=ships=3                       three pull requests docked at the harbour
 *   ?fx=busy=<place>                  a scaffold at a place: its id (a hall's `packages/sim`), its kind
 *                                     (`market`, the first of that kind) or its zone's index; `+` for more
 *   ?fx=close=sail                    a closed pull request's ship sails off (default: it sinks)
 *   ?fx=storm,ships=3,busy=market     together (`,` or `;` between them); `?fx=1` mounts them at rest
 *
 * `window.guildhall.ext.fx` drives them for shots: `weather(kind, now)`, `strike(hold?)`, `open(n)`,
 * `merge(key)`, `close(key)`, `busy(ids)`, `advance(s)`, `ships()`, `stats()`.
 */
import {
  createHarbourShips,
  createScaffolds,
  type EventSites,
  type HarbourShips,
  type HarbourShipsOpts,
  type Scaffolds,
  SHIP_PIECE,
  type ShipEnd,
  type SkyDrive,
  type Stage,
  type Water,
  type WeatherKind,
} from "@guildhall/render"

export interface FxSpec {
  weather: WeatherKind | null
  ships: number
  busy: string[]
  /** `close=sail`: a closed pull request's ship sails off instead of sinking. */
  close: "sink" | "sail"
}

/** `?fx=`: null when absent or `0`. */
export function fxOf(query: Pick<URLSearchParams, "get">): FxSpec | null {
  const raw = query.get("fx")
  if (raw === null || raw === "0") return null
  const spec: FxSpec = { weather: null, ships: 0, busy: [], close: "sink" }
  for (const part of raw.split(/[,;]/)) {
    const [k, v = ""] = part.split("=") as [string, string?]
    if (k === "storm" || k === "cloudy" || k === "clear") spec.weather = k
    else if (k === "close") spec.close = v === "sail" ? "sail" : "sink"
    else if (k === "ships") spec.ships = Math.max(0, Math.min(12, Math.floor(Number(v) || 0)))
    else if (k === "busy") spec.busy.push(...v.split("+").filter(Boolean))
  }
  return spec
}

export interface Fx {
  drive: SkyDrive
  ships: HarbourShips | null
  scaffolds: Scaffolds | null
  /** A place's scaffold id from an id, a kind or a zone index (the debug driver's `busy=`). */
  placeId(name: string): string | null
  stats(): { ms: number; ships: number; scaffolds: number; weather: WeatherKind }
  dispose(): void
}

/** A place's scaffold id: its repo unit's, or its zone's. */
const idOf = (p: EventSites["places"][number]) => p.id ?? `zone-${p.zone}`

export function mountFx(parts: {
  stage: Stage
  drive: SkyDrive
  sites: EventSites
  water: Water | null
  load: (id: string) => ReturnType<NonNullable<HarbourShipsOpts["load"]>>
  spec: FxSpec | null
}): Fx {
  const { stage, drive, sites } = parts
  const harbour = sites.harbours.find((h) => h.berths.length > 0)
  const ships = harbour
    ? createHarbourShips(stage, {
        berths: harbour.berths,
        close: parts.spec?.close ?? "sink",
        load: () => parts.load(SHIP_PIECE),
        water: parts.water,
      })
    : null
  const scaffolds = sites.places.length
    ? createScaffolds(
        stage,
        sites.places.map((p) => ({ id: idOf(p), at: p.build })),
      )
    : null
  const placeId = (name: string): string | null => {
    const byId = sites.places.find((p) => idOf(p) === name)
    if (byId) return idOf(byId)
    const byKind = sites.places.find((p) => p.kind === name)
    if (byKind) return idOf(byKind)
    const zone = Number(name)
    const byZone = Number.isInteger(zone) ? sites.places.find((p) => p.zone === zone) : undefined
    return byZone ? idOf(byZone) : null
  }
  let opened = 0
  const open = (n: number, docked: boolean) => {
    for (let i = 0; i < n; i++) ships?.open(`#${101 + opened++}`, { docked })
  }
  const spec = parts.spec
  if (spec) {
    if (spec.weather) drive.set(spec.weather)
    open(spec.ships, true)
    scaffolds?.set(
      spec.busy.map(placeId).filter((id): id is string => id !== null),
      true,
    )
  }
  const fx: Fx = {
    drive,
    ships,
    scaffolds,
    placeId,
    stats: () => ({
      ms: drive.stats().ms + (ships?.stats().ms ?? 0) + (scaffolds?.stats().ms ?? 0),
      ships: ships?.stats().afloat ?? 0,
      scaffolds: scaffolds?.stats().shown ?? 0,
      weather: drive.weather(),
    }),
    dispose() {
      ships?.dispose()
      scaffolds?.dispose()
      drive.dispose()
    },
  }
  const ext = window.guildhall?.ext
  if (ext)
    ext.fx = {
      sites,
      weather: (kind: WeatherKind, now = false) => drive.set(kind, now),
      strike: (hold?: number) => drive.strike(hold),
      open: (n = 1, docked = false) => open(n, docked),
      merge: (key?: string) => end(key, "merged"),
      close: (key?: string) => end(key, "closed"),
      busy: (names: string[], now = false) =>
        scaffolds?.set(
          names.map(placeId).filter((id): id is string => id !== null),
          now,
        ),
      advance: (s: number) => ships?.advance(s),
      ships: () => ships?.ships() ?? [],
      ready: () => Promise.all([ships?.ready, scaffolds?.ready]),
      stats: () => ({ ...fx.stats(), drive: drive.stats() }),
    }
  function end(key: string | undefined, how: ShipEnd) {
    const k = key ?? ships?.ships().find((s) => s.phase === "docked")?.key
    if (k) ships?.end(k, how)
  }
  return fx
}
