/**
 * The grip editor's pure side (ADR 010): the edits the panel makes to a `Mount`, the deep link, the
 * prop and body pickers, and the merge that turns one edited mount into a whole `data/mounts.json`.
 * Every edit returns a new mount; nothing here touches three or the DOM.
 */
import type { CatalogEntry, Mount, MountClip, MountSlot, MountsFile, Vec3 } from "@guildhall/assets"
import { param } from "../../params.ts"

/** The rig every editable body plays (the slot frames are measured on it). */
export const RIG = "rig-medium"

/** The strip under the view: the clips a grip must survive (G3's key clips), each frozen at `t`. */
export const KEY_CLIPS: readonly { label: string; clip: string; t: number }[] = [
  { label: "chop", clip: "Chopping", t: 0.35 },
  { label: "walk", clip: "Walking_A", t: 0.25 },
  { label: "sit", clip: "Sit_Chair_Idle", t: 0.5 },
  { label: "wave", clip: "Waving", t: 0.4 },
]

export const DEFAULTS = {
  piece: "kaykit-weapons/sword-a",
  body: "kaykit-adventurers/knight",
  clip: "Holding_A",
  t: 0.5,
}

export interface EditorQuery {
  piece: string
  body: string
  clip: string
  /** 0…1: where the clip is frozen. */
  t: number
}

/** `?piece=<id>&body=<id>&clip=<name>&t=<0..1>`, with the defaults for anything missing or bad. */
export function parseQuery(q: URLSearchParams): EditorQuery {
  const t = Number(param(q, "t"))
  return {
    piece: param(q, "piece") || DEFAULTS.piece,
    body: param(q, "body") || DEFAULTS.body,
    clip: param(q, "clip") || DEFAULTS.clip,
    t: param(q, "t") !== null && Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : DEFAULTS.t,
  }
}

// ── axes ──────────────────────────────────────────────────────────────

export const AXIS_NAMES = ["+x", "-x", "+y", "-y", "+z", "-z"] as const
export type AxisName = (typeof AXIS_NAMES)[number]

export const AXES: Readonly<Record<AxisName, Vec3>> = {
  "+x": [1, 0, 0],
  "-x": [-1, 0, 0],
  "+y": [0, 1, 0],
  "-y": [0, -1, 0],
  "+z": [0, 0, 1],
  "-z": [0, 0, -1],
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const scaled = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k]
const minus = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const unit = (a: Vec3): Vec3 => scaled(a, 1 / (Math.hypot(...a) || 1))
/** Directions are stored to 1e-4 (well inside validateMount's 1e-3), lengths to the 1 cm grid. */
const r4 = (v: number) => Math.round(v * 1e4) / 1e4 || 0
const cm = (v: number) => Math.round(v * 100) / 100 || 0
const round4 = (a: Vec3): Vec3 => [r4(a[0]), r4(a[1]), r4(a[2])]

/** The signed prop axis `v` lies on, or null when it lies on none (it was fine-rotated). */
export function axisName(v: Vec3): AxisName | null {
  return AXIS_NAMES.find((n) => dot(AXES[n], v) > 1 - 1e-6) ?? null
}

/** `v` turned `deg` degrees about the unit `about` (right-handed). */
function rotate(v: Vec3, about: Vec3, deg: number): Vec3 {
  const a = (deg * Math.PI) / 180
  const c = Math.cos(a)
  const s = Math.sin(a)
  const k = dot(about, v) * (1 - c)
  const x = cross(about, v)
  return [
    v[0] * c + x[0] * s + about[0] * k,
    v[1] * c + x[1] * s + about[1] * k,
    v[2] * c + x[2] * s + about[2] * k,
  ]
}

/** `edge` made exactly perpendicular to `axis` and unit, both rounded for storage. */
function orthonormal(axis: Vec3, edge: Vec3): { axis: Vec3; edge: Vec3 } {
  const a = unit(axis)
  return { axis: round4(a), edge: round4(unit(minus(edge, scaled(a, dot(edge, a))))) }
}

/** The signed axes perpendicular to `axis`, the one nearest `edge` first. */
export function edgeChoices(axis: Vec3, edge: Vec3): AxisName[] {
  return AXIS_NAMES.filter((n) => Math.abs(dot(AXES[n], axis)) < 1e-6).sort(
    (a, b) => dot(AXES[b], edge) - dot(AXES[a], edge),
  )
}

/** The working axis snapped to a prop axis; the edge snaps to the perpendicular axis nearest it. */
export function setAxis(m: Mount, name: AxisName): Mount {
  const axis = AXES[name]
  const edge = edgeChoices(axis, m.edge)[0] ?? "+x"
  return { ...m, axis, edge: AXES[edge] }
}

/** The strike edge snapped to a prop axis, made perpendicular to the working axis (refused if parallel). */
export function setEdge(m: Mount, name: AxisName): Mount {
  if (Math.abs(dot(AXES[name], m.axis)) > 1 - 1e-6) return m
  return { ...m, ...orthonormal(m.axis, AXES[name]) }
}

/** Fine rotation: the edge turned about the working axis (the prop spins in the fist). */
export function twist(m: Mount, deg: number): Mount {
  return { ...m, ...orthonormal(m.axis, rotate(m.edge, m.axis, deg)) }
}

