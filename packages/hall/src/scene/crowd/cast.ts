import type { AnimationClip, Object3D } from "three"
import { CARRY_WALK, carryClip } from "../activity.ts"
import { bakeClips } from "./bake.ts"
import { Crowd } from "./Crowd.ts"
import { type CrowdShading, GLSL_SHADING } from "./material.ts"
import { simplifyModels } from "./simplify.ts"

/**
 * The cast's crowd (scene/Scene.tsx Cast, scene/body.ts): every adventurer clip baked once, every
 * model mustered, made the first time the cast is big enough to want it and kept for the page's
 * life (the bake is ~1 MB on the GPU; a small story never makes it).
 */

/** The clips Adventurer plays once and holds (body.ts); every other clip loops, as in the mixer. */
export const ONCE: ReadonlySet<string> = new Set(["Sit_Chair_Down", "Lie_Down", "Spawn_Ground"])
/** Rows per second of clip: the shader blends between them. */
const BAKE_FPS = 30
/** Seconds a clip change blends: the mixer's crossfade (body.ts). */
export const FADE_S = 0.25

/**
 * The cast's clock, seconds: advanced once a frame by the cast (Scene.tsx), before any figure reads
 * it. Bodies time their crossfades on it, and the crowd's shader runs on it.
 */
export const castClock = { now: 0 }

let made: { animations: readonly AnimationClip[]; shading: CrowdShading; crowd: Crowd } | null = null

/**
 * The crowd for these clips and models, made on first call (the bake: a one-off ~0.1–0.3 s). Its
 * coarser mesh levels follow once simplified (crowd/simplify.ts: its own chunk, ~40 ms). `shading`:
 * GLSL, or the renderer's node materials (material.ts `nodeShading`).
 */
export function castCrowd(
  animations: readonly AnimationClip[],
  models: Record<string, Object3D>,
  shading: CrowdShading = GLSL_SHADING,
): Crowd {
  if (made?.animations === animations && made.shading === shading) return made.crowd
  made?.crowd.dispose()
  const clips = [...animations]
  const carry = carryClip(animations)
  if (carry && !clips.some((clip) => clip.name === CARRY_WALK)) clips.push(carry)
  const rig = Object.values(models)[0]
  if (!rig) throw new Error("castCrowd: no models")
  const bake = bakeClips(rig, clips, BAKE_FPS, { once: ONCE })
  const crowd = new Crowd(bake, models, [], FADE_S, shading)
  made = { animations, shading, crowd }
  simplifyModels(models).then(
    (lods) => {
      if (made?.crowd === crowd) crowd.levels(lods)
    },
    // Without them everyone draws the full mesh, as before there were levels.
    (error: unknown) => console.warn("crowd: no mesh levels", error),
  )
  return crowd
}
