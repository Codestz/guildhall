/**
 * The island's event FX (render events/, task F1), mounted when a screen asks for them: CI weather over
 * the sky, pull-request ships at the harbour, scaffolds at the busy places. A hall drives them from its
 * world (`HudParts.fx`); without a feed, `?fx=` shows them for a look:
 *
 *   ?fx=storm | cloudy | clear        the weather (eased in, as a CI run would)
 *   ?fx=ships=3                       three pull requests docked at the harbour
 *   ?fx=busy=<place>                  a scaffold at a place: its id (a hall's `packages/sim`), its kind
 *                                     (`market`, the first of that kind) or its zone's index; `+` for more
 *   ?fx=busy=market:0.5               …built that far (its stages: frame, decks, roof; 1 = done, a flag)
 *   ?fx=close=sail                    a closed pull request's ship sails off (default: it sinks)
 *   ?fx=lamps=1                       a storm lights the lanterns by day too (default: only the flames glow)
 *   ?fx=storm,ships=3,busy=market     together (`,` or `;` between them); `?fx=1` mounts them at rest
 *
 * `window.guildhall.ext.fx` drives them for shots: `weather(kind, now)`, `strike(hold?)`, `open(n)`,
 * `merge(key)`, `close(key)`, `busy(ids)`, `progress(name, p, now?)`, `advance(s)`, `rate(r?)` (the
 * voyages' speed; no `r`: read it), `ships()`, `stats()`.
 *
 * The work FX (render workfx/: sparks, chips, splashes, dust, …) are mounted on every island (`mountWorkFx`)
 * and draw nothing until something emits; life's beats call `workfx.beat(beat, at, sample)`. For a look:
 *
 *   ?workfx=sparks,chips,splash       each kind fired on its work rhythm at the nearest fitting spot to
 *                                     where the camera looks (anvil, log, boat; `all` for every kind)
 *   ?workfx=0                         off
 *
 * `window.guildhall.ext.workfx`: `emit(kind, at, opts?)`, `beat(beat, at, sample?)`, `fire(kind)` (at its
 * spot near the focus), `sites()`, `freeze(on)`, `advance(s)`, `clear()`, `time()`, `stats()`.
 */
import {
  createHarbourShips,
  createScaffolds,
  createWorkFx,
  type DayLight,
  type Driver,
  driveWorkFx,
  type EventSites,
  type HarbourShips,
  type HarbourShipsOpts,
  type Scaffolds,
  SHIP_PIECE,
  type ShipEnd,
  type SitePiece,
  type SkyDrive,
  type Stage,
  scaffoldSize,
  siteFor,
  type Water,
  type WeatherKind,
  type WorkFx,
  type WorkKind,
  workfxOf,
} from "@guildhall/render"

export interface FxSpec {
  weather: WeatherKind | null
  ships: number
  busy: string[]
  /** `busy=<place>:<p>`: how far each named place's work is (0 … 1). */
  progress: Record<string, number>
  /** `close=sail`: a closed pull request's ship sails off instead of sinking. */
  close: "sink" | "sail"
  /** `lamps=1`: a storm lights the lanterns and windows by day too (two more draws then). */
  lamps: boolean
}

/** `?fx=`: null when absent or `0`. */
export function fxOf(query: Pick<URLSearchParams, "get">): FxSpec | null {
  const raw = query.get("fx")
  if (raw === null || raw === "0") return null
  const spec: FxSpec = { weather: null, ships: 0, busy: [], progress: {}, close: "sink", lamps: false }
  for (const part of raw.split(/[,;]/)) {
    const [k, v = ""] = part.split("=") as [string, string?]
    if (k === "storm" || k === "cloudy" || k === "clear") spec.weather = k
    else if (k === "lamps") spec.lamps = v === "1"
    else if (k === "close") spec.close = v === "sail" ? "sail" : "sink"
    else if (k === "ships") spec.ships = Math.max(0, Math.min(12, Math.floor(Number(v) || 0)))
    else if (k === "busy")
      for (const item of v.split("+").filter(Boolean)) {
        const [name, p] = item.split(":") as [string, string?]
        spec.busy.push(name)
        if (p !== undefined && Number.isFinite(Number(p))) spec.progress[name] = Number(p)
      }
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
  /** The work FX: a place's work done puffs dust at its scaffold's foot. */
  workfx?: WorkFx | null
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
        sites.places.map((p) => ({
          id: idOf(p),
          at: p.build,
          yaw: p.yaw,
          half: p.half,
          top: p.top,
          colour: p.colour,
        })),
        {
          // done: a puff of dust at the frame's feet (its back corners and the middle of its sides)
          onFinish: (place) => {
            const [hx, , hz] = scaffoldSize(place)
            const c = Math.cos(place.yaw ?? 0)
            const s = Math.sin(place.yaw ?? 0)
            const feet: [number, number][] = [
              [-1, -1],
              [1, -1],
              [-1, 0.3],
              [1, 0.3],
            ]
            for (const [fx, fz] of feet) {
              const x = fx * (hx + 1)
              const z = fz * (hz + 1)
              const at: [number, number, number] = [
                place.at[0] + x * c + z * s,
                place.at[1],
                place.at[2] - x * s + z * c,
              ]
              parts.workfx?.emit("dust", at, { scale: 1.8, seed: fx * 7 + fz * 3 })
            }
          },
        },
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
    for (const [name, p] of Object.entries(spec.progress)) {
      const id = placeId(name)
      if (id) scaffolds?.progress(id, p, true)
    }
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
      progress: (name: string, p: number, now = false) => {
        const id = placeId(name)
        if (id) scaffolds?.progress(id, p, now)
      },
      advance: (s: number) => ships?.advance(s),
      rate: (r?: number) => (r === undefined ? ships?.rate() : ships?.setRate(r)),
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

export interface WorkFxMount {
  fx: WorkFx
  dispose(): void
}

/**
 * The work FX on an island (`?workfx=0`: none). `pieces` are the island's placed pieces (the debug
 * driver's spots), `sea` the water's surface.
 */
export function mountWorkFx(parts: {
  stage: Stage
  query: Pick<URLSearchParams, "get">
  light: () => DayLight
  pieces: () => readonly SitePiece[]
  sea: number
}): WorkFxMount | null {
  const spec = workfxOf(parts.query.get("workfx"))
  if (spec?.off) return null
  const fx = createWorkFx(parts.stage, { light: parts.light })
  const fire = (kind: WorkKind, at: readonly [number, number, number], opts: { seed?: number } = {}) =>
    fx.beat(kind, at, undefined, opts)
  const driver: Driver | null = spec?.kinds.length
    ? driveWorkFx(parts.stage, spec, fire, parts.pieces, { sea: parts.sea })
    : null
  const ext = window.guildhall?.ext
  if (ext)
    ext.workfx = {
      emit: fx.emit,
      beat: fx.beat,
      // a kind at its spot near the focus (or the focus itself), now
      fire: (kind: WorkKind, opts: { seed?: number; force?: boolean } = {}) => {
        const [x, y, z] = parts.stage.getCamera().target
        const at = siteFor(kind, parts.pieces(), [x, z], { sea: parts.sea }) ?? [x, y, z]
        return { at, spawned: fx.beat(kind, at, undefined, opts) }
      },
      sites: () => driver?.sites() ?? {},
      freeze: fx.freeze,
      advance: fx.advance,
      clear: fx.clear,
      enable: fx.setEnabled,
      time: fx.time,
      ready: () => fx.ready,
      stats: fx.stats,
    }
  return {
    fx,
    dispose() {
      driver?.dispose()
      fx.dispose()
    },
  }
}
