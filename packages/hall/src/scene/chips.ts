import { type Camera, type Object3D, Vector3 } from "three"
import type { HudMode } from "../hud/prefs.ts"
import { pxPerUnit, sigilRoom, sizeFor } from "./sigilSize.ts"

/**
 * Screen-space declutter for the name chips over adventurers' heads (`<Label>`, scene/ChipLayer.tsx).
 *
 * About ten times a second it projects every chip's anchor, sorts nearest first, and:
 *  - folds a pile of three or more overlapping chips into one that reads "+N";
 *  - nudges any other overlapping chip upward until it clears the ones placed before it.
 * The chip you follow and a pleading chip always stay visible (they are placed first).
 *
 * A chip whose adventurer shows a deed sigil (scene/Sigils.tsx) keeps a band under itself for it
 * (`--room`, sigilSize.ts), and that band counts as part of the chip: no other chip is placed over a
 * sigil, and in the Hidden HUD (no name plate) the sigils alone still declutter.
 *
 * Speech bubbles are the declutter's too (`speaks`, below): with no HUD the world speaks only through
 * the story captions; in Minimal a bubble shows for whoever you follow, or once the camera is close
 * enough that speech belongs to a figure you can see; never two bubbles over one another and at most
 * MAX_SPEAKERS on screen, nearest first, so they never stack into a wall of text.
 *
 * Nothing here goes through React: it writes a CSS variable (`--lift`), two attributes and a text,
 * and only when they change. CSS eases the lift and fades a folded chip, so nothing jumps.
 * No allocations per run: slots, scratch vectors, the grid and the sort are all reused.
 *
 * Built for crowds (hundreds of chips): a chip's size is measured once when its element appears and
 * then kept by a ResizeObserver (never read per run, which would force a layout), and "which chips
 * could touch this one" is asked of a screen-space grid, not of every other chip.
 *
 * At crowd scale (more than CROWD_AT chips on stage) the rules turn strict, so a crowd never reads as
 * a smear of translucent plates: a chip is either fully shown or folded into a pile's "+N". Any two
 * overlapping chips make a pile (and piles gather a little wider, CROWD_PAD), a chip folds at once
 * and unfolds only once it has stayed clear, a folded chip hides without fading (`data-crowd`, hall.css),
 * a chip still dissolving in or out waits until it is solid, and a pile is headed by whoever matters
 * most: the pinned, then a plea or a fall, then the nearest. Normal stories keep the gentle rules.
 */

/** Height of the chip's anchor above the adventurer's feet (the `<Html position>`). */
export const CHIP_HEIGHT = 3.2
const EVERY_MS = 100
/** Space kept between two chips, px. */
const GAP = 3
/** A chip never climbs further than this above its head, px: past it, it sits where it can. */
const MAX_LIFT = 96
/** A pile this large folds into one chip. */
const FOLD_AT = 3
/** Runs a chip must want to fold (or unfold) before it does: chips walking past don't flicker. */
const FOLD_AFTER = 3
const UNFOLD_AFTER = 2
/**
 * More chips than this on stage is a crowd (a stress cast, `?n=300`): the strict rules apply. The
 * showcase stories (party, saga, rush) stay well under it. Leaving crowd mode waits for CROWD_UNTIL,
 * so a cast hovering at the line doesn't switch back and forth.
 */
export const CROWD_AT = 24
const CROWD_UNTIL = 20
/** On a phone (CSS media query) the strict rules start at this many chips: a few small chips, the rest folded. */
const PHONE = "(max-width: 720px)"
const PHONE_AT = 3
/** At crowd scale: two chips make a pile, a chip folds on the first run it overlaps, unfolds after three clear. */
const CROWD_FOLD_AT = 2
const CROWD_FOLD_AFTER = 1
const CROWD_UNFOLD_AFTER = 3
/** At crowd scale piles gather chips this close (px), not only touching ones: fewer, fuller piles. */
const CROWD_PAD = 10
/** Speech bubbles on screen at once, at most (the followed one counts among them). */
export const MAX_SPEAKERS = 3
/**
 * CSS px a world unit must span before Minimal shows speech unasked: a figure ~45 px tall, close
 * enough to read as a person. The diorama overview is ~6; Explore close-ups are 25 and up.
 */
export const READ_AT_PX = 18
/** A bubble's widest box, px (hall.css `.chip .bubble`: 220 wide, two lines and the name). */
const BUBBLE_W = 220
const BUBBLE_H = 64

