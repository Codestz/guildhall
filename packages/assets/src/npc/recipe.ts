/**
 * NPC recipes (`data/npcs/<role>.json`): the options a role draws from by seed (body, outfit ramps,
 * headwear, held props, clips, variation), and the NpcLook one seed resolves to (npc/resolve.ts).
 */
import type { MountSlot } from "../mount.ts"
import type { Palette } from "../palette.ts"
import { isNum, isRecord, isStr, isStrList, SLUG, show } from "../validate.ts"

export interface NpcRecipe {
  version: 1
  id: string
  role: string
  /** KayKit character catalog ids; one is picked by seed. */
  body: string[]
  /** Body sub-meshes to hide (catalog `character.parts`). */
  hide?: string[]
  /** Ramp → replacement ramp options (tone for tone), one picked by seed. */
  outfit: Record<string, string[]>
  /** Worn catalog ids (mount slot head), worn with probability `chance`. */
  head?: { pieces: string[]; chance: number }
  /** Held catalog ids per hand; "" is the empty-hand option. */
  hands?: { r?: string[]; l?: string[] }
  /** Clip names (checked against the rig by the builder). */
  activity: { work: string; idle: string[]; walk: string; station?: string }
  /** Multiplier ranges [min, max]: around ±4% height and ±10% speed by default. */
  vary: { height: [number, number]; speed: [number, number] }
}

export interface NpcLook {
  recipe: string
  seed: number
  body: string
  hide: string[]
  rampMap: Record<string, string>
  mounts: { piece: string; slot: MountSlot }[]
  clips: { work: string; idle: string; walk: string }
  scale: number
  speed: number
  phase: number
}

/** A non-empty list of strings where "" is allowed (the empty hand). */
const isOptionList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string")

function checkRange(out: string[], at: string, v: unknown): void {
  const ok = Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]) && v[0] > 0 && v[0] <= v[1]
  if (!ok) out.push(`${at}: expected [min, max] with 0 < min <= max`)
}

/** Problems with an NPC recipe, as "where: what". With a palette, outfit ramps must exist in it. */
export function validateNpc(json: unknown, palette?: Palette): string[] {
  if (!isRecord(json)) return ["npc: expected an object"]
  const r = json
  const out: string[] = []
  const ramp = (at: string, name: string): void => {
    if (palette && !palette.ramps.some((x) => x.name === name)) out.push(`${at}: unknown ramp ${show(name)}`)
  }
  if (r.version !== 1) out.push(`version: expected 1, got ${show(r.version)}`)
  if (!isStr(r.id) || !SLUG.test(r.id)) out.push(`id: expected a kebab-case id, got ${show(r.id)}`)
  if (!isStr(r.role)) out.push("role: expected a string")
  if (!isStrList(r.body) || r.body.length === 0) out.push("body: expected at least one character id")
  if (r.hide !== undefined && !isStrList(r.hide)) out.push("hide: expected part names")

  if (!isRecord(r.outfit)) out.push("outfit: expected ramp → ramps")
  else
    for (const [from, options] of Object.entries(r.outfit)) {
      ramp("outfit", from)
      if (!isStrList(options) || options.length === 0)
        out.push(`outfit.${from}: expected a non-empty list of ramps`)
      else for (const [i, to] of options.entries()) ramp(`outfit.${from}[${i}]`, to)
    }

  if (r.head !== undefined) {
    const h = r.head
    if (!isRecord(h)) out.push("head: expected { pieces, chance }")
    else {
      if (!isStrList(h.pieces) || h.pieces.length === 0)
        out.push("head.pieces: expected at least one catalog id")
      if (!(isNum(h.chance) && h.chance >= 0 && h.chance <= 1))
        out.push("head.chance: expected a probability 0..1")
    }
  }
  if (r.hands !== undefined) {
    const h = r.hands
    if (!isRecord(h)) out.push("hands: expected { r?, l? }")
    else
      for (const k of ["r", "l"] as const)
        if (h[k] !== undefined && !isOptionList(h[k]))
          out.push(`hands.${k}: expected a non-empty list of ids or ""`)
  }

  const a = r.activity
  if (!isRecord(a)) out.push("activity: expected { work, idle, walk, station? }")
  else {
    if (!isStr(a.work)) out.push("activity.work: expected a clip name")
    if (!isStrList(a.idle) || a.idle.length === 0) out.push("activity.idle: expected at least one clip name")
    if (!isStr(a.walk)) out.push("activity.walk: expected a clip name")
    if (a.station !== undefined && !isStr(a.station)) out.push("activity.station: expected a string")
  }

  if (!isRecord(r.vary)) out.push("vary: expected { height, speed }")
  else {
    checkRange(out, "vary.height", r.vary.height)
    checkRange(out, "vary.speed", r.vary.speed)
  }
  return out
}
