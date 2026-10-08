import {
  DataTexture,
  FloatType,
  type InstancedMesh,
  type Material,
  type MeshStandardMaterial,
  RGBAFormat,
  type Texture,
  type Vector3,
} from "three"
import {
  attribute,
  cos,
  cross,
  dot,
  Fn,
  If,
  instanceColor,
  instancedBufferAttribute,
  int,
  ivec2,
  mix,
  normalize,
  normalLocal,
  positionLocal,
  select,
  sin,
  texture,
  vec3,
  vec4,
} from "three/tsl"
import { MeshStandardNodeMaterial, type Node, type NodeBuilder, type TextureNode } from "three/webgpu"
import type { BoneBake } from "./bake.ts"
import type { CrowdShading, CrowdUniforms } from "./material.ts"
import { STAGE_ROW, TEXELS_PER_MEMBER } from "./material.ts"

/**
 * The crowd's skinning as a TSL node material (WebGPU, always; WebGL with `?tsl=1`): material.ts's
 * GLSL, function for function — the same stage and bake textures, the same nlerp of two rows and two
 * clips, the same levelled grips, the same yaw and place — on a MeshStandardNodeMaterial copied from
 * the part's own material (its map, colour, roughness; instance tints are the node material's own).
 *
 * Like three's own skinning node it moves `positionLocal` and `normalLocal` in place, so lights,
 * fog and tints follow; the instance matrices (identity, as on the GLSL path) are left unread.
 * Loaded on demand: it pulls in three/webgpu.
 */

type Vec4 = Node<"vec4">
type Vec3 = Node<"vec3">
type Int = Node<"int">
type Float = Node<"float">

/** A bone's pose: q turns about its pivot, head.xyz is where the pivot is now, head.w its scale. */
interface Pose {
  q: Vec4
  head: Vec4
}

/** The node path's uniforms: the bake and the stage as texture nodes (their `value` swaps live). */
function nodeUniforms(bake: BoneBake): CrowdUniforms {
  return {
    crowdBones: texels(bake.texture),
    // Set by the crowd as it is made (crowd/Crowd.ts), before anything draws.
    crowdStage: texels(null),
    crowdPivots: { value: bake.pivots.map((pivot) => pivot.clone()) },
  } as unknown as CrowdUniforms
}

function texels(value: Texture | null): TextureNode {
  return value ? texture(value) : texture()
}

/** Texel `at` of `source`, exactly: no uv transform (the stock load multiplies by one per fetch). */
function fetch(source: TextureNode, at: Node<"ivec2">): Vec4 {
  const load = source.load(at) as unknown as { setUpdateMatrix(value: boolean): Vec4 }
  return load.setUpdateMatrix(false)
}

/**
 * The bones' pivots, one texel each: a texture, not a uniform array, because on WebGL the nodes
 * handler gives every material's every uniform buffer a uniform block of its own (32 on ANGLE/Metal,
 * for the whole page), and a crowd has a dozen materials. One per crowd, shared by its materials.
 */
const pivotTextures = new WeakMap<CrowdUniforms, TextureNode>()

function pivotsOf(uniforms: CrowdUniforms): TextureNode {
  let pivots = pivotTextures.get(uniforms)
  if (!pivots) {
    const points = uniforms.crowdPivots.value
    const data = new Float32Array(points.length * 4)
    for (const [i, point] of points.entries()) point.toArray(data, i * 4)
    const map = new DataTexture(data, points.length, 1, RGBAFormat, FloatType)
    map.needsUpdate = true
    pivots = texture(map)
    pivotTextures.set(uniforms, pivots)
  }
  return pivots
}

function textureNode(slot: { value: Texture | null }, name: string): TextureNode {
  const node = slot as unknown as TextureNode
  if (!node.isTextureNode)
    throw new Error(`crowdNodeMaterial: ${name} is not a texture node (GLSL uniforms?)`)
  return node
}

/** v turned by q. */
function turn(q: Vec4, v: Vec3): Vec3 {
  return v.add(cross(q.xyz, cross(q.xyz, v).add(v.mul(q.w))).mul(2)) as Vec3
}

/** nlerp's blend (normalised once, at the end): the short way round, even across two clips. */
function blend(a: Pose, b: Pose, t: Float): Pose {
  const q = select(dot(a.q, b.q).lessThan(0), b.q.negate(), b.q)
  return { q: mix(a.q, q, t) as Vec4, head: mix(a.head, b.head, t) as Vec4 }
}

/** q, then the shortest turn taking the item's `up` (bind frame) to +y. */
function levelled(q: Vec4, up: Vector3): Vec4 {
  const u = normalize(turn(q, vec3(up.x, up.y, up.z))).toVar()
  const raw = vec4(u.z.negate(), 0, u.x, u.y.add(1))
  const l = select(raw.w.lessThan(1e-4), vec4(1, 0, 0, 0), normalize(raw)).toVar()
  return vec4(
    l.w.mul(q.xyz).add(q.w.mul(l.xyz)).add(cross(l.xyz, q.xyz)),
    l.w.mul(q.w).sub(dot(l.xyz, q.xyz)),
  ) as Vec4
}

/**
 * Moves positionLocal and normalLocal in place (the stock `skinning` node's way): a member's
 * bones, blended and weighted, then its yaw and place from the stage.
 */
