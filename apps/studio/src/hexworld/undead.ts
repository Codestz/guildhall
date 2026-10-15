/**
 * The graveyard's undead on an island (render undead/, world events Task B). A hall's session drives
 * them: each frame the world events' graves on stage (hall/events.ts, sim worldEvents.ts) at the
 * session's clock, each struck when its fixer's itinerary says the blow lands (sim `asStruck`), so a
 * seek or a scrub shows the graveyard as it was then. Nothing loads until a grave first stands. For a
 * look, without a session, `?undead=` plays a scene on its own clock from when the island is ready:
 *
 *   ?undead=rise      a warrior lies in its grave, stirs and claws up (2.8 s), then keeps vigil
 *   ?undead=vigil     two keep vigil (a mage and a rogue), taunting now and then
 *   ?undead=sink      one keeps vigil, reels at a blow at 2 s, dies and sinks (2.6 s)
 *   ?undead=minion    a failed deed's minion claws up, stands 5 s and crumbles
 *   ?undead=all       every kind on its own grave, risen
 *
 * `window.guildhall.ext.undead`: `play(scene)`, `hold(ms | null)` (the scene held that far in),
 * `at()` (the scene's time), `graves()` (where they stand), `figures()` (what is drawn), `ready()`,
 * `stats()`.
 */
import {
  type CrowdLibrary,
  createUndead,
  type Stage,
  type Undead,
  type UndeadFigure,
  type WorkFx,
} from "@guildhall/render"
import { asStruck, gravesOf, type Itinerary, type Show, undeadKind } from "@guildhall/sim"
import type { HexGraveyard, PlacedPiece } from "@guildhall/world"
import type { HallEvents, ViewBlocker } from "../hall/events.ts"
import type { HallSession } from "../hall/feeds/session.ts"

export const UNDEAD_SCENES = ["rise", "vigil", "sink", "minion", "all"] as const
export type UndeadScene = (typeof UNDEAD_SCENES)[number]

/** `?undead=`: the scene to play, or null. */
export function undeadOf(query: Pick<URLSearchParams, "get">): UndeadScene | null {
  const v = query.get("undead")
  return (UNDEAD_SCENES as readonly string[]).includes(v ?? "") ? (v as UndeadScene) : null
}

const RISE = 2800
const SINK = 2600

/** A scene's figures, on its own clock (ms from when it starts). */
export function sceneFigures(scene: UndeadScene): UndeadFigure[] {
  const risen = (id: string, slot: number, kind: UndeadFigure["kind"]): UndeadFigure => ({
    id,
    slot,
    kind,
    rise: -20_000,
    vigil: -20_000 + RISE,
  })
  switch (scene) {
    case "rise":
      return [{ id: "rise", slot: 0, kind: "warrior", rise: 300, vigil: 300 + RISE }]
    case "vigil":
      return [risen("vigil-a", 0, "mage"), risen("vigil-b", 2, "rogue")]
    case "sink":
      return [{ ...risen("sink", 0, "warrior"), strike: 2000, sink: 2600 }]
    case "minion":
      return [{ id: "minion", slot: 7, kind: "minion", rise: 300, vigil: 300 + RISE, sink: 300 + 5000 }]
    case "all":
      return [
        risen("w", 0, "warrior"),
        risen("m", 1, "mage"),
        risen("r", 2, "rogue"),
        risen("n", 3, "minion"),
      ]
  }
}

/**
 * A session's graves at run time `t` as the undead draw them: the world events' undead shows, each
 * struck when its fixer's itinerary has the blow (none known: the events' own times).
 */
export function sessionFigures(
  shows: readonly Show[],
  itinerary: (id: string) => Itinerary | undefined,
): UndeadFigure[] {
  return gravesOf(shows).map(({ show, grave }) => {
    const struck = grave.fixer ? asStruck(grave, itinerary(grave.fixer.id)?.acts) : grave
    return {
      id: show.id,
      slot: grave.slot,
      kind: undeadKind(grave, show.params.who),
      rise: grave.rise,
      vigil: grave.vigil,
      ...(struck.strike !== undefined ? { strike: struck.strike } : {}),
      ...(struck.sink !== undefined ? { sink: struck.sink } : {}),
    }
  })
}

/** How far round the graves the camera's view is checked for what stands in it, metres (a rise is filmed from 12 m). */
export const BLOCK_REACH = 18
/** Pieces a camera sees through (open, or bare): never in the way. */
const SEE_THROUGH = /fence|dead|lantern|candle|bone|skull|ribcage/
/** An arch or a gateway: open in the middle, solid at its posts (this share of its width in from each end). */
const ARCH = /arch|gate/
const POST = 0.1
/** Pieces lower than this never hide a skeleton from a camera above (fences, headstones, bushes), metres. */
const BLOCK_LOW = 1.6

/**
 * What stands round the graveyard that a camera filming a grave must not look through (hall/camera.ts
 * `clearAzimuth`): every solid piece within `BLOCK_REACH` of the graves taller than a fence, as an upright
 * cylinder; a tree as its crown (its trunk is thin), anything else from the ground up. `size` is a
 * piece's [w, h, d] at scale 1 (the catalog's), undefined for one it does not know. Pure.
 */
