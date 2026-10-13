/**
 * The heroes' chips (decisions.md "Hero chips = V1 port"): V1's label over each agent's head (legacy
 * hall scene/Label, ChipLayer, chips.ts, Adventurer) as plain DOM in the Viewer's labels layer, in V2's
 * tokens (ui `heroChip`, `.ui-hero`). Three parts:
 *
 *   what a chip says   `chipViews(world, t)`: name, rank pips, the verb line from the hero's intent
 *                      ("editing hex/life.ts", "waiting on you", "returning with loot") with its glyph and
 *                      tone, the deed sigil while a deed runs, the party's pennant when there is more than
 *                      one, and speech from the world's recent moments (a quest given, loot, a fall). Pure.
 *   where chips go     `Declutter` (V1's chips.ts, pure): about ten times a second, nearest first with the
 *                      followed and the pleading placed before anyone, it folds a pile of three or more
 *                      overlapping chips into one that reads "+N", nudges any other overlap upward, keeps
 *                      chips off the HUD (`data-keepout`), lets at most MAX_SPEAKERS speak (never two
 *                      bubbles in one place; in Minimal only the followed or those close by), and turns
 *                      strict at crowd scale (two make a pile, folded chips never fade) and on a phone.
 *   the DOM            `createChips(host)`: one chip per hero, moved every frame (a transform, only when it
 *                      moved), its texts and attributes written only when they change, its size measured by
 *                      a ResizeObserver (never read per run), the HUD's rects read twice a second between
 *                      frames. No React, no layout read in a frame, no allocation in a run.
 */
import { type Craft, commandGist } from "@guildhall/core"
import { type GuildWorld, pipsOf, type WorldActor, type WorldEvent } from "@guildhall/sim"
import { type ChipGlyph, type ChipTone, type HeroChipParts, heroChip, setGlyph, setPips } from "@guildhall/ui"

// ─────────────────────────────── what a chip says ───────────────────────────────

export interface ChipView {
  id: string
  name: string
  /** The hero's role colour (the plate's edge, the sigil's rim). */
  colour: string
  /** Its party's banner, when more than one party is on the island. */
  party?: string
  pips: number
  tone: ChipTone
  glyph: ChipGlyph
  /** The verb line's word(s): "editing", "waiting on you", "returning with loot". */
  verb: string
  /** What it is about, in mono: "hex/life.ts", "yardThemes", "git status" (may be ""). */
  target: string
  /** The deed sigil's glyph while a deed runs, else null. */
  sigil: ChipGlyph | null
  /** Resting or done: a softer chip. */
  quiet: boolean
  /** Waiting on a human: pinned, with its plea mark. */
  plea: boolean
  /** What it says now ("" for nothing). */
  speech: string
}

/** A deed in progress, by its craft (V1 hud/format.ts VERBS). */
const VERBS: Record<Craft, { verb: string; glyph: ChipGlyph }> = {
  read: { verb: "reading", glyph: "read" },
  search: { verb: "searching", glyph: "search" },
  edit: { verb: "editing", glyph: "edit" },
  write: { verb: "writing", glyph: "edit" },
  run: { verb: "running", glyph: "run" },
  test: { verb: "testing", glyph: "test" },
  lint: { verb: "checking", glyph: "test" },
  fetch: { verb: "consulting", glyph: "globe" },
  consult: { verb: "consulting", glyph: "globe" },
  plan: { verb: "planning", glyph: "thought" },
  delegate: { verb: "dispatching", glyph: "summon" },
  other: { verb: "working", glyph: "work" },
}

/** `…/packages/world/src/hex/life.ts` → `hex/life.ts`: a file's folder and name. */
export function shortFile(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean)
  return parts.slice(-2).join("/")
}

/** The plain words of what a deed is about: a file, a search term, a command's gist; never a raw line. */
function targetOf(intent: NonNullable<WorldActor["intent"]>): string {
  if (intent.craft === "delegate" || intent.craft === "plan") return ""
  const path = intent.paths[0]
  if (path) return shortFile(path)
  const tool = intent.tool.toLowerCase()
  if (tool === "bash" || tool === "shell" || tool === "powershell")
    return commandGist(intent.target).target ?? ""
  const t = intent.target.replace(/\s+/g, " ").trim()
  return t.length > 28 ? `${t.slice(0, 27)}…` : t
}

