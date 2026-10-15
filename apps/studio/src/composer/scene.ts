/**
 * The tile composer's 3D side: one hex at scale B with its six neighbours (their ground, the road going
 * on through them, or a step down for terraces), the tile's pieces one node each so the gizmo can take
 * any of them, its spots and blockers as flat markers drawn over everything, and in "try" mode a KayKit
 * townsperson at CHARACTER_SCALE on every spot playing the spot's clip with its prop. Every three object
 * comes from @guildhall/render; picking is screen-space over each item's projected box.
 */
import { type Catalog, type NpcRecipe, resolveNpc } from "@guildhall/assets"
import { type CameraPose, log } from "@guildhall/core"
import {
  createGizmo,
  createHexGround,
  createNpc,
  createSky,
  createStage,
  createSun,
  createSurface,
  discMarker,
  disposeObject,
  type GizmoMode,
  type GizmoPose,
  group,
  type HexPrism,
  hexOutline,
  loadPiece,
  measure,
  type Npc,
  recolourPiece,
  type Stage,
  spotMarker,
  type TerrainMesh,
  toScreen,
} from "@guildhall/render"
import {
  CHARACTER_SCALE,
  DIRS,
  FRONT_SIDE,
  HEX_TILE_SIZE,
  hexCentre,
  KENNEY_WOOD,
  LEAF_TONES,
  LEVEL_STEP,
  sideDir,
  type TileGround,
  type TilePiece,
  type TilePrefab,
  tilePath,
  worldSide,
} from "@guildhall/world"
import { libraryUrl } from "../catalog.ts"
import { BLOCKER_COLOUR, KIND_COLOUR, type Selection } from "./model.ts"

const logger = log("studio:composer")

/** What the neighbours are: the tile's own ground, grass, a beach and the sea, or a terrace step down. */
export type Around = "same" | "grass" | "shore" | "step"
export const AROUND: readonly Around[] = ["same", "grass", "shore", "step"]

export interface ShowOpts {
  around: Around
  /** Characters on every spot. */
  tryOn: boolean
  /** The markers (spots, blockers, footprint) drawn at all. */
  markers: boolean
  /** Which foliage tone of the prefab's `tones` the leaves take (the world picks one per tile). */
  tone: number
}

export interface SceneEvents {
  /** A click picked an item, or nothing (null). */
  pick(sel: Selection | null): void
  /** A gizmo drag ended with the item here: tile space, y over the tile's top. */
  moved(sel: Selection, x: number, y: number, z: number, rot: number): void
}

export interface TileScene {
  stage: Stage
  /** Draws `t`; resolves once drawn (characters included in try mode). */
  show(t: TilePrefab, opts: ShowOpts): Promise<void>
  select(sel: Selection | null): void
  setMode(mode: GizmoMode): void
  /** Aims the camera on the tile. */
  frame(): void
  dispose(): void
}

type RGB = [number, number, number]
/** The hex island's ground colours (hexworld/index.ts), so a tile reads here as it will there. */
const TOP: Record<TileGround, RGB> = {
  grass: [112, 156, 64],
  soil: [150, 112, 70],
  dirt: [196, 160, 108],
  paved: [196, 186, 166],
  sand: [232, 210, 150],
  rock: [150, 140, 128],
  water: [79, 154, 214],
}
const SIDE: RGB = [122, 90, 60]
const SIDE_ROCK: RGB = [118, 110, 100]
const PATH_COLOUR = "#d9c08c"
/** The tile's top, metres: the ground prisms stand on -1. */
const TOP_Y = 0.5
/**
 * Where a tile's pieces stand: its top, or for a water tile the shallows' bed, 0.75 under the beach
 * (world.ts: a dock's posts on the bed at -0.4, the beach at 0.35), so a dock's deck meets the shore.
 */
const baseOf = (t: TilePrefab): number => (t.ground === "water" ? TOP_Y - 0.75 : TOP_Y)
const R = HEX_TILE_SIZE
/** The world side the tile's front faces here: the camera looks at it from a little to its side. */
const FACE = 5
/** The tile's turn in the world (world.ts rotOf(FACE) = 90° + 60°·FACE), so it sits as it will on the island. */
const TURN = (Math.PI / 180) * (90 + 60 * FACE)
/** A press that moves further than this (CSS px) is an orbit, not a click. */
const CLICK_SLOP = 4
const SNAP = { translate: { coarse: 0.05, fine: 0.01 }, rotate: { coarse: 15, fine: 5 } }
/** Who stands on a spot with no roles, by its kind (data/npcs ids). */
const KIND_ROLE: Record<string, string> = {
  sit: "merchant",
  talk: "merchant",
  stand: "farmer",
  work: "farmer",
  sleep: "monk",
}

