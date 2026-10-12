/**
 * The home page's vignette: a small piece of the hex world, built the way the island is (tile prefabs
 * placed with `placeTile` on hex prisms): the canteen with its beer garden in the middle, people at its
 * tables and by its door, cottages, an orchard, pines and a pond round it, a road out to the front, in
 * the early-evening light, turning slowly. It costs nothing while it cannot be seen: off screen or in a
 * hidden tab it stops updating and draws an empty scene. Reduced motion stops the turn.
 */
import type { Catalog, Mount } from "@guildhall/assets"
import type { CameraPose } from "@guildhall/core"
import {
  attachMount,
  type Character,
  createHexGround,
  createSky,
  createStage,
  createStaticBatch,
  createSun,
  createSurface,
  type HexPrism,
  loadCharacter,
  loadPiece,
  type Sky,
  type Stage,
  type StaticBatch,
  type Sun,
  type TerrainMesh,
  type World,
} from "@guildhall/render"
import {
  CHARACTER_SCALE,
  DIRS,
  HEX_TILE_SIZE,
  hexCentre,
  type PlacedPiece,
  placeTile,
  type TileGround,
  type TileSpot,
  tilePath,
  tilePrefab,
  worldSide,
} from "@guildhall/world"
import { libraryUrl } from "../catalog.ts"

/** Degrees the camera turns per second (a full turn in two minutes). */
export const TURN_DEG_S = 3
export const RIG = "rig-medium"
const R = HEX_TILE_SIZE
/** Tops of land and water tiles over the plinth's base, metres. */
const LAND = 0.5
const WATER = 0.2

/** One tile of the vignette: axial cell, the prefab on it (none: bare ground), the world side it fronts. */
export interface VignetteTile {
  q: number
  r: number
  prefab?: string
  /** The world side (DIRS order) its front faces: buildings face the camera's side. */
  face: number
  ground?: TileGround
}

/** Every building fronts world side 5, toward the camera's start. */
const FRONT = 5
/** The canteen's beer garden spills onto its side-5 neighbour (its prefab's `footprint`). */
const GARDEN = DIRS[worldSide(5, FRONT)]!

/** The canteen in the middle, its garden beside it, the village round them. */
export const TILES: readonly VignetteTile[] = [
  { q: 0, r: 0, prefab: "tavern-garden", face: FRONT },
  { q: GARDEN.q, r: GARDEN.r, face: FRONT },
  // the road out to the front, then houses, a pond, an orchard and pines round the back
  { q: 0, r: 1, prefab: "road", face: 0 },
  { q: -1, r: 1, prefab: "lake", face: 2, ground: "water" },
  { q: -1, r: 0, prefab: "cottage-garden", face: FRONT },
  { q: 0, r: -1, prefab: "pines", face: 1 },
  { q: 1, r: -1, prefab: "house", face: FRONT },
  { q: 1, r: 1, prefab: "orchard", face: 3 },
  { q: 2, r: -1, prefab: "pines", face: 4 },
  { q: -2, r: 1, prefab: "house", face: FRONT },
  { q: -1, r: -1, prefab: "pines", face: 2 },
]

/** Who is out at the canteen: a body, the kind of spot they take (the k-th of that kind), what they hold. */
interface Figure {
  body: string
  spot: TileSpot["kind"]
  k: number
  prop?: string
}

export const FIGURES: readonly Figure[] = [
  { body: "kaykit-adventurers/knight", spot: "sit", k: 0, prop: "kaykit-adventurers/mug-full" },
  { body: "kaykit-adventurers/mage", spot: "sit", k: 1 },
  { body: "kaykit-adventurers/barbarian", spot: "sit", k: 2, prop: "kaykit-adventurers/mug-full" },
  { body: "kaykit-adventurers/rogue-hooded", spot: "sit", k: 5 },
  { body: "kaykit-adventurers/ranger", spot: "sit", k: 6, prop: "kaykit-adventurers/mug-full" },
  { body: "kaykit-adventurers/rogue", spot: "sit", k: 9 },
  { body: "kaykit-adventurers/mage", spot: "talk", k: 0, prop: "kaykit-tools/lantern" },
  { body: "kaykit-adventurers/knight", spot: "talk", k: 1, prop: "kaykit-weapons/sword-a" },
  { body: "kaykit-adventurers/barbarian", spot: "work", k: 0 },
]

/** A tile's centre, metres. */
export const tileAt = (t: Pick<VignetteTile, "q" | "r">): [number, number] => {
  const [x, z] = hexCentre(t)
  return [x * R, z * R]
}

/** A tile's turn for the side it fronts (world.ts rotOf). */
const rotOf = (d: number) => {
  const a = (Math.PI / 180) * (60 * d)
  return Math.atan2(Math.cos(a), -Math.sin(a))
}

/** The view: three-quarters onto the canteen's front and garden, the whole cluster in frame. */
export const POSE: CameraPose = { target: [2.6, 1, 0.9], azimuth: 24, elevation: 31, distance: 23.5 }

/** What the view is held inside: no water, no free flight, a wide zoom so the low view stands. */
export const DIORAMA_WORLD: World = {
  centre: [2, 1],
  half: R * 4,
  water: null,
  maxReach: 2.5,
  free: false,
}

const GROUND: Record<TileGround, [number, number, number]> = {
  grass: [143, 195, 86],
  soil: [150, 112, 70],
  dirt: [196, 160, 108],
  paved: [196, 186, 166],
  sand: [232, 210, 150],
  rock: [150, 140, 128],
  water: [86, 170, 222],
}
const SIDE: [number, number, number] = [122, 90, 60]

