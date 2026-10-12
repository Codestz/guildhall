import type { Material, Texture } from "three"
import {
  attribute,
  float,
  floor,
  fract,
  instanceColor,
  length,
  materialOpacity,
  positionGeometry,
  positionLocal,
  reference,
  screenCoordinate,
  select,
  vec3,
} from "three/tsl"
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial, type Node, type NodeBuilder } from "three/webgpu"

/**
 * The cast's onBeforeCompile patches as node materials, for WebGPU (which never runs
 * onBeforeCompile): the dissolve's dither (dissolve.ts), the ring under every adventurer
 * (Rings.tsx), the contact shadows (Blobs.tsx) and the deed motes (DeedEffect.tsx). Each draws what
 * its GLSL patch draws; the GLSL stays the default on WebGL. Loaded on demand: it pulls in three/webgpu.
 */

type Float = Node<"float">

/** dissolve.ts `guildBayer2`: a 2×2 Bayer step. */
function bayer2(a: Node<"vec2">): Float {
  const f = floor(a)
  return fract(f.x.div(2).add(f.y.mul(f.y).mul(0.75)))
}

/** dissolve.ts `guildDither`: the 4×4 Bayer threshold in [0, 1) of this pixel. */
export function ditherNode(): Float {
  const p = screenCoordinate.xy as unknown as Node<"vec2">
  return bayer2(p.mul(0.5)).mul(0.25).add(bayer2(p))
}

/**
 * True where a pixel of something `presence` there (0 gone … 1 whole) is drawn: the node twin of
 * dissolve.ts DISCARD_GLSL, for a material's `maskNode` (false discards).
 */
export function presenceKept(presence: Float): Node<"bool"> {
  return presence.greaterThanEqual(1).or(ditherNode().lessThan(presence))
}

/**
 * dissolve.ts `dithered` on WebGPU: a copy of `material` masked by the dither at `amount`. A plain
 * material keeps the field when WebGPU turns it into its node twin (it copies every field).
 */
export function ditheredNode(material: Material, amount: { value: number }): Material {
  const copy = material.clone() as Material & { maskNode: unknown }
  copy.maskNode = presenceKept(reference("value", "float", amount))
  const key = material.customProgramCacheKey()
  copy.customProgramCacheKey = () => `${key}|dissolve`
  return copy
}

/**
 * Rings.tsx's ring: per instance (`aRing`: outer radius, opacity, presence) the outer vertices move
 * out to the ring's radius before the instance places it; its opacity scales and its presence
 * dithers. `mid` tells outer vertices (radius 1) from inner ones.
 */
class RingNodeMaterial extends MeshBasicNodeMaterial {
  constructor(private readonly mid: number) {
    super()
  }

  override setupPosition(builder: NodeBuilder): Node {
    const outer = attribute<"vec3">("aRing", "vec3").x
    const scale = select(length(positionGeometry.xy).greaterThan(this.mid), outer, float(1))
    positionLocal.assign(vec3(positionLocal.xy.mul(scale), positionLocal.z))
    return super.setupPosition(builder)
  }

  override customProgramCacheKey(): string {
    return `${super.customProgramCacheKey()}:cast-ring`
  }
}

export function ringNodeMaterial(mid: number): MeshBasicNodeMaterial {
  const material = new RingNodeMaterial(mid)
  const ring = attribute<"vec3">("aRing", "vec3")
  material.transparent = true
  material.depthWrite = false
  material.opacityNode = materialOpacity.mul(ring.y)
  material.maskNode = presenceKept(ring.z)
  return material
}

/** Blobs.tsx's disc: black, its map's falloff, each disc's opacity in its instance colour's red. */
export function blobNodeMaterial(map: Texture): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({
    color: "#000000",
    map,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  })
  material.opacityNode = materialOpacity.mul(instanceColor.r)
  return material
}

/** DeedEffect.tsx's glow: an emissive mote, its adventurer's presence (`aPresence`) dithering it. */
export function glowNodeMaterial(color: string): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({
    color,
    emissive: color,
    emissiveIntensity: 2.2,
    transparent: true,
    opacity: 0.85,
  })
  material.maskNode = presenceKept(attribute<"float">("aPresence", "float"))
  return material
}
