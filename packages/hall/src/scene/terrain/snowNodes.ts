import type { Material, MeshStandardMaterial } from "three"
import { float, mix, normalWorld, positionWorld, reference, smoothstep, texture, uv, vec2 } from "three/tsl"
import type { Node } from "three/webgpu"
import { SWATCH, swatchV } from "../../world/gen/relief/swatches.ts"
import { cutaway } from "./cutaway.ts"
import { cutOpacity } from "./cutawayNodes.ts"
import { SNOW_EDGE, type Snowline } from "./snow.ts"

/**
 * The snow line (snow.ts) as a node material, for WebGPU (which never runs onBeforeCompile): the
 * land material's palette sampled as it is, then blended to the white swatch above the line, node
 * for node what `SNOW_FRAGMENT` computes. A plain material keeps the field when WebGPU turns it into
 * its node twin, so `colorNode` set on a clone is all the twin needs. Loaded on demand: it pulls in
 * three/tsl. The see-through cut rides along as its opacity under an alpha test (cutawayNodes.ts).
 */

type Float = Node<"float">

/** The blend factor, 0–1: world height over the line, and a face gentle enough to hold snow. */
export function snowAmount(line: Float, height: Float, up: Float): Float {
  return smoothstep(line.sub(SNOW_EDGE), line.add(SNOW_EDGE), height).mul(smoothstep(0.4, 0.66, up))
}

/** snow.ts `snowMaterial` on WebGPU: a copy of `base` whose colour is the palette, whitened over the line. */
export function snowNodeMaterial(base: Material, snowline: Snowline): Material {
  const copy = (base as MeshStandardMaterial).clone() as MeshStandardMaterial & {
    colorNode: unknown
    opacityNode: unknown
  }
  const map = copy.map
  if (!map) return copy
  const up = normalWorld.y as unknown as Float
  const height = positionWorld.y as unknown as Float
  const line = reference("value", "float", snowline) as unknown as Float
  const palette = texture(map, uv())
  const white = texture(
    map,
    vec2(float(SWATCH.snow.u), up.oneMinus().mul(0.12).add(swatchV(SWATCH.snow, 0.15))),
  )
  copy.colorNode = mix(palette.rgb, white.rgb, snowAmount(line, height, up))
  copy.opacityNode = cutOpacity(cutaway)
  copy.alphaTest = 0.5
  const key = base.customProgramCacheKey()
  copy.customProgramCacheKey = () => `${key}|snowline|cut`
  return copy
}
