/**
 * The home page's vignette: a small island of library pieces (three houses, trees, a cobbled square)
 * with two KayKit adventurers holding props whose grips were authored in the grip editor, under the
 * golden-hour sky, turning slowly. It costs nothing while it cannot be seen: off screen or in a
 * hidden tab it stops updating and draws an empty scene. Reduced motion stops the turn.
 */
import type { Catalog, Mount } from "@guildhall/assets"
import type { CameraPose } from "@guildhall/core"
import {
  attachMount,
  type Character,
  createGround,
  createSky,
  createStage,
  createSun,
  type Ground,
  loadCharacter,
  loadPiece,
  measure,
  type Sky,
  type Stage,
  type Sun,
  type World,
} from "@guildhall/render"
import type { Vec2 } from "@guildhall/world"
import { libraryUrl } from "../catalog.ts"

/** The island's radius (m): an octagon whose bank skirt reads as the diorama's plinth. */
export const ISLAND_R = 12
/** Degrees the camera turns per second (a full turn in two minutes). */
export const TURN_DEG_S = 3
export const RIG = "rig-medium"

type Piece = Awaited<ReturnType<typeof loadPiece>>

interface Stand {
  id: string
  /** x, z in metres. */
  at: Vec2
  /** Yaw, radians. */
  rot: number
}

interface Figure {
  body: string
  prop: string
  clip: string
  at: Vec2
  rot: number
}

/** Houses round a little square, opening onto the camera's side; trees closing the back. */
export const HOUSES: readonly Stand[] = [
  { id: "quaternius-rts/houses-second-age-1-level1", at: [-5.4, -4.6], rot: 0.55 },
  { id: "quaternius-rts/houses-second-age-3-level1", at: [4.9, -4.9], rot: -0.45 },
]

export const TREES: readonly Stand[] = [
  { id: "kenney-town/tree-high", at: [-0.4, -9.4], rot: 0 },
  { id: "kenney-town/tree-high-round", at: [-9.2, 1.8], rot: 0.4 },
  { id: "kenney-town/tree-high-crooked", at: [9.4, -0.6], rot: 2 },
  { id: "quaternius-nature/bush-1", at: [-6.2, 6.4], rot: 0.3 },
  { id: "quaternius-nature/bush-2", at: [6.4, 6.2], rot: 0.7 },
  { id: "quaternius-nature/bush-berries-2", at: [-8.6, -4.6], rot: 1.2 },
]

export const FIGURES: readonly Figure[] = [
  {
    body: "kaykit-adventurers/knight",
    prop: "kaykit-weapons/sword-a",
    clip: "Idle_B",
    at: [-0.9, 1.5],
    rot: 0.35,
  },
  {
    body: "kaykit-adventurers/mage",
    prop: "kaykit-tools/lantern",
    clip: "Idle_A",
    at: [1.3, 2.3],
    rot: -0.4,
  },
]

/** The view: a three-quarter look at the figures, the houses behind them, the whole island in frame. */
export const POSE: CameraPose = { target: [0.2, 1.4, 0.6], azimuth: 18, elevation: 19, distance: 27 }

/** What the view is held inside: the plinth, no water, a wide zoom so the low three-quarter view stands. */
export const DIORAMA_WORLD: World = {
  centre: [0, 0],
  half: ISLAND_R,
  water: null,
  maxReach: 2.5,
  free: false,
}

const octagon = (r: number): Vec2[] =>
  Array.from({ length: 8 }, (_, i) => {
    const a = ((i + 0.5) / 8) * Math.PI * 2
    return [Math.cos(a) * r, Math.sin(a) * r]
  })

const disc = (cx: number, cz: number, r: number, n = 18): Vec2[] =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2
    return [cx + Math.cos(a) * r, cz + Math.sin(a) * r * 0.85]
  })

/** A strip `w` wide along x = `x`, from z0 to z1. */
const lane = (x: number, z0: number, z1: number, w: number): Vec2[] => [
  [x - w / 2, z0],
  [x + w / 2, z0],
  [x + w / 2, z1],
  [x - w / 2, z1],
]

/** The ground: grass, a cobbled square with a road out to the near edge, a garden behind. */
export function islandGround(footprints: Vec2[][]) {
  return {
    land: octagon(ISLAND_R),
    holes: [],
    overlays: [
      { kind: "garden" as const, poly: lane(-7.4, -1.8, 3.4, 2.8) },
      { kind: "cobble" as const, poly: lane(0.4, 1, ISLAND_R + 1, 3) },
      { kind: "plaza" as const, poly: disc(0.2, 0.8, 3.9) },
    ],
    footprints,
  }
}

export interface Diorama {
  stage: Stage
  /** Resolves once every piece is placed (or the library is missing what it needs). */
  ready: Promise<void>
  dispose(): void
}

function footprintOf(object: Piece): Vec2[] {
  const m = measure(object)
  const [w, , d] = m.size
  const [cx, , cz] = m.centre
  return [
    [cx - w / 2, cz - d / 2],
    [cx + w / 2, cz - d / 2],
    [cx + w / 2, cz + d / 2],
    [cx - w / 2, cz + d / 2],
  ]
}

const shadowed = (object: Piece) =>
  object.traverse((node) => {
    node.castShadow = true
    node.receiveShadow = true
  })

/**
 * Builds the vignette into `host`. `mounts` are the authored grips (`data/mounts.json`); a figure whose
 * prop has none falls back to the catalog's own, and is left empty-handed when there is neither.
 */
