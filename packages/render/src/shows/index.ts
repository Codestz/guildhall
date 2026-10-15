/**
 * The sky and town shows (plan v1events, task C): a dragon round the peaks, a comet or a shower of
 * shooting stars, a rainbow (a moonbow by night), a festival round the busiest square. The world-events
 * engine schedules them (`play(show)`, a `Show`: kind, start and end on the shows' clock, params); a
 * debug driver plays one now (`play("dragon")`).
 *
 * A show is built when it starts (its programs linked off the frame, warm.ts, before it is shown) and
 * freed when it is over. With nothing playing nothing is in the scene and no frame hook runs: the
 * picture and the frame are the island's own. Playing, each costs a draw or two and a few uniforms.
 *
 * The clock: by default the shows keep their own (seconds, moved by the frames while something plays);
 * `opts.clock` puts them on another (the engine's run time).
 */
import type { Camera } from "three"
import type { EventSites } from "../events/sites.ts"
import type { DayLight } from "../light.ts"
import type { Stage } from "../stage.ts"
import { warmPrograms } from "../warm.ts"
import { createComet } from "./comet.ts"
import { createDragon, DRAGON_LEAVE_S } from "./dragon.ts"
import { createFestival } from "./festival.ts"
import { createRainbow } from "./rainbow.ts"
import {
  NIGHT_AT,
  SHOW_KINDS,
  SHOW_S,
  type Show,
  type ShowCtx,
  type ShowKind,
  type ShowPiece,
} from "./show.ts"

export {
  bankAt,
  breathAt,
  CRUISE_CLEAR,
  DRAGON_ARRIVE_S,
  DRAGON_LEAVE_S,
  dragonAt,
  dragonFlight,
  dragonOrbit,
  dragonState,
  highestUnder,
  SWOOP_CLEAR,
  shadowLook,
} from "./dragon.ts"
export {
  buildBunting,
  CROWN_S,
  FINALE_S,
  fireworksProgramme,
  POLE_H,
  ROCKET_S,
  type Shell,
  type ShellStyle,
  STAR_S,
} from "./festival.ts"
export { BEAT_S, beatAngle, type FlightPlan, flightPlan, wingAngle } from "./flight.ts"
export { rainbowSize } from "./rainbow.ts"
export { envelope, NIGHT_AT, SHOW_KINDS, SHOW_S, type Show, type ShowKind } from "./show.ts"

export interface ShowsOpts {
  sites: EventSites
  /** The island's half extent, metres. */
  span: number
  /** The sky's light now (night versions, the dragon's ember). */
  light: () => DayLight
  /** The clock `Show.start` and `end` are on (seconds); the shows' own when left out. */
  clock?: () => number
  /** Reduced motion; the user's setting when left out. */
  still?: boolean
  /** The island's surface at (x, z) (`ShowCtx.ground`): the dragon's clearance and its shadow. */
  ground?: (x: number, z: number) => number
}

export interface ShowsStats {
  /** The kinds playing (built, started, not over). */
  playing: ShowKind[]
  /** Draw calls the shows add this frame. */
  draws: number
  /** Mean CPU ms of the shows' frame hook over the last frames it ran (0 when nothing has played). */
  ms: number
  /** Whether the frame hook is subscribed (only while something plays or waits to). */
  hooked: boolean
}

export interface Shows {
  /**
   * Plays a show: a `Show` from the engine, or a kind to play now for its usual time (`SHOW_S`). A kind
   * already playing is re-timed (a dragon's `end` moved on keeps it circling) rather than doubled.
   */
  play(show: Show | ShowKind): Show
  /** Links every kind's programs ahead and keeps them, so no show's start links one (for under a loading cover). */
  prewarm(): Promise<void>
  /** Ends a kind now (a dragon turns for home and leaves; the rest fade out quickly); all with none. */
  stop(kind?: ShowKind): void
  /** Removes every show at once, no fade. */
  clear(): void
  /** The shows' clock now, seconds. */
  now(): number
  /** Holds every show at `t` seconds into it (shots); null lets them run. */
  hold(t: number | null): void
  /** Resolves once every playing show's programs are linked and it is in view. */
  ready(): Promise<void>
  playing(): Show[]
  /** Where to film a playing kind now (the dragon as it flies), null when it is not shown or says nothing. */
  subject(kind: ShowKind): [number, number, number] | null
  stats(): ShowsStats
  dispose(): void
}

/** How long a stopped show takes to fade (a dragon takes its leave), seconds. */
const STOP_S = 2.5

interface Playing {
  show: Show
  piece: ShowPiece
  ready: Promise<void>
  shown: boolean
}

const reducedMotion = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true