/**
 * The verb line of a hero: what it is doing now, in a word or three with its glyph and tone, and what
 * about. `walking`: the figure is on its way (a hero's loot goes home on foot).
 */
export function verbOf(
  a: Pick<WorldActor, "status" | "parent" | "intent">,
  walking = false,
): { verb: string; glyph: ChipGlyph; tone: ChipTone; target: string; sigil: ChipGlyph | null } {
  const none = { target: "", sigil: null }
  switch (a.status) {
    case "waiting":
      return { verb: "waiting on you", glyph: "plea", tone: "plea", ...none }
    case "failed":
      return { verb: "fallen", glyph: "fail", tone: "fail", ...none }
    case "done":
      if (a.parent === undefined) return { verb: "resting", glyph: "idle", tone: "idle", ...none }
      return walking
        ? { verb: "returning with loot", glyph: "loot", tone: "loot", ...none }
        : { verb: "home with loot", glyph: "loot", tone: "loot", ...none }
    case "starting":
      return { verb: "arriving", glyph: "join", tone: "work", ...none }
    default:
      break
  }
  const intent = a.intent
  if (intent && intent.ended === undefined) {
    const v = VERBS[intent.craft]
    return { verb: v.verb, glyph: v.glyph, tone: "work", target: targetOf(intent), sigil: v.glyph }
  }
  if (walking) return { verb: "on the way", glyph: "walk", tone: "work", ...none }
  return { verb: "thinking", glyph: "thought", tone: "work", ...none }
}

/** How long a moment is spoken, ms of the session's clock. */
export const SPEAK_MS = 5000
const SPEECH_MAX = 72

const clipped = (text: string, max = SPEECH_MAX) => {
  const line = text.replace(/\s+/g, " ").trim()
  if (line.length <= max) return line
  const cut = line.slice(0, max - 1)
  const space = cut.lastIndexOf(" ")
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.—-]+$/, "")}…`
}

/** What one moment has its hero say, if anything (the quest it gives, its loot, its fall, its plea). */
export function sayingOf(ev: WorldEvent, world: GuildWorld): { id: string; text: string } | null {
  switch (ev.kind) {
    case "actor.quest":
      return ev.text ? { id: ev.id, text: clipped(ev.text) } : null
    case "actor.loot": {
      const a = world.actors.get(ev.id)
      return {
        id: ev.id,
        text: a?.parent === undefined ? "That's the quest done." : "Done. Bringing it home.",
      }
    }
    case "actor.fail":
      return { id: ev.id, text: ev.error ? clipped(`I've fallen: ${ev.error}`) : "I've fallen." }
    case "actor.plea":
      return { id: ev.id, text: "I need your word." }
    case "actor.join":
      return ev.parent ? { id: ev.id, text: "On my way." } : null
    default:
      return null
  }
}

/** What each hero says at `t`: its latest saying from the last SPEAK_MS of the world's moments. */
export function speechOf(world: GuildWorld, t: number): Map<string, string> {
  const out = new Map<string, string>()
  for (const ev of world.recent) {
    if (ev.at > t || t - ev.at > SPEAK_MS) continue
    const said = sayingOf(ev, world)
    if (said) out.set(said.id, said.text)
  }
  return out
}

/** Who leads a hero's party: its guildmaster, the top of its parent chain. */
function masterOf(world: GuildWorld, id: string): WorldActor | undefined {
  let a = world.actors.get(id)
  for (let k = 0; k < 64 && a?.parent !== undefined; k++) {
    const up = world.actors.get(a.parent)
    if (!up) break
    a = up
  }
  return a
}

