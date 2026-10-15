/**
 * `resolveNpc(recipe, seed, catalog)`: one person drawn from a role's options (decisions, Characters):
 * a body, an outfit re-tint, headwear and held props, the activity clips and a little variation.
 * Pure: every choice is `roll(seed, salt)` with its own salt, so the same (recipe, seed) is the same
 * look. Props must be in the catalog with a mount that can ride the slot they are drawn for.
 */
import { roll } from "@guildhall/core"
import type { MountSlot } from "../mount.ts"
import type { Catalog } from "../query.ts"
import { type NpcLook, type NpcRecipe, validateNpc } from "./recipe.ts"

/**
 * Ramps that are skin on the KayKit bodies (kaykit-adventurers pins its skin cell to them), so an
 * outfit never re-tints them; a recipe's outfit entry for one is ignored.
 */
export const SKIN_RAMPS: readonly string[] = ["skin"]

/** The two-handed guard: both fists on one hilt, so it is no stance for a hand that holds a shield. */
export const TWO_HANDED_GUARD = "Melee_2H_Idle"

/** True when `mounts` put a shield in a hand. */
export const holdsShield = (mounts: readonly { piece: string }[]): boolean =>
  mounts.some((m) => /(^|\/)shield/.test(m.piece))

/**
 * The clip `look` stands on when asked for `clip`: its own plain idle in place of the two-handed guard
 * while it carries a shield (sword and board is no two-handed grip), else `clip`. Combat clips (the
 * block, a duel's strikes) and two-handed holders' guard are left as they are.
 */
export function standClip(clip: string, look: Pick<NpcLook, "mounts" | "clips">): string {
  return clip === TWO_HANDED_GUARD && holdsShield(look.mounts) ? look.clips.idle : clip
}

/** One of `options`, drawn by `salt`. */
const pick = <T>(options: readonly T[], seed: number, salt: string): T =>
  options[Math.min(options.length - 1, Math.floor(roll(seed, salt) * options.length))] as T

/** A value in [min, max), drawn by `salt`. */
const within = ([min, max]: readonly [number, number], seed: number, salt: string): number =>
  min + (max - min) * roll(seed, salt)

/**
 * The look of person `seed` of role `r`. Throws an Error naming the recipe when it is invalid, the body
 * drawn is not a catalog character, or a prop drawn is unknown or has no mount for its slot.
 */
export function resolveNpc(r: NpcRecipe, seed: number, cat: Catalog): NpcLook {
  const fail = (message: string): never => {
    throw new Error(`resolveNpc(${r.id}): ${message}`)
  }
  const problems = validateNpc(r)
  if (problems.length > 0) fail(problems.join("; "))

  const body = pick(r.body, seed, "body")
  const entry = cat.get(body)
  if (entry?.kind !== "character") fail(`body "${body}" is not a character in the catalog`)
  const parts = entry?.character?.parts
  // A role lists the parts of all its bodies; keep the ones this body has (all, when parts are unknown).
  const hide = (r.hide ?? []).filter((p) => !parts || parts.includes(p))

  const rampMap: Record<string, string> = {}
  for (const from of Object.keys(r.outfit).sort()) {
    if (SKIN_RAMPS.includes(from)) continue
    const to = pick(r.outfit[from] as string[], seed, `${from}:outfit`)
    if (to !== from) rampMap[from] = to
  }

  const mounts: NpcLook["mounts"] = []
  const hold = (piece: string, slot: MountSlot): void => {
    if (piece === "") return
    const mount = cat.get(piece)?.compose.mount ?? fail(`prop "${piece}" is unknown or has no mount`)
    if (mount.slot !== slot && !mount.alt?.includes(slot)) fail(`prop "${piece}" has no mount for ${slot}`)
    mounts.push({ piece, slot })
  }
  if (r.head && roll(seed, "head") < r.head.chance) hold(pick(r.head.pieces, seed, "headwear"), "head")
  if (r.hands?.r) hold(pick(r.hands.r, seed, "right-hand"), "hand.r")
  if (r.hands?.l) hold(pick(r.hands.l, seed, "left-hand"), "hand.l")

  // a shield-bearer idles plain, never in the two-handed guard (Idle_A when the recipe lists nothing else)
  const idles = holdsShield(mounts) ? r.activity.idle.filter((c) => c !== TWO_HANDED_GUARD) : r.activity.idle

  return {
    recipe: r.id,
    seed,
    body,
    hide,
    rampMap,
    mounts,
    clips: {
      work: r.activity.work,
      idle: idles.length > 0 ? pick(idles, seed, "idle") : "Idle_A",
      walk: r.activity.walk,
    },
    scale: within(r.vary.height, seed, "height"),
    speed: within(r.vary.speed, seed, "speed"),
    phase: roll(seed, "phase"),
  }
}
