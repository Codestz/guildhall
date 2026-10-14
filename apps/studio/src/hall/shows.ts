/**
 * The world events on the island (plan .probe/v1events, the engine connected to every show): what
 * hall/events.ts says is on stage at the session's clock, handed to the pieces that draw it.
 *
 *   dragon · comet · rainbow · festival   render shows/ (`Shows.play`), on the session's clock in seconds
 *   ghostship · raid                      render sea/ (`SeaLife.setShows`), on the sea's clock (the session's, ms)
 *   undead                                render undead/ (hexworld/undead.ts reads the graves itself)
 *
 * The shows' clock is the engine's: a show starts at its `start` and is gone at its `end` on the session
 * clock, so a replay at 4× plays it 4× and a pause holds it. A seek begins the watching again (the engine
 * replays nothing from before it), so what was playing is cleared at once, never faded in.
 *
 * Each also says where it stands for the director (`HallEvents.setSite`): the dragon over the peaks, the
 * festival on the square, the comet and the rainbow over the island, the ghost ship and the raid where
 * their hulls are on the water.
 */
import type {
  EventSites,
  Show as RenderShow,
  ShowKind as RenderShowKind,
  SeaLife,
  SeaShow,
  Shows,
} from "@guildhall/render"
import type { Show, ShowKind } from "@guildhall/sim"
import type { HallEvents, ShowPoint } from "./events.ts"

/** The kinds render shows/ plays. */
export const SKY_KINDS: readonly RenderShowKind[] = ["dragon", "comet", "rainbow", "festival"]
/** The kinds render sea/ sails. */
export const SEA_KINDS: readonly ShowKind[] = ["ghostship", "raid"]
/** The ghost ship's passage (render sea plan `SEA.GHOST_S`), ms: an end before it is an early one. */
const GHOST_MS = 36_000

const isSky = (kind: ShowKind): kind is RenderShowKind & ShowKind =>
  (SKY_KINDS as readonly string[]).includes(kind)

/**
 * An engine show as render shows/ plays it (null for the kinds it does not draw): seconds on the
 * session's clock; a dragon still circling has no end yet (Infinity), one told to go leaves by `end`.
 */
export function skyShowOf(show: Show): RenderShow | null {
  if (!isSky(show.kind)) return null
  return {
    kind: show.kind,
    start: show.start / 1000,
    end: show.end / 1000,
    params: {
      id: show.id,
      ...(show.params.who ? { who: show.params.who.name } : {}),
      ...(show.params.size !== undefined ? { size: show.params.size } : {}),
    },
  }
}

/**
 * The engine's sea shows as render sea/ sails them (ms on the sea's clock, the session's): the ghost
 * ship's own passage unless it was ended early; the raid lies at anchor until it is told to go
 * (`leave`), then sails off (its leaving is the sea's own).
 */
export function seaShowsOf(shows: readonly Show[]): SeaShow[] {
  const out: SeaShow[] = []
  for (const s of shows) {
    if (s.kind === "ghostship") {
      const early = Number.isFinite(s.end) && s.end < s.start + GHOST_MS
      out.push({ kind: "ghostship", start: s.start, ...(early ? { end: s.end } : {}), params: { key: s.id } })
    } else if (s.kind === "raid") {
      out.push({
        kind: "raid",
        start: s.start,
        ...(s.leave !== undefined ? { end: s.leave } : {}),
        params: { key: s.id },
      })
    }
  }
  return out
}

/** What a sync asks of render shows/: which to play (or re-time), which to stop, whether to clear first. */
export interface SkyPlan {
  clear: boolean
  play: RenderShow[]
  stop: RenderShowKind[]
}

/**
 * The step from what render shows/ plays (`playing`, with the engine id each was started for) to what
 * the engine has on stage (`shows`). Pure. A kind playing for another show is stopped first (it fades;
 * the new one waits for the next sync); one already playing is re-timed only when its end moved.
 */
export function skyPlan(
  shows: readonly Show[],
  playing: ReadonlyMap<RenderShowKind, { id: string; end: number }>,
  jumped: boolean,
): SkyPlan {
  const want = new Map<RenderShowKind, RenderShow>()
  for (const s of shows) {
    const r = skyShowOf(s)
    if (r) want.set(r.kind, r)
  }
  const plan: SkyPlan = { clear: jumped && playing.size > 0, play: [], stop: [] }
  const now = jumped ? new Map() : playing
  for (const [kind, p] of now) {
    const w = want.get(kind)
    if (!w || w.params?.id !== p.id) plan.stop.push(kind)
  }
  for (const [kind, w] of want) {
    const p = now.get(kind)
    if (!p) plan.play.push(w)
    else if (p.id === w.params?.id && p.end !== w.end) plan.play.push(w)
  }
  return plan
}