/** Every hero on the island at `t` as its chip says it. `walking(id)`: its figure is on its way. */
export function chipViews(
  world: GuildWorld,
  t: number,
  walking: (id: string) => boolean = () => false,
  /** A name and colour a hero is drawn with over the world's (the demo's Claude, Warden, Scout). */
  looks?: (id: string) => { name: string; colour: string } | undefined,
): Map<string, ChipView> {
  const out = new Map<string, ChipView>()
  const speech = speechOf(world, t)
  let parties = 0
  for (const a of world.actors.values()) if (a.parent === undefined && a.gone === undefined) parties++
  for (const a of world.actors.values()) {
    if (a.gone !== undefined) continue
    const v = verbOf(a, walking(a.id))
    const master = parties > 1 ? masterOf(world, a.id) : undefined
    const party = master ? (looks?.(master.id)?.colour ?? master.color) : undefined
    const look = looks?.(a.id)
    out.set(a.id, {
      id: a.id,
      name: look?.name ?? a.name,
      colour: look?.colour ?? a.color,
      ...(party ? { party } : {}),
      pips: pipsOf(a.rank),
      tone: v.tone,
      glyph: v.glyph,
      verb: v.verb,
      target: v.target,
      sigil: v.sigil,
      quiet: v.tone === "idle",
      plea: a.status === "waiting",
      speech: speech.get(a.id) ?? "",
    })
  }
  return out
}

// ─────────────────────────────── where chips go ───────────────────────────────

export type ChipMode = "detailed" | "minimal" | "hidden"
/** left, top, right, bottom, CSS px in the layer. */
export type Rect = [number, number, number, number]

/** A chip as the declutter sees it: set by the screen, then its run's verdict. */
export interface ChipSlot {
  id: string
  // ── set by the screen ──
  /** The chip's anchor on screen (its bottom centre), CSS px; `on` false when it is not drawn. */
  x: number
  y: number
  /** Distance from the camera (nearer first). */
  z: number
  /** CSS px a metre spans at the anchor (how close the hero is). */
  perUnit: number
  /** Drawn at all this run (on the island, in front of the camera, on screen). */
  shown: boolean
  /** Its size, CSS px (measured by a ResizeObserver; 0 until then). */
  width: number
  height: number
  /** The one you follow. */
  selected: boolean
  /** Waiting on a human. */
  plea: boolean
  /** Fallen (crowd scale: heads its pile before the merely near). */
  fallen: boolean
  /** Has something to say. */
  bubble: boolean
  // ── the run's verdict ──
  folded: boolean
  /** "+N": chips folded into this one. */
  more: number
  lift: number
  speak: boolean
  /** Under the HUD: not drawn. */
  out: boolean
  /** Close enough to read: the verb line's target shows in Minimal, the verb line on a phone. */
  near: boolean
  // ── scratch ──
  on: boolean
  pinned: boolean
  notable: boolean
  w: number
  h: number
  index: number
  parent: number
  count: number
  votes: number
}

export function chipSlot(id: string): ChipSlot {
  return {
    id,
    x: 0,
    y: 0,
    z: 0,
    perUnit: 0,
    shown: false,
    width: 0,
    height: 0,
    selected: false,
    plea: false,
    fallen: false,
    bubble: false,
    folded: false,
    more: 0,
    lift: 0,
    speak: false,
    out: false,
    near: false,
    on: false,
    pinned: false,
    notable: false,
    w: 0,
    h: 0,
    index: 0,
    parent: 0,
    count: 0,
    votes: 0,
  }
}

/** Space kept between two chips, px. */
const GAP = 3
/** A chip never climbs further than this above its head, px. */
const MAX_LIFT = 96
/** A pile this large folds into one chip. */
export const FOLD_AT = 3
/** Runs a chip must want to fold (or unfold) before it does: chips walking past don't flicker. */
const FOLD_AFTER = 3
const UNFOLD_AFTER = 2
/** More chips than this on stage is a crowd: the strict rules apply (until it drops to CROWD_UNTIL). */
export const CROWD_AT = 24
const CROWD_UNTIL = 20
/** On a phone the strict rules start at this many chips. */
export const PHONE_AT = 3
const CROWD_FOLD_AT = 2
const CROWD_FOLD_AFTER = 1
const CROWD_UNFOLD_AFTER = 3
/** At crowd scale piles gather chips this close (px), not only touching ones. */
const CROWD_PAD = 10
/** Speech bubbles on screen at once, at most. */
export const MAX_SPEAKERS = 3
/** A bubble's widest box, px (`.ui-hero-bubble`): never two such boxes over each other. */
const BUBBLE_W = 220
const BUBBLE_H = 64
/**
 * CSS px a metre must span before a hero reads as close: a figure (~1.15 m at the island's scale) about
 * 45 px tall. Minimal shows speech and the verb's target from here; a phone its verb line.
 */
