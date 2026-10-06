import { type Camera, Color, Vector3 } from "three"
import type { Moment } from "../guild/moments.ts"
import type { AdventurerView } from "../guild/store.ts"
import { type VerbGlyph, verbOf } from "../hud/format.ts"
import type { GlyphPath } from "../hud/glyphs.ts"
import { chipOf } from "./chips.ts"
import { SIGIL_BASE } from "./sigilSize.ts"

/**
 * Deed sigils (docs/research/roadmap.md S2): what each working adventurer is doing, as a small
 * medallion over their head, readable with the HUD hidden (the Generative Agents emoji, in the
 * HUD's ink and brass). When a deed finishes the sigil pops: green sparks for a success, a red-grey
 * puff for a failure.
 *
 * This file is the logic, with no GPU in it, so it can be tested: which sigil a view shows, the
 * fades and pops, and the instance data the two meshes in scene/Sigils.tsx draw. It allocates only
 * when an adventurer arrives; a frame writes into fixed typed arrays.
 */

export type SigilKind =
  | "read"
  | "edit"
  | "search"
  | "test"
  | "run"
  | "think"
  | "dispatch"
  | "consult"
  | "work"

/** Atlas order (cell index) and the shared glyph each kind is drawn with (hud/glyphs.ts). */
export const SIGIL_GLYPHS: readonly (readonly [SigilKind, GlyphPath])[] = [
  ["read", "read"],
  ["edit", "edit"],
  ["search", "search"],
  ["test", "test"],
  ["run", "run"],
  ["think", "thought"],
  ["dispatch", "star"],
  ["consult", "globe"],
  ["work", "work"],
]
const CELL = Object.fromEntries(SIGIL_GLYPHS.map(([kind], i) => [kind, i])) as Record<SigilKind, number>

/** Sigils drawn at once: the budget's 30 adventurers on screen, and a little over. */
export const MAX_SIGILS = 32
/** Bursts in flight at once; a new one takes the oldest slot. */
export const MAX_BURSTS = 12
/** Particles one burst may use. */
export const PER_BURST = 12
export const MAX_PARTICLES = MAX_BURSTS * PER_BURST

/** Seconds to fade a sigil in or out. Never a hard pop-in. */
const FADE_S = 0.3
/** Seconds each way when one glyph gives way to the next: a busy agent changes tools every second. */
const SWAP_S = 0.12
/** A pop: how long it holds the sigil up, scaled and flashing. */
export const POP_S = 0.6

/**
 * The chip's verb glyph (hud/format.ts verbOf) as a sigil: one mapping, so the name chip and the
 * medallion can never disagree. Glyphs that only mean a state (plea, rest, loot…) have no sigil.
 */
const BY_GLYPH: Partial<Record<VerbGlyph, SigilKind>> = {
  read: "read",
  edit: "edit",
  search: "search",
  test: "test",
  run: "run",
  summon: "dispatch",
  thought: "think",
  globe: "consult",
  work: "work",
}

/** The sigil for a tool call. `doing` lets a shell command read as testing (`bun test`) or running. */
export function kindOfTool(tool: string, doing = ""): SigilKind {
  return BY_GLYPH[verbOf({ phase: "working", tool, thinking: false, doing }).glyph] ?? "work"
}

/**
 * What sigil a view shows: only while at work on a deed or thinking. Nothing while resting, idle,
 * leaving, bringing loot, fallen, or walking with no deed; nothing while pleading either (the plea
 * has its own "!" over the head).
 */
export function sigilOf(
  view: Pick<AdventurerView, "phase" | "tool" | "thinking" | "doing">,
): SigilKind | null {
  if (view.phase !== "working") return null
  if (view.tool) return kindOfTool(view.tool, view.doing)
  return view.thinking ? "think" : null
}

/** Success and failure colours: the HUD's loot and fail tones, gold sparks and the rim from its brass-hi. */
const LOOT = new Color("#a6dd8f")
const GOLD = new Color("#f1d590")
const FAIL = new Color("#ff8b7b")
const ASH = new Color("#857a70")
const BRASS = new Color("#f1d590")

interface Entry {
  id: string
  /** What the views ask for now. */
  want: SigilKind | null
  /** The view's tool call and line, at the last sync: the deed a finishing moment is about. */
  tool: string
  doing: string
  /** What is drawn (fades out before it changes). */
  shown: SigilKind | null
  alpha: number
  /** Seconds into a pop, or -1. */
  pop: number
  ok: boolean
  /** Rim colour: brass tinted by the role's colour (linear). */
  rim: Color
  colour: string
  /** Their party's banner (linear), drawn as the medallion's outer ring when several parties share the island. */
  banner: Color
  bannerColour: string
  bannerOn: number
  /** Bob phase, so neighbours don't bob in step. */
  phase: number
  /** The chip's lift, eased like its CSS transition. */
  lift: number
  present: boolean
  depth: number
  /** Changing glyph (out, then in): the quick fade. */
  swapping: boolean
}

