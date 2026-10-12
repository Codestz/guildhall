/**
 * Bake the palette (ADR 003): every primitive's colour source → per-vertex COLOR_0 (linear RGB, the
 * swatch with its shade), _SWATCH (palette id, uint8) and _SHADE (uint8 normalized, 128 = the swatch's
 * own lightness). Then every primitive gets the one `palette` material and every other material,
 * texture, image and sampler goes.
 *
 * Per primitive, the source is chosen like this:
 *   untextured                      material: factor × COLOR_0
 *   textured, pack "texture-average" or "keep-texture"   that mode (flags `texture-lost`)
 *   textured, any other pack mode   by how its faces sit on the texture (scan's `colourKind`): faces that
 *                                   span real image area are averaged (`texture-lost`); the rest are
 *                                   corner-sampled (atlas / colormap)
 * so a piece that mixes kinds is handled primitive by primitive. Vertex colours need no mode of their own:
 * COLOR_0 is always part of the base colour.
 *
 * A vertex shared by faces that bake to different swatches is split, one copy per swatch, so swatches
 * never blend across an edge (plan R2); copies of one swatch average their shade. Optimize welds again.
 */
import type { Accessor, Document, Material, Primitive, Texture, TypedArray } from "@gltf-transform/core"
import type { ColourMode, Palette } from "@guildhall/assets"
import { decodePng, isPng, type Raster } from "../png.ts"
import {
  type Bake,
  bakePalette,
  cornerVertices,
  decodeShade,
  encodeShade,
  sampleVertexColours,
  shadedRgb,
} from "../sample.ts"
import { colourKind } from "../scan.ts"
import type { Stage } from "./types.ts"

/** The name of the one vertex-colour material every baked primitive shares. */
export const PALETTE_MATERIAL = "palette"

/** How this primitive's colour is read, given the pack's mode (see the header). */
export function sourceMode(prim: Primitive, mode: ColourMode): ColourMode {
  const info = prim.getMaterial()?.getBaseColorTextureInfo()
  const textured = !!prim.getMaterial()?.getBaseColorTexture() && !!info
  if (!textured || !prim.getAttribute(`TEXCOORD_${info?.getTexCoord() ?? 0}`)) return "material"
  if (mode === "texture-average" || mode === "keep-texture") return mode
  // colourKind reports any COLOR_0 as "vertex"; classify the texture use on a throwaway copy without it.
  const probe = prim.clone().setAttribute("COLOR_0", null)
  const kind = colourKind(probe)
  probe.dispose()
  return kind === "texture" ? "texture-average" : "atlas"
}

function paletteMaterial(doc: Document): Material {
  const existing = doc
    .getRoot()
    .listMaterials()
    .find((m) => m.getName() === PALETTE_MATERIAL)
  return (
    existing ??
    doc
      .createMaterial(PALETTE_MATERIAL)
      .setBaseColorFactor([1, 1, 1, 1])
      .setMetallicFactor(0)
      .setRoughnessFactor(1)
  )
}

/** A copy of `acc` holding the elements `source` lists, in that order. */
function gather(doc: Document, acc: Accessor, source: Uint32Array): Accessor {
  const size = acc.getElementSize()
  const from = acc.getArray()
  if (!from) throw new Error(`accessor "${acc.getName()}" has no data`)
  const out = new (from.constructor as new (n: number) => TypedArray)(source.length * size)
  for (let n = 0; n < source.length; n++)
    for (let k = 0; k < size; k++) out[n * size + k] = from[(source[n] ?? 0) * size + k] ?? 0
  return doc
    .createAccessor(acc.getName())
    .setType(acc.getType())
    .setArray(out)
    .setNormalized(acc.getNormalized())
    .setBuffer(acc.getBuffer())
}

/**
 * Writes a bake (one entry per corner, `cornerVertices` order) onto the primitive: vertices are split
 * per (vertex, swatch), every attribute and morph target is re-gathered, and COLOR_0 / _SWATCH / _SHADE
 * are set. `dropUv` removes TEXCOORD_* and TANGENT (nothing samples a texture any more). Returns the
 * accessors it replaced, for the caller to dispose once nothing uses them.
 */
