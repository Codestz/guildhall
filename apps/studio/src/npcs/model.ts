/**
 * The NPC builder's document: an NpcRecipe (plan §3.3) and the pure edits the screen makes to it, the
 * option lists it offers (bodies, cloth ramps, props with a mount for a slot) and every problem it shows
 * inline. Problems are the validator's plus what only the catalog and the rig can tell: unknown bodies,
 * clips the rig lacks, props with no mount for the slot they are listed under.
 */
import {
  type Catalog,
  type CatalogEntry,
  type Mount,
  type MountSlot,
  type NpcLook,
  type NpcRecipe,
  type Palette,
  SKIN_RAMPS,
  validateNpc,
} from "@guildhall/assets"

/** The rig every townsperson body shares (decisions, Characters). */
export const RIG = "rig-medium"

export const ACTIVITIES = ["work", "idle", "walk"] as const
export type Activity = (typeof ACTIVITIES)[number]

export type Hand = "r" | "l"
export const HAND_SLOT: Record<Hand, MountSlot> = { r: "hand.r", l: "hand.l" }

/** The strip's length when the link does not say. */
export const STRIP = 8
const MAX_STRIP = 16
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** What `?screen=npc&recipe=<role>&seed=<n>&strip=<n>&clip=<work|idle|walk>&t=<f>&cam=map` asks for. */
export interface NpcQuery {
  role: string
  seed: number
  strip: number
  clip: Activity
  /** 0…1 freezes every clip there; null plays them live, each from its look's phase. */
  t: number | null
  /** The far, high camera that judges silhouettes at map zoom. */
  map: boolean
}

export const DEFAULT_ROLE = "farmer"

/** The query, with defaults for anything missing or unreadable. */
export function parseQuery(q: URLSearchParams): NpcQuery {
  const role = q.get("recipe") ?? ""
  const seed = Number(q.get("seed"))
  const strip = Number(q.get("strip"))
  const t = Number(q.get("t"))
  const clip = q.get("clip") as Activity
  return {
    role: ID.test(role) ? role : DEFAULT_ROLE,
    seed: q.get("seed") !== null && Number.isInteger(seed) && seed >= 0 ? seed : 1,
    strip: Number.isInteger(strip) && strip >= 1 ? Math.min(strip, MAX_STRIP) : STRIP,
    clip: ACTIVITIES.includes(clip) ? clip : "idle",
    t: q.get("t") !== null && q.get("t") !== "" && Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : null,
    map: q.get("cam") === "map",
  }
}

export const stripSeeds = (seed: number, count = STRIP): number[] =>
  Array.from({ length: count }, (_, i) => seed + i)

/** How many looks differ in what the eye reads (body, outfit, props, parts, clips), not in scale or phase. */
export const distinctLooks = (looks: readonly NpcLook[]): number =>
  new Set(looks.map((l) => JSON.stringify([l.body, l.rampMap, l.mounts, l.hide, l.clips]))).size

// ── templates ────────────────────────────────────────────────────────

const ADVENTURERS = ["barbarian", "knight", "mage", "ranger", "rogue", "rogue-hooded"].map(
  (b) => `kaykit-adventurers/${b}`,
)
const VARY: NpcRecipe["vary"] = { height: [0.96, 1.04], speed: [0.9, 1.1] }

const recipe = (id: string, over: Partial<NpcRecipe>): NpcRecipe => ({
  version: 1,
  id,
  role: id,
  body: ADVENTURERS,
  outfit: {},
  activity: { work: "Working_A", idle: ["Idle_A", "Idle_B"], walk: "Walking_A" },
  vary: VARY,
  ...over,
})