/** A piece's re-tint as the world gives it (tiles.ts placeTile): Kenney wood to timber, leaves to the tone. */
function swatches(t: TilePrefab, q: TilePiece, tone: number): Record<number, number> {
  const tones = t.tones?.length ? t.tones[tone % t.tones.length] : undefined
  return {
    ...(q.piece.startsWith("kenney-") ? KENNEY_WOOD : {}),
    ...(q.tone && tones ? tones : q.piece.startsWith("kaykit-forest/") ? LEAF_TONES.base : {}),
    ...q.swatchMap,
  }
}

/** The six neighbour centres, metres, in side order (side d's neighbour is DIRS[d]). */
const neighbours = (): [number, number][] =>
  DIRS.map((d) => {
    const [x, z] = hexCentre(d)
    return [x * R, z * R]
  })

/** A press on an item: its projected box (CSS px) and how far in front it is. */
interface Hit {
  sel: Selection
  rect: [number, number, number, number]
  area: number
  /** Markers win over the pieces they lie on. */
  rank: number
}

export function createTileScene(
  host: HTMLElement,
  catalog: Catalog,
  roles: ReadonlyMap<string, NpcRecipe>,
  events: SceneEvents,
): TileScene {
  const stage = createStage(host)
  const town = {
    min: [-R * 4, -2, -R * 4] as [number, number, number],
    max: [R * 4, 12, R * 4] as [number, number, number],
  }
  const sun = createSun(stage, { town, radii: [14, 40], mapSize: 2048 })
  const sky = createSky(stage, { sun, hour: 15.5, reach: 40 })

  const loaded = new Map<string, Promise<unknown>>()
  const piece = async (id: string) => {
    const entry = catalog.get(id)
    if (!entry) throw new Error(`no catalog piece "${id}"`)
    return loadPiece(libraryUrl(entry.files.glb))
  }

  let generation = 0
  // everything authored lives in the tile's own frame, turned as the world turns it
  const frame = group("composer-frame")
  frame.rotation.y = TURN
  stage.scene.add(frame)
  let ground: TerrainMesh[] = []
  let root: ReturnType<typeof group> | null = null
  let marks: ReturnType<typeof group> | null = null
  let folk: Npc[] = []
  /** Node of each selectable item, by layer. */
  let nodes: Record<Selection["layer"], (ReturnType<typeof group> | null)[]> = {
    pieces: [],
    spots: [],
    blockers: [],
  }
  let shown: TilePrefab | null = null
  let opts: ShowOpts | null = null
  let selected: Selection | null = null

  // ── gizmo: a drag lands in `pending` and is committed on release, so a redraw never cuts it short.
  let mode: GizmoMode = "translate"
  let fine = false
  let pending: GizmoPose | null = null
  let dragged = false
  const gizmo = createGizmo(stage, {
    mode,
    snap: SNAP.translate.coarse,
    onChange(pose) {
      pending = pose
      dragged = true
    },
  })
  const applySnap = () => gizmo.setSnap(fine ? SNAP[mode].fine : SNAP[mode].coarse)
  const attach = () => {
    const node = selected ? nodes[selected.layer][selected.i] : null
    if (node) gizmo.attach(node)
    else gizmo.detach()
  }

  const canvas = stage.renderer.domElement
  let press: { x: number; y: number } | null = null
  const down = (e: PointerEvent) => {
    press = { x: e.clientX, y: e.clientY }
    dragged = false
  }
  const up = () => {
    if (!pending || !selected) return
    const pose = pending
    const sel = selected
    pending = null
    // after the gizmo's own pointerup
    setTimeout(
      () =>
        events.moved(
          sel,
          pose.position[0],
          pose.position[1] - (shown ? baseOf(shown) : TOP_Y),
          pose.position[2],
          pose.rot,
        ),
      0,
    )
  }
  const hits = (): Hit[] => {
    const out: Hit[] = []
    const box = (sel: Selection, node: ReturnType<typeof group>, rank: number) => {
      const m = measure(node)
      const [cx, cy, cz] = m.centre
      const [w, h, d] = m.size.map((v) => Math.max(v, 0.25)) as [number, number, number]
      let rect: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity]
      for (const sx of [-1, 1])
        for (const sy of [-1, 1])
          for (const sz of [-1, 1]) {
            const p = toScreen(stage, [cx + (sx * w) / 2, cy + (sy * h) / 2, cz + (sz * d) / 2])
            if (!p) return
            rect = [
              Math.min(rect[0], p[0]),
              Math.min(rect[1], p[1]),
              Math.max(rect[2], p[0]),
              Math.max(rect[3], p[1]),
            ]
          }
      out.push({ sel, rect, area: (rect[2] - rect[0]) * (rect[3] - rect[1]), rank })
    }
    for (const layer of ["spots", "blockers", "pieces"] as const)
      nodes[layer].forEach((node, i) => {
        if (node?.visible) box({ layer, i }, node, layer === "pieces" ? 0 : 1)
      })
    return out
  }
  const click = (e: MouseEvent) => {
    const moved = press ? Math.hypot(e.clientX - press.x, e.clientY - press.y) > CLICK_SLOP : false
    if (dragged || moved) {
      dragged = false
      return
    }
    const rect = canvas.getBoundingClientRect()
    const [px, py] = [e.clientX - rect.left, e.clientY - rect.top]
    const under = hits()
      .filter((h) => px >= h.rect[0] && px <= h.rect[2] && py >= h.rect[1] && py <= h.rect[3])
      .sort((a, b) => b.rank - a.rank || a.area - b.area)
    events.pick(under[0]?.sel ?? null)
  }
  const keys = (e: KeyboardEvent) => {
    if (e.key === "Alt") {
      fine = e.type === "keydown"
      applySnap()
    }
  }
  host.addEventListener("pointerdown", down, { capture: true })
  host.addEventListener("pointerup", up, { capture: true })
  canvas.addEventListener("click", click)
  addEventListener("keydown", keys)
  addEventListener("keyup", keys)
  const unTick = stage.onFrame((dt) => {
    for (const n of folk) n.update(dt)
  })

  const drawGround = (t: TilePrefab, around: Around) => {
    for (const m of ground) m.dispose()
    ground = []
    const prisms: HexPrism[] = []
    const paths: number[] = []
    const side = (g: TileGround) => (g === "rock" ? SIDE_ROCK : SIDE)
    const own = baseOf(t)
    prisms.push({ x: 0, z: 0, top: own, color: TOP[t.ground], side: side(t.ground) })
    // the tile's own road sides, as the world will see them on this turned tile
    const roads = (t.path ?? []).map((k) => worldSide(k, FACE))
    if (roads.length) paths.push(...tilePath([0, 0], TOP_Y + 0.03, roads))
    neighbours().forEach(([x, z], w) => {
      // which of the tile's own sides this neighbour lies across (0–2 behind, 3–5 in front)
      const k = (((w - FACE - 2) % 6) + 6) % 6
      const front = k >= 3
      let g: TileGround = around === "same" ? t.ground : "grass"
      let top = TOP_Y
      if (around === "shore") g = front ? "sand" : "water"
      if (around === "step" && front) top = TOP_Y - LEVEL_STEP
      if (g === "water") top = TOP_Y - 0.6
      if (t.ground === "water" && around === "same") top = own
      // a dock's land end (its front) is the beach it runs out from
      if (t.ground === "water" && k === FRONT_SIDE) {
        g = "sand"
        top = TOP_Y
      }
      // a tile the prefab also covers takes its ground
      const claimed = t.footprint?.includes(k) ?? false
      if (claimed) {
        g = t.ground
        top = own
      }
      const shade = claimed ? 1 : 0.93
      const c = TOP[g]
      prisms.push({ x, z, top, color: [c[0] * shade, c[1] * shade, c[2] * shade], side: side(g) })
      // the road goes on: through the neighbour beyond each side it leaves by
      if (roads.includes(w) && g !== "water") paths.push(...tilePath([x, z], top + 0.03, [(w + 3) % 6, w]))
    })
    ground.push(createHexGround(stage, { size: R, base: -1.6, tiles: prisms }))
    if (paths.length) ground.push(createSurface(stage, new Float32Array(paths), PATH_COLOUR))
  }

  const drawMarks = (t: TilePrefab, o: ShowOpts) => {
    if (marks) disposeObject(marks)
    nodes = { ...nodes, spots: [], blockers: [] }
    marks = group("composer-marks")
    if (o.markers) {
      t.spots?.forEach((s, i) => {
        const on = selected?.layer === "spots" && selected.i === i
        const g = group(`spot-${i}`, spotMarker(KIND_COLOUR[s.kind], on))
        g.position.set(s.x, baseOf(t) + (s.y ?? 0), s.z)
        g.rotation.y = s.facing
        marks!.add(g)
        nodes.spots[i] = g
      })
      t.blockers?.forEach((b, i) => {
        const on = selected?.layer === "blockers" && selected.i === i
        const g = group(`blocker-${i}`, discMarker(b.r, BLOCKER_COLOUR, on))
        g.position.set(b.x, baseOf(t), b.z)
        marks!.add(g)
        nodes.blockers[i] = g
      })
      for (const k of t.footprint ?? []) {
        // the neighbour across side k, its outline turned back to the world's pointy-top hexes
        const [dx, dz] = sideDir(k)
        const apothem = (R * Math.sqrt(3)) / 2
        const o2 = group(`footprint-${k}`, hexOutline(R, "#dcb662"))
        o2.position.set(dx * apothem * 2, TOP_Y, dz * apothem * 2)
        o2.rotation.y = -TURN
        marks.add(o2)
      }
    }
    frame.add(marks)
  }

  const disposeFolk = () => {
    for (const n of folk) n.dispose()
    folk = []
  }

  /** A townsperson for spot `s`: its first role's look (or its kind's), holding the spot's prop only. */
  const person = async (t: TilePrefab, i: number): Promise<Npc | null> => {
    const s = t.spots![i]!
    const recipe = roles.get(s.roles?.[0] ?? KIND_ROLE[s.kind] ?? "merchant") ?? [...roles.values()][0]
    if (!recipe) return null
    const head = recipe.head?.pieces.filter((id) => id === "" || catalog.get(id)?.compose.mount)
    const look = resolveNpc(
      {
        ...recipe,
        hands: {},
        ...(recipe.head && head?.length ? { head: { ...recipe.head, pieces: head } } : { head: undefined }),
      },
      i * 7 + 3,
      catalog,
    )
    const mount = s.prop ? catalog.get(s.prop)?.compose.mount : undefined
    const npc = await createNpc(
      {
        ...look,
        scale: look.scale * CHARACTER_SCALE,
        mounts: [...look.mounts, ...(s.prop && mount ? [{ piece: s.prop, slot: mount.slot }] : [])],
      },
      catalog,
      libraryUrl,
    )
    npc.root.position.set(s.x, baseOf(t) + (s.y ?? 0), s.z)
    npc.root.rotation.y = s.facing
    if (!s.clip || !npc.character.play(s.clip)) npc.play("idle")
    npc.root.traverse((n) => {
      n.castShadow = true
    })
    return npc
  }

  const scene: TileScene = {
    stage,
    async show(t, o) {
      const mine = ++generation
      const turnFolk = !shown || !opts || o.tryOn !== opts.tryOn || t.spots !== shown.spots
      const built = await Promise.all(
        t.pieces.map(async (q) => {
          const node = recolourPiece(await piece(q.piece), swatches(t, q, o.tone))
          node.traverse((n) => {
            n.castShadow = true
            n.receiveShadow = true
          })
          // the wrapper carries the placement: it is what the gizmo moves (and turns about +y only); a
          // piece's lean sits inside it
          const leaned = q.tilt ? group(`${q.piece}-tilt`, node) : node
          if (q.tilt) leaned.rotation.set(q.tilt[0], 0, q.tilt[1])
          const g = group(q.piece, leaned)
          g.position.set(q.x, baseOf(t) + (q.y ?? 0), q.z)
          g.rotation.set(0, q.rot, 0)
          g.scale.setScalar(q.scale)
          return g
        }),
      ).catch((error: unknown) => {
        logger.error("pieces failed", { error: String(error) })
        return null
      })
      let people: (Npc | null)[] | null = null
      if (o.tryOn && turnFolk && t.spots?.length)
        people = await Promise.all(
          t.spots.map((_, i) =>
            person(t, i).catch((error: unknown) => {
              logger.warn("spot person failed", { spot: i, error: String(error) })
              return null
            }),
          ),
        )
      if (mine !== generation || !built) {
        for (const p of people ?? []) p?.dispose()
        return
      }
      gizmo.detach()
      root?.removeFromParent()
      root = group("composer-tile", ...built)
      frame.add(root)
      nodes = { pieces: built, spots: [], blockers: [] }
      if (
        !shown ||
        !opts ||
        shown.ground !== t.ground ||
        shown.path !== t.path ||
        shown.footprint !== t.footprint ||
        opts.around !== o.around
      )
        drawGround(t, o.around)
      drawMarks(t, o)
      if (!o.tryOn) disposeFolk()
      else if (people) {
        disposeFolk()
        folk = people.filter((p): p is Npc => p !== null)
        for (const p of folk) frame.add(p.root)
      }
      shown = t
      opts = o
      attach()
      sun.markDirty()
      void loaded
    },
    select(sel) {
      selected = sel
      pending = null
      if (shown && opts) drawMarks(shown, opts)
      attach()
    },
    setMode(next) {
      mode = next
      gizmo.setMode(next)
      applySnap()
    },
    frame() {
      const pose: CameraPose = { target: [0, 0.8, 0.4], azimuth: 22, elevation: 42, distance: 14 }
      stage.setCamera(pose)
      sun.markDirty()
    },
    dispose() {
      generation++
      unTick()
      host.removeEventListener("pointerdown", down, { capture: true })
      host.removeEventListener("pointerup", up, { capture: true })
      canvas.removeEventListener("click", click)
      removeEventListener("keydown", keys)
      removeEventListener("keyup", keys)
      gizmo.dispose()
      disposeFolk()
      if (marks) disposeObject(marks)
      root?.removeFromParent()
      for (const m of ground) m.dispose()
      sky.dispose()
      sun.dispose()
      stage.dispose()
    },
  }
  return scene
}
