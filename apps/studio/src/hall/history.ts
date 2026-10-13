/**
 * The hall's history (plan-hud-events T1, spike S4): the island is built once at today's size and the
 * hall's `Clock` (clock.ts, scale history) reveals it as it was on a day, without a rebuild:
 * `t → day → tiles(t) = landTiles(filesAt(c, day))`, eased between days, and never less than on a day
 * before (`landByDay`: risen land does not sink again on a dip in the files). The reveal look is A, "grow"
 * (decisions 2026-10-13): a tile rises from the sea, its pieces grow from the ground, over `span` tiles
 * of count, so a scrub moves a smooth frontier instead of popping tiles.
 *
 * What follows the count (`WorldHooks`, hexworld/index.ts): the ground, roads, stairs and bridges by draw
 * range (render reveal.ts), the batch's pieces by its walk, the water (open sea over land not yet risen,
 * pools rising in their beds), a skirt walling the frontier (order.ts), the gates' leaves, the night's
 * lamps and windows, the town cascade's shadows, and the townsfolk, who stay hidden off the tiles not yet
 * there (their routines are still today's: life on `tiles(t)` is later work).
 *
 * The count follows the clock's tiles at a bounded speed (`follow`): a jump in files (a vendored folder)
 * moves the frontier no faster than twice the history's own pace while playing, and a scrub catches up in
 * well under a second; at rest it is exactly `tiles(t)`, so the same `t` always gives the same picture. A
 * jump of the clock (a link, a restart, a shot) lands at once.
 */
import { log } from "@guildhall/core"
import {
  createReveal,
  groundMaterial,
  type PlaceAt,
  paletteMaterial,
  placesTexture,
  REVEAL_SPAN,
  type Reveal,
  type RevealLook,
  surfaceMaterial,
} from "@guildhall/render"
import {
  type Chronicle,
  DAY_MS,
  type Day,
  dayOf,
  erasOf,
  filesAt,
  isoOf,
  majorsOf,
  unitsAt,
} from "@guildhall/sim"
import { HEX_TILE_SIZE, landTiles } from "@guildhall/world"
import { ROAD_COLOR, type WorldHooks } from "../hexworld/index.ts"
import { type HallTime, HISTORY_SECONDS, type HistoryRange, MAX_DT } from "./clock.ts"
import { placer, skirt, type TilePlaces, tilePlaces } from "./order.ts"

const logger = log("studio:history")

/** Per chronicle, the land on each day from its start: never less than any day before (`landByDay`). */
const lands = new WeakMap<Chronicle, Float64Array>()

/**
 * The land tiles of each day of the history, from `c.start`: `landTiles(filesAt(c, day))`, but never
 * less than it was on a day before. Land that has risen does not sink again: a dip in the files (a
 * sample GitHub cut short, a folder moved out and back) would otherwise sink tiles and raise them again.
 */
export function landByDay(c: Chronicle): Float64Array {
  let out = lands.get(c)
  if (out) return out
  const days = Math.max(0, c.end - c.start) + 1
  out = new Float64Array(days)
  let most = 0
  for (let k = 0; k < days; k++) {
    most = Math.max(most, landTiles(filesAt(c, c.start + k)))
    out[k] = most
  }
  lands.set(c, out)
  return out
}

/** The tiles the island has at `day` (a fractional day eases between two days' counts; `landByDay`). */
export function tilesAt(c: Chronicle, day: number): number {
  const land = landByDay(c)
  const at = (d: number) => land[Math.min(land.length - 1, Math.max(0, d - c.start))] as number
  const d0 = Math.floor(day)
  const f = day - d0
  const a = at(d0)
  if (f <= 0) return a
  return a + (at(d0 + 1) - a) * f
}

/** The day at `t` (0..1) along the chronicle's history. */
export const dayAt = (c: Pick<Chronicle, "start" | "end">, t: number): number =>
  c.start + Math.min(1, Math.max(0, t)) * (c.end - c.start)