export interface SigilData {
  /** x, y, z of the medallion's footing (sigilSize.ts SIGIL_BASE); w: sideways shake px. */
  anchor: Float32Array
  /** cell, alpha, scale, lift px. */
  state: Float32Array
  /** rim r, g, b; bob phase. */
  rim: Float32Array
  /** flash r, g, b, amount. */
  flash: Float32Array
  /** banner r, g, b; 1 when several parties are on the island, else 0. */
  banner: Float32Array
}

export interface BurstData {
  /** x, y, z: its adventurer's medallion footing. */
  origin: Float32Array
  /** velocity x, y px/s; birth (s, render clock); life s. */
  motion: Float32Array
  /** r, g, b; kind (0 spark, 1 puff). */
  look: Float32Array
  /** lift px; size px; growth over life; drag. */
  shape: Float32Array
}

export class SigilBoard {
  /** Sigils to draw this frame (set by `write`). */
  count = 0
  readonly sigils: SigilData = {
    anchor: new Float32Array(MAX_SIGILS * 4),
    state: new Float32Array(MAX_SIGILS * 4),
    rim: new Float32Array(MAX_SIGILS * 4),
    flash: new Float32Array(MAX_SIGILS * 4),
    banner: new Float32Array(MAX_SIGILS * 4),
  }
  readonly bursts: BurstData = {
    origin: new Float32Array(MAX_PARTICLES * 3),
    motion: new Float32Array(MAX_PARTICLES * 4),
    look: new Float32Array(MAX_PARTICLES * 4),
    shape: new Float32Array(MAX_PARTICLES * 4),
  }
  /** Burst particles changed since the meshes last uploaded them. */
  burstsDirty = false
  /** Render clock (s) until which some burst is still in the air. */
  burstsUntil = -1
  /** Render clock, s: the same `uTime` the shaders read (atmosphere/wind.ts). */
  now = 0
  /** The viewer's Settings toggle. */
  on = true
  /** prefers-reduced-motion: no bob, no scale or shake, no particles; the rim flash alone. */
  still = false
  /** Sparks per burst: fewer on the Low tier. */
  sparks = 10
  /** How fast fades, pops and bursts play: 1, or slower for a probe to photograph a pop. */
  pace = 1

  private readonly list: Entry[] = []
  private readonly byId = new Map<string, Entry>()
  private readonly order: Entry[] = []
  private nextBurst = 0
  /** Who each burst slot belongs to, and until when (render clock): a burst follows its adventurer. */
  private readonly burstOf: string[] = new Array(MAX_BURSTS).fill("")
  private readonly burstEnd = new Float64Array(MAX_BURSTS)

  constructor(private readonly positions: ReadonlyMap<string, Vector3>) {}

  /** At the store's refresh (~10×/s): who is on stage and what each is doing. */
  sync(views: readonly AdventurerView[]): void {
    for (const entry of this.list) entry.present = false
    let multi = false
    for (let i = 1; i < views.length; i++)
      if ((views[i] as AdventurerView).party !== views[0]?.party) multi = true
    for (const view of views) {
      let entry = this.byId.get(view.id)
      if (!entry) {
        entry = {
          id: view.id,
          want: null,
          tool: "",
          doing: "",
          shown: null,
          alpha: 0,
          pop: -1,
          ok: true,
          rim: new Color(),
          colour: "",
          banner: new Color(),
          bannerColour: "",
          bannerOn: 0,
          phase: hash(view.id) * Math.PI * 2,
          lift: 0,
          present: true,
          depth: 0,
          swapping: false,
        }
        this.byId.set(view.id, entry)
        this.list.push(entry)
      }
      entry.present = true
      entry.want = sigilOf(view)
      entry.tool = view.tool ?? ""
      entry.doing = view.doing
      if (entry.colour !== view.color) {
        entry.colour = view.color
        entry.rim.set(view.color).lerp(BRASS, 0.35)
      }
      if (entry.bannerColour !== view.banner) {
        entry.bannerColour = view.banner
        entry.banner.set(view.banner)
      }
      entry.bannerOn = multi ? 1 : 0
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const entry = this.list[i] as Entry
      if (entry.present) continue
      this.list.splice(i, 1)
      this.byId.delete(entry.id)
    }
  }