/**
 * May this chip's bubble show, by the HUD mode, who you follow and how close the camera is?
 * Hidden: never (the captions carry the story). Detailed: always. Minimal: the followed one, or
 * when close enough to read. (The declutter then caps it: no overlapping bubbles, MAX_SPEAKERS in all.)
 */
export function speaks(mode: HudMode, selected: boolean, perUnit: number): boolean {
  if (mode === "hidden") return false
  if (mode === "detailed" || selected) return true
  return perUnit >= READ_AT_PX
}

let hud: HudMode = "minimal"
let crowd = false
/** Is the declutter at crowd scale (its strict rules)? For tests and the HUD. */
export function atCrowdScale(): boolean {
  return crowd
}
/** The HUD mode, for the bubble rule (hud/Hud.tsx keeps it current). */
export function setChipMode(mode: HudMode): void {
  hud = mode
}

export interface ChipSlot {
  /** The adventurer's session id ("" for chips that are not an adventurer's): sigils find their chip by it. */
  id: string
  /** The adventurer's root: the anchor is CHIP_HEIGHT above it, in its own space. */
  anchor: Object3D | null
  /** The `.chip` element. */
  el: HTMLElement | null
  /** Where "+N" is written. */
  more: HTMLElement | null
  /** The element whose size `width`/`height` hold (kept by the ResizeObserver). */
  watched: HTMLElement | null
  /** The chip's size, px: measured when it appears, then whenever it changes (offsetWidth/Height). */
  width: number
  height: number
  /** The selected or pleading chip: never folded, placed before anyone else. */
  pinned: boolean
  /** A deed sigil shows under this chip: keep room for it (set by scene/Sigils.tsx). */
  sigil: boolean
  /** This adventurer has something to say (a `.bubble` is in the chip). */
  bubble: boolean
  /** The one you follow (its bubble may show in Minimal at any distance). */
  selected: boolean
  // ── per run, crowd scale ──
  /** Pleading or fallen (the chip's `data-tone`): heads its pile before the merely near. */
  notable: boolean
  /** Still dissolving in or out (its wrapper is translucent): kept folded until it is solid. */
  faint: boolean
  // ── per run ──
  on: boolean
  x: number
  y: number
  w: number
  h: number
  z: number
  parent: number
  index: number
  /** Chips in the pile this one roots (meaningful on roots only). */
  count: number
  lift: number
  /** Px kept under the chip for its sigil, this run. */
  room: number
  /** CSS px a world unit spans at the anchor, this run. */
  perUnit: number
  /** Its bubble shows, this run. */
  speak: boolean
  // ── written state ──
  shownLift: number
  shownRoom: number
  shownSpeak: boolean
  folded: boolean
  votes: number
  shownMore: number
  moreN: number
  shownCrowd: boolean
}

export function chipSlot(): ChipSlot {
  return {
    id: "",
    anchor: null,
    el: null,
    more: null,
    watched: null,
    width: 0,
    height: 0,
    pinned: false,
    sigil: false,
    bubble: false,
    selected: false,
    notable: false,
    faint: false,
    on: false,
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    z: 0,
    parent: 0,
    index: 0,
    count: 0,
    lift: 0,
    room: 0,
    perUnit: 0,
    speak: false,
    shownLift: 0,
    shownRoom: 0,
    shownSpeak: false,
    folded: false,
    votes: 0,
    shownMore: 0,
    moreN: 0,
    shownCrowd: false,
  }
}

const slots: ChipSlot[] = []
/** On-screen slots, priority order: reused every run. */
const order: ChipSlot[] = []
const scratch = new Vector3()
let last = -Infinity

export function addChip(slot: ChipSlot): void {
  if (!slots.includes(slot)) slots.push(slot)
}

/** The chip of the adventurer with session `id`, if it is on stage. */
export function chipOf(id: string): ChipSlot | undefined {
  for (const slot of slots) if (slot.id === id) return slot
  return undefined
}

export function removeChip(slot: ChipSlot): void {
  const at = slots.indexOf(slot)
  if (at >= 0) slots.splice(at, 1)
  watch(slot, null)
}

// ── sizes: measured when a chip appears, then kept by one ResizeObserver ──

let observer: ResizeObserver | null = null
const owners = new Map<Element, ChipSlot>()

/** Measure `el` for `slot` now, and whenever it resizes from here on (null: stop). */
function watch(slot: ChipSlot, el: HTMLElement | null): void {
  if (slot.watched) {
    owners.delete(slot.watched)
    observer?.unobserve(slot.watched)
  }
  slot.watched = el
  slot.width = el ? el.offsetWidth : 0
  slot.height = el ? el.offsetHeight : 0
  if (!el) return
  if (!observer && typeof ResizeObserver !== "undefined") observer = new ResizeObserver(resized)
  owners.set(el, slot)
  observer?.observe(el)
}