export function createShows(stage: Stage, opts: ShowsOpts): Shows {
  let own = 0
  const now = () => (opts.clock ? opts.clock() : own)
  const playing = new Map<ShowKind, Playing>()
  let held: number | null = null
  let off: (() => void) | null = null
  const costs: number[] = []
  let disposed = false

  const build = (kind: ShowKind, ctx: ShowCtx): ShowPiece => {
    switch (kind) {
      case "dragon":
        return createDragon(ctx)
      case "comet":
        return createComet(ctx)
      case "rainbow":
        return createRainbow(ctx)
      case "festival":
        return createFestival(ctx)
    }
  }

  const end = (kind: ShowKind) => {
    const p = playing.get(kind)
    if (!p) return
    playing.delete(kind)
    p.piece.dispose()
  }

  const frame = (dt: number, camera: Camera) => {
    const t0 = performance.now()
    own += Math.min(dt, 0.1)
    const t = now()
    for (const [kind, p] of playing) {
      if (held === null && t >= p.show.end) {
        end(kind)
        continue
      }
      const age = held ?? t - p.show.start
      const total = p.show.end - p.show.start
      p.piece.object.visible = p.shown && age >= 0
      if (p.piece.object.visible) p.piece.update(age, total, camera)
    }
    if (!playing.size) unhook()
    costs.push(performance.now() - t0)
    if (costs.length > 120) costs.shift()
  }

  const hook = () => {
    off ??= stage.onFrame((dt) => frame(dt, stage.camera))
  }
  const unhook = () => {
    off?.()
    off = null
  }

  /** What a show is built with now: the sites, the span, the light (its night form), the motion preference. */
  const ctxOf = (): ShowCtx => {
    const light = opts.light()
    return {
      stage,
      sites: opts.sites,
      span: opts.span,
      night: light.night > NIGHT_AT,
      still: opts.still ?? reducedMotion(),
      nightLevel: () => opts.light().night,
      ...(opts.ground ? { ground: opts.ground } : {}),
    }
  }

  /**
   * Links every kind's programs now and keeps them (warm.ts `pin`): each kind built once, hidden, its
   * programs read and pinned, the piece torn down again. Under the loading cover, where the links'
   * waits (30–50 ms each on ANGLE/Metal, at the first sync use whatever came before) cost no frame
   * anyone sees; a show's first start then links nothing, and nor does its tenth (a show's own
   * materials go with it, and three dropped the program with them).
   */
  const prewarm = async (): Promise<void> => {
    for (const kind of SHOW_KINDS) {
      if (disposed) return
      const piece = build(kind, ctxOf())
      piece.object.visible = false
      stage.scene.add(piece.object)
      try {
        await warmPrograms(stage, piece.object, undefined, { pin: true })
      } finally {
        piece.object.removeFromParent()
        piece.dispose()
      }
    }
  }

  const play = (input: Show | ShowKind): Show => {
    const t = now()
    const show: Show =
      typeof input === "string" ? { kind: input, start: t, end: t + SHOW_S[input] } : { ...input }
    if (disposed) return show
    // only a dragon stays until told; and it needs its time to leave
    if (show.kind !== "dragon" && !Number.isFinite(show.end)) show.end = show.start + SHOW_S[show.kind]
    if (show.kind === "dragon") show.end = Math.max(show.end, t + DRAGON_LEAVE_S)
    const current = playing.get(show.kind)
    if (current) {
      // the same kind again: re-timed, never doubled (the engine moves a dragon's end on)
      current.show.end = show.end
      if (show.params) current.show.params = show.params
      return current.show
    }
    const piece = build(show.kind, ctxOf())
    piece.object.visible = false
    stage.scene.add(piece.object)
    const entry: Playing = { show, piece, shown: false, ready: Promise.resolve() }
    entry.ready = warmPrograms(stage, piece.object).then(() => {
      entry.shown = true
    })
    playing.set(show.kind, entry)
    hook()
    return show
  }

  return {
    play,
    prewarm,
    stop(kind) {
      const t = now()
      for (const k of kind ? [kind] : SHOW_KINDS) {
        const p = playing.get(k)
        if (!p) continue
        // a dragon leaves over its own time; the rest fade over a moment
        const fade = k === "dragon" ? DRAGON_LEAVE_S : STOP_S
        p.show.end = Math.min(p.show.end, t + fade)
      }
    },
    clear() {
      for (const k of [...playing.keys()]) end(k)
      unhook()
    },
    now,
    hold(t) {
      held = t
    },
    async ready() {
      await Promise.all([...playing.values()].map((p) => p.ready))
    },
    playing: () => [...playing.values()].map((p) => ({ ...p.show })),
    subject(kind) {
      const p = playing.get(kind)
      return p?.shown && p.piece.object.visible ? (p.piece.subject?.() ?? null) : null
    },
    stats: () => ({
      playing: [...playing.keys()],
      draws: [...playing.values()].reduce((n, p) => n + p.piece.draws(), 0),
      ms: costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : 0,
      hooked: off !== null,
    }),
    dispose() {
      disposed = true
      for (const k of [...playing.keys()]) end(k)
      unhook()
    },
  }
}