export const NEAR_PX = 39

/** The view a run lays chips out in. */
export interface ChipField {
  width: number
  height: number
  mode: ChipMode
  phone: boolean
  /** HUD rects chips keep off (`data-keepout`), layer px. */
  keep: readonly Rect[]
}

/** May this chip speak, by the HUD mode, whether it is followed and how close? (V1 `speaks`.) */
export function speaks(mode: ChipMode, selected: boolean, near: boolean): boolean {
  if (mode === "hidden") return false
  return mode === "detailed" || selected || near
}

/**
 * The declutter (V1 scene/chips.ts): one run lays out every slot. Its lists are reused, so a run
 * allocates nothing; with a few dozen chips the pair checks are cheaper than V1's grid, which was for
 * hundreds.
 */
export class Declutter {
  readonly slots: ChipSlot[] = []
  /** At crowd scale (the strict rules) after the last run. */
  crowd = false
  private readonly order: ChipSlot[] = []
  private readonly speakers: ChipSlot[] = []
  private readonly hosts: (ChipSlot | undefined)[] = []

  run(field: ChipField): void {
    const { order } = this
    order.length = 0
    let count = 0
    for (const s of this.slots) if (s.shown) count++
    this.crowd = count > (this.crowd ? CROWD_UNTIL : CROWD_AT) || (field.phone && count > PHONE_AT)
    const crowd = this.crowd
    for (const s of this.slots) {
      s.on = false
      s.out = false
      s.pinned = s.selected || s.plea
      s.notable = crowd && (s.plea || s.fallen)
      s.near = s.perUnit >= NEAR_PX
      if (!s.shown || s.width === 0 || s.height === 0) continue
      // a phone folds a chip the edge would clip (the followed and a plea stay)
      if (field.phone && !s.pinned && Math.abs(s.x - field.width / 2) > (field.width - s.width) / 2) continue
      s.w = s.width
      s.h = s.height
      s.on = true
      order.push(s)
    }
    order.sort(before)

    // ── piles: chips whose resting boxes overlap, joined transitively ──
    for (let i = 0; i < order.length; i++) {
      const s = order[i] as ChipSlot
      s.index = i
      s.parent = i
      s.count = 0
      s.more = 0
    }
    const pad = crowd ? CROWD_PAD : 0
    for (let i = 0; i < order.length; i++)
      for (let j = i + 1; j < order.length; j++)
        if (overlaps(order[i] as ChipSlot, 0, order[j] as ChipSlot, 0, pad)) this.union(i, j)
    for (const s of order) (order[this.find(s.index)] as ChipSlot).count++
    const foldAt = crowd ? CROWD_FOLD_AT : FOLD_AT
    for (const s of order) {
      if (s.pinned) {
        s.folded = false
        s.votes = 0
        continue
      }
      const root = order[this.find(s.index)] as ChipSlot
      this.vote(s, root.count >= foldAt && s !== root)
    }
    // "+N" on the first chip of a pile still shown; a pile always keeps one chip
    const { hosts } = this
    hosts.length = order.length
    hosts.fill(undefined)
    for (const s of order) {
      const r = this.find(s.index)
      if (!s.folded && !hosts[r]) hosts[r] = s
    }
    for (const s of order) {
      if (!s.folded) continue
      const r = this.find(s.index)
      const host = hosts[r]
      if (host) host.more++
      else {
        s.folded = false
        hosts[r] = s
      }
    }

    // ── nudge: shown chips in priority order, each above whatever it would cover ──
    for (const s of order) s.lift = 0
    for (let i = 0; i < order.length; i++) {
      const s = order[i] as ChipSlot
      if (s.folded) continue
      let moved = true
      for (let guard = 0; moved && guard < 8; guard++) {
        moved = false
        for (let j = 0; j < i; j++) {
          const o = order[j] as ChipSlot
          if (o.folded || !overlaps(s, s.lift, o, o.lift)) continue
          const need = s.y - (o.y - o.lift - o.h) + GAP
          if (need > s.lift) {
            s.lift = Math.min(MAX_LIFT, need)
            moved = s.lift < MAX_LIFT
          }
        }
      }
    }

    // ── the HUD: a chip whose box lies under a HUD region is not drawn ──
    for (const s of order) {
      if (s.folded) continue
      const l = s.x - s.w / 2
      const r = s.x + s.w / 2
      const b = s.y - s.lift
      const t = b - s.h
      for (const [L, T, R, B] of field.keep)
        if (l < R && r > L && t < B && b > T) {
          s.out = true
          break
        }
    }

    // ── speech: pinned and nearest first, never two bubbles in one place, MAX_SPEAKERS in all ──
    const { speakers } = this
    speakers.length = 0
    for (const s of this.slots) s.speak = false
    for (const s of order) {
      if (speakers.length >= MAX_SPEAKERS) break
      if (s.folded || s.out || !s.bubble || !speaks(field.mode, s.selected, s.near)) continue
      let crowded = false
      for (const o of speakers)
        if (Math.abs(s.x - o.x) < BUBBLE_W + GAP && Math.abs(s.y - o.y) < BUBBLE_H + GAP) crowded = true
      if (crowded) continue
      s.speak = true
      speakers.push(s)
    }

    // off screen: rests, so it comes back where it belongs; drawn but left out (not measured yet, or a
    // phone's edge would clip it): folded until it earns its place
    for (const s of this.slots)
      if (!s.on) {
        s.lift = 0
        s.more = 0
        s.folded = s.shown
        s.votes = 0
      }
  }