function skin(uniforms: CrowdUniforms, bone?: number, up?: Vector3) {
  const bones = textureNode(uniforms.crowdBones, "crowdBones")
  const stage = textureNode(uniforms.crowdStage, "crowdStage")
  const pivots = pivotsOf(uniforms)

  return Fn(() => {
    const member = int(attribute<"float">("crowdMember", "float").add(0.5)).toVar()
    const stageAt = (k: number): Vec4 =>
      fetch(stage, ivec2(member.mod(STAGE_ROW).mul(TEXELS_PER_MEMBER).add(k), member.div(STAGE_ROW)))
    const place = stageAt(0).toVar()
    const frames = stageAt(1).toVar()
    const rowNow = int(frames.x.add(0.5)).toVar()
    const rowWas = int(frames.z.add(0.5)).toVar()
    const fadeIn = stageAt(2).x.toVar()

    const read = (row: Int, joint: Int): Pose => ({
      q: fetch(bones, ivec2(joint.mul(2), row)),
      head: fetch(bones, ivec2(joint.mul(2).add(1), row)),
    })

    const pose = (joint: Int): Pose => {
      const now = blend(read(rowNow, joint), read(rowNow.add(1), joint), frames.y)
      const q = now.q.toVar()
      const head = now.head.toVar()
      If(fadeIn.lessThan(1), () => {
        const was = blend(read(rowWas, joint), read(rowWas.add(1), joint), frames.w)
        const mixed = blend(was, { q, head }, fadeIn)
        q.assign(mixed.q)
        head.assign(mixed.head)
      })
      q.assign(normalize(q))
      return { q, head }
    }

    const move = (p: Pose, joint: Int, v: Vec3): Vec3 =>
      p.head.xyz.add(turn(p.q, v.sub(fetch(pivots, ivec2(joint, 0)).xyz)).mul(p.head.w)) as Vec3

    // The geometry's own, read once (not inside the first influence's branch).
    const position = positionLocal.toVar()
    const normal = normalLocal.toVar()
    const moved = vec3(0).toVar()
    const turned = vec3(0).toVar()
    if (bone !== undefined) {
      const joint = int(bone)
      const p = pose(joint)
      if (up) p.q = levelled(p.q, up).toVar()
      moved.assign(move(p, joint, position))
      turned.assign(turn(p.q, normal))
    } else {
      // Typed by the geometry (uint8 joints: uvec4 on WebGPU); only ever converted to int.
      const joints = attribute<"uvec4">("skinIndex")
      const weights = attribute<"vec4">("skinWeight", "vec4")
      for (const c of ["x", "y", "z", "w"] as const) {
        const w = weights[c] as Float
        If(w.greaterThan(0), () => {
          const joint = int(joints[c]).toVar()
          const p = pose(joint)
          moved.addAssign(move(p, joint, position).mul(w))
          turned.addAssign(turn(p.q, normal).mul(w))
        })
      }
    }

    // The member's turn about y (place.w), as Matrix4.makeRotationY, then its place.
    const c = cos(place.w).toVar()
    const s = sin(place.w).toVar()
    const yaw = (v: Vec3): Vec3 => vec3(c.mul(v.x).add(s.mul(v.z)), v.y, c.mul(v.z).sub(s.mul(v.x))) as Vec3
    normalLocal.assign(yaw(turned))
    positionLocal.assign(yaw(moved).add(place.xyz))
  }, "void")
}

/** A MeshStandardNodeMaterial whose vertices the crowd skins before anything else moves them. */
class CrowdNodeMaterial extends MeshStandardNodeMaterial {
  constructor(
    private readonly skinning: () => Node,
    private readonly key: string,
  ) {
    super()
  }

  /**
   * The skinning, then the instance tint — in place of the stock step (morphs, skins, instancing…),
   * none of which a crowd part has but its InstancedMesh's matrices: identity, never read (as on the
   * GLSL path). Read, they cost an inverse per vertex and, on WebGL, a uniform block per mesh (the
   * nodes handler's; ANGLE has 24, and a crowd has a dozen meshes or more).
   */
  override setupPosition(builder: NodeBuilder): Node {
    this.skinning()
    const tints = (builder.object as InstancedMesh).instanceColor
    if (tints) instanceColor.assign(instancedBufferAttribute(tints, "vec3"))
    return positionLocal
  }

  // The skinning is no node property, so the graph's own key can't tell a gear's bone from a body's.
  override customProgramCacheKey(): string {
    return `${super.customProgramCacheKey()}:${this.key}`
  }
}

/** material.ts `crowdMaterial`, as a node material: a copy of `base` skinned by the bake. */
export function crowdNodeMaterial(
  base: Material,
  uniforms: CrowdUniforms,
  bone?: number,
  up?: Vector3,
): MeshStandardNodeMaterial {
  if (!(base as MeshStandardMaterial).isMeshStandardMaterial)
    throw new Error(`crowdNodeMaterial: ${base.type} is not a MeshStandardMaterial`)
  const key = `crowd:${bone ?? "skin"}:${up ? up.toArray().map((v) => v.toFixed(6)) : "-"}`
  const material = new CrowdNodeMaterial(skin(uniforms, bone, up), key)
  material.copy(base)
  return material
}

export const NODE_SHADING: CrowdShading = { uniforms: nodeUniforms, material: crowdNodeMaterial }