export function writeBake(
  doc: Document,
  prim: Primitive,
  bake: Bake,
  palette: Palette,
  dropUv: boolean,
): Accessor[] {
  const corners = cornerVertices(prim)
  const slots = new Map<number, number>()
  const source: number[] = []
  const swatch: number[] = []
  const shadeSum: number[] = []
  const count: number[] = []
  const indices = new Uint32Array(corners.length)
  for (let i = 0; i < corners.length; i++) {
    const id = bake.swatch[i] ?? 0
    const key = (corners[i] ?? 0) * 256 + id
    let slot = slots.get(key)
    if (slot === undefined) {
      slot = source.length
      slots.set(key, slot)
      source.push(corners[i] ?? 0)
      swatch.push(id)
      shadeSum.push(0)
      count.push(0)
    }
    shadeSum[slot] = (shadeSum[slot] ?? 0) + decodeShade(bake.shade[i] ?? 0)
    count[slot] = (count[slot] ?? 0) + 1
    indices[i] = slot
  }
  const verts = source.length
  const rgb = new Float32Array(verts * 3)
  const shade = new Uint8Array(verts)
  for (let n = 0; n < verts; n++) {
    shade[n] = encodeShade((shadeSum[n] ?? 0) / (count[n] ?? 1))
    const s = palette.swatches[swatch[n] ?? 0]
    if (s) rgb.set(shadedRgb(s, decodeShade(shade[n] ?? 0)), n * 3)
  }

  const order = Uint32Array.from(source)
  const replaced: Accessor[] = []
  const dropped = (semantic: string): boolean =>
    semantic === "COLOR_0" || (dropUv && (semantic.startsWith("TEXCOORD_") || semantic === "TANGENT"))
  for (const target of [prim, ...prim.listTargets()])
    for (const semantic of target.listSemantics()) {
      const acc = target.getAttribute(semantic) as Accessor
      replaced.push(acc)
      target.setAttribute(semantic, dropped(semantic) ? null : gather(doc, acc, order))
    }
  const old = prim.getIndices()
  if (old) replaced.push(old)

  const buffer = prim.getAttribute("POSITION")?.getBuffer() ?? doc.getRoot().listBuffers()[0] ?? null
  const make = () => doc.createAccessor().setBuffer(buffer)
  prim
    .setIndices(
      make()
        .setType("SCALAR")
        .setArray(verts <= 65535 ? Uint16Array.from(indices) : indices),
    )
    .setAttribute("COLOR_0", make().setType("VEC3").setArray(rgb))
    .setAttribute("_SWATCH", make().setType("SCALAR").setArray(Uint8Array.from(swatch)))
    .setAttribute("_SHADE", make().setType("SCALAR").setArray(shade).setNormalized(true))
  return replaced
}

/** The decoded base-colour image, or null when it is not a PNG (or missing). */
function decode(texture: Texture, cache: Map<Texture, Raster | null>): Raster | null {
  if (!cache.has(texture)) {
    const bytes = texture.getImage()
    cache.set(texture, bytes && isPng(bytes) ? decodePng(bytes) : null)
  }
  return cache.get(texture) ?? null
}

export const colour: Stage = async (doc, ctx) => {
  const root = doc.getRoot()
  const material = paletteMaterial(doc)
  const kept = new Set<Material>([material])
  const images = new Map<Texture, Raster | null>()
  const replaced = new Set<Accessor>()
  const missed = new Set<string>()
  let misses = 0
  let doubleSided = false
  for (const mesh of root.listMeshes())
    for (const prim of mesh.listPrimitives()) {
      if (!prim.getAttribute("POSITION")) continue
      const source = prim.getMaterial()
      let mode = sourceMode(prim, ctx.pack.colour.mode)
      let image: Raster | undefined
      if (mode !== "material") {
        const texture = source?.getBaseColorTexture()
        image = (texture && decode(texture, images)) || undefined
        if (!image) {
          ctx.log.warn(
            `texture "${texture?.getName() ?? "?"}" (${texture?.getMimeType() ?? "?"}) is not a PNG; using the material colour`,
          )
          ctx.out.flags.add("texture-lost")
          mode = "material"
        }
      }
      if (mode === "texture-average" || mode === "keep-texture") ctx.out.flags.add("texture-lost")
      const bake = bakePalette(sampleVertexColours(prim, mode, image), ctx.palette, ctx.pack.colour.map)
      const keep = mode === "keep-texture"
      for (const acc of writeBake(doc, prim, bake, ctx.palette, !keep)) replaced.add(acc)
      for (const id of bake.swatch) ctx.out.swatches.add(id)
      misses += bake.misses
      for (const hex of bake.missed) missed.add(hex)
      if (keep && source) kept.add(source)
      else {
        doubleSided ||= source?.getDoubleSided() ?? false
        prim.setMaterial(material)
      }
    }
  material.setDoubleSided(doubleSided || material.getDoubleSided())

  const used = (p: Accessor | Texture | Material): boolean => p.listParents().some((x) => x !== root)
  for (const m of root.listMaterials()) if (!kept.has(m)) m.dispose()
  for (const t of root.listTextures()) if (!used(t)) t.dispose()
  for (const a of replaced) if (!used(a)) a.dispose()

  if (misses > 0) {
    ctx.out.flags.add("colour-miss")
    ctx.log.warn(`${misses} corner(s) bake far from their source colour; pin them with colour.map`, {
      hexes: [...missed],
    })
  }
  ctx.log.debug("palette baked", { swatches: [...ctx.out.swatches].sort((a, b) => a - b) })
}
