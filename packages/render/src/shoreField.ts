/**
 * How far each point of the water is from the land, as a texture the water reads (water.ts `field`):
 * the depth colour, the foam rim and the wave lines rolling in all key off it, as V1's baked shore mask
 * did (legacy/packages/hall/src/scene/nature/shoreBake.ts), but from a plain land test instead of a GPU
 * bake, so it works for any ground the caller can answer "is this land?" for. The distances themselves
 * are three-free (shoreDistance.ts), so a worker can bake the bytes and the main thread only uploads them.
 */
import { ClampToEdgeWrapping, DataTexture, LinearFilter, RedFormat, UnsignedByteType, Vector4 } from "three"
import { type ShoreWindow, shoreBytes } from "./shoreDistance.ts"

export { type ShoreWindow, shoreBytes, shoreDistances } from "./shoreDistance.ts"

export interface ShoreFieldOpts extends ShoreWindow {
  /** Distances are stored up to this, metres (the open sea past it reads as `reach`). */
  reach: number
}

/** A field already baked (`shoreBytes`): its window, reach and res × res bytes. */
export interface ShoreFieldData extends Omit<ShoreFieldOpts, "isLand"> {
  data: Uint8Array
}

export interface ShoreField {
  texture: DataTexture
  /** x0, z0, 1 / size, 1 / size: world xz to field uv. */
  window: Vector4
  reach: number
  dispose(): void
}

/** Baked bytes as the field's linear-filtered R8 texture (0..reach metres). */
export function shoreFieldTexture(baked: ShoreFieldData): ShoreField {
  const texture = new DataTexture(baked.data, baked.res, baked.res, RedFormat, UnsignedByteType)
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  texture.wrapS = ClampToEdgeWrapping
  texture.wrapT = ClampToEdgeWrapping
  texture.unpackAlignment = 1
  texture.needsUpdate = true
  const window = new Vector4(baked.min[0], baked.min[1], 1 / baked.size, 1 / baked.size)
  return { texture, window, reach: baked.reach, dispose: () => texture.dispose() }
}

/** The field baked here and now (`shoreBytes` then `shoreFieldTexture`). */
export function bakeShoreField(opts: ShoreFieldOpts): ShoreField {
  const { min, size, res, reach } = opts
  return shoreFieldTexture({ min, size, res, reach, data: shoreBytes(opts) })
}
