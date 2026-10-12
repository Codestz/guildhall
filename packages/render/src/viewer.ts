import { type CatalogEntry, DOOR_TOP, HERO_HEIGHT } from "@guildhall/assets"
import { log } from "@guildhall/core"
import {
  CanvasTexture,
  DoubleSide,
  GridHelper,
  Group,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  PlaneGeometry,
  Sprite,
  SpriteMaterial,
} from "three"
import type { Disposable } from "./grid.ts"
import { disposeObject, heroSilhouette } from "./hero.ts"
import { measure } from "./model.ts"
import { loadPiece } from "./pieces.ts"
import { createShadows } from "./shadow.ts"
import type { Stage } from "./stage.ts"
import { boundingSphere, fitSphere } from "./thumbnail.ts"

/** One piece to show: its GLB url, and its catalog entry when it has one. */
export interface ShowItem {
  url: string
  entry?: CatalogEntry
}

export interface Overlay {
  /** The 1 m grid with metre labels every 5 m. */
  grid: boolean
  /** The 2.2 m hero silhouette left of the origin. */
  hero: boolean
  /** A translucent band at door-top height (2.4–2.8 m) behind the pieces. */
  doorBand: boolean
}

export interface ViewerStats {
  /** Triangles over every shown piece. */
  tris: number
  /** World size `[w, h, d]` in metres of the shown pieces together. */
  size: [number, number, number]
  /** The shown pieces' catalog entries, where they came with one. */
  entries: CatalogEntry[]
}

export interface Viewer {
  /** Shows one piece, replacing what was shown, and frames it. */
  show(url: string): Promise<void>
  /** The same, from a catalog entry (kept in `stats`) and the url its GLB is served at. */
  show(entry: CatalogEntry, url: string): Promise<void>
  /** Shows pieces in a row from the origin rightward, each on whole 1 m cells, and frames them. */
  showMany(items: readonly ShowItem[]): Promise<void>
  clear(): void
  setOverlay(overlay: Partial<Overlay>): void
  /** Re-aims the camera to fit what is shown. */
  frame(): void
  /** What is shown, or null when nothing is. */
  stats(): ViewerStats | null
  dispose(): void
}

export interface ViewerOpts {
  /** Grid metres a side (default 60). */
  gridSize?: number
  overlay?: Partial<Overlay>
}

/** A slot in a row of pieces: where it starts, its whole-metre width, and its centre. */
export interface RowSlot {
  start: number
  width: number
  centre: number
}

const logger = log("render:viewer")

/** Open metres between two pieces in a row. */
const ROW_GAP = 1
/** Open metres between the hero and the origin. */
const HERO_GAP = 0.5
const LABEL_STEP = 5
const VIEW = { azimuth: 35, elevation: 22, margin: 1.15 }

/** Slots left to right from x = 0: each piece's width rounded up to whole metres, `gap` between. */
export function rowSlots(widths: readonly number[], gap = ROW_GAP): RowSlot[] {
  let cursor = 0
  return widths.map((w) => {
    // Float noise (2.0000001 m) must not cost a whole extra metre.
    const width = Math.max(1, Math.ceil(w - 1e-6))
    const slot = { start: cursor, width, centre: cursor + width / 2 }
    cursor += width + gap
    return slot
  })
}

/** Triangles drawn by the meshes under `root`. */
export function countTris(root: Object3D): number {
  let tris = 0
  root.traverse((node) => {
    if (!(node instanceof Mesh)) return
    const geometry = node.geometry
    tris += Math.floor((geometry.index?.count ?? geometry.getAttribute("position").count) / 3)
  })
  return tris
}

function metreLabel(text: string): Sprite {
  const canvas = document.createElement("canvas")
  canvas.width = 128
  canvas.height = 64
  const context = canvas.getContext("2d")
  if (context) {
    context.font = "600 36px ui-monospace, Menlo, monospace"
    context.textAlign = "center"
    context.textBaseline = "middle"
    context.fillStyle = "#5a5246"
    context.fillText(text, 64, 32)
  }
  const sprite = new Sprite(new SpriteMaterial({ map: new CanvasTexture(canvas), depthWrite: false }))
  sprite.scale.set(1, 0.5, 1)
  return sprite
}

/** The 1 m grid (in the stage grid's colours), a darker line every 5 m, labels every 5 m along x. */
function metreGrid(size: number): Group & Disposable {
  const fine = new GridHelper(size, size, "#8a8172", "#b3aa99")
  const coarse = new GridHelper(size, size / LABEL_STEP, "#6f675a", "#6f675a")
  coarse.position.y = 0.001
  const labels: Sprite[] = []
  for (let x = -size / 2 + LABEL_STEP; x < size / 2; x += LABEL_STEP) {
    if (x === 0) continue
    const label = metreLabel(`${x} m`)
    label.position.set(x, 0.3, 0.6)
    labels.push(label)
  }
  const grid = Object.assign(new Group(), {
    dispose() {
      grid.removeFromParent()
      fine.dispose()
      coarse.dispose()
      for (const label of labels) {
        label.material.map?.dispose()
        label.material.dispose()
      }
    },
  })
  grid.name = "grid"
  grid.add(fine, coarse, ...labels)
  return grid
}

