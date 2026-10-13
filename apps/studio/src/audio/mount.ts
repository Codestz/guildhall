/**
 * The island's sound (V1's audio/, ported: decisions.md "V1 UI parity", "Port ALL V1 sounds"), mounted
 * by the hex world once its island is built (one call). Muted by default: until the viewer turns it on
 * nothing here runs but a prefs subscription, and no AudioContext exists. On, the first gesture
 * creates the context (browsers' autoplay rule); a returning viewer who left it on finds a dot on the
 * speaker and their first click or key anywhere starts it.
 *
 * What it listens to:
 *   the guild   a hall's session (`?feed=`: its log on its clock, hall/hud/mount.tsx `hallSession`),
 *               or the site's own demo guild on life's agent clock (`/`, `/town`): driver.ts hears
 *               what the clock plays through, cues.ts reads each event as V1's moment, engine.ts plays it
 *   the camera  the Stage's camera as the listener: pan and distance gain (spatial.ts)
 *   the light   the sky's sun: the key turns minor at night, birds by day, crickets on a clear night
 *   the weather the F1 sky drive (CI weather): rain with the storm, thunder after each strike
 *   the island  the shore field (the sea near the coast), the places (a town's crowd), the castle's hearth
 *
 * Cost: on, about one array step a frame (the driver) and a 10 Hz sample of the camera and the bed;
 * `window.guildhall.ext.audio` says what plays (`stats()`, `probe`) and what it costs (`cpu`).
 */
import type { DayLight, EventSites, Stage } from "@guildhall/render"
import { EventLog, flush, GONE_MS, normalize, normalizer, type WorldEvent } from "@guildhall/sim"
import type { Fx } from "../hexworld/fx.ts"
import type { ShoreStage } from "../hexworld/job.ts"
import type { Life } from "../hexworld/life.ts"
import { type AgentPlan, agentSource, DEMO_FOLDERS, demoStory } from "../hexworld/lifeAgents.ts"
import { bedOf, firePanOf } from "./ambience.ts"
import { cueOf, type IslandSpots, infoOf } from "./cues.ts"
import { CueDriver, type Timeline } from "./driver.ts"
import { audio, type Where } from "./engine.ts"
import type { MoodId } from "./kinds.ts"
import { keyOf } from "./music.ts"
import { soundPrefs } from "./prefs.ts"
import { type Listener, listenerOf, smoothstep } from "./spatial.ts"

export interface SoundParts {
  stage: Stage
  /** The island's people (null with `?life=0`): where each hero is drawn, and the demo's clock. */
  life: Life | null
  /** The worker's life plan: the demo guild's span and round. */
  plan: Promise<{ agents: AgentPlan | null }>
  /** The sky's light now (the weathered one with the FX). */
  light(): DayLight
  /** The island's mood (its key): the Morning Keep unless a screen says. */
  mood?(): MoodId
  sites: EventSites
  /** Inland water: rivers and lakes. */
  pools: readonly { x: number; z: number }[]
  /** The shore field (distance to land over the water), when the worker has baked it. */
  shore: Promise<ShoreStage>
  /** The event FX, once mounted (null without them): the weather's mix and its strikes. */
  fx(): Fx | null
  /** A hall playing a session (`?feed=`): the guild is its log, not the demo's. */
  session: boolean
}

/** The camera, the bed, the key and the pleas are sampled this often (ms): ≈10 Hz, never per frame. */
const SAMPLE_MS = 100

/** How busy each kind of place sounds (its crowd), 0–1. */
const BUSY: Readonly<Record<string, number>> = {
  town: 1,
  market: 0.85,
  harbour: 0.7,
  castle: 0.6,
  fishing: 0.55,
  camp: 0.5,
  farm: 0.45,
  hamlet: 0.4,
  mine: 0.4,
  lumber: 0.35,
  monastery: 0.3,
}
/** Places with a fire you hear close up: the Guildhall's hearth, a camp's fire. */
const FIRES = new Set(["castle", "camp"])