/** After layout, so these reads cost nothing: a hidden chip (display none) reads 0 × 0. */
function resized(entries: ResizeObserverEntry[]): void {
  for (const entry of entries) {
    const slot = owners.get(entry.target)
    if (!slot) continue
    const el = entry.target as HTMLElement
    slot.width = el.offsetWidth
    slot.height = el.offsetHeight
  }
}

/**
 * Called from every adventurer's frame; does the work at most every EVERY_MS. `width`/`height` are
 * the canvas size in CSS px (R3F `size`), the space drei places the chips in.
 */
export function declutter(camera: Camera, width: number, height: number, now = performance.now()): void {
  if (now - last < EVERY_MS) return
  last = now
  layout(camera, width, height)
}

/** One run, exported for tests. */
export function layout(camera: Camera, width: number, height: number): void {
  // ── read: positions and the kept sizes; nothing here touches layout ──
  order.length = 0
  const phone = typeof matchMedia === "function" && matchMedia(PHONE).matches
  crowd = slots.length > (crowd ? CROWD_UNTIL : CROWD_AT) || (phone && slots.length > PHONE_AT)
  for (const slot of slots) {
    slot.on = false
    slot.faint = false
    slot.notable = false
    const { el, anchor } = slot
    if (!el || !anchor) continue
    if (el !== slot.watched) watch(slot, el)
    if (crowd) {
      // Inline style and an attribute: reads that never force a layout.
      const tone = el.dataset?.tone
      slot.notable = tone === "plea" || tone === "fail"
      // The adventurer's dissolve writes its wrapper's opacity ("" when solid; scene/Adventurer.tsx).
      const fade = el.parentElement?.style.opacity
      slot.faint = !slot.pinned && Boolean(fade) && fade !== "1"
      if (slot.faint) continue
    }
    scratch.set(0, CHIP_HEIGHT, 0)
    anchor.localToWorld(scratch)
    const perUnit = pxPerUnit(camera, scratch, height)
    slot.perUnit = perUnit
    const size = slot.sigil ? sizeFor(perUnit) : 0
    slot.room = size ? sigilRoom(size, perUnit, CHIP_HEIGHT) : 0
    // The band counts as part of the chip, so a sigil alone (Hidden HUD: no plate) declutters too.
    const w = Math.max(slot.width, size)
    const h = slot.height + slot.room || size
    if (w === 0 || h === 0) {
      // Not measured yet (just back from display none: the observer reports after this layout). At
      // crowd scale it waits folded rather than show for a run outside the declutter.
      if (crowd && !slot.pinned) slot.faint = true
      continue
    }
    scratch.project(camera)
    if (scratch.z > 1 || scratch.z < -1) continue
    slot.x = (scratch.x * 0.5 + 0.5) * width
    // A phone folds a chip the edge would clip (the one you follow or a plea stays).
    if (phone && !slot.pinned && !slot.notable && Math.abs(slot.x - width / 2) > (width - w) / 2) {
      slot.faint = true
      continue
    }
    // The chip's bottom edge sits on the anchor (drei centres it; `.chip` lifts itself by half).
    slot.y = (-scratch.y * 0.5 + 0.5) * height
    slot.z = scratch.z
    slot.w = w
    slot.h = h
    slot.on = true
    order.push(slot)
  }
  order.sort(before)

  // ── piles: chips whose resting boxes overlap, joined transitively ──
  for (let i = 0; i < order.length; i++) {
    const slot = order[i] as ChipSlot
    slot.index = i
    slot.parent = i
    slot.count = 0
    slot.moreN = 0
  }
  grid.maxW = 0
  grid.maxH = 0
  for (const slot of order) {
    grid.maxW = Math.max(grid.maxW, slot.w)
    grid.maxH = Math.max(grid.maxH, slot.h)
  }
  grid.clear()
  for (const slot of order) grid.add(slot, 0)
  const pad = crowd ? CROWD_PAD : 0
  for (const a of order) {
    // Each pair once, from its higher-priority side.
    const near = grid.near(a, a.y - a.h - pad, a.y + pad, pad)
    for (const b of near) if (b.index > a.index && overlaps(a, 0, b, 0, pad)) union(a.index, b.index)
  }
  for (const slot of order) (order[find(slot.index)] as ChipSlot).count++
  const foldAt = crowd ? CROWD_FOLD_AT : FOLD_AT
  for (const slot of order) {
    const root = order[find(slot.index)] as ChipSlot
    if (slot.pinned) {
      slot.folded = false
      slot.votes = 0
      continue
    }
    // The first of a pile in priority order is its root (union keeps the lower index): it stays.
    vote(slot, root.count >= foldAt && slot !== root)
  }
  // "+N" goes on the first chip of the pile still shown; a pile always keeps one chip.
  hosts.length = order.length
  hosts.fill(undefined)
  for (const slot of order) {
    const root = find(slot.index)
    if (!slot.folded && !hosts[root]) hosts[root] = slot
  }
  for (const slot of order) {
    if (!slot.folded) continue
    const root = find(slot.index)
    const host = hosts[root]
    if (host) host.moreN++
    else {
      slot.folded = false
      hosts[root] = slot
    }
  }

  // ── speech: pinned and nearest first, never two bubbles in one place, MAX_SPEAKERS in all ──
  speakers.length = 0
  for (const slot of order) slot.speak = false
  for (const slot of order) {
    if (speakers.length >= MAX_SPEAKERS) break
    if (slot.folded || !slot.bubble || !speaks(hud, slot.selected, slot.perUnit)) continue
    if (crowded(slot)) continue
    slot.speak = true
    speakers.push(slot)
  }

  // ── nudge: place shown chips in priority order, each above whatever it would cover ──
  // The grid holds the chips placed so far, where they were placed; asked for everything a chip
  // could meet at any lift it may take, in priority order, it gives what a scan of them all would.
  grid.clear()
  for (const slot of order) slot.lift = 0
  for (const slot of order) {
    if (slot.folded) continue
    const near = grid.near(slot, slot.y - MAX_LIFT - slot.h, slot.y)
    near.sort(byIndex)
    let moved = true
    let guard = 0
    while (moved && guard++ < 8) {
      moved = false
      for (const other of near) {
        if (!overlaps(slot, slot.lift, other, other.lift)) continue
        // Bottom of this chip goes GAP above the top of the other.
        const need = slot.y - (other.y - other.lift - other.h) + GAP
        if (need > slot.lift) {
          slot.lift = Math.min(MAX_LIFT, need)
          moved = slot.lift < MAX_LIFT
        }
      }
    }
    grid.add(slot, slot.lift)
  }

  // ── write: only what changed ──
  for (const slot of slots) {
    const el = slot.el
    if (!el) continue
    if (!slot.on) {
      // Off screen: let it rest, so it comes back where it belongs. Faint (crowd scale, still
      // dissolving): folded until solid, then it has to earn its place like any other.
      slot.lift = 0
      slot.moreN = 0
      slot.folded = slot.faint
      slot.votes = 0
      slot.room = slot.sigil ? slot.shownRoom : 0
    }
    if (crowd !== slot.shownCrowd) {
      slot.shownCrowd = crowd
      el.toggleAttribute("data-crowd", crowd)
    }
    if (slot.room !== slot.shownRoom) {
      slot.shownRoom = slot.room
      el.style.setProperty("--room", `${slot.room}px`)
    }
    const lift = slot.folded ? slot.shownLift : Math.round(slot.lift)
    if (lift !== slot.shownLift) {
      slot.shownLift = lift
      el.style.setProperty("--lift", `${lift}px`)
    }
    // Attributes React never sets on the chip, so its re-renders can't undo them.
    if (el.hasAttribute("data-folded") !== slot.folded) el.toggleAttribute("data-folded", slot.folded)
    if (!slot.on) slot.speak = false
    if (slot.speak !== slot.shownSpeak) {
      slot.shownSpeak = slot.speak
      el.toggleAttribute("data-speak", slot.speak)
    }
    if (slot.moreN !== slot.shownMore) {
      slot.shownMore = slot.moreN
      if (slot.more) slot.more.textContent = slot.moreN > 0 ? `+${slot.moreN}` : ""
      el.toggleAttribute("data-more", slot.moreN > 0)
    }
  }
}