/** How often the drive looks again between the engine's changes (a fade ending, a seek), ms. */
const SYNC_MS = 250
/**
 * The comet is laid out in the view it starts in (render shows/comet.ts): it waits for the director's
 * glide to the sky (<= 2.4 s, hall/camera.ts `glideMs`) before it is built, so it falls in the view the
 * camera settles on. It keeps its engine start: it is that far in when it shows.
 */
export const COMET_SETTLE_S = 2.6

/**
 * Plays the engine's sky and town shows on `shows` (render shows/, put on the session's clock by its
 * mount) and says where they stand. Returns the stop.
 */
export function driveSkyShows(
  shows: Shows,
  events: HallEvents,
  clock: { jumps(): number; now(): number },
  sites: EventSites,
  /** Whether the sky is night now (render `NIGHT_AT`): a festival by night is its fireworks. */
  night: () => boolean = () => false,
): () => void {
  /** What render plays for whom: the engine id each kind was started for, and the end it was given. */
  const started = new Map<RenderShowKind, { id: string; end: number }>()
  let jumps = clock.jumps()
  const sync = () => {
    const j = clock.jumps()
    const jumped = j !== jumps
    jumps = j
    // what render still plays (a stopped one fades, then is gone)
    const live = new Set(shows.playing().map((p) => p.kind))
    for (const kind of [...started.keys()]) if (!live.has(kind)) started.delete(kind)
    const plan = skyPlan(events.shows(), started, jumped)
    if (plan.clear) {
      shows.clear()
      started.clear()
    }
    for (const kind of plan.stop) {
      shows.stop(kind)
      // fading out: a new show of the kind starts once this one is gone (skyPlan waits on the id)
      started.set(kind, { id: "", end: Number.NaN })
    }
    for (const show of plan.play) {
      if (show.kind === "comet" && !started.has("comet") && clock.now() < show.start + COMET_SETTLE_S)
        continue
      shows.play(show)
      started.set(show.kind, { id: String(show.params?.id ?? ""), end: show.end })
    }
  }
  sync()
  const off = events.subscribe(sync)
  const timer = setInterval(sync, SYNC_MS)
  // where they stand: the peaks (lifted by the hint), the square, the island's middle for the sky
  const peak = sites.peak?.at
  const square = sites.square?.at
  const middle: ShowPoint = [0, 0, 0]
  events.setSite("dragon", () => (peak ? [peak[0], peak[1], peak[2]] : null))
  // the festival: by night its fireworks over the keep (render festival.ts bursts 10-19 m over it), by
  // day the square's bunting and confetti
  const keep = sites.castle
  const fireworks: ShowPoint | null = keep ? [keep[0], keep[1] + 12, keep[2]] : null
  const bunting: ShowPoint | null = square ? [square[0], square[1] + 4, square[2]] : null
  events.setSite("festival", () => (night() ? (fireworks ?? bunting) : (bunting ?? fireworks)))
  events.setSite("comet", () => middle)
  events.setSite("rainbow", () => middle)
  return () => {
    off()
    clearInterval(timer)
    for (const kind of ["dragon", "festival", "comet", "rainbow"] as const) events.setSite(kind, null)
    shows.clear()
  }
}

/**
 * Sails the engine's ghost ship and raid on `sea` (its clock already the session's, hall/sea.ts) and
 * says where their hulls are. Returns the stop.
 */
export function driveSeaShows(
  sea: SeaLife,
  events: HallEvents,
  level: number,
  /** Where the ghost ship passes (the graveyard's coast, xz), while its hull is not yet on the water. */
  ghostNear: readonly [number, number] | null = null,
): () => void {
  let last = ""
  const sync = () => {
    const list = seaShowsOf(events.shows())
    const key = JSON.stringify(list)
    if (key === last) return
    last = key
    sea.setShows(list)
  }
  sync()
  const off = events.subscribe(sync)
  // where a hull is now; before it is on the water, where it is bound (the graveyard's coast, the quay)
  const hull =
    (name: string, bound: () => readonly [number, number] | null | undefined) => (): ShowPoint | null => {
      const ships = sea.view().ships
      const at = ships.find((s) => s.hull === name)?.at ?? bound()
      return at ? [at[0], level, at[1]] : null
    }
  events.setSite(
    "ghostship",
    hull("ghost", () => ghostNear),
  )
  events.setSite(
    "raid",
    hull("pirate", () => sea.view().ships.find((s) => s.key === "quay-boat")?.at),
  )
  return () => {
    off()
    events.setSite("ghostship", null)
    events.setSite("raid", null)
    sea.setShows([])
  }
}