export function graveBlockers(
  graves: readonly { x: number; z: number }[],
  pieces: readonly PlacedPiece[],
  size: (id: string) => readonly [number, number, number] | undefined,
): ViewBlocker[] {
  if (!graves.length) return []
  const cx = graves.reduce((n, g) => n + g.x, 0) / graves.length
  const cz = graves.reduce((n, g) => n + g.z, 0) / graves.length
  const out: ViewBlocker[] = []
  for (const p of pieces) {
    if (Math.hypot(p.x - cx, p.z - cz) > BLOCK_REACH) continue
    // open or bare things a camera sees through: the fence, the gate's arch, the yard's dead trees, lamps
    if (SEE_THROUGH.test(p.piece)) continue
    const s = size(p.piece)
    if (!s) continue
    const h = s[1] * p.scale
    if (h < BLOCK_LOW) continue
    if (ARCH.test(p.piece)) {
      // its two posts, at either end of its width (the piece's own x, turned as it is placed)
      const half = (s[0] * p.scale) / 2
      const r = Math.max(0.25, s[0] * p.scale * POST)
      for (const side of [-1, 1]) {
        const lx = side * (half - r)
        out.push({
          x: p.x + lx * Math.cos(p.rot),
          z: p.z - lx * Math.sin(p.rot),
          r,
          bottom: p.y,
          top: p.y + h,
          what: p.piece,
        })
      }
      continue
    }
    const tree = /tree|pine|birch|oak/.test(p.piece)
    out.push({
      x: p.x,
      z: p.z,
      r: Math.max(s[0], s[2]) * p.scale * 0.5 * (tree ? 0.85 : 1),
      bottom: p.y + (tree ? h * 0.3 : 0),
      top: p.y + h,
      what: p.piece,
    })
  }
  return out
}

export interface UndeadMount {
  undead: Undead
  dispose(): void
}

export function mountUndead(parts: {
  stage: Stage
  graveyard: HexGraveyard | null
  library: CrowdLibrary
  workfx: WorkFx | null
  query: Pick<URLSearchParams, "get">
  /** The heroes' itineraries (life's), for the fixer's blow. */
  itinerary: (id: string) => Itinerary | undefined
  /** A hall (or a session) may play on the island: its world events drive the graves. */
  hall: boolean
  /** The session playing on the island, when it is not the hall HUD's own (the site's home). */
  session?: () => HallSession | null
  /** What stands round the graveyard (`graveBlockers`): the camera films a rise from where none hides it. */
  blockers?: readonly ViewBlocker[]
}): UndeadMount | null {
  const { stage, graveyard } = parts
  if (!graveyard) return null
  const graves = graveyard.graves.map((g) => ({ x: g.x, y: g.y, z: g.z, facing: g.facing }))
  const undead = createUndead(stage, { graves, library: parts.library, workfx: parts.workfx })
  let scene = undeadOf(parts.query)
  let sceneStart = performance.now()
  let held: number | null = null
  let events: (() => HallEvents | null) | null = null
  let sessionOf: (() => HallSession | null) | null = parts.session ?? null
  let lastFigures: UndeadFigure[] = []
  let site: HallEvents | null = null
  // a hall's events and session (loaded only where one may play)
  if (parts.hall)
    void Promise.all([import("../hall/events.ts"), import("../hall/hud/mount.tsx")]).then(([e, m]) => {
      events = e.hallEvents
      sessionOf ??= m.hallSession
    })
  if (scene)
    void (window.guildhall?.ready() ?? Promise.resolve()).then(() => (sceneStart = performance.now()))
  const sceneAt = () => held ?? performance.now() - sceneStart
  const off = stage.onFrame((dt) => {
    let figures: UndeadFigure[] = []
    let t = 0
    const hall = events?.() ?? null
    const session = sessionOf?.() ?? null
    if (scene) {
      figures = sceneFigures(scene)
      t = sceneAt()
    } else if (hall && session) {
      t = session.clock.get().at
      figures = sessionFigures(hall.shows(t), parts.itinerary)
    }
    // the camera films a rise where its grave is
    if (hall && hall !== site) {
      site = hall
      hall.setSite("undead", (show) => {
        const slot = show.params.grave?.slot
        return slot === undefined ? null : undead.point(slot)
      })
      const blockers = parts.blockers ?? []
      hall.setBlockers("undead", blockers.length ? () => blockers : null)
    }
    lastFigures = figures
    undead.update(figures, t, dt)
  })
  const ext = window.guildhall?.ext
  if (ext)
    ext.undead = {
      play: (s: UndeadScene) => {
        scene = s
        held = null
        sceneStart = performance.now()
      },
      hold: (ms: number | null) => {
        held = ms
      },
      at: () => sceneAt(),
      graves: () => graveyard.graves,
      blockers: () => parts.blockers ?? [],
      gate: () => graveyard.gate,
      figures: () => lastFigures,
      ready: () => undead.ready(),
      stats: () => undead.stats(),
    }
  return {
    undead,
    dispose() {
      off()
      site?.setSite("undead", null)
      site?.setBlockers("undead", null)
      undead.dispose()
      if (ext) delete ext.undead
    },
  }
}