/** Priority order: pinned first, then (crowd scale) a plea or a fall, then nearest the camera first. */
function before(a: ChipSlot, b: ChipSlot): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
  if (a.notable !== b.notable) return a.notable ? -1 : 1
  return a.z - b.z
}

function byIndex(a: ChipSlot, b: ChipSlot): number {
  return a.index - b.index
}

/** First shown chip of each pile, by its root's index (reused). */
const hosts: (ChipSlot | undefined)[] = []
/** This run's speakers (at most MAX_SPEAKERS). */
const speakers: ChipSlot[] = []

/**
 * Screen-space buckets of CELL px, each chip in the one cell under the middle of its bottom edge.
 * `near` looks as far around a box as the widest and tallest chip of the run could reach into it,
 * so it returns every chip that box might touch (and some it doesn't: `overlaps` decides). Cells
 * past the edges are clamped together, so chips far off screen share a few cells rather than growing
 * the map. The cells and the result are reused.
 */
const CELL = 64
const SPAN = 1024
const cells = new Map<number, ChipSlot[]>()
const met: ChipSlot[] = []

const cellOf = (px: number) => Math.min(SPAN - 1, Math.max(0, Math.floor(px / CELL) + 64))

const grid = {
  /** The widest and tallest chip of the run, px. */
  maxW: 0,
  maxH: 0,
  clear(): void {
    for (const cell of cells.values()) cell.length = 0
  },
  add(slot: ChipSlot, lift: number): void {
    const key = cellOf(slot.y - lift) * SPAN + cellOf(slot.x)
    const cell = cells.get(key)
    if (cell) cell.push(slot)
    else cells.set(key, [slot])
  },
  /** Chips that could overlap `slot`'s columns (widened by `pad` px) anywhere between `top` and `bottom` (px, y down). */
  near(slot: ChipSlot, top: number, bottom: number, pad = 0): ChipSlot[] {
    met.length = 0
    const reach = (slot.w + grid.maxW) / 2 + GAP + pad
    const x0 = cellOf(slot.x - reach)
    const x1 = cellOf(slot.x + reach)
    // Another chip's bottom edge, to overlap: above `bottom` + GAP + its height, below `top` − GAP.
    const y0 = cellOf(top - GAP)
    const y1 = cellOf(bottom + GAP + grid.maxH)
    for (let cy = y0; cy <= y1; cy++)
      for (let cx = x0; cx <= x1; cx++) {
        const cell = cells.get(cy * SPAN + cx)
        if (!cell) continue
        for (const other of cell) if (other !== slot) met.push(other)
      }
    return met
  },
}

