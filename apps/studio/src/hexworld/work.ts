/**
 * The townsfolk's work, drawn (game feel, task B): what life.ts adds to each townsfolk at a routine
 * (world routines.ts) besides the clip it plays.
 *
 *   props    every piece someone's day may show is mounted on them once (the union: the rod, the fish,
 *            the basket carried to market); a mask a frame says which show (`propMask`): the sample's
 *            props, the look's own off the hands, one piece to a slot (the part's own wins)
 *   carry    a log, a basket, a sack, a chest is carried in both arms on a carry walk: the carrying walk
 *            (render character/carry.ts) and the load on the chest (`<piece>#carry`, render props/carry.ts)
 *   turns    a part's turn (to the basket, the cart) eased over ~150 ms instead of snapped
 *   rod      a line from the rod's tip to a float that rides, dips on a bite and comes in with the catch
 *   stocks   baskets, piles, heaps, carts on their rails, crates, bars, arrows: one batch (render stocks)
 *   beats    the sample's beat, once per cycle, to the work FX near the camera (and, later, a sound)
 *
 * Pure parts are exported for tests; `createWork` is the drawing side life.ts drives.
 */
import type { Catalog, CatalogEntry, Mount, MountSlot, NpcLook } from "@guildhall/assets"
import {
  BUILT,
  BUILT_SIZE,
  builtId,
  builtPath,
  type Crowd,
  carryMount,
  createStocks,
  floatAt,
  floatPoint,
  type Stage,
  type Stocks,
  type WorkFx,
} from "@guildhall/render"
import {
  type Folk,
  type LifePose,
  type LifeSample,
  PROPS,
  ROUTINES,
  type Stock,
  spotFrame,
  stockAt,
} from "@guildhall/world"

// ---- pieces ----

/** Pieces drawn as another (a routine's basket is the wicker basket built in code). */
export const DRAWN_AS: Readonly<Record<string, string>> = { [PROPS.basket]: builtId("basket") }
export const drawnAs = (piece: string): string => DRAWN_AS[piece] ?? piece

/** Loads carried in both arms on the chest (a carry walk); anything else carried is held in a hand. */
export const CARRIED: ReadonlySet<string> = new Set([
  PROPS.log,
  builtId("basket"),
  "kaykit-hexagon/sack",
  "kaykit-dungeon/chest",
])

/** The catalog id of a load's chest mount (a second entry of the same piece). */
export const carryId = (piece: string): string => `${piece}#carry`

/** The rod's tip in the staff's own space (kaykit-weapons/staff-a: centred, 2.15 m long). */
export const ROD_TIP: readonly [number, number, number] = [0, 1.05, 0]

/**
 * The entries the catalog gets for task B: the pieces built in code (render props/built.ts) and a chest
 * mount for every load carried in both arms, each a copy of a template entry with its own id, size,
 * file and mount. `template` is any static library entry (its other fields are not read for these).
 */
export function workEntries(catalog: Pick<Catalog, "get">, template: CatalogEntry): CatalogEntry[] {
  const out: CatalogEntry[] = []
  const entry = (id: string, size: readonly [number, number, number], glb: string, mount?: Mount) => {
    const { mount: _, ...compose } = template.compose
    out.push({
      ...template,
      id,
      pack: "built",
      source: id,
      name: id,
      category: "prop",
      size: [size[0], size[1], size[2]],
      files: { glb, thumb: null },
      compose: mount ? { ...compose, mount } : compose,
    })
  }
  for (const name of BUILT) {
    // the basket, held by a grip in one hand (a stall's delivery is put down from it)
    const mount: Mount | undefined =
      name === "basket"
        ? {
            slot: "hand.r",
            hands: 1,
            handle: [0, 0.3, 0],
            axis: [0, -1, 0],
            edge: [1, 0, 0],
            scale: 0.8,
            upright: { up: [0, 1, 0] },
            clips: { Waving: { hide: true } },
          }
        : undefined
    entry(builtId(name), BUILT_SIZE[name], builtPath(name), mount)
  }
  for (const piece of CARRIED) {
    const base = catalog.get(piece)
    const size = base?.size ?? (piece.startsWith("built/") ? BUILT_SIZE[piece.slice(6) as "basket"] : null)
    if (!size) continue
    entry(carryId(piece), size, base?.files.glb ?? `${piece}.glb`, carryMount(size))
  }
  return out
}

