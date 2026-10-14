/**
 * A KayKit body's sub-meshes (arms, legs, body, head, hat, cape…) as one skinned geometry: one draw
 * instead of six to nine. Two uses:
 *   - a hero (`mergeBody`): the dressed body's shown parts, re-tinted, bound to its own skeleton;
 *   - the crowd (`crowdGeometry`): every part of a body, un-tinted (the shader tints per person) and
 *     tagged with its part index (`_part`, so a person hides parts by mask), its joints renumbered into
 *     the bake's bone order.
 * Coarser tiers for distance keep the vertices and drop triangles (`simplifyParts`): skin weights stay
 * valid whatever is dropped.
 */
import { MeshoptSimplifier } from "meshoptimizer"
import {
  type Bone,
  BufferAttribute,
  BufferGeometry,
  Matrix4,
  type Mesh,
  type Object3D,
  SkinnedMesh,
  Uint8BufferAttribute,
  Uint16BufferAttribute,
} from "three"

/** `_SHADE` neutral, for a part without palette bytes. */
const SHADE_NEUTRAL = 128

/** The skinned meshes under `root`, in traversal order (the part order `_part` counts in). */
export function skinnedParts(root: Object3D): SkinnedMesh[] {
  const out: SkinnedMesh[] = []
  root.traverse((node) => {
    if ((node as SkinnedMesh).isSkinnedMesh) out.push(node as SkinnedMesh)
  })
  return out
}

/**
 * The rigid meshes riding a bone of the body's skeleton (KayKit's skeletons wear their helmet, hat, hood
 * and cape that way; the adventurers have none), as skinned parts: each bound whole to its bone (weight
 * 1), its vertices in the skinned parts' bind space, so the crowd's bake moves it as the bone moves.
 * Read with the body in its rest pose (as loaded).
 */
export function boneRiders(root: Object3D): SkinnedMesh[] {
  const first = skinnedParts(root)[0]
  if (!first) return []
  const { bones, boneInverses } = first.skeleton
  root.updateMatrixWorld(true)
  const out: SkinnedMesh[] = []
  const toBind = new Matrix4()
  root.traverse((node) => {
    const mesh = node as Mesh
    if (!mesh.isMesh || (mesh as SkinnedMesh).isSkinnedMesh) return
    let up: Object3D | null = mesh.parent
    while (up && !bones.includes(up as Bone)) up = up.parent
    const k = up ? bones.indexOf(up as Bone) : -1
    const inverse = boneInverses[k]
    if (!up || k < 0 || !inverse) return
    // posed by the bake as (bone now) · boneInverse · bindMatrix · v: from the mesh's own space, at rest,
    // v = bindMatrix⁻¹ · boneInverse⁻¹ · (bone at rest)⁻¹ · (mesh at rest)
    toBind
      .copy(first.bindMatrix)
      .invert()
      .multiply(inverse.clone().invert())
      .multiply(up.matrixWorld.clone().invert())
      .multiply(mesh.matrixWorld)
    const g = mesh.geometry.clone()
    g.applyMatrix4(toBind)
    const n = g.getAttribute("position").count
    const index = new Uint16Array(n * 4)
    const weight = new Float32Array(n * 4)
    for (let v = 0; v < n; v++) {
      index[v * 4] = k
      weight[v * 4] = 1
    }
    g.setAttribute("skinIndex", new Uint16BufferAttribute(index, 4))
    g.setAttribute("skinWeight", new BufferAttribute(weight, 4))
    const rider = new SkinnedMesh(g, mesh.material)
    rider.name = mesh.name
    rider.bind(first.skeleton, first.bindMatrix)
    out.push(rider)
  })
  return out
}

const byte = (value: number, normalized: boolean) =>
  Math.min(255, Math.max(0, Math.round(normalized ? value * 255 : value)))

/**
 * `parts` merged into one indexed geometry in their shared bind space (KayKit parts all sit at the
 * rig's origin with the same bind matrix): float position and normal, byte rgb `color`, `skinIndex`
 * (through `joints` when given: part joint → output joint), `skinWeight`, `_swatch`, `_shade` and
 * `_part` (the part's index in `parts`).
 */