/** Do the two boxes, at these lifts, come within GAP (+ `pad`) px of each other? */
function overlaps(a: ChipSlot, liftA: number, b: ChipSlot, liftB: number, pad = 0): boolean {
  const ab = a.y - liftA
  const bb = b.y - liftB
  const gap = GAP + pad
  return Math.abs(a.x - b.x) * 2 < a.w + b.w + gap * 2 && ab - a.h < bb + gap && bb - b.h < ab + gap
}

function find(i: number): number {
  let at = i
  while ((order[at] as ChipSlot).parent !== at) at = (order[at] as ChipSlot).parent
  // Compress.
  let walk = i
  while ((order[walk] as ChipSlot).parent !== at) {
    const next = (order[walk] as ChipSlot).parent
    ;(order[walk] as ChipSlot).parent = at
    walk = next
  }
  return at
}

/** The lower index (higher priority) becomes the root. */
function union(i: number, j: number): void {
  const a = find(i)
  const b = find(j)
  if (a === b) return
  if (a < b) (order[b] as ChipSlot).parent = a
  else (order[a] as ChipSlot).parent = b
}

function vote(slot: ChipSlot, fold: boolean): void {
  if (fold === slot.folded) {
    slot.votes = 0
    return
  }
  slot.votes++
  const after = crowd ? (fold ? CROWD_FOLD_AFTER : CROWD_UNFOLD_AFTER) : fold ? FOLD_AFTER : UNFOLD_AFTER
  if (slot.votes >= after) {
    slot.folded = fold
    slot.votes = 0
  }
}

/**
 * Would `slot`'s bubble crowd one already speaking? Judged on a bubble's full box (BUBBLE_W ×
 * BUBBLE_H) at the chips' resting places, never on measured chips: whether a bubble shows changes
 * a chip's size, and that must not turn speech on and off from one run to the next.
 */
function crowded(slot: ChipSlot): boolean {
  for (const other of speakers) {
    if (other === slot) continue
    if (Math.abs(slot.x - other.x) < BUBBLE_W + GAP && Math.abs(slot.y - other.y) < BUBBLE_H + GAP)
      return true
  }
  return false
}

/** Test hook: forget every chip and the clock. */
export function resetChips(): void {
  for (const slot of slots) watch(slot, null)
  observer?.disconnect()
  observer = null
  owners.clear()
  cells.clear()
  slots.length = 0
  order.length = 0
  last = -Infinity
  hud = "minimal"
  crowd = false
}