/** Where `day` lies along the chronicle's history, 0..1. */
export const tOfDay = (c: Pick<Chronicle, "start" | "end">, day: number): number =>
  c.end > c.start ? Math.min(1, Math.max(0, (day - c.start) / (c.end - c.start))) : 1

/** A paused scrub's count catches up within about this long, seconds. */
export const CATCH_UP_S = 0.35

/**
 * The frontier's top speed while playing, tiles per second: twice the history's own pace at this
 * speed (its tiles from the first commit to today over the seconds it plays), and never under 30.
 */
export function frontierRate(tiles0: number, land: number, rate: number, seconds = HISTORY_SECONDS): number {
  return Math.max(30, (2 * Math.max(0, land - tiles0)) / seconds) * Math.max(1, rate)
}

/**
 * The count one frame on: toward `target`, by at most `limit` tiles a second while playing; paused (a
 * scrub) by whatever closes the gap in `CATCH_UP_S`, or `limit` when that is more. Reaches the target
 * exactly. Pure.
 */
export function follow(shown: number, target: number, dt: number, playing: boolean, limit: number): number {
  if (!Number.isFinite(shown)) return target
  const gap = target - shown
  if (gap === 0) return target
  const speed = playing ? limit : Math.max(limit, Math.abs(gap) / CATCH_UP_S)
  const step = speed * Math.min(Math.max(dt, 0), MAX_DT)
  return Math.abs(gap) <= step ? target : shown + Math.sign(gap) * step
}

/**
 * `?t=` read: a fraction of the history ("0.5") or a day ("2019-03-01", from a shared link). Null:
 * today (none, or one that reads as neither).
 */
export function readT(text: string | null): { t: number } | { day: Day } | null {
  if (!text) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const day = dayOf(`${text}T00:00:00Z`)
    return Number.isFinite(day) ? { day } : null
  }
  const t = Number(text)
  return Number.isFinite(t) && t >= 0 && t <= 1 ? { t } : null
}

/** `?t=` written: the day the clock is on, or null at today (the link's own default). */
export function writeT(c: Pick<Chronicle, "start" | "end">, t: number): string | null {
  return t >= 1 ? null : isoOf(Math.floor(dayAt(c, t)))
}

type Marker = HistoryRange["markers"][number]

/** The bar's beats and bounds for a chronicle: its majors as releases, the eras' starts and the units' births. */
export function historyMarkers(c: Chronicle): Marker[] {
  const at = (day: Day) => day * DAY_MS
  const out: Marker[] = majorsOf(c).map((r) => ({ at: at(r.day), kind: "release", label: r.tag }))
  const eras = erasOf(c).spans
  for (const e of eras.slice(1))
    if (!out.some((m) => Math.abs(m.at - at(e.from)) < DAY_MS))
      out.push({ at: at(e.from), kind: "release", label: e.opens?.tag ?? `A new era, ${isoOf(e.from)}` })
  for (const m of c.milestones)
    if (m.kind === "born" && m.day > c.start) out.push({ at: at(m.day), kind: "born", label: m.text })
  return out.sort((a, b) => a.at - b.at)
}

export interface HistoryOpts {
  /** The hall's time: its clock, and where the bar learns the history's bounds. */
  time: HallTime
  /** The repo's chronicle (null: no history, the island is drawn as it is). */
  chronicle: Promise<Chronicle | null>
  /** Where to open (`readT` of `?t=`): a day lands once the chronicle is read. */
  at?: ReturnType<typeof readT>
  look?: RevealLook
  /** The frontier's width, tiles on their way in at once. */
  span?: number
  /** The Studio lab: the title card's figures carry the day, the files and the tiles. */
  figures?: boolean
  /** The clock came to rest (paused a moment) on `t`: what `?t=` should say (null: today). */
  onRest?(t: string | null): void
}

/** How long the clock rests before `onRest` hears of it, ms (a drag writes the URL once, at its end). */
const REST_MS = 400

export interface History {
  hooks: WorldHooks
  dispose(): void
}

