/**
 * Every source colour the importer's colour stage would sample, weighted by the surface that wears it.
 *
 * The colour stage's own pieces do the reading (`sourceMode`, `sampleVertexColours`, the PNG decoder),
 * so a colour here is exactly the corner colour `bakePalette` would see, rounded to its sRGB hex the
 * same way. Each triangle gives a third of its world-space area (m², after the pack's scale factor) to
 * each of its three corners' colours.
 */
import type { Document, Primitive, Texture } from "@gltf-transform/core"
import { linearToSrgb, type PackConfig } from "@guildhall/assets"
import { discover } from "@guildhall/import/src/discover.ts"
import { decodePng, isPng, type Raster } from "@guildhall/import/src/png.ts"
import { defaultScene, readModel } from "@guildhall/import/src/read.ts"
import { cornerVertices, sampleVertexColours } from "@guildhall/import/src/sample.ts"
import { sourceMode } from "@guildhall/import/src/stages/colour.ts"

/** Source hex ("#rrggbb") → area in m². */
export type Colours = Map<string, number>

const TRIANGLES = 4

const toByte = (linear: number): number => Math.round(linearToSrgb(Math.min(1, Math.max(0, linear))) * 255)

/** Linear RGB → the "#rrggbb" key `bakePalette` rounds a source colour to. */
export function hexOf(r: number, g: number, b: number): string {
  const key = (toByte(r) << 16) | (toByte(g) << 8) | toByte(b)
  return `#${key.toString(16).padStart(6, "0")}`
}

/** Area of the triangle p q r (flat xyz triples). */
function triangleArea(p: number[], q: number[], r: number[]): number {
  const u = [(q[0] ?? 0) - (p[0] ?? 0), (q[1] ?? 0) - (p[1] ?? 0), (q[2] ?? 0) - (p[2] ?? 0)]
  const v = [(r[0] ?? 0) - (p[0] ?? 0), (r[1] ?? 0) - (p[1] ?? 0), (r[2] ?? 0) - (p[2] ?? 0)]
  const x = (u[1] ?? 0) * (v[2] ?? 0) - (u[2] ?? 0) * (v[1] ?? 0)
  const y = (u[2] ?? 0) * (v[0] ?? 0) - (u[0] ?? 0) * (v[2] ?? 0)
  const z = (u[0] ?? 0) * (v[1] ?? 0) - (u[1] ?? 0) * (v[0] ?? 0)
  return Math.sqrt(x * x + y * y + z * z) / 2
}

/** `m` (column-major 4×4) applied to the point `p`, times `scale`. */
function transform(m: readonly number[], p: readonly number[], scale: number): number[] {
  const [x = 0, y = 0, z = 0] = p
  return [0, 1, 2].map(
    (i) => ((m[i] ?? 0) * x + (m[i + 4] ?? 0) * y + (m[i + 8] ?? 0) * z + (m[i + 12] ?? 0)) * scale,
  )
}

/**
 * Adds one primitive's corner colours to `into`, each weighted by a third of its triangle's area.
 * `world` places the primitive (its node's world matrix), `scale` is the pack factor. Points and lines
 * have no area and add nothing.
 */
export function addPrimitive(
  prim: Primitive,
  mode: Parameters<typeof sampleVertexColours>[1],
  image: Raster | undefined,
  world: readonly number[],
  scale: number,
  into: Colours,
): void {
  const position = prim.getAttribute("POSITION")
  if (!position || prim.getMode() !== TRIANGLES) return
  const corners = cornerVertices(prim)
  const rgb = sampleVertexColours(prim, mode, image)
  const at = (corner: number): number[] =>
    transform(world, position.getElement(corners[corner] ?? 0, [0, 0, 0]), scale)
  for (let t = 0; t + 2 < corners.length; t += 3) {
    const third = triangleArea(at(t), at(t + 1), at(t + 2)) / 3
    if (third === 0) continue
    for (let c = t; c < t + 3; c++) {
      const hex = hexOf(rgb[c * 3] ?? 0, rgb[c * 3 + 1] ?? 0, rgb[c * 3 + 2] ?? 0)
      into.set(hex, (into.get(hex) ?? 0) + third)
    }
  }
}

/** One document's colours, as the colour stage would sample them under `pack`'s colour mode. */
export function documentColours(doc: Document, pack: PackConfig, into: Colours = new Map()): Colours {
  const images = new Map<Texture, Raster | undefined>()
  const decode = (texture: Texture): Raster | undefined => {
    if (!images.has(texture)) {
      const bytes = texture.getImage()
      images.set(texture, bytes && isPng(bytes) ? decodePng(bytes) : undefined)
    }
    return images.get(texture)
  }
  const factor = "factor" in pack.scale ? pack.scale.factor : 1
  defaultScene(doc)?.traverse((node) => {
    const mesh = node.getMesh()
    if (!mesh) return
    const world = node.getWorldMatrix()
    for (const prim of mesh.listPrimitives()) {
      let mode = sourceMode(prim, pack.colour.mode)
      const texture = prim.getMaterial()?.getBaseColorTexture()
      const image = mode !== "material" && texture ? decode(texture) : undefined
      // The colour stage falls back to the material colour when the texture is not a PNG.
      if (mode !== "material" && !image) mode = "material"
      addPrimitive(prim, mode, image, world, factor, into)
    }
  })
  return into
}

/** Every piece the importer would take from `pack`, read from `raw` and summed into one map. */
export async function packColours(pack: PackConfig, raw: string): Promise<Colours> {
  const colours: Colours = new Map()
  for (const piece of discover(pack, raw)) {
    const doc = await readModel(piece.file)
    documentColours(doc, pack, colours)
  }
  return colours
}