/**
 * A piece viewer on a stage: the stage's orbit camera, frame-to-fit, a metre grid, a 2.2 m hero
 * silhouette left of the origin for scale and an optional door-top band. Characters show in their
 * bind pose. Shown pieces come from `loadPiece`, so clearing only removes them (the cache owns their
 * geometry).
 */
export function createViewer(stage: Stage, opts: ViewerOpts = {}): Viewer {
  const overlay: Overlay = { grid: true, hero: true, doorBand: false, ...opts.overlay }
  const gridSize = Math.ceil((opts.gridSize ?? 60) / (2 * LABEL_STEP)) * 2 * LABEL_STEP
  const grid = metreGrid(gridSize)
  stage.scene.add(grid)

  const hero = heroSilhouette(HERO_HEIGHT)
  hero.traverse((node) => {
    node.castShadow = true
  })
  const heroRadius = measure(hero).size[0] / 2
  hero.position.x = -HERO_GAP - heroRadius

  const [doorLow, doorHigh] = DOOR_TOP
  const bandHeight = (doorHigh ?? doorLow) - doorLow
  const band = new Mesh(
    new PlaneGeometry(1, bandHeight),
    new MeshBasicMaterial({
      color: "#d9822b",
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      side: DoubleSide,
    }),
  )
  band.name = "door-band"

  const content = new Group()
  content.name = "viewer"
  const pieces = new Group()
  content.add(pieces, hero, band)
  stage.scene.add(content)

  let shown: ViewerStats | null = null
  let shadows: Disposable | null = null
  let request = 0

  const applyOverlay = () => {
    grid.visible = overlay.grid
    hero.visible = overlay.hero
    band.visible = overlay.doorBand && pieces.children.length > 0
  }

  const frame = () => {
    const { centre, radius } = boundingSphere(content)
    const canvas = stage.renderer.domElement
    const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight)
    stage.setCamera(fitSphere(centre, radius, { fov: stage.camera.fov, aspect, ...VIEW }))
  }

  const clear = () => {
    request++
    pieces.clear()
    shadows?.dispose()
    shadows = null
    shown = null
    applyOverlay()
  }

  const showMany = async (items: readonly ShowItem[]) => {
    const mine = ++request
    const loaded = await Promise.all(items.map((item) => loadPiece(item.url)))
    // A newer show (or a clear) arrived while these loaded: drop them.
    if (mine !== request) return
    pieces.clear()
    shadows?.dispose()
    const measures = loaded.map((piece) => measure(piece))
    const slots = rowSlots(measures.map((m) => m.size[0]))
    for (const [i, piece] of loaded.entries()) {
      // Only x moves: the import set each pivot, and the viewer shows it as imported.
      piece.position.x = (slots[i]?.centre ?? 0) - (measures[i]?.centre[0] ?? 0)
      pieces.add(piece)
    }
    const all = measure(pieces)
    const end = slots.at(-1)
    const right = end ? end.start + end.width : 0
    const left = hero.position.x - heroRadius
    band.scale.x = right - left + 1
    band.position.set((left + right) / 2, doorLow + bandHeight / 2, all.centre[2] - all.size[2] / 2 - 0.05)
    shadows = createShadows(stage, {
      min: [left - 1, 0, all.centre[2] - all.size[2] / 2 - 1],
      max: [right + 1, Math.max(all.size[1], HERO_HEIGHT) + 1, all.centre[2] + all.size[2] / 2 + 1],
    })
    shown = {
      tris: countTris(pieces),
      size: all.size,
      entries: items.flatMap((item) => (item.entry ? [item.entry] : [])),
    }
    applyOverlay()
    frame()
    logger.debug("shown", { count: items.length, tris: shown.tris, size: shown.size })
  }

  applyOverlay()
  return {
    show: (target: string | CatalogEntry, url?: string) =>
      showMany([typeof target === "string" ? { url: target } : { url: url as string, entry: target }]),
    showMany,
    clear,
    setOverlay(next) {
      Object.assign(overlay, next)
      applyOverlay()
    },
    frame,
    stats: () => shown && { ...shown, size: [...shown.size], entries: [...shown.entries] },
    dispose() {
      clear()
      content.removeFromParent()
      disposeObject(hero)
      band.geometry.dispose()
      band.material.dispose()
      grid.dispose()
    },
  }
}
