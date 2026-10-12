/**
 * Palette variants as geometry (ADR 008): a re-tinted piece is a clone of its geometry with COLOR_0
 * rebuilt from `_SWATCH`, `_SHADE` and `_AO` through `tintColours`, so the material, batching and
 * shadows stay untouched.
 */
import { PALETTE, tintColours } from "@guildhall/assets"
import { log } from "@guildhall/core"
import {
  type BufferAttribute,
  type BufferGeometry,
  type InterleavedBufferAttribute,
  Mesh,
  type Object3D,
} from "three"

const logger = log("render:tint")

type Attribute = BufferAttribute | InterleavedBufferAttribute

/** Source geometry → map key → its recoloured clone. Keyed by geometry, since piece copies share it. */
const variants = new WeakMap<BufferGeometry, Map<string, BufferGeometry>>()

/**
 * A swatch map's cache key: `from>to` pairs sorted by `from`, identity pairs left out, so equal
 * re-tints give equal keys. "" is the identity.
 */
export function swatchMapKey(map: Record<number, number>): string {
  return Object.keys(map)
    .map(Number)
    .filter((from) => map[from] !== from)
    .sort((a, b) => a - b)
    .map((from) => `${from}>${map[from]}`)
    .join(";")
}

/** A per-vertex byte attribute as bytes; three reads a normalized one as byte / 255. */
function bytes(attribute: Attribute): Uint8Array {
  const out = new Uint8Array(attribute.count)
  const k = attribute.normalized ? 255 : 1
  for (let i = 0; i < out.length; i++) out[i] = Math.round(attribute.getX(i) * k)
  return out
}

/**
 * `geometry` with its vertex colours re-tinted by `swatchMap` (swatch id → swatch id), cached by
 * (geometry, map key): the same piece and map always give the same clone. The identity map gives
 * `geometry` itself, and so does a geometry with no `_swatch` / `_shade` (warned). `_ao` is applied
 * when present; without it (characters) every vertex is unoccluded. The clone keeps every other
 * attribute (skinning included) and COLOR_0's own format. It belongs to the cache: never dispose it.
 */
export function recolour(geometry: BufferGeometry, swatchMap: Record<number, number>): BufferGeometry {
  const key = swatchMapKey(swatchMap)
  if (key === "") return geometry
  let byKey = variants.get(geometry)
  const hit = byKey?.get(key)
  if (hit) return hit

  const colour = geometry.getAttribute("color")
  const swatch = geometry.getAttribute("_swatch")
  const shade = geometry.getAttribute("_shade")
  if (!colour || !swatch || !shade) {
    logger.warn("no palette attributes; not re-tinted", { geometry: geometry.name })
    return geometry
  }
  const ao = geometry.getAttribute("_ao")
  const rgb = tintColours(bytes(swatch), bytes(shade), PALETTE, swatchMap, ao ? bytes(ao) : undefined)

  const variant = geometry.clone()
  const out = variant.getAttribute("color")
  // setXYZ normalizes into a byte attribute and leaves an alpha channel as it was.
  for (let v = 0; v < out.count; v++) out.setXYZ(v, rgb[v * 3] ?? 0, rgb[v * 3 + 1] ?? 0, rgb[v * 3 + 2] ?? 0)
  out.needsUpdate = true

  if (!byKey) {
    byKey = new Map()
    variants.set(geometry, byKey)
  }
  byKey.set(key, variant)
  logger.debug("variant", { geometry: geometry.name, key })
  return variant
}

/** Re-tints every mesh under `root` in place (its geometry swapped for the cached variant). */
export function recolourPiece(root: Object3D, swatchMap: Record<number, number>): Object3D {
  root.traverse((node) => {
    if (node instanceof Mesh) node.geometry = recolour(node.geometry, swatchMap)
  })
  return root
}