/** The history reveal over a hall's island: its world hooks, driven by the hall's clock. */
export function createHistory(opts: HistoryOpts): History {
  const { time } = opts
  const clock = time.clock
  const look = opts.look ?? "grow"
  const span = Math.max(0, opts.span ?? REVEAL_SPAN) || 0
  const reveal: Reveal = createReveal(look)
  let c: Chronicle | null = null
  let places: TilePlaces | null = null
  let placeAt: PlaceAt | null = null
  let disposed = false
  const offs: (() => void)[] = []
  void opts.chronicle.then((read) => {
    if (disposed || !read) return
    c = read
    if (opts.at && "day" in opts.at) clock.seek(tOfDay(read, opts.at.day), { jump: true })
  })

  const hooks: WorldHooks = {
    transport: true,
    prepare(island) {
      if (!c) return
      places = tilePlaces(island)
      placeAt = placer(island, places)
      // the island opens as it was at the clock's day: nothing drawn whole and then taken away
      reveal.set(countOf(tilesAt(c, dayAt(c, clock.get().t))), span)
      logger.info("history", {
        repo: c.repo.name,
        start: isoOf(c.start),
        end: isoOf(c.end),
        land: island.stats.land,
        ranked: places.ranked,
        tiles0: Math.round(tilesAt(c, c.start)),
        look,
        span,
      })
    },
    mesh(stage, data, kind) {
      if (!placeAt) return null
      const material =
        kind === "ground"
          ? groundMaterial()
          : kind === "roads"
            ? surfaceMaterial(ROAD_COLOR)
            : paletteMaterial()
      return reveal.mesh(stage, data, placeAt, { material, castShadow: kind !== "roads" })
    },
    built(parts) {
      const chronicle = c
      const tiles = places
      const place = placeAt
      if (disposed || !chronicle || !tiles || !place) return
      const land = tiles.ranked
      reveal.batch(parts.batch.mesh, place)
      // the frontier's skirt, like the ground: the palette material, its tile's place, gone at the neighbour's
      const wall = skirt(parts.island, parts.groundAt, tiles)
      reveal.mesh(parts.stage, wall.data, place, {
        material: paletteMaterial(),
        until: wall.until,
        castShadow: false,
      })
      // townsfolk stay off the tiles not yet there (their routines are today's)
      parts.life?.hide((x, z) => place(x, z, 0, 0) >= reveal.count)
      // the water: hidden land is open sea, pools rise with their tiles
      parts.water?.setReveal({
        places: placesTexture(parts.island.grid, (i) => tiles.place[i] as number),
        radius: parts.island.grid.radius,
        tile: HEX_TILE_SIZE,
        count: reveal.uniforms.count,
        span: reveal.uniforms.span,
        sink: reveal.uniforms.sink,
      })
      const gates = parts.doors.gates
      // each unit's birthday; a pool's ("packages/*") is its first member's, which the chronicle's own pool carries
      const born = new Map(chronicle.units.map((u) => [u.name, u.born]))
      const tiles0 = tilesAt(chronicle, chronicle.start)
      let shown = Number.NaN
      let jumps = clock.get().jumps
      let drawn = Number.NaN
      /** Everything that follows the count, `n` tiles whole. */
      const show = (n: number) => {
        if (n === drawn) return
        drawn = n
        // the count is the frontier's far edge: n tiles whole, the next `span` on their way in
        reveal.set(countOf(n), span)
        parts.sun.markDirty()
        gates?.hide((x, z) => place(x, z, 0, 0) >= n)
        parts.night?.hide((x, z) => place(x, z, 0, 0) >= n)
        // a place's plate once its unit is born and its heart is whole
        const today = dayAt(chronicle, clock.get().t)
        parts.labels?.hide(
          (x, z, id) => place(x, z, 0, 0) >= n || (id !== undefined && (born.get(id) ?? -Infinity) > today),
        )
        if (opts.figures)
          parts.viewer.setInfo({
            figures: [
              { label: "Day", value: isoOf(Math.floor(dayAt(chronicle, clock.get().t))) },
              { label: "Files", value: filesAt(chronicle, Math.floor(dayAt(chronicle, clock.get().t))) },
              { label: "Tiles", value: `${Math.round(n)} / ${land}` },
            ],
          })
      }
      /** The count for `n` whole tiles: the end of the history is the whole island, whatever its ranks. */
      const target = () => {
        const t = clock.get().t
        return t >= 1
          ? Math.max(land, tilesAt(chronicle, chronicle.end))
          : tilesAt(chronicle, dayAt(chronicle, t))
      }
      const step = (dt: number) => {
        clock.tick(dt)
        const s = clock.get()
        const goal = target()
        if (s.jumps !== jumps || !Number.isFinite(shown)) {
          jumps = s.jumps
          shown = goal
        } else shown = follow(shown, goal, dt, s.playing, frontierRate(tiles0, land, s.rate))
        show(shown)
      }
      step(0)
      offs.push(parts.stage.onFrame(step))
      // the plates' file counts are the day's once the clock rests (today's at the end of the history)
      const labels = parts.labels
      if (labels) {
        let counted = Number.NaN
        const count = () => {
          const s = clock.get()
          if (s.playing || s.t === counted) return
          counted = s.t
          if (s.t >= 1) return labels.files(null)
          const files = new Map(unitsAt(chronicle, dayAt(chronicle, s.t)).map((u) => [u.name, u.files]))
          labels.files((id) => (id === undefined ? undefined : files.get(id)))
        }
        count()
        offs.push(clock.subscribe(count))
      }
      // the link follows the clock at rest
      const onRest = opts.onRest
      if (onRest) {
        let timer = 0
        let said: string | null | undefined
        offs.push(() => clearTimeout(timer))
        offs.push(
          clock.subscribe(() => {
            clearTimeout(timer)
            if (clock.get().playing) return
            timer = window.setTimeout(() => {
              const now = writeT(chronicle, clock.get().t)
              if (now !== said) onRest(now)
              said = now
            }, REST_MS)
          }),
        )
      }
      time.setRange({
        start: chronicle.start * DAY_MS,
        end: chronicle.end * DAY_MS,
        markers: historyMarkers(chronicle),
      })
      const ext = window.guildhall?.ext
      if (ext)
        ext.replay = {
          repo: chronicle.repo.name,
          look,
          span,
          start: chronicle.start,
          end: chronicle.end,
          land,
          get: () => dayAt(chronicle, clock.get().t),
          set: (d: number) => {
            clock.seek(tOfDay(chronicle, d), { jump: true })
            step(0)
          },
          /** 0..1 along the history. */
          t: () => clock.get().t,
          setT: (t: number) => {
            clock.seek(t, { jump: true })
            step(0)
          },
          tiles: () => shown,
          /** The clock as the bar drives it. */
          play: (on: boolean) => clock.play(on),
          setRate: (rate: number) => clock.setRate(rate),
          playing: () => clock.get().playing,
          files: () => filesAt(chronicle, Math.floor(dayAt(chronicle, clock.get().t))),
          /** The centre of a tile on the frontier now (mid-way in), for a shot's camera; null at the end. */
          frontier: () => {
            const want = shown + span / 2
            let best = -1
            for (let i = 0; i < tiles.place.length; i++) {
              const p = tiles.place[i] as number
              if (p < 0) continue
              if (best < 0 || Math.abs(p - want) < Math.abs((tiles.place[best] as number) - want)) best = i
            }
            if (best < 0) return null
            const g = parts.island.grid
            const q = g.q[best] as number
            const r = g.r[best] as number
            return {
              x: HEX_TILE_SIZE * Math.sqrt(3) * (q + r / 2),
              z: HEX_TILE_SIZE * 1.5 * r,
              place: tiles.place[best],
            }
          },
        }
    },
  }
  /** The reveal count for `n` whole tiles: n, and the next `span` on their way in. */
  const countOf = (n: number) => n + span

  return {
    hooks,
    dispose() {
      disposed = true
      for (const off of offs) off()
      reveal.dispose()
      time.setRange(null)
      const ext = window.guildhall?.ext
      if (ext) delete ext.replay
    },
  }
}
