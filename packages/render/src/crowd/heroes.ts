/**
 * Heroes: the people drawn as full NPCs (`createNpc`: the builder's own people, a mixer each, their
 * props real mounted pieces), not as crowd members. Who is a hero is decided per frame by
 * `chooseHeroes` (pure): everyone pinned (`setHeroes`), then the nearest people tall enough on screen
 * to show the difference, up to a cap. Bands on both rules keep anyone from flickering between the two.
 *
 * A hero is posed from the same state as the crowd (`poseHero`): the clip and its phase, and the clip
 * it is fading out of, so handing a person from one to the other changes nothing on screen.
 */
import {
  type BufferGeometry,
  Color,
  type Material,
  Mesh,
  MeshBasicMaterial,
  Uint8BufferAttribute,
} from "three"
import type { Npc } from "../character/npc.ts"
import { GLOW_SWATCHES } from "../night/glow.ts"
import { mergeBody } from "./parts.ts"

/** On-screen height (CSS px) from which someone may become a hero, and under which a hero goes back. */
export const TALL = 120
export const SHORT = 95
/** A hero's distance counts this much less when ranking, so two people at the same distance do not swap. */
export const STICKY = 0.85

export interface Candidate {
  id: number
  /** Metres from the camera. */
  distance: number
  /** Drawn height, CSS px. */
  tall: number
}

/**
 * Who is a hero this frame: every id in `pinned`, then the nearest candidates at least `tall` px tall
 * (`short` for one that is a hero now, in `current`) until there are `max`. Pinned heroes count
 * toward `max` but are never dropped for it.
 */
export function chooseHeroes(
  candidates: readonly Candidate[],
  current: ReadonlySet<number>,
  pinned: ReadonlySet<number>,
  max: number,
  { tall = TALL, short = SHORT } = {},
): Set<number> {
  const out = new Set<number>()
  for (const c of candidates) if (pinned.has(c.id)) out.add(c.id)
  const ranked = candidates
    .filter((c) => !pinned.has(c.id) && c.tall >= (current.has(c.id) ? short : tall))
    .map((c) => ({ id: c.id, rank: current.has(c.id) ? c.distance * STICKY : c.distance }))
    .sort((a, b) => a.rank - b.rank || a.id - b.id)
  for (const c of ranked) {
    if (out.size >= max) break
    out.add(c.id)
  }
  return out
}

/**
 * Whether a person is drawn as its hero this frame: when wanted and made, else not; but never switched
 * mid-fade. A fade blends the two clips per bone in the rig's space (crowd) or per joint (mixer), which
 * differ by centimetres mid-way, so the hand-off waits for the fade to finish and then changes nothing.
 */
export function heroShown(want: boolean, ready: boolean, shownNow: boolean, fade: number): boolean {
  if (fade < 1) return shownNow && ready
  return want && ready
}

/**
 * Light sources people carry that the static batch never places (GLOW_SWATCHES covers those): the
 * KayKit tools lantern's glass is snow-light (14), used nowhere else on it.
 */
export const CARRIED_GLOW: Readonly<Record<string, readonly number[]>> = {
  "kaykit-tools/lantern": [14],
}

/** The swatches of piece `id` that glow by night. */
export const glowSwatches = (id: string): readonly number[] => CARRIED_GLOW[id] ?? GLOW_SWATCHES[id] ?? []

/** Source geometry → its copy with `_glow` set on the glowing swatches (night/glow.ts reads it). */
const glowing = new WeakMap<BufferGeometry, BufferGeometry>()

function withGlow(geometry: BufferGeometry, swatches: readonly number[]): BufferGeometry {
  let lit = glowing.get(geometry)
  if (!lit) {
    const swatch = geometry.getAttribute("_swatch")
    const glow = new Uint8Array(geometry.getAttribute("position").count)
    if (swatch)
      for (let v = 0; v < glow.length; v++)
        if (swatches.includes(Math.round(swatch.getX(v) * (swatch.normalized ? 255 : 1)))) glow[v] = 255
    lit = geometry.clone()
    lit.setAttribute("_glow", new Uint8BufferAttribute(glow, 1, true))
    glowing.set(geometry, lit)
  }
  return lit
}