// ---- who shows what ----

/** What a townsfolk's day may put in their hands or arms: (piece, carried on the chest). */
export function dayPieces(f: Pick<Folk, "day" | "prop">): { piece: string; carried: boolean }[] {
  const out = new Map<string, boolean>()
  const add = (piece: string | undefined, carried = false) => {
    if (!piece) return
    const p = drawnAs(piece)
    const chest = carried && CARRIED.has(p)
    out.set(chest ? carryId(p) : p, chest)
  }
  add(f.prop)
  for (const s of f.day) {
    if (s.kind === "walk") {
      add(s.carry, true)
      continue
    }
    const r = s.routine ? ROUTINES[s.routine.id] : undefined
    if (!r) continue
    for (const p of r.props) add(p)
    for (const part of r.parts) {
      for (const p of part.props ?? []) add(p)
      add(part.carry)
    }
  }
  return [...out].map(([piece, carried]) => ({ piece, carried }))
}

/** A townsfolk's look with every piece of their day mounted, and how to say which show. */
export interface WorkLook {
  look: NpcLook
  /** The look's own mounts (what it showed before task B: the recipe's and the spot's prop). */
  base: number
  /** Mount index by piece (a carried load by its `#carry` id). */
  index: ReadonlyMap<string, number>
  /** Each mount's slot. */
  slots: readonly MountSlot[]
}

/** `look` (the recipe's, holding the spot's prop) with the day's pieces added after its own mounts. */
export function workLook(
  look: NpcLook,
  f: Pick<Folk, "day" | "prop">,
  mountOf: (piece: string) => Mount | undefined,
): WorkLook {
  const mounts = [...look.mounts]
  const base = mounts.length
  const have = new Set(mounts.map((m) => m.piece))
  for (const { piece } of dayPieces(f)) {
    if (have.has(piece)) continue
    const mount = mountOf(piece)
    if (!mount) continue
    have.add(piece)
    mounts.push({ piece, slot: mount.slot })
  }
  // at most 31 mounts in a mask
  const kept = mounts.slice(0, 31)
  return {
    look: { ...look, mounts: kept },
    base: base >= 31 ? 0x7fffffff : (1 << Math.min(base, kept.length)) - 1,
    index: new Map(kept.map((m, k) => [m.piece, k])),
    slots: kept.map((m) => m.slot),
  }
}

const HANDS: ReadonlySet<MountSlot> = new Set(["hand.r", "hand.l"])

/**
 * Which mounts show (bit k: mount k) when `shown` pieces are wanted, in order (the last wins its slot):
 * those, and the look's own (`base`) where nothing wanted takes their slot, except in the hands when
 * `handsBusy` (at work, the routine says what is held). Pieces not mounted are skipped.
 */
export function propMask(
  w: Pick<WorkLook, "base" | "index" | "slots">,
  shown: readonly string[],
  handsBusy: boolean,
): number {
  let mask = 0
  const taken = new Map<MountSlot, number>()
  for (const piece of shown) {
    const k = w.index.get(drawnAs(piece))
    if (k === undefined) continue
    const slot = w.slots[k]!
    const was = taken.get(slot)
    if (was !== undefined) mask &= ~(1 << was)
    taken.set(slot, k)
    mask |= 1 << k
  }
  for (let k = 0; k < w.slots.length; k++) {
    if (!((w.base >>> k) & 1)) continue
    const slot = w.slots[k]!
    if (taken.has(slot) || (handsBusy && HANDS.has(slot))) continue
    mask |= 1 << k
  }
  return mask
}

/** The angle `cur` eased toward `target` by `dt` seconds (the shorter way round), ~`tau` s to settle. */
export function easeAngle(cur: number, target: number, dt: number, tau = 0.05): number {
  let d = (target - cur) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  // a seek (or a first frame) snaps
  if (Number.isNaN(cur) || dt <= 0 || dt > 0.5) return target
  return cur + d * (1 - Math.exp(-dt / tau))
}