  /** A live moment (store.moments.on: rebuilt moments never get here). A finished deed pops. */
  take(moment: Moment): void {
    if (!this.on || (moment.kind !== "deed" && moment.kind !== "deed-failed")) return
    const entry = this.byId.get(moment.id)
    if (!entry) return
    // The deed that just ended: the views have not caught up yet, so its line is still the last one
    // synced (a shell call reads as testing from its command).
    entry.shown = kindOfTool(moment.tool, moment.tool === entry.tool ? entry.doing : "")
    entry.pop = 0
    entry.ok = moment.kind === "deed"
    if (this.still) return
    const at = this.positions.get(moment.id)
    // Folded into a neighbour's "+N", the sigil is hidden and its chip's lift means nothing:
    // the burst rises from the head instead of from an empty spot up in the air.
    const folded = chipOf(moment.id)?.folded ?? false
    if (at) this.burst(moment.id, at, folded ? 0 : entry.lift, entry.ok)
  }

  /** History was thrown away (a seek, a loop, a load): nothing in flight survives it. */
  rebuild(): void {
    for (const entry of this.list) entry.pop = -1
    this.burstEnd.fill(0)
    this.bursts.motion.fill(0)
    this.burstsUntil = -1
    this.burstsDirty = true
  }

  /** Once a frame: fades, pops, and the chip's lift. */
  step(elapsed: number, now: number): void {
    const dt = elapsed * this.pace
    this.now = now
    for (const entry of this.list) {
      const chip = chipOf(entry.id)
      const popping = entry.pop >= 0
      const target = popping ? entry.shown : entry.want
      if (entry.shown !== null && target !== null && entry.shown !== target) entry.swapping = true
      if (!popping && entry.shown !== target && (entry.alpha < 0.02 || entry.shown === null)) {
        entry.shown = target
      }
      const show = this.on && target !== null && entry.shown === target && !chip?.folded
      const rate = dt / (popping ? 0.12 : entry.swapping ? SWAP_S : FADE_S)
      entry.alpha = show ? Math.min(1, entry.alpha + rate) : Math.max(0, entry.alpha - rate)
      if (entry.alpha >= 1 || entry.shown === null) entry.swapping = false
      if (popping) {
        entry.pop += dt
        if (entry.pop > POP_S) entry.pop = -1
      }
      // The chip keeps its room for as long as the sigil is drawn (a pop or a fade-out included),
      // so a failure that ends the session doesn't drop the plate onto its own puff.
      if (chip) chip.sigil = this.on && (show || popping || entry.alpha > 0)
      const lift = chip?.shownLift ?? 0
      // Real time, like the chip's own CSS transition (pace only slows the sigil's show).
      entry.lift += (lift - entry.lift) * Math.min(1, elapsed * 10)
    }
    this.follow()
  }

  /** Bursts in the air ride along with their adventurer, so the pop stays on the sigil as they walk. */
  private follow(): void {
    const { origin, shape } = this.bursts
    for (let b = 0; b < MAX_BURSTS; b++) {
      if ((this.burstEnd[b] ?? 0) < this.now) continue
      const id = this.burstOf[b] as string
      const at = this.positions.get(id)
      if (!at) continue
      const entry = this.byId.get(id)
      const lift = entry && !chipOf(id)?.folded ? entry.lift : 0
      for (let p = 0; p < PER_BURST; p++) {
        const i = b * PER_BURST + p
        origin[i * 3] = at.x
        origin[i * 3 + 1] = at.y + SIGIL_BASE
        origin[i * 3 + 2] = at.z
        shape[i * 4] = lift
      }
      this.burstsDirty = true
    }
  }