export interface Diorama {
  stage: Stage
  /** Resolves once every piece is placed (or the library is missing what it needs). */
  ready: Promise<void>
  dispose(): void
}

/** The vignette's pieces, ground prisms and road, laid out as the island would lay them. */
export function vignetteLayout() {
  const pieces: PlacedPiece[] = []
  const prisms: HexPrism[] = []
  const road: number[] = []
  for (const [k, t] of TILES.entries()) {
    const at = tileAt(t)
    const prefab = t.prefab ? tilePrefab(t.prefab) : undefined
    const ground = t.ground ?? prefab?.ground ?? "grass"
    const top = ground === "water" ? WATER : LAND
    prisms.push({ x: at[0], z: at[1], top, color: GROUND[ground], side: SIDE })
    if (!prefab) continue
    const rot = rotOf(t.face)
    pieces.push(...placeTile(prefab, at, top, rot, k + 11, false))
    if (prefab.path)
      road.push(
        ...tilePath(
          at,
          LAND + 0.03,
          prefab.path.map((s) => worldSide(s, t.face)),
        ),
      )
  }
  return { pieces, prisms, road }
}

/** The canteen's spots in the world: where its people sit, talk and serve. */
export function canteenSpots(): (TileSpot & { y: number })[] {
  const t = TILES[0]!
  const prefab = t.prefab ? tilePrefab(t.prefab) : undefined
  const [ox, oz] = tileAt(t)
  const rot = rotOf(t.face)
  const c = Math.cos(rot)
  const s = Math.sin(rot)
  return (prefab?.spots ?? []).map((spot) => ({
    ...spot,
    x: ox + spot.x * c + spot.z * s,
    z: oz - spot.x * s + spot.z * c,
    facing: spot.facing + rot,
    y: LAND + (spot.y ?? 0),
  }))
}

/**
 * Builds the vignette into `host`. `mounts` are the authored grips (`data/mounts.json`); a figure whose
 * prop has none falls back to the catalog's own, and is left empty-handed when there is neither. The
 * tile prefabs must be loaded (`loadTiles`) first; a prefab missing from them is left as bare ground.
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
  const span = R * 4
  const sun: Sun = createSun(stage, {
    town: { min: [-span, -1, -span], max: [span + 4, 12, span + 2] },
    radii: [26],
    mapSize: 1024,
  })
  const sky: Sky = createSky(stage, { sun, hour: 17.4, reach: 2.4 * span })

  // The page scrolls under the wheel, and only a left drag turns the view.
  const swallow = (e: Event) => e.stopPropagation()
  const swallowNonLeft = (e: PointerEvent) => {
    if (e.button !== 0) e.stopPropagation()
  }
  host.addEventListener("wheel", swallow, { capture: true })
  host.addEventListener("pointerdown", swallowNonLeft, { capture: true })
  host.addEventListener("contextmenu", swallow, { capture: true })

  const figures: Character[] = []
  const meshes: TerrainMesh[] = []
  let batch: StaticBatch | null = null
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
    // The figures move, so the near cascade is redrawn every other frame: their idle sway is slow
    // enough that half rate does not show.
    if (figures.length > 0 && frame++ % 2 === 0) stage.sun.shadow.needsUpdate = true
    if (!reduce.matches && !dragging && dt > 0) {
      const pose = stage.getCamera()
      stage.setCamera({ ...pose, azimuth: (pose.azimuth + TURN_DEG_S * Math.min(dt, 0.1)) % 360 })
    }
  })

  const build = async () => {
    const { pieces, prisms, road } = vignetteLayout()
    meshes.push(createHexGround(stage, { size: R, base: -0.6, tiles: prisms }))
    if (road.length) meshes.push(createSurface(stage, new Float32Array(road), "#d9c08c"))
    if (!catalog) return
    const rig = catalog.rig(RIG)
    const spots = canteenSpots()
    const [made, people] = await Promise.all([
      createStaticBatch(
        stage,
        pieces.filter((p) => catalog.get(p.piece)),
        async (id) => loadPiece(libraryUrl(catalog.get(id)!.files.glb)),
      ),
      Promise.all(
        FIGURES.map(async (f) => {
          const spot = spots.filter((s) => s.kind === f.spot)[f.k]
          const body = catalog.get(f.body)
          if (!spot || !body || !rig) return null
          const prop = f.prop ? catalog.get(f.prop) : undefined
          const [ch, held] = await Promise.all([
            loadCharacter(body, rig, libraryUrl),
            prop ? loadPiece(libraryUrl(prop.files.glb)) : Promise.resolve(null),
          ])
          return { f, spot, ch, held, mount: f.prop ? (mounts?.[f.prop] ?? prop?.compose.mount) : undefined }
        }),
      ),
    ])
    if (disposed) {
      made.dispose()
      return
    }
    batch = made
    for (const [i, person] of people.entries()) {
      if (!person) continue
      const { spot, ch, held, mount } = person
      // Each figure starts at its own point in its clip, so nobody breathes in step.
      ch.play(spot.clip ?? "Idle_A", { speed: 0.9 })
      ch.update(i * 0.61 + 0.3)
      if (held && mount) attachMount(ch, held, mount)
      ch.root.position.set(spot.x, spot.y, spot.z)
      ch.root.rotation.y = spot.facing
      ch.root.scale.setScalar(CHARACTER_SCALE)
      ch.root.traverse((node) => {
        node.castShadow = true
        node.receiveShadow = true
      })
      stage.scene.add(ch.root)
      figures.push(ch)
    }
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
      batch?.dispose()
      for (const m of meshes) m.dispose()
      sky.dispose()
      sun.dispose()
      stage.dispose()
    },
  }
}