export function mountSound(parts: SoundParts): () => void {
  let gone = false
  let run: (() => void) | null = null
  const ext = window.guildhall?.ext as Record<string, unknown> | undefined
  audio.probe ??= []
  const cpu = { frame: 0, sample: 0, frames: 0 }
  if (ext)
    ext.audio = {
      engine: audio,
      get probe() {
        return audio.probe
      },
      stats: () => ({ ...audio.stats(), running: run !== null, cpu: { ...cpu } }),
    }

  const sync = () => {
    const prefs = soundPrefs.get()
    audio.setLevels(prefs)
    // sound that is on and unlocked runs; off, or still waiting for the first gesture, nothing does
    if (prefs.on && audio.state !== "locked" && !run && !gone) run = start(parts, cpu)
    else if ((!prefs.on || gone) && run) {
      run()
      run = null
    }
  }
  const offPrefs = soundPrefs.subscribe(sync)
  const offState = audio.subscribe(sync)
  const onVisibility = () => audio.setHidden(document.hidden)
  onVisibility()
  document.addEventListener("visibilitychange", onVisibility)
  // a returning listener who left it on: the first gesture anywhere starts it
  const onGesture = () => {
    if (soundPrefs.get().on && audio.state === "locked") audio.unlock()
  }
  window.addEventListener("pointerdown", onGesture, true)
  window.addEventListener("keydown", onGesture, true)
  sync()

  return () => {
    gone = true
    offPrefs()
    offState()
    document.removeEventListener("visibilitychange", onVisibility)
    window.removeEventListener("pointerdown", onGesture, true)
    window.removeEventListener("keydown", onGesture, true)
    run?.()
    run = null
    if (ext?.audio) delete ext.audio
    // the island is gone: its bed falls silent and the context sleeps until another island wakes it
    audio.rebuild()
    audio.setHidden(true)
  }
}

