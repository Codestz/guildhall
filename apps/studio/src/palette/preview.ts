/**
 * The live preview: the cast in a 4 × 3 grid, each piece fitted to one cell, recoloured on the client by
 * rewriting COLOR_0 from its `_SWATCH` / `_SHADE` attributes (no shader, no re-import). Every mesh gets
 * its own copy of its geometry first, because `loadPiece` shares geometry with every other screen.
 */
import type { CatalogEntry } from "@guildhall/assets"
import {
  boundingSphere,
  createShadows,
  type Disposable,
  fitSphere,
  group,
  loadPiece,
  measure,
  type Stage,
  toScreen,
} from "@guildhall/render"
import { libraryUrl } from "../catalog.ts"
import { vertexColour } from "./colour.ts"

const COLUMNS = 4
/** Metres between cell centres. */
const CELL = 9
/** Each piece is scaled so its largest side is this many metres. */
const FIT = 6.5
const VIEW = { azimuth: 14, elevation: 40, margin: 0.92 }

type Piece = Awaited<ReturnType<typeof loadPiece>>

/** The parts of three's BufferAttribute / BufferGeometry / Mesh the recolour touches. */
interface Attribute {
  count: number
  getX(index: number): number
  setXYZ(index: number, x: number, y: number, z: number): unknown
  needsUpdate: boolean
}
interface Geometry {
  getAttribute(name: string): Attribute | undefined
  clone(): Geometry
  dispose(): void
}
interface MeshLike {
  isMesh?: boolean
  geometry: Geometry
}

/** One mesh's colour attribute and the swatch and shade each of its vertices was baked with. */
interface Target {
  colour: Attribute
  swatch: Uint8Array
  shade: Uint8Array
}

export interface Preview {
  /** Rewrites every vertex colour from a `shadeTable`. */
  recolour(table: Float32Array): void
  /** Meshes that had no `_SWATCH` / `_SHADE` (they keep their baked colour). */
  skipped: number
  dispose(): void
}

/** Grid cell centre for slot `i`, row 0 at the back, centred on the origin. */
export function cellCentre(i: number, count: number): [number, number] {
  const rows = Math.ceil(count / COLUMNS)
  const col = i % COLUMNS
  const row = Math.floor(i / COLUMNS)
  return [(col - (COLUMNS - 1) / 2) * CELL, (row - (rows - 1) / 2) * CELL]
}

/** GLTFLoader keeps custom attributes under their lower-cased glTF names. */
function targetOf(mesh: MeshLike, geometries: Geometry[]): Target | null {
  const own = mesh.geometry.clone()
  geometries.push(own)
  mesh.geometry = own
  const colour = own.getAttribute("color")
  const swatch = own.getAttribute("_swatch")
  const shade = own.getAttribute("_shade")
  if (!colour || !swatch || !shade) return null
  const ids = new Uint8Array(swatch.count)
  const bytes = new Uint8Array(shade.count)
  // _SHADE is normalized, so three reads it as byte / 255.
  for (let i = 0; i < ids.length; i++) ids[i] = Math.round(swatch.getX(i))
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.round(shade.getX(i) * 255)
  return { colour, swatch: ids, shade: bytes }
}

/** A text label under each piece, kept in place every frame. */
function labels(stage: Stage, host: HTMLElement, spots: { text: string; at: [number, number, number] }[]) {
  const nodes = spots.map(({ text }) => {
    const node = document.createElement("div")
    node.className = "gh-pal-label"
    node.textContent = text
    host.append(node)
    return node
  })
  const place = () => {
    for (const [i, node] of nodes.entries()) {
      const xy = toScreen(stage, spots[i]?.at ?? [0, 0, 0])
      node.style.display = xy ? "" : "none"
      if (xy) node.style.transform = `translate(${xy[0]}px, ${xy[1]}px) translate(-50%, -100%)`
    }
  }
  const off = stage.onFrame(place)
  return () => {
    off()
    for (const node of nodes) node.remove()
  }
}

/** Loads the cast onto `stage`, lays it out and frames it; labels go into `labelHost`. */
export async function createPreview(
  stage: Stage,
  entries: readonly CatalogEntry[],
  labelHost: HTMLElement,
): Promise<Preview> {
  const loaded = await Promise.all(entries.map((e) => loadPiece(libraryUrl(e.files.glb))))
  const root = group("palette-preview")
  const geometries: Geometry[] = []
  const targets: Target[] = []
  let skipped = 0
  const spots: { text: string; at: [number, number, number] }[] = []
  for (const [i, piece] of loaded.entries()) {
    const entry = entries[i] as CatalogEntry
    const fit = FIT / Math.max(0.01, ...measure(piece).size)
    piece.scale.setScalar(fit)
    const m = measure(piece)
    const [x, z] = cellCentre(i, loaded.length)
    piece.position.set(x - m.centre[0], -m.minY, z - m.centre[2])
    piece.traverse((node: Piece) => {
      const mesh = node as unknown as MeshLike
      if (!mesh.isMesh) return
      const target = targetOf(mesh, geometries)
      if (target) targets.push(target)
      else skipped++
    })
    root.add(piece)
    spots.push({ text: `${entry.pack} · ${entry.name}`, at: [x, m.size[1] + 0.6, z] })
  }
  stage.scene.add(root)

  const extent = measure(root)
  const half = extent.size.map((s) => s / 2) as [number, number, number]
  const shadows: Disposable = createShadows(stage, {
    min: [extent.centre[0] - half[0] - 1, 0, extent.centre[2] - half[2] - 1],
    max: [extent.centre[0] + half[0] + 1, extent.size[1] + 1, extent.centre[2] + half[2] + 1],
  })
  const { centre, radius } = boundingSphere(root)
  const canvas = stage.renderer.domElement
  const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight)
  stage.setCamera(fitSphere(centre, radius, { fov: stage.camera.fov, aspect, ...VIEW }))
  const unlabel = labels(stage, labelHost, spots)

  const rgb = [0, 0, 0]
  return {
    skipped,
    recolour(table) {
      for (const { colour, swatch, shade } of targets) {
        for (let i = 0; i < swatch.length; i++) {
          vertexColour(table, swatch[i] ?? 0, shade[i] ?? 0, rgb)
          colour.setXYZ(i, rgb[0] ?? 0, rgb[1] ?? 0, rgb[2] ?? 0)
        }
        colour.needsUpdate = true
      }
    },
    dispose() {
      unlabel()
      shadows.dispose()
      root.removeFromParent()
      for (const g of geometries) g.dispose()
    },
  }
}