/** A person's animation state, shared by both ways of drawing them. */
export interface Playing {
  clip: string
  /** 0–1 of the clip. */
  phase: number
  /** The clip fading out (null: none) and its phase, held where it was left. */
  was: string | null
  wasPhase: number
  /** How far the fade has come: 1 is done. */
  fade: number
}

export interface Hero {
  npc: Npc
  /** Merged geometry the hero owns (its body's shown parts as one draw). */
  dispose(): void
}

/**
 * Readies a freshly made NPC to be a hero: its shown body parts merged into one draw, nothing cast
 * into the sun's cascades (people get blob shadows), its lanterns lit by night. `pieceOf` names the
 * catalog id each mounted prop came from, in mount order.
 */
export function makeHero(npc: Npc, pieceOf: readonly string[]): Hero {
  const body = mergeBody(npc.root)
  npc.root.traverse((node) => {
    if (node instanceof Mesh) node.castShadow = false
  })
  for (const [i, mounted] of npc.character.mounted.entries()) {
    const swatches = glowSwatches(pieceOf[i] ?? "")
    if (swatches.length === 0) continue
    mounted.piece.traverse((node) => {
      if (node instanceof Mesh) node.geometry = withGlow(node.geometry, swatches)
    })
  }
  return {
    npc,
    dispose() {
      npc.dispose()
      body?.geometry.dispose()
    },
  }
}

/** Poses `npc` at `playing`, as the crowd's shader would: both clips held at their phases, weighted by the fade. */
export function poseHero(npc: Npc, playing: Playing): void {
  const ch = npc.character
  if (ch.clip !== playing.clip && !ch.play(playing.clip, { t: 0 })) return
  const { mixer, clips } = ch
  const now = clips.find((c) => c.name === playing.clip)
  const was = playing.was !== null && playing.fade < 1 ? clips.find((c) => c.name === playing.was) : undefined
  if (now) {
    const action = mixer.clipAction(now)
    action.time = playing.phase * now.duration
    action.setEffectiveWeight(was ? playing.fade : 1)
  }
  if (was) {
    const action = mixer.clipAction(was)
    if (!action.isScheduled()) {
      action.play()
      action.paused = true
    }
    action.time = playing.wasPhase * was.duration
    action.setEffectiveWeight(1 - playing.fade)
  } else if (playing.was !== null) {
    const old = clips.find((c) => c.name === playing.was)
    if (old && old !== now) mixer.existingAction(old)?.stop()
  }
  ch.update(0)
}

/** A ghost's colour (a pale, cold blue-white) and how see-through it is at its fullest. */
export const GHOST_COLOUR = new Color(0xb9dcff)
export const GHOST_OPACITY = 0.55

/** Each ghosted hero's own materials, kept while it is drawn as a ghost, and the ghost's material. */
const ghosted = new WeakMap<Hero, { was: Map<Mesh, Material | Material[]>; mat: MeshBasicMaterial }>()

/**
 * Draws a hero as a ghost (a fallen hero's: sim rest.ts), `ghost` 0–1 how visible: every mesh of it in
 * one pale, cold, see-through material; undefined puts its own materials back.
 */
export function ghostHero(hero: Hero, ghost: number | undefined): void {
  const was = ghosted.get(hero)
  if (ghost === undefined) {
    if (!was) return
    for (const [mesh, m] of was.was) mesh.material = m
    was.mat.dispose()
    ghosted.delete(hero)
    return
  }
  let g = was
  if (!g) {
    const mat = new MeshBasicMaterial({
      color: GHOST_COLOUR,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    })
    const kept = new Map<Mesh, Material | Material[]>()
    hero.npc.root.traverse((node) => {
      if (node instanceof Mesh) {
        kept.set(node, node.material)
        node.material = mat
      }
    })
    g = { was: kept, mat }
    ghosted.set(hero, g)
  }
  g.mat.opacity = GHOST_OPACITY * Math.max(0, Math.min(1, ghost))
}
