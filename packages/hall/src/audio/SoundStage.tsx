import { useThree } from "@react-three/fiber"
import { useEffect } from "react"
import { PROBE } from "../guild/mode.ts"
import type { Moment } from "../guild/moments.ts"
import type { GuildStore } from "../guild/store.ts"
import { positions, useGuildStore } from "../guild/useGuild.ts"
import { soundPrefs } from "../hud/prefs.ts"
import { wind } from "../scene/atmosphere/wind.ts"
import { kindOfTool } from "../scene/sigilBoard.ts"
import { GRAVEYARD_PLOT, island } from "../world/lands.ts"
import { GATE, HEARTH, STATIONS } from "../world/layout.ts"
import { ambienceOf, firePanOf } from "./ambience.ts"
import { audio, type MomentInfo, type Where } from "./engine.ts"
import { keyOf } from "./music.ts"
import { sampleFor } from "./samples.ts"
import { type Listener, listenerOf } from "./spatial.ts"

/** Ambience, listener, key and plea calls are sampled this often (ms): ≈10 Hz, never per frame. */
const SAMPLE_MS = 100

const FIRES: readonly Where[] = [
  { x: HEARTH[0], z: HEARTH[1] },
  { x: STATIONS.forge.at[0], z: STATIONS.forge.at[1] },
]
const GRAVEYARD: Where = {
  x: (GRAVEYARD_PLOT.x0 + GRAVEYARD_PLOT.x1) / 2,
  z: (GRAVEYARD_PLOT.z0 + GRAVEYARD_PLOT.z1) / 2,
}

/**
 * The guild's sound, mounted once inside the Canvas (for the camera). Renders nothing and never
 * re-renders: it subscribes to live moments (each one a cue, audio/engine.ts) and, on a 10 Hz
 * timer, samples the camera, the environment and the shared wind for the listener, the key and
 * the ambience. With PROBE, `window.audio.probe` records every cue decision (scripts/shot.ts).
 */
export function SoundStage() {
  const store = useGuildStore()
  const get = useThree((state) => state.get)

  useEffect(() => {
    if (PROBE) {
      audio.probe ??= []
      Object.assign(window, { audio })
    }
    const sync = () => audio.setLevels(soundPrefs.get())
    sync()
    const offPrefs = soundPrefs.subscribe(sync)
    const onVisibility = () => audio.setHidden(document.hidden)
    onVisibility()
    document.addEventListener("visibilitychange", onVisibility)
    const offMoments = store.moments.on((moment) =>
      audio.moment(moment, audio.audible ? infoOf(store, moment) : undefined),
    )
    const offRebuild = store.moments.onRebuild(() => audio.rebuild())
    const timer = setInterval(() => {
      const state = get()
      const listener = listenerOf(state.camera, state.size.width / Math.max(1, state.size.height))
      audio.setListener(listener)
      audio.setKey(keyOf(store.mood.id, store.environment.daylight))
      if (!audio.audible) return
      const fire = nearest(FIRES, listener)
      audio.setAmbience(
        ambienceOf({
          env: store.environment,
          wind: wind.strength,
          listener,
          sea: nearest(waters(), listener).distance,
          fire: fire.distance,
        }),
        fire.at ? firePanOf(fire.at.x, fire.at.z, listener) : 0,
      )
      audio.tick(whereOf)
    }, SAMPLE_MS)
    return () => {
      offPrefs()
      offMoments()
      offRebuild()
      clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [store, get])

  return null
}

/** Where an adventurer is right now (they walk), if drawn. */
function whereOf(id: string): Where | undefined {
  const at = positions.get(id)
  return at ? { x: at.x, z: at.z } : undefined
}

/** What the hall knows about a moment: where it sounds, the deed's kind and its spot sound. */
function infoOf(store: GuildStore, moment: Moment): MomentInfo {
  const view = store.views.find((v) => v.id === moment.id)
  const where = whereOf(moment.id) ?? (moment.kind === "join" ? { x: GATE[0], z: GATE[1] } : undefined)
  const tool = moment.kind === "deed" || moment.kind === "deed-failed" ? moment.tool : undefined
  let sigil: MomentInfo["sigil"]
  if (moment.kind === "deed") {
    const entry = store.sessionOf(moment.id)?.entries.find((e) => e.kind === "tool" && e.call === moment.call)
    const command = entry?.kind === "tool" ? entry.input.command : undefined
    sigil = kindOfTool(moment.tool, typeof command === "string" ? command : "")
  }
  const sample = sampleFor(moment.kind, tool, { station: view?.station, site: view?.site })
  const sampleAt = sample === "bell" || sample === "creak" ? GRAVEYARD : undefined
  return { where, sigil, sample, sampleAt }
}

let water: Where[] | undefined
/** Open water and the river (world/lands.ts `island().water`), once. */
function waters(): readonly Where[] {
  water ??= island().water.map(([x, z]) => ({ x, z }))
  return water
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