/** Fine rotation: the working axis tipped about the edge (the prop leans toward or away from the thumb). */
export function tilt(m: Mount, deg: number): Mount {
  return { ...m, ...orthonormal(rotate(m.axis, m.edge, deg), m.edge) }
}

// ── slot, handle, upright, scale ─────────────────────────────────────

/** The slots the editor offers; `both` is the right hand carrying a two-handed prop. */
export const SLOT_CHOICES = ["hand.r", "hand.l", "both", "head", "chest", "back"] as const
export type SlotChoice = (typeof SLOT_CHOICES)[number]

export function slotChoice(m: Mount): SlotChoice {
  return m.hands === 2 && m.slot === "hand.r" ? "both" : m.slot
}

export function setSlot(m: Mount, choice: SlotChoice): Mount {
  const slot: MountSlot = choice === "both" ? "hand.r" : choice
  const { alt, ...rest } = m
  const kept = alt?.filter((s) => s !== slot)
  return { ...rest, slot, hands: choice === "both" ? 2 : 1, ...(kept?.length ? { alt: kept } : {}) }
}

/** The handle on the 1 cm grid. */
export function setHandle(m: Mount, handle: Vec3): Mount {
  return { ...m, handle: [cm(handle[0]), cm(handle[1]), cm(handle[2])] }
}

/** Upright on (keeping `up` along a prop axis) or off. */
export function setUpright(m: Mount, up: AxisName | null): Mount {
  const { upright: _old, ...rest } = m
  return up ? { ...rest, upright: { up: AXES[up] } } : rest
}

/** Scale 1 is the default and is left out of the file. */
export function setScale(m: Mount, scale: number): Mount {
  const { scale: _old, ...rest } = m
  const k = Math.round(scale * 100) / 100
  return k > 0 && k !== 1 ? { ...rest, scale: k } : rest
}

// ── per-clip overrides ───────────────────────────────────────────────

/** A clip's override as the panel edits it: roll in degrees, offset in metres. */
export interface ClipEdit {
  rollDeg: number
  offset: Vec3
  hide: boolean
}

export function clipEdit(m: Mount, clip: string): ClipEdit {
  const c = m.clips?.[clip]
  return {
    rollDeg: Math.round(((c?.roll ?? 0) * 180) / Math.PI),
    offset: c?.offset ?? [0, 0, 0],
    hide: c?.hide === true,
  }
}

/** The clip's override set from `edit`; an override that changes nothing is dropped, and so is an empty `clips`. */
export function setClip(m: Mount, clip: string, edit: ClipEdit): Mount {
  const roll = r4((edit.rollDeg * Math.PI) / 180)
  const offset: Vec3 = [cm(edit.offset[0]), cm(edit.offset[1]), cm(edit.offset[2])]
  const override: MountClip = {
    ...(roll !== 0 ? { roll } : {}),
    ...(offset.some((v) => v !== 0) ? { offset } : {}),
    ...(edit.hide ? { hide: true as const } : {}),
  }
  const { [clip]: _old, ...others } = m.clips ?? {}
  const clips = Object.keys(override).length > 0 ? { ...others, [clip]: override } : others
  const { clips: _clips, ...rest } = m
  return Object.keys(clips).length > 0 ? { ...rest, clips } : rest
}

// ── the starting mount, pickers, save ────────────────────────────────

/** A first guess for a prop with no mount: held in the right hand by its origin, +y to the working end. */
export function defaultMount(): Mount {
  return { slot: "hand.r", hands: 1, handle: [0, 0, 0], axis: [0, 1, 0], edge: [1, 0, 0] }
}

/** The mount to start editing from: the saved one in `data/mounts.json`, else the catalog's, else a guess. */
export function startMount(
  id: string,
  saved: Record<string, Mount> | undefined,
  entry?: CatalogEntry,
): Mount {
  return structuredClone(saved?.[id] ?? entry?.compose.mount ?? defaultMount())
}

/**
 * Props the search lists: category `prop`, matched on every word of `text` (id, name or tag), held and
 * worn props first, then by id. With `holdable`, only held and worn props.
 */
export function propChoices(
  entries: readonly CatalogEntry[],
  text: string,
  holdable: boolean,
  limit = 80,
): CatalogEntry[] {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean)
  const held = (e: CatalogEntry) => e.compose.attach === "held" || e.compose.attach === "worn"
  return entries
    .filter((e) => e.category === "prop" && (!holdable || held(e)))
    .filter((e) => {
      const hay = `${e.id} ${e.name} ${e.tags.join(" ")}`.toLowerCase()
      return words.every((w) => hay.includes(w))
    })
    .sort((a, b) => Number(held(b)) - Number(held(a)) || a.id.localeCompare(b.id))
    .slice(0, limit)
}

/** Bodies that play the rig the slot frames were measured on. */
export function bodyChoices(entries: readonly CatalogEntry[]): CatalogEntry[] {
  return entries.filter((e) => e.kind === "character" && e.character?.rig === RIG)
}

/** `data/mounts.json` with `id`'s mount replaced and every other entry kept as it was. */
export function mergeMount(saved: Record<string, Mount> | undefined, id: string, mount: Mount): MountsFile {
  return { version: 1, mounts: { ...saved, [id]: mount } }
}