/** Starting points for a role with no saved file (N3 authors the real set in data/npcs). */
export const TEMPLATES: Readonly<Record<string, NpcRecipe>> = {
  farmer: recipe("farmer", {
    body: ["kaykit-adventurers/barbarian", "kaykit-adventurers/ranger", "kaykit-adventurers/rogue"],
    hide: ["Barbarian_BearHat", "Ranger_Cape", "Ranger_Quiver", "Rogue_Cape"],
    outfit: { timber: ["thatch", "dirt", "sand", "leaf"], terracotta: ["terracotta", "dry-grass"] },
    activity: { work: "Digging", idle: ["Idle_A", "Idle_B"], walk: "Walking_A" },
  }),
  guard: recipe("guard", {
    body: ["kaykit-adventurers/knight", "kaykit-adventurers/barbarian"],
    outfit: { accent: ["accent", "slate", "roof-blue"], terracotta: ["terracotta", "cobble"] },
    hands: { r: ["kaykit-weapons/sword-a"] },
    activity: { work: "Holding_A", idle: ["Idle_A", "Melee_Blocking"], walk: "Walking_C" },
  }),
  merchant: recipe("merchant", {
    body: ["kaykit-adventurers/mage", "kaykit-adventurers/rogue", "kaykit-adventurers/ranger"],
    hide: ["Mage_Hat", "Ranger_Quiver", "Rogue_Cape"],
    outfit: { teal: ["teal", "orange", "accent"], timber: ["timber", "dirt"] },
    hands: { r: ["kaykit-tools/lantern", ""] },
    activity: { work: "Interact", idle: ["Idle_A", "Idle_B"], walk: "Walking_B" },
  }),
}

/** The template of that role, else a plain townsperson under that id. */
export function blank(role: string): NpcRecipe {
  const t = TEMPLATES[role]
  return t ? structuredClone(t) : recipe(role, {})
}

// ── options ──────────────────────────────────────────────────────────

/** True when `mount` can ride `slot` (its own slot or an alternative). */
export const covers = (mount: Mount | undefined, slot: MountSlot): boolean =>
  !!mount && (mount.slot === slot || !!mount.alt?.includes(slot))

/** The bodies a recipe can list: characters on the shared rig. */
export const bodyChoices = (entries: readonly CatalogEntry[]): CatalogEntry[] =>
  entries.filter((e) => e.kind === "character" && e.character?.rig === RIG)

/**
 * The props a slot offers: those with a mount for it, and the ones that would fit (held for hands, worn
 * for the head) but need a mount authored first.
 */
export function propChoices(
  entries: readonly CatalogEntry[],
  slot: MountSlot,
): { mounted: string[]; needs: string[] } {
  const role = slot === "head" ? "worn" : "held"
  const mounted: string[] = []
  const needs: string[] = []
  for (const e of entries) {
    if (covers(e.compose.mount, slot)) mounted.push(e.id)
    else if (e.compose.attach === role) needs.push(e.id)
  }
  return { mounted, needs }
}

/** Where a prop's mount is authored. */
export const gripLink = (piece: string): string => `?screen=grip&piece=${encodeURIComponent(piece)}`

/**
 * The ramps the recipe's bodies are painted with that an outfit may swap (skin never), in palette
 * order: one row of chips each.
 */
export function clothRamps(r: NpcRecipe, cat: Catalog, p: Palette): string[] {
  const used = new Set<string>()
  for (const id of r.body)
    for (const s of cat.get(id)?.swatches ?? []) {
      const ramp = p.swatches[s]?.ramp
      if (ramp) used.add(ramp)
    }
  return p.ramps.map((x) => x.name).filter((name) => used.has(name) && !SKIN_RAMPS.includes(name))
}

/** What a ramp may become: any ramp but skin (tone for tone). */
export const outfitTargets = (p: Palette): string[] =>
  p.ramps.map((x) => x.name).filter((name) => !SKIN_RAMPS.includes(name))

/** Core body parts never offered for hiding: hiding them leaves a hole, not a costume change. */
const CORE_PART = /_(ArmLeft|ArmRight|Body|Head|LegLeft|LegRight|Eyes|Jaw|Skull)$/

/** The sub-meshes worth hiding (hats, capes, quivers, masks), sorted. */
export const hideable = (parts: readonly string[]): string[] =>
  [...new Set(parts)].filter((p) => !CORE_PART.test(p)).sort()

// ── edits ────────────────────────────────────────────────────────────

/** `list` with `item` added (at the end) or removed. */
export const toggle = <T>(list: readonly T[], item: T): T[] =>
  list.includes(item) ? list.filter((x) => x !== item) : [...list, item]

