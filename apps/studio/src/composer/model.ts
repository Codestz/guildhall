/**
 * The composer's document: a PrefabRecipe (ADR 005) and the pure edits the screen makes to it. Every
 * edit returns a new recipe and keeps it drawable where it can (edits and the door follow a resize);
 * what it cannot keep valid is left to `validatePrefab` and shown inline.
 */
import {
  buildHouse,
  type HouseBlueprint,
  KIT_PROFILES,
  type PrefabRecipe,
  type RecipeInstance,
  type Storey,
} from "@guildhall/assets"
import type { DataKind } from "../data.ts"

export type Side = HouseBlueprint["edits"][number]["side"]

/** One wall panel of the blueprint (what a panel click addresses). */
export interface Slot {
  storey: number
  side: Side
  index: number
}

/** A recipe file: `data/<kind>/<id>.json`. */
export interface RecipeRef {
  kind: DataKind
  id: string
}

/** `?recipe=houses/demo` → the houses folder; anything unreadable falls back to it. */
export const DEFAULT_REF: RecipeRef = { kind: "recipes/houses", id: "demo" }

const FOLDERS = ["houses", "landmarks", "stalls", "docks", "farm", "vignettes"] as const
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** `kind/id` (e.g. `houses/demo`) as a data file, or null when it names no recipe folder. */
export function parseRef(text: string | null): RecipeRef | null {
  if (!text) return null
  const [folder, id, ...rest] = text.split("/")
  if (rest.length > 0 || !id || !ID.test(id) || !(FOLDERS as readonly string[]).includes(folder ?? ""))
    return null
  return { kind: `recipes/${folder}` as DataKind, id }
}

export const refText = (ref: RecipeRef): string => `${ref.kind.slice("recipes/".length)}/${ref.id}`

const house = (over: Partial<HouseBlueprint>): HouseBlueprint => ({
  kit: "kenney-town",
  size: { w: 1, d: 1 },
  storeys: [{ family: "plaster", openings: "home" }],
  roof: { style: "gable", ridge: "x" },
  door: { index: "centre" },
  edits: [],
  vary: {},
  ...over,
})

const recipe = (id: string, h: HouseBlueprint, dressing: RecipeInstance[] = []): PrefabRecipe => ({
  version: 1,
  id,
  kind: "house",
  tags: [],
  fits: {},
  house: h,
  dressing,
  anchors: [],
})

/** Starting points for a new recipe: H1's three sample blueprints (.probe/h1). */
export const TEMPLATES: Readonly<Record<"cottage" | "townhouse" | "hall", PrefabRecipe>> = {
  cottage: recipe("cottage", house({ chimney: 1 })),
  townhouse: recipe(
    "townhouse",
    house({
      size: { w: 2, d: 1 },
      storeys: [
        { family: "stone", openings: "shop" },
        { family: "wood", openings: "home" },
      ],
      door: { index: 0, style: "round" },
    }),
    [{ piece: "kenney-town/lantern", x: 2, y: 0, z: 2.5, rot: 0, scale: 1 }],
  ),
  hall: recipe(
    "hall",
    house({
      size: { w: 3, d: 2 },
      storeys: [
        { family: "stone", openings: "home" },
        { family: "plaster", openings: "home" },
      ],
      roof: { style: "high-gable", ridge: "x" },
      door: { index: "centre", style: "square" },
      chimney: 1,
      edits: [{ storey: 1, side: "+z", index: 1, piece: "kenney-town/wall-window-round" }],
    }),
  ),
}

/** A fresh recipe for `id`: the template of that name, else the cottage renamed. */
export function blank(id: string): PrefabRecipe {
  const template = TEMPLATES[id as keyof typeof TEMPLATES] ?? TEMPLATES.cottage
  return { ...structuredClone(template), id }
}

/** Cells along a side: ±z run along the frontage (w), ±x along the depth (d). */
export const cellsOn = (h: HouseBlueprint, side: Side): number =>
  side === "+z" || side === "-z" ? h.size.w : h.size.d

const withHouse = (r: PrefabRecipe, h: HouseBlueprint): PrefabRecipe => ({ ...r, house: h })

/** Drops the edits a smaller blueprint no longer has a panel for. */
function keepEdits(h: HouseBlueprint): HouseBlueprint {
  const edits = h.edits.filter((e) => e.storey < h.storeys.length && e.index < cellsOn(h, e.side))
  const index = h.door.index
  const door = index !== "centre" && index >= h.size.w ? { ...h.door, index: h.size.w - 1 } : h.door
  return { ...h, edits, door }
}

/** A new footprint, in whole modules (at least 1). */
export function setSize(r: PrefabRecipe, w: number, d: number): PrefabRecipe {
  if (!r.house) return r
  const size = { w: Math.max(1, Math.round(w)), d: Math.max(1, Math.round(d)) }
  return withHouse(r, keepEdits({ ...r.house, size }))
}

/** 1–3 storeys; a new storey copies the one below it. */
export function setStoreyCount(r: PrefabRecipe, n: number, max = 3): PrefabRecipe {
  if (!r.house) return r
  const count = Math.min(max, Math.max(1, Math.round(n)))
  const storeys = r.house.storeys.slice(0, count)
  while (storeys.length < count) storeys.push({ ...(storeys.at(-1) as Storey) })
  return withHouse(r, keepEdits({ ...r.house, storeys }))
}