  /** The shown chips' boxes now (left, top, right, bottom), for the plates to keep off. */
  boxes(out: Rect[]): Rect[] {
    out.length = 0
    for (const s of this.order) {
      if (s.folded || s.out) continue
      out.push([s.x - s.w / 2, s.y - s.lift - s.h, s.x + s.w / 2, s.y - s.lift])
    }
    return out
  }

  private find(i: number): number {
    const { order } = this
    let at = i
    while ((order[at] as ChipSlot).parent !== at) at = (order[at] as ChipSlot).parent
    let walk = i
    while ((order[walk] as ChipSlot).parent !== at) {
      const next = (order[walk] as ChipSlot).parent
      ;(order[walk] as ChipSlot).parent = at
      walk = next
    }
    return at
  }

  /** The lower index (higher priority) becomes the root. */
  private union(i: number, j: number): void {
    const a = this.find(i)
    const b = this.find(j)
    if (a === b) return
    if (a < b) (this.order[b] as ChipSlot).parent = a
    else (this.order[a] as ChipSlot).parent = b
  }

  private vote(s: ChipSlot, fold: boolean): void {
    if (fold === s.folded) {
      s.votes = 0
      return
    }
    s.votes++
    const after = this.crowd
      ? fold
        ? CROWD_FOLD_AFTER
        : CROWD_UNFOLD_AFTER
      : fold
        ? FOLD_AFTER
        : UNFOLD_AFTER
    if (s.votes >= after) {
      s.folded = fold
      s.votes = 0
    }
  }
}

/** Priority: pinned first, then (crowd scale) a plea or a fall, then nearest the camera. */
function before(a: ChipSlot, b: ChipSlot): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
  if (a.notable !== b.notable) return a.notable ? -1 : 1
  return a.z - b.z || (a.id < b.id ? -1 : 1)
}

/** Do the two boxes, at these lifts, come within GAP (+ `pad`) px of each other? */
function overlaps(a: ChipSlot, liftA: number, b: ChipSlot, liftB: number, pad = 0): boolean {
  const ab = a.y - liftA
  const bb = b.y - liftB
  const gap = GAP + pad
  return Math.abs(a.x - b.x) * 2 < a.w + b.w + gap * 2 && ab - a.h < bb + gap && bb - b.h < ab + gap
}

// ─────────────────────────────── the DOM ───────────────────────────────

/** How often the declutter runs, ms. */
const EVERY_MS = 100
/** How often the HUD's rects are read (between frames), ms. */
const KEEP_MS = 500