/** The id and role are one name: the file is `data/npcs/<role>.json`. */
export const rename = (r: NpcRecipe, role: string): NpcRecipe => ({ ...r, id: role, role })

export const setBodies = (r: NpcRecipe, body: string[]): NpcRecipe => ({ ...r, body })

export function setHide(r: NpcRecipe, hide: string[]): NpcRecipe {
  const { hide: _old, ...rest } = r
  return hide.length > 0 ? { ...rest, hide } : rest
}

/** A ramp's replacement options; null (or none) stops re-tinting it. Listing `from` keeps it as an option. */
export function setOutfit(r: NpcRecipe, from: string, options: string[] | null): NpcRecipe {
  const { [from]: _old, ...outfit } = r.outfit
  return { ...r, outfit: options && options.length > 0 ? { ...outfit, [from]: options } : outfit }
}

/** Headwear pieces and their chance; no pieces drops headwear. */
export function setHead(r: NpcRecipe, pieces: string[], chance: number): NpcRecipe {
  const { head: _old, ...rest } = r
  return pieces.length > 0 ? { ...rest, head: { pieces, chance } } : rest
}

/** A hand's options ("" is the empty hand); none drops the hand, and no hands drops `hands`. */
export function setHand(r: NpcRecipe, hand: Hand, options: string[]): NpcRecipe {
  const { hands: old, ...rest } = r
  const { [hand]: _old, ...others } = old ?? {}
  const hands = options.length > 0 ? { ...others, [hand]: options } : others
  return Object.keys(hands).length > 0 ? { ...rest, hands } : rest
}

export const setActivity = (r: NpcRecipe, patch: Partial<NpcRecipe["activity"]>): NpcRecipe => ({
  ...r,
  activity: { ...r.activity, ...patch },
})

/** One end of a variation range, rounded to the 1% the sliders step in. */
export function setVary(r: NpcRecipe, key: keyof NpcRecipe["vary"], end: 0 | 1, value: number): NpcRecipe {
  const range: [number, number] = [...r.vary[key]]
  range[end] = Math.round(value * 100) / 100
  return { ...r, vary: { ...r.vary, [key]: range } }
}

// ── problems ─────────────────────────────────────────────────────────

/**
 * Every problem with `r`, as "where: what": the validator's (ramps checked against the palette), then
 * bodies that are not on the rig, clips the rig lacks, props with no mount for their slot, and outfit
 * entries for skin (which resolve ignores).
 */
export function problems(r: NpcRecipe, cat: Catalog, p: Palette): string[] {
  const out = validateNpc(r, p)
  if (out.length > 0) return out
  for (const id of r.body) {
    const e = cat.get(id)
    if (e?.kind !== "character") out.push(`body: "${id}" is not a character in the catalog`)
    else if (e.character?.rig !== RIG) out.push(`body: "${id}" is not on ${RIG}`)
  }
  const clips = new Set(cat.rig(RIG)?.clips.map((c) => c.name))
  const clip = (at: string, name: string) => {
    if (!clips.has(name)) out.push(`${at}: ${RIG} has no clip "${name}"`)
  }
  clip("activity.work", r.activity.work)
  for (const [i, name] of r.activity.idle.entries()) clip(`activity.idle[${i}]`, name)
  clip("activity.walk", r.activity.walk)
  const hold = (at: string, piece: string, slot: MountSlot) => {
    if (piece === "") return
    const e = cat.get(piece)
    if (!e) out.push(`${at}: "${piece}" is not in the catalog`)
    else if (!covers(e.compose.mount, slot)) out.push(`${at}: "${piece}" needs a mount for ${slot}`)
  }
  for (const [i, piece] of (r.head?.pieces ?? []).entries()) hold(`head.pieces[${i}]`, piece, "head")
  for (const hand of ["r", "l"] as const)
    for (const [i, piece] of (r.hands?.[hand] ?? []).entries())
      hold(`hands.${hand}[${i}]`, piece, HAND_SLOT[hand])
  for (const from of Object.keys(r.outfit))
    if (SKIN_RAMPS.includes(from)) out.push(`outfit.${from}: skin is never re-tinted; remove it`)
  return out
}