/** Metres from the camera within which beats make particles (the FX thin out past this anyway). */
export const BEAT_M = 35
/** Fishers whose floats and lines are drawn: within this many metres of the camera. */
export const LINE_M = 45

/** Heights (metres over the feet) and reach ahead a beat's burst is at, when it has no stock to land in. */
const BEAT_POINT: Readonly<Record<string, readonly [number, number]>> = {
  hit: [0.62, 0.55],
  saw: [0.6, 0.6],
  dig: [0.55, 0.05],
  pickup: [0.45, 0.05],
  drop: [0.45, 0.1],
  quench: [0.6, 0.75],
  serve: [0.55, 1.0],
  coin: [0.35, 1.15],
  pour: [0.45, 1.0],
  page: [0.45, 1.1],
  look: [0, 0],
}

/** A work beat's burst point in a worker's frame (x right, z ahead, y up), turned with them. */
export function beatPoint(beat: string, routine: string | undefined): readonly [number, number, number] {
  // a smith's anvil stands higher than a log or a rock face
  if (beat === "hit" && routine === "smith") return [0, 0.85, 0.55]
  if (beat === "hit" && routine === "chop") return [0, 0.35, 0.65]
  const p = BEAT_POINT[beat] ?? [0.5, 0.6]
  return [0, p[1], p[0]]
}

/** Beats that land in the routine's stock (a fish in the basket, ore in the cart, a crop in the crate). */
const INTO_STOCK = new Set(["drop", "throw"])

// ---- the drawing side ----

type V3 = readonly [number, number, number]

/** A fisher who may be drawn with a line: their crowd id and the rod's mount index on them. */
export interface Fisher {
  id: number
  rod: number
}

export interface WorkOpts {
  stage: Stage
  crowd: Crowd
  catalog: Catalog
  url: (path: string) => string
  stocks: readonly Stock[]
  /** The ground or a deck under a point. */
  ground: (x: number, z: number) => number
  /** The sea's level (a float's waterline). */
  sea: number
  /** The work FX (null: no particles). */
  workfx?: WorkFx | null
  /** Screen seconds to a day hour. */
  secPerHour: number
  fishers: readonly Fisher[]
}

/** What a townsfolk at work did this frame (life's sample of them). */
interface Doing {
  p: LifePose
  s: LifeSample
  /** Their feet as drawn, and the way they face (the spot's facing and the part's turn). */
  at: V3
  heading: number
}

export interface WorkStats {
  stocks: number
  shown: number
  relayouts: number
  rolls: number
  lines: number
  beats: number
  /** Mean CPU ms a frame (floats, lines, beats, stocks). */
  ms: number
}

export interface Work {
  /** A townsfolk at a routine this frame (not hidden), as drawn: what `frame` reads. */
  note(id: number, p: LifePose, s: LifeSample, at: V3, heading: number): void
  /** Every frame, after the crowd's update: floats and lines, beats, the stocks at `hour`. */
  frame(hour: number, dt: number, seek: boolean): void
  stats(): WorkStats
  dispose(): void
}

/** Seconds between the stocks' levels being read (a cart is read every frame: it may be rolling). */
const STOCK_EVERY = 0.5
/** Where a cast lands and where a line comes in to, metres ahead of a fisher's spot. */
export const CAST_M = 3.4
export const QUAY_M = 0.95