export interface Chips {
  /** What the heroes say now (2–10 times a second): chips come, go and change their words. */
  set(views: ReadonlyMap<string, ChipView>): void
  /**
   * Where hero `id`'s chip stands this frame: its anchor on screen (CSS px), its distance and px a metre
   * spans there; null when it is not drawn.
   */
  place(id: string, at: { x: number; y: number; z: number; perUnit: number } | null): void
  /** After every chip is placed, once a frame: the declutter's run when one is due. */
  frame(now: number): void
  /** The hero you follow (its chip pinned and full), or none. */
  select(id: string | null): void
  /** A plea mark was clicked or tapped. */
  onPlea(fn: ((id: string) => void) | null): void
  /** The shown chips' boxes as of the last run (layer px), for plates to keep off. */
  boxes(): readonly Rect[]
  /** The declutter, for shots and tests. */
  readonly declutter: Declutter
  dispose(): void
}

interface Chip {
  parts: HeroChipParts
  slot: ChipSlot
  view: ChipView | null
  // written state
  x: number
  y: number
  drawn: boolean
  lift: number
  more: number
  flags: number
}

/** A flag per attribute the declutter writes, so a run writes only what changed. */
const F = { folded: 1, speak: 2, out: 4, crowd: 8, near: 16, selected: 32 } as const
const ATTRS: [number, string][] = [
  [F.folded, "data-folded"],
  [F.speak, "data-speak"],
  [F.out, "data-out"],
  [F.crowd, "data-crowd"],
  [F.near, "data-near"],
  [F.selected, "data-selected"],
]

/**
 * The chip layer over the stage, in `host` (the Viewer's labels layer). `field()` says the view: its
 * size, the HUD's mode and whether it is a phone (attribute reads, never layout).
 */