export function createDiorama(
  host: HTMLElement,
  catalog: Catalog | null,
  mounts: Record<string, Mount> | undefined,
): Diorama {
  const stage = createStage(host)
  // Held over its plinth: never below the grass, never looking up from under it. No free flight here.
  stage.rig.setWorld(DIORAMA_WORLD)
  stage.setCamera(POSE)
  const town = { min: [-ISLAND_R, -1.5, -ISLAND_R], max: [ISLAND_R, 12, ISLAND_R] } as const
  const sun: Sun = createSun(stage, {
    town: { min: [...town.min], max: [...town.max] },
    radii: [20],
    mapSize: 1024,
  })
  const sky: Sky = createSky(stage, { sun, reach: 2.2 * ISLAND_R })

  // The page scrolls under the wheel, and only a left drag turns the view.
  const swallow = (e: Event) => e.stopPropagation()
  const swallowNonLeft = (e: PointerEvent) => {
    if (e.button !== 0) e.stopPropagation()
  }
  host.addEventListener("wheel", swallow, { capture: true })
  host.addEventListener("pointerdown", swallowNonLeft, { capture: true })
  host.addEventListener("contextmenu", swallow, { capture: true })

  const figures: Character[] = []
  let ground: Ground | null = null
  let disposed = false

  // Motion only while it can be seen.
  const reduce = matchMedia("(prefers-reduced-motion: reduce)")
  let onScreen = true
  const active = () => onScreen && document.visibilityState === "visible"
  const sync = () => {
    stage.scene.visible = active()
  }
  const watch = new IntersectionObserver(([entry]) => {
    onScreen = entry?.isIntersecting ?? true
    sync()
  })
  watch.observe(host)
  document.addEventListener("visibilitychange", sync)

  let dragging = false
  const down = (e: PointerEvent) => {
    if (e.button === 0) dragging = true
  }
  const up = () => {
    dragging = false
  }
  host.addEventListener("pointerdown", down)
  addEventListener("pointerup", up)

  let frame = 0
  const unsubscribe = stage.onFrame((dt) => {
    if (!active()) return
    for (const ch of figures) ch.update(dt)
    // The figures move, so the near cascade (the sun's own) is redrawn every other frame: their idle
    // sway is slow enough that half rate does not show. The town map is never redrawn.
    if (figures.length > 0 && frame++ % 2 === 0) stage.sun.shadow.needsUpdate = true
    if (!reduce.matches && !dragging && dt > 0) {
      const pose = stage.getCamera()
      stage.setCamera({ ...pose, azimuth: (pose.azimuth + TURN_DEG_S * Math.min(dt, 0.1)) % 360 })
    }
  })

  const place = (object: Piece, s: Stand) => {
    object.position.set(s.at[0], 0, s.at[1])
    object.rotation.y = s.rot
    shadowed(object)
    return object
  }

  const build = async () => {
    if (!catalog) return
    const load = (id: string) => {
      const entry = catalog.get(id)
      return entry ? loadPiece(libraryUrl(entry.files.glb)) : Promise.resolve(null)
    }
    const rig = catalog.rig(RIG)
    const [houses, trees, people] = await Promise.all([
      Promise.all(HOUSES.map((s) => load(s.id))),
      Promise.all(TREES.map((s) => load(s.id))),
      Promise.all(
        FIGURES.map(async (f) => {
          const body = catalog.get(f.body)
          const prop = catalog.get(f.prop)
          if (!body || !rig) return null
          const [ch, held] = await Promise.all([
            loadCharacter(body, rig, libraryUrl),
            prop ? loadPiece(libraryUrl(prop.files.glb)) : Promise.resolve(null),
          ])
          return { f, ch, held, mount: mounts?.[f.prop] ?? prop?.compose.mount }
        }),
      ),
    ])
    if (disposed) return

    const footprints: Vec2[][] = []
    houses.forEach((object, i) => {
      const s = HOUSES[i]
      if (!object || !s) return
      stage.scene.add(place(object, s))
      object.updateMatrixWorld(true)
      footprints.push(footprintOf(object))
    })
    trees.forEach((object, i) => {
      const s = TREES[i]
      if (object && s) stage.scene.add(place(object, s))
    })
    for (const person of people) {
      if (!person) continue
      const { f, ch, held, mount } = person
      // Each figure starts at its own point in the clip, so the two never breathe in step.
      ch.play(f.clip, { speed: 0.9 })
      ch.update(f.at[0] * 0.37 + 1)
      if (held && mount) attachMount(ch, held, mount)
      ch.root.position.set(f.at[0], 0, f.at[1])
      ch.root.rotation.y = f.rot
      shadowed(ch.root as Piece)
      stage.scene.add(ch.root)
      figures.push(ch)
    }
    ground = createGround(stage, islandGround(footprints), { seed: 7 })
    sun.markDirty()
  }
  const ready = build()

  return {
    stage,
    ready,
    dispose() {
      disposed = true
      unsubscribe()
      watch.disconnect()
      document.removeEventListener("visibilitychange", sync)
      host.removeEventListener("wheel", swallow, { capture: true })
      host.removeEventListener("pointerdown", swallowNonLeft, { capture: true })
      host.removeEventListener("contextmenu", swallow, { capture: true })
      host.removeEventListener("pointerdown", down)
      removeEventListener("pointerup", up)
      ground?.dispose()
      sky.dispose()
      sun.dispose()
      stage.dispose()
    },
  }
}