export function mergeParts(parts: readonly SkinnedMesh[], joints?: readonly number[]): BufferGeometry {
  let vertices = 0
  let indices = 0
  for (const part of parts) {
    const count = part.geometry.getAttribute("position").count
    vertices += count
    indices += part.geometry.index?.count ?? count
  }
  const position = new Float32Array(vertices * 3)
  const normal = new Float32Array(vertices * 3)
  const color = new Uint8Array(vertices * 3).fill(255)
  const skinIndex = new Uint16Array(vertices * 4)
  const skinWeight = new Float32Array(vertices * 4)
  const swatch = new Uint8Array(vertices)
  const shade = new Uint8Array(vertices).fill(SHADE_NEUTRAL)
  const partOf = new Uint8Array(vertices)
  const index = new Uint32Array(indices)

  let base = 0
  let at = 0
  for (const [p, part] of parts.entries()) {
    const g = part.geometry
    const pos = g.getAttribute("position")
    const nor = g.getAttribute("normal")
    const col = g.getAttribute("color")
    const si = g.getAttribute("skinIndex")
    const sw = g.getAttribute("skinWeight")
    const sa = g.getAttribute("_swatch")
    const sh = g.getAttribute("_shade")
    for (let v = 0; v < pos.count; v++) {
      const o = base + v
      position[o * 3] = pos.getX(v)
      position[o * 3 + 1] = pos.getY(v)
      position[o * 3 + 2] = pos.getZ(v)
      if (nor) {
        normal[o * 3] = nor.getX(v)
        normal[o * 3 + 1] = nor.getY(v)
        normal[o * 3 + 2] = nor.getZ(v)
      }
      if (col) {
        color[o * 3] = byte(col.getX(v), true)
        color[o * 3 + 1] = byte(col.getY(v), true)
        color[o * 3 + 2] = byte(col.getZ(v), true)
      }
      for (let k = 0; k < 4; k++) {
        const joint = si ? si.getComponent(v, k) : 0
        skinIndex[o * 4 + k] = joints ? (joints[joint] ?? 0) : joint
        skinWeight[o * 4 + k] = sw ? sw.getComponent(v, k) : k === 0 ? 1 : 0
      }
      if (sa) swatch[o] = byte(sa.getX(v), sa.normalized)
      if (sh) shade[o] = byte(sh.getX(v), sh.normalized)
      partOf[o] = p
    }
    const source = g.index
    const count = source?.count ?? pos.count
    for (let i = 0; i < count; i++) index[at + i] = base + (source ? source.getX(i) : i)
    base += pos.count
    at += count
  }

  const merged = new BufferGeometry()
  merged.setAttribute("position", new BufferAttribute(position, 3))
  merged.setAttribute("normal", new BufferAttribute(normal, 3))
  merged.setAttribute("color", new Uint8BufferAttribute(color, 3, true))
  merged.setAttribute("skinIndex", new Uint16BufferAttribute(skinIndex, 4))
  merged.setAttribute("skinWeight", new BufferAttribute(skinWeight, 4))
  merged.setAttribute("_swatch", new Uint8BufferAttribute(swatch, 1))
  merged.setAttribute("_shade", new Uint8BufferAttribute(shade, 1, true))
  merged.setAttribute("_part", new Uint8BufferAttribute(partOf, 1))
  merged.setIndex(new BufferAttribute(index, 1))
  merged.computeBoundingBox()
  merged.computeBoundingSphere()
  return merged
}

/**
 * A dressed character's shown parts merged into one SkinnedMesh on the first part's skeleton (the
 * parts share one), added where the parts were; the parts come out of the graph. Null when there is
 * no shown skinned part. The merged geometry is the caller's to dispose.
 */
export function mergeBody(root: Object3D): SkinnedMesh | null {
  const all = skinnedParts(root)
  const shown = all.filter((part) => part.visible)
  const first = shown[0]
  if (!first) return null
  const mesh = first.clone() as SkinnedMesh
  mesh.geometry = mergeParts(shown)
  mesh.name = "body"
  mesh.bind(first.skeleton, first.bindMatrix)
  first.parent?.add(mesh)
  for (const part of all) part.removeFromParent()
  return mesh
}

/** How far a coarser tier may go: at most `ratio` of the triangles, within `error` (share of size). */
export interface PartsTier {
  ratio: number
  error: number
}

/**
 * `geometry` (from `mergeParts`) with fewer triangles over the same vertices: borders between two
 * swatches or two parts never move, so outfits keep their outlines. The simplifier must be ready.
 */
export function simplifyParts(geometry: BufferGeometry, { ratio, error }: PartsTier): BufferGeometry {
  const position = geometry.getAttribute("position").array as Float32Array
  const normal = geometry.getAttribute("normal").array as Float32Array
  const swatch = geometry.getAttribute("_swatch").array as Uint8Array
  const part = geometry.getAttribute("_part").array as Uint8Array
  const index = Uint32Array.from(geometry.index?.array ?? [])
  const remap = MeshoptSimplifier.generatePositionRemap(position, 3)
  const first = new Int32Array(remap.length).fill(-1)
  const mixed = new Uint8Array(remap.length)
  for (let v = 0; v < remap.length; v++) {
    const key = (part[v] as number) * 256 + (swatch[v] as number)
    const at = remap[v] as number
    if (first[at] === -1) first[at] = key
    else if (first[at] !== key) mixed[at] = 1
  }
  const lock = new Uint8Array(remap.length)
  for (let v = 0; v < remap.length; v++) if (mixed[remap[v] as number]) lock[v] = 2
  const [coarse] = MeshoptSimplifier.simplifyWithAttributes(
    index,
    position,
    3,
    normal,
    3,
    [0.5, 0.5, 0.5],
    lock,
    Math.max(3, Math.floor((index.length * ratio) / 3) * 3),
    error,
    ["Permissive"],
  )
  const out = new BufferGeometry()
  for (const [name, attribute] of Object.entries(geometry.attributes)) out.setAttribute(name, attribute)
  out.setIndex(new BufferAttribute(coarse, 1))
  out.boundingBox = geometry.boundingBox
  out.boundingSphere = geometry.boundingSphere
  return out
}