/** The sound running on the island: the guild's driver, the listener, the bed. Returns the stop. */
function start(parts: SoundParts, cpu: { frame: number; sample: number; frames: number }): () => void {
  const { stage, life, sites } = parts
  let stopped = false
  let timeline: Timeline | null = null
  let undo = () => {}
  const castle = sites.castle ? { x: sites.castle[0], z: sites.castle[2] } : null
  const harbourSite = sites.harbours[0]
  const harbour = harbourSite ? { x: harbourSite.heart[0], z: harbourSite.heart[2] } : null
  const monastery = sites.places.find((p) => p.kind === "monastery")
  const byZone = new Map(sites.places.map((p) => [p.zone, { kind: p.kind, at: { x: p.at[0], z: p.at[2] } }]))
  const heroAt = (id: string): Where | null => {
    const at = life?.heroAt(id)
    return at ? { x: at[0], z: at[2] } : null
  }
  const spots: IslandSpots = {
    zone: (zone) => byZone.get(zone),
    pathKind: (path) => DEMO_FOLDERS[/^\/demo\/[^/]+\/([^/]+)\//.exec(path)?.[1] ?? ""],
    castle,
    harbour,
    chapel: monastery ? { x: monastery.at[0], z: monastery.at[2] } : castle,
    heroAt,
  }
  const driver = new CueDriver(
    (ev: WorldEvent) => {
      const cue = cueOf(ev)
      if (!cue) return
      audio.hearing = ev.at
      audio.moment(cue, infoOf(cue, spots))
      audio.hearing = undefined
    },
    () => audio.rebuild(),
  )

  // the guild: a hall's session, or the site's demo guild on life's agent clock
  if (parts.session) {
    void import("../hall/hud/mount.tsx").then(({ hallSession }) => {
      const look = (tries: number) => {
        if (stopped) return
        const session = hallSession()
        if (!session) {
          if (tries > 0) setTimeout(() => look(tries - 1), 100)
          return
        }
        timeline = {
          events: () => session.log().events,
          clock: () => {
            const c = session.clock.get()
            return { at: c.at, jumps: c.jumps }
          },
        }
      }
      look(300)
    })
  } else if (life) {
    void parts.plan.then(({ agents }) => {
      if (stopped || !agents || agents.feed !== "story") return
      // the demo's events, read here as the worker read them (its places are kinds by path: cues.ts)
      const ctx = normalizer()
      const log = new EventLog()
      for (const ev of demoStory()) log.append(...normalize(ev, ctx))
      log.append(...flush(ctx, log.head.at + GONE_MS + 1))
      // life's agent clock, read off the poses it asks for (the same source, tapped)
      const source = agentSource(agents)
      let secs = Number.NaN
      life.setAgents({
        list: source.list,
        poseAt(id, s) {
          if (!(s <= secs)) secs = s
          return source.poseAt(id, s)
        },
      })
      undo = () => life.setAgents(agentSource(agents))
      const [first] = agents.span
      const p = agents.period
      timeline = {
        events: () => log.events,
        clock: () => ({ at: Number.isNaN(secs) ? first : first + ((((secs * 1000) % p) + p) % p), jumps: 0 }),
        loops: true,
      }
    })
  }

  // the bed's places: open water near the coast, the towns, the fires
  let water: Where[] = parts.pools.map((p) => ({ x: p.x, z: p.z }))
  void parts.shore.then((shore) => {
    if (!stopped) water = water.concat(coastOf(shore))
  })
  const towns = sites.places.map((p) => ({ x: p.at[0], z: p.at[2], weight: BUSY[p.kind] ?? 0.3 }))
  const fires: Where[] = [
    ...(castle ? [castle] : []),
    ...sites.places
      .filter((p) => FIRES.has(p.kind) && p.kind !== "castle")
      .map((p) => ({ x: p.at[0], z: p.at[2] })),
  ]

  let strikes = parts.fx()?.drive.stats().strikes ?? 0
  const sample = () => {
    const t0 = performance.now()
    const camera = stage.camera
    const listener = listenerOf(camera, camera.aspect || 1)
    audio.setListener(listener)
    const light = parts.light()
    const daylight = smoothstep(-0.12, 0.35, Math.sin((light.elevation * Math.PI) / 180))
    audio.setKey(keyOf(parts.mood?.() ?? "keep", daylight))
    const drive = parts.fx()?.drive.stats()
    const storm = drive?.mix.storm ?? 0
    const cloud = drive?.mix.cloud ?? 0
    if (drive && drive.strikes !== strikes) {
      if (drive.strikes > strikes) audio.thunder(castle ?? undefined)
      strikes = drive.strikes
    }
    if (audio.audible) {
      const fire = nearest(fires, listener)
      const town = busiest(towns, listener)
      const wind = Math.min(1, 0.22 + 0.55 * storm + 0.12 * cloud + 0.06 * Math.sin(t0 / 20000))
      const bed = bedOf({
        env: {
          weather: storm > 0.05 ? "rain" : cloud > 0.3 ? "cloudy" : "clear",
          precipitation: Math.round(storm * 0.9 * 1000) / 1000,
          daylight,
          cloudCover: Math.max(cloud, storm),
          temperature: 14,
        },
        wind,
        listener,
        sea: nearest(water, listener).distance,
        fire: fire.distance,
        town: { distance: town.distance, weight: town.weight },
      })
      audio.setAmbience(
        bed,
        fire.at ? firePanOf(fire.at.x, fire.at.z, listener) : 0,
        town.at ? firePanOf(town.at.x, town.at.z, listener) : 0,
      )
      audio.tick((id) => heroAt(id) ?? undefined)
    }
    const ms = performance.now() - t0
    cpu.sample += (ms - cpu.sample) * 0.1
  }
  sample()
  const timer = setInterval(sample, SAMPLE_MS)
  const offFrame = stage.onFrame(() => {
    if (!timeline) return
    const t0 = performance.now()
    driver.step(timeline)
    const ms = performance.now() - t0
    stage.timing.cpu.add("audio", ms)
    cpu.frame += (ms - cpu.frame) * 0.05
    cpu.frames++
  })
  return () => {
    stopped = true
    clearInterval(timer)
    offFrame()
    undo()
    audio.rebuild()
  }
}

/**
 * Water cells near land in the shore field (≤ about 6 m out), one every ~4 m: the coast's sea, a few
 * hundred points, so the nearest is cheap at 10 Hz.
 */
export function coastOf(shore: Pick<ShoreStage, "min" | "size" | "res" | "reach" | "data">): Where[] {
  const out: Where[] = []
  const texel = shore.size / shore.res
  const band = Math.max(1, Math.round((6 / shore.reach) * 255))
  const step = Math.max(1, Math.round(4 / texel))
  for (let j = 0; j < shore.res; j += step)
    for (let i = 0; i < shore.res; i += step) {
      const v = shore.data[j * shore.res + i] ?? 0
      if (v > 0 && v <= band)
        out.push({ x: shore.min[0] + (i + 0.5) * texel, z: shore.min[1] + (j + 0.5) * texel })
    }
  return out
}

function nearest(spots: readonly Where[], listener: Listener): { distance: number; at?: Where } {
  let distance = Number.POSITIVE_INFINITY
  let at: Where | undefined
  for (const spot of spots) {
    const d = Math.hypot(spot.x - listener.x, spot.z - listener.z)
    if (d < distance) {
      distance = d
      at = spot
    }
  }
  return at ? { distance, at } : { distance }
}

/** The place whose crowd is heard most: busy, and near the focus for the view's width. */
function busiest(
  towns: readonly (Where & { weight: number })[],
  listener: Listener,
): { distance: number; weight: number; at?: Where } {
  let best = { distance: Number.POSITIVE_INFINITY, weight: 0 } as {
    distance: number
    weight: number
    at?: Where
  }
  let score = -1
  const r = listener.radius
  for (const t of towns) {
    const d = Math.hypot(t.x - listener.x, t.z - listener.z)
    const s = t.weight * (1 - smoothstep(0.25 * r, 1.4 * r, d))
    if (s > score) {
      score = s
      best = { distance: d, weight: t.weight, at: t }
    }
  }
  return best
}