export function createChips(
  host: HTMLElement,
  field: () => { width: number; height: number; mode: ChipMode; phone: boolean },
): Chips {
  const layer = document.createElement("div")
  layer.className = "ui-heroes"
  host.append(layer)
  const declutter = new Declutter()
  const chips = new Map<string, Chip>()
  let selected: string | null = null
  let plea: ((id: string) => void) | null = null
  let last = Number.NEGATIVE_INFINITY
  let keep: Rect[] = []
  const shownBoxes: Rect[] = []
  let mode = ""
  let phone = false
  const owners = new Map<Element, Chip>()
  const observer =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver((entries) => {
          // after layout: these reads cost nothing (a hidden chip reads 0 × 0)
          for (const e of entries) {
            const c = owners.get(e.target)
            if (!c) continue
            const el = e.target as HTMLElement
            c.slot.width = el.offsetWidth
            c.slot.height = el.offsetHeight
          }
        })
  // the HUD's rects, between frames (a read there finds layout clean)
  const readKeep = () => {
    const at = host.getBoundingClientRect()
    keep = [...document.querySelectorAll("[data-keepout]")].flatMap((el) => {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return []
      return [
        [r.left - at.left - 4, r.top - at.top - 4, r.right - at.left + 4, r.bottom - at.top + 4] as Rect,
      ]
    })
  }
  const timer = setInterval(readKeep, KEEP_MS)
  setTimeout(readKeep, 0)

  const make = (id: string): Chip => {
    const parts = heroChip(() => plea?.(id))
    parts.at.style.display = "none"
    const c: Chip = {
      parts,
      slot: chipSlot(id),
      view: null,
      x: Number.NaN,
      y: Number.NaN,
      drawn: false,
      lift: 0,
      more: 0,
      flags: 0,
    }
    layer.append(parts.at)
    owners.set(parts.chip, c)
    observer?.observe(parts.chip)
    declutter.slots.push(c.slot)
    return c
  }
  const drop = (c: Chip) => {
    observer?.unobserve(c.parts.chip)
    owners.delete(c.parts.chip)
    c.parts.at.remove()
    const k = declutter.slots.indexOf(c.slot)
    if (k >= 0) declutter.slots.splice(k, 1)
  }
  /** A view's words into the chip, each only when it changed. */
  const write = (c: Chip, v: ChipView) => {
    const was = c.view
    const p = c.parts
    const el = p.chip
    if (was?.name !== v.name) p.name.textContent = v.name
    if (was?.colour !== v.colour) el.style.setProperty("--hero", v.colour)
    if (was?.party !== v.party) {
      if (v.party) {
        el.style.setProperty("--party", v.party)
        el.dataset.party = ""
      } else delete el.dataset.party
    }
    if (was?.pips !== v.pips) setPips(p.pips, v.pips)
    if (was?.tone !== v.tone) el.dataset.tone = v.tone
    if (was?.glyph !== v.glyph) setGlyph(p.glyph, v.glyph)
    if (was?.verb !== v.verb) p.word.textContent = v.verb
    if (was?.target !== v.target) p.target.textContent = v.target
    if (was?.sigil !== v.sigil) {
      if (v.sigil) {
        setGlyph(p.sigilGlyph, v.sigil)
        el.dataset.sigil = ""
      } else delete el.dataset.sigil
    }
    if (was?.quiet !== v.quiet) el.toggleAttribute("data-quiet", v.quiet)
    if (was?.speech !== v.speech) p.bubble.textContent = v.speech
    c.slot.plea = v.plea
    c.slot.fallen = v.tone === "fail"
    c.slot.bubble = v.speech !== "" && !v.quiet
    c.view = v
  }

  return {
    declutter,
    set(views) {
      for (const [id, c] of chips)
        if (!views.has(id)) {
          drop(c)
          chips.delete(id)
        }
      for (const [id, v] of views) {
        let c = chips.get(id)
        if (!c) {
          c = make(id)
          chips.set(id, c)
        }
        write(c, v)
      }
    },
    place(id, at) {
      const c = chips.get(id)
      if (!c) return
      const s = c.slot
      s.shown = at !== null
      if (!at) {
        if (c.drawn) {
          c.parts.at.style.display = "none"
          c.drawn = false
        }
        return
      }
      s.x = at.x
      s.y = at.y
      s.z = at.z
      s.perUnit = at.perUnit
      if (!c.drawn) {
        c.parts.at.style.display = ""
        c.drawn = true
      }
      // (NaN at first: never placed yet)
      if (!(Math.abs(at.x - c.x) <= 0.25 && Math.abs(at.y - c.y) <= 0.25)) {
        c.x = at.x
        c.y = at.y
        c.parts.at.style.transform = `translate3d(${at.x.toFixed(1)}px,${at.y.toFixed(1)}px,0)`
      }
    },
    frame(now) {
      if (now - last < EVERY_MS) return
      last = now
      const f = field()
      if (f.mode !== mode) {
        mode = f.mode
        layer.dataset.mode = mode
      }
      if (f.phone !== phone) {
        phone = f.phone
        layer.toggleAttribute("data-phone", phone)
      }
      for (const c of chips.values()) c.slot.selected = c.slot.id === selected
      declutter.run({ ...f, keep })
      const crowd = declutter.crowd
      for (const c of chips.values()) {
        const s = c.slot
        const el = c.parts.chip
        const flags =
          (s.folded ? F.folded : 0) |
          (s.speak ? F.speak : 0) |
          (s.out ? F.out : 0) |
          (crowd ? F.crowd : 0) |
          (s.near ? F.near : 0) |
          (s.selected ? F.selected : 0)
        if (flags !== c.flags) {
          for (const [bit, attr] of ATTRS)
            if ((flags & bit) !== (c.flags & bit)) el.toggleAttribute(attr, (flags & bit) !== 0)
          c.flags = flags
        }
        const lift = s.folded ? c.lift : Math.round(s.lift)
        if (lift !== c.lift) {
          c.lift = lift
          el.style.setProperty("--lift", `${lift}px`)
        }
        if (s.more !== c.more) {
          c.more = s.more
          c.parts.more.textContent = s.more > 0 ? `+${s.more}` : ""
          el.toggleAttribute("data-more", s.more > 0)
        }
      }
      declutter.boxes(shownBoxes)
    },
    select(id) {
      selected = id
      last = Number.NEGATIVE_INFINITY
    },
    onPlea(fn) {
      plea = fn
    },
    boxes: () => shownBoxes,
    dispose() {
      clearInterval(timer)
      observer?.disconnect()
      layer.remove()
      chips.clear()
    },
  }
}