export function setStorey(r: PrefabRecipe, k: number, patch: Partial<Storey>): PrefabRecipe {
  if (!r.house) return r
  const storeys = r.house.storeys.map((s, i) => (i === k ? { ...s, ...patch } : s))
  return withHouse(r, { ...r.house, storeys })
}

export function patchHouse(r: PrefabRecipe, patch: Partial<HouseBlueprint>): PrefabRecipe {
  return r.house ? withHouse(r, { ...r.house, ...patch }) : r
}

const sameSlot = (a: Slot) => (b: Slot) => a.storey === b.storey && a.side === b.side && a.index === b.index

/** The piece the blueprint puts in `slot` with no edit there (null: the slot draws nothing). */
export function defaultPanel(h: HouseBlueprint, seed: number, slot: Slot): string | null {
  const plain = { ...h, edits: h.edits.filter((e) => !sameSlot(slot)(e)) }
  return buildHouse(plain, seed).parts.find((p) => p.slot && sameSlot(slot)(p.slot))?.instance.piece ?? null
}

/** What a slot can hold: the family's blind panel, its windows, its shop front, doors on the ground front, empty. */
export function panelChoices(h: HouseBlueprint, slot: Slot): (string | null)[] {
  const set = KIT_PROFILES[h.kit].walls[(h.storeys[slot.storey] as Storey).family]
  const doors = slot.storey === 0 && slot.side === "+z" ? Object.values(set.doors) : []
  return [...new Set([set.blind, ...Object.values(set.windows), set.shop, ...doors]), null]
}

/**
 * A panel click: the slot's piece steps to the next choice (`step` -1 goes back). Landing on what the
 * blueprint would draw anyway removes the edit, so cycling all the way round leaves no trace.
 */
export function cyclePanel(r: PrefabRecipe, seed: number, slot: Slot, step: 1 | -1 = 1): PrefabRecipe {
  const h = r.house
  if (!h) return r
  const fallback = defaultPanel(h, seed, slot)
  const edit = h.edits.find(sameSlot(slot))
  const current = edit ? edit.piece : fallback
  const choices = panelChoices(h, slot)
  if (!choices.includes(fallback)) choices.unshift(fallback)
  const at = Math.max(0, choices.indexOf(current))
  const next = choices[(at + step + choices.length) % choices.length] as string | null
  const others = h.edits.filter((e) => !sameSlot(slot)(e))
  const edits = next === fallback ? others : [...others, { ...slot, piece: next }]
  return withHouse(r, { ...h, edits })
}

export function removeEdit(r: PrefabRecipe, slot: Slot): PrefabRecipe {
  return r.house ? withHouse(r, { ...r.house, edits: r.house.edits.filter((e) => !sameSlot(slot)(e)) }) : r
}

/** Adds a dressing piece standing at (x, z), unturned; returns the recipe and its dressing index. */
export function addDressing(r: PrefabRecipe, piece: string, x: number, z: number): [PrefabRecipe, number] {
  const instance: RecipeInstance = { piece, x, y: 0, z, rot: 0, scale: 1 }
  return [{ ...r, dressing: [...r.dressing, instance] }, r.dressing.length]
}

export function moveDressing(
  r: PrefabRecipe,
  i: number,
  pose: Pick<RecipeInstance, "x" | "y" | "z" | "rot">,
): PrefabRecipe {
  return { ...r, dressing: r.dressing.map((d, j) => (j === i ? { ...d, ...pose } : d)) }
}

export function removeDressing(r: PrefabRecipe, i: number): PrefabRecipe {
  return { ...r, dressing: r.dressing.filter((_, j) => j !== i) }
}

/** Ramp swaps: `from` may become any of `to` by seed; an empty list drops the swap. */
export function setRampSwap(r: PrefabRecipe, from: string, to: string[]): PrefabRecipe {
  if (!r.house) return r
  const rampSwaps = { ...r.house.vary.rampSwaps }
  if (to.length > 0) rampSwaps[from] = to
  else delete rampSwaps[from]
  const { rampSwaps: _, ...rest } = r.house.vary
  const vary = Object.keys(rampSwaps).length > 0 ? { ...rest, rampSwaps } : rest
  return withHouse(r, { ...r.house, vary })
}

/** Window styles a seed picks from; none means each family's own default. */
export function setOpeningStyles(r: PrefabRecipe, styles: string[]): PrefabRecipe {
  if (!r.house) return r
  const { openings: _, ...rest } = r.house.vary
  const vary = styles.length > 0 ? { ...rest, openings: styles } : rest
  return withHouse(r, { ...r.house, vary })
}

/** The variants a seed strip shows: `count` seeds from `seed` on. */
export const stripSeeds = (seed: number, count = 6): number[] =>
  Array.from({ length: count }, (_, i) => seed + i)

/** A whole, non-negative seed from the query, else 1. */
export function parseSeed(text: string | null): number {
  const n = Number(text)
  return text !== null && Number.isInteger(n) && n >= 0 ? n : 1
}