  /** The sigils to draw, farthest first so nearer ones overlap them. Returns how many. */
  write(camera: Camera): number {
    camera.getWorldDirection(forward)
    const order = this.order
    order.length = 0
    for (const entry of this.list) {
      const at = this.positions.get(entry.id)
      if (!at || entry.alpha <= 0.003 || entry.shown === null) continue
      entry.depth =
        (at.x - camera.position.x) * forward.x +
        (at.y - camera.position.y) * forward.y +
        (at.z - camera.position.z) * forward.z
      // Insertion sort, farthest first: a few dozen at most, no garbage.
      let i = order.length
      order.push(entry)
      while (i > 0 && (order[i - 1] as Entry).depth < entry.depth) {
        order[i] = order[i - 1] as Entry
        i--
      }
      order[i] = entry
      // Over the cap, the farthest one goes.
      if (order.length > MAX_SIGILS) order.shift()
    }
    const { anchor, state, rim, flash, banner } = this.sigils
    for (let k = 0; k < order.length; k++) {
      const entry = order[k] as Entry
      const at = this.positions.get(entry.id) as Vector3
      const o = k * 4
      const t = entry.pop
      const popping = t >= 0
      // Success: a quick swell. Failure: a small flinch and a shudder.
      let scale = 1
      let shake = 0
      if (popping && !this.still) {
        if (entry.ok) scale = 1 + 0.38 * Math.sin(Math.PI * Math.min(1, t / 0.42))
        else {
          scale = 1 - 0.1 * Math.sin(Math.PI * Math.min(1, t / 0.3))
          shake = 3 * Math.exp(-7 * t) * Math.sin(t * 46)
        }
      }
      anchor[o] = at.x
      anchor[o + 1] = at.y + SIGIL_BASE
      anchor[o + 2] = at.z
      anchor[o + 3] = shake
      state[o] = CELL[entry.shown as SigilKind]
      state[o + 1] = entry.alpha
      state[o + 2] = scale
      state[o + 3] = entry.lift
      rim[o] = entry.rim.r
      rim[o + 1] = entry.rim.g
      rim[o + 2] = entry.rim.b
      rim[o + 3] = entry.phase
      const tone = entry.ok ? LOOT : FAIL
      flash[o] = tone.r
      flash[o + 1] = tone.g
      flash[o + 2] = tone.b
      flash[o + 3] = popping ? (1 - t / POP_S) ** 1.5 : 0
      banner[o] = entry.banner.r
      banner[o + 1] = entry.banner.g
      banner[o + 2] = entry.banner.b
      banner[o + 3] = entry.bannerOn
    }
    this.count = order.length
    return order.length
  }

  /** Burst particles still in the air now (for tests and the mesh's visibility). */
  liveParticles(): number {
    const m = this.bursts.motion
    let n = 0
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const birth = m[i * 4 + 2] ?? 0
      const life = m[i * 4 + 3] ?? 0
      if (life > 0 && (this.now - birth) * this.pace < life) n++
    }
    return n
  }

  /** Writes one burst into the next slot (the oldest is overwritten when all are in use). */
  private burst(id: string, at: Vector3, lift: number, ok: boolean): void {
    const slot = this.nextBurst
    this.nextBurst = (slot + 1) % MAX_BURSTS
    this.burstOf[slot] = id
    this.burstEnd[slot] = this.now + 1.4 / this.pace
    const { origin, motion, look, shape } = this.bursts
    const n = ok ? this.sparks : Math.max(4, Math.round(this.sparks * 0.8))
    for (let p = 0; p < PER_BURST; p++) {
      const i = slot * PER_BURST + p
      const m = i * 4
      if (p >= n) {
        motion[m + 3] = 0
        continue
      }
      origin[i * 3] = at.x
      origin[i * 3 + 1] = at.y + SIGIL_BASE
      origin[i * 3 + 2] = at.z
      const r = Math.random()
      if (ok) {
        // Sparks: a fan rising out of the medallion, green and gold.
        // Wide and flat, so most of the fan clears the name chip right above the medallion.
        const angle = Math.PI / 2 + ((p + 0.5) / n - 0.5) * 3.4 + (r - 0.5) * 0.25
        const speed = 60 + Math.random() * 40
        motion[m] = Math.cos(angle) * speed
        motion[m + 1] = Math.sin(angle) * speed * 0.55 + 8
        motion[m + 3] = 0.75 + Math.random() * 0.3
        const c = p % 2 === 0 ? LOOT : GOLD
        look[m] = c.r
        look[m + 1] = c.g
        look[m + 2] = c.b
        look[m + 3] = 0
        shape[m + 1] = 8 + Math.random() * 4
        shape[m + 2] = -0.5
        shape[m + 3] = 2.4
      } else {
        // A puff: soft red-grey smoke rolling outwards and drifting up.
        const angle = (p / n) * Math.PI * 2 + r * 0.6
        const speed = 16 + Math.random() * 16
        motion[m] = Math.cos(angle) * speed
        motion[m + 1] = Math.sin(angle) * speed * 0.7 + 14
        motion[m + 3] = 0.9 + Math.random() * 0.35
        const c = p % 3 === 0 ? FAIL : ASH
        look[m] = c.r
        look[m + 1] = c.g
        look[m + 2] = c.b
        look[m + 3] = 1
        shape[m + 1] = 10 + Math.random() * 4
        shape[m + 2] = 0.9
        shape[m + 3] = 2.8
      }
      motion[m + 2] = this.now
      shape[m] = lift
    }
    this.burstsUntil = Math.max(this.burstsUntil, this.now + 1.4 / this.pace)
    this.burstsDirty = true
  }
}

const forward = new Vector3()

/** 0–1 from a string, stable: a sigil's bob phase. */
function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return (h >>> 0) / 4294967296
}