export async function createWork(o: WorkOpts): Promise<Work> {
  const fishers = o.fishers.slice(0, 32)
  const stocks: Stocks = await createStocks(o.stage, o.stocks, {
    catalog: o.catalog,
    url: o.url,
    ground: o.ground,
    floats: fishers.length,
    lines: fishers.length,
  })
  const carts = o.stocks.flatMap((s, k) => (s.kind === "ore-cart" ? [k] : []))
  const doing = new Map<number, Doing>()
  /** Each townsfolk's last beat sent (its cycle and name): one beat, one burst. */
  const sent = new Map<number, string>()
  const tip = [0, 0, 0]
  const float = [0, 0, 0]
  const near: [number, number, number] = [0, 0, 0]
  const far: [number, number, number] = [0, 0, 0]
  let since = Number.POSITIVE_INFINITY
  let beats = 0
  let ms = 0
  let secs = 0
  const eye = o.stage.camera.position

  /** A fisher's float and line, when near and the rod is drawn; false: none this frame. */
  const fishing = (f: Fisher, k: number): boolean => {
    const w = doing.get(f.id)
    if (!w || w.p.routine?.id !== "fish") return false
    const state = floatAt(w.s.clip, w.s.phase, secs + f.id)
    if (!state.shown || Math.hypot(eye.x - w.at[0], eye.z - w.at[2]) > LINE_M) return false
    if (!o.crowd.propPoint(f.id, f.rod, ROD_TIP, tip)) return false
    const [nx, nz] = spotFrame(w.p.at[0], w.p.at[2], w.p.facing, 0, QUAY_M)
    const [fx, fz] = spotFrame(w.p.at[0], w.p.at[2], w.p.facing, 0, CAST_M)
    near[0] = nx
    near[1] = o.sea
    near[2] = nz
    far[0] = fx
    far[1] = o.sea
    far[2] = fz
    const t = tip as unknown as V3
    floatPoint(state, t, near, far, float)
    stocks.float(k, float as unknown as V3, w.p.facing)
    stocks.line(t, float as unknown as V3, state.sag)
    return true
  }

  /** Where a beat's burst goes: the water for a fisher, the stock a load lands in, else ahead of the hands. */
  const burstAt = (w: Doing, b: string): [number, number, number] => {
    const p = w.p
    if (p.routine?.id === "fish" && (b === "cast" || b === "catch" || b === "bite")) {
      const [x, z] = spotFrame(p.at[0], p.at[2], p.facing, 0, b === "catch" ? QUAY_M + 0.2 : CAST_M)
      return [x, o.sea, z]
    }
    const spec = p.routine ? ROUTINES[p.routine.id]?.stock : undefined
    if (spec && INTO_STOCK.has(b)) {
      const [x, z] = spotFrame(p.at[0], p.at[2], p.facing, spec.at[0], spec.at[1])
      return [x, o.ground(x, z) + 0.45, z]
    }
    const [x, y, z] = beatPoint(b, p.routine?.id)
    const [wx, wz] = spotFrame(w.at[0], w.at[2], w.heading, x, z)
    return [wx, w.at[1] + y, wz]
  }

  return {
    note(id, p, s, at, heading) {
      doing.set(id, { p, s, at, heading })
    },
    frame(hour, dt, seek) {
      const t0 = performance.now()
      secs += dt
      stocks.beginLines()
      for (const [k, f] of fishers.entries()) if (!fishing(f, k)) stocks.float(k, null)
      stocks.endLines()
      // beats → bursts, once per cycle and beat, near the camera (workfx culls off-screen ones)
      const fx = o.workfx
      for (const [id, w] of doing) {
        const b = w.s.beat
        if (!b) continue
        const key = `${w.s.cycle}:${b}`
        if (sent.get(id) === key) continue
        sent.set(id, key)
        if (seek || !fx) continue
        if (Math.hypot(eye.x - w.at[0], eye.y - w.at[1], eye.z - w.at[2]) > BEAT_M) continue
        // the rod is a staff: named a rod, a cast rings the water rather than sparkling (workfx kinds.ts)
        const props = w.s.props.map((pp) => (pp === PROPS.rod ? "rod" : pp))
        fx.beat(b, burstAt(w, b), { clip: w.s.clip, props }, { yaw: w.heading, seed: w.s.cycle * 31 + id })
        // TODO(sound): audio/ has spot sounds for world events only, no per-beat entry yet; call it here
        beats++
      }
      // the stocks: their levels every STOCK_EVERY s (and on a seek), the carts every frame
      since += dt
      if (seek || since >= STOCK_EVERY) {
        since = 0
        for (const [k, s] of o.stocks.entries()) stocks.set(k, stockAt(s, hour, o.secPerHour))
      } else for (const k of carts) stocks.set(k, stockAt(o.stocks[k]!, hour, o.secPerHour))
      doing.clear()
      ms += (performance.now() - t0 - ms) * 0.05
    },
    stats: () => ({ ...stocks.stats(), beats, ms }),
    dispose: () => stocks.dispose(),
  }
}
