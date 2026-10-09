import {
  abs,
  cameraProjectionMatrix,
  cameraViewMatrix,
  float,
  floor,
  length,
  mod,
  positionWorld,
  reference,
  screenCoordinate,
  smoothstep,
  uniformArray,
  vec2,
  vec4,
} from "three/tsl"
import type { Node } from "three/webgpu"
import { CUT_DEPTH, CUT_SOFT, type Cutaway, MAX_CUTS } from "./cutaway.ts"

/**
 * The see-through cut (cutaway.ts) as nodes, for WebGPU: node for node what `CUT_FRAGMENT` computes
 * in GLSL. `cutOpacity` is 0 where a fragment is cut and 1 elsewhere; the material draws it as
 * `opacityNode` under an alpha test, which discards. Loaded on demand with snowNodes.ts (three/tsl).
 */

type Float = Node<"float">

/** The 4×4 Bayer threshold at the pixel (cutaway.ts `bayer4`). */
function bayer(pixel: Node<"vec2">): Float {
  const q = mod(floor(pixel), 4)
  const lo = mod(q, 2)
  const hi = floor(q.mul(0.5))
  const low = abs(lo.x.sub(lo.y))
  const high = abs(hi.x.sub(hi.y))
  return low.mul(8).add(lo.y.mul(4)).add(high.mul(2)).add(hi.y).add(0.5).div(16) as unknown as Float
}

/** 0 for a fragment of the relief that hides a figure inside one of the cut's holes (and is dithered out), else 1. */
export function cutOpacity(cut: Cutaway): Float {
  const dots = uniformArray(cut.dots, "vec4")
  const aspect = reference("x", "float", cut.view) as unknown as Float
  const count = reference("y", "float", cut.view) as unknown as Float
  const world = vec4(positionWorld, 1)
  const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(world)
  const ndc = clip.xy.div(clip.w)
  const depth = cameraViewMatrix.mul(world).z.negate()
  const dither = bayer(screenCoordinate.xy as unknown as Node<"vec2">)
  let cutOut = float(0).greaterThan(1)
  for (let i = 0; i < MAX_CUTS; i++) {
    const hole = dots.element(i) as unknown as Node<"vec4">
    const reach = length(ndc.sub(hole.xy).mul(vec2(aspect, 1))).div(hole.z)
    const inside = smoothstep(CUT_SOFT, 1, reach).oneMinus()
    const here = inside
      .greaterThan(dither)
      .and(depth.lessThan(hole.w.sub(CUT_DEPTH)))
      .and(float(i).lessThan(count))
    cutOut = cutOut.or(here)
  }
  return cutOut.select(float(0), float(1)) as unknown as Float
}
