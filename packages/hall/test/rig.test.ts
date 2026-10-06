import { describe, expect, test } from "bun:test"
import {
  Bone,
  BoxGeometry,
  DoubleSide,
  FrontSide,
  Group,
  Matrix4,
  MeshStandardMaterial,
  Skeleton,
  type SkinnedMesh,
  SkinnedMesh as SkinnedMeshClass,
} from "three"
import { singlePass } from "../src/scene/Kit.tsx"
import { cloneRig } from "../src/scene/rig.ts"

/** A character as the glTF loader builds one: parts on the same bones, each with its own Skeleton. */
function character(capeInverse = new Matrix4()): Group {
  const root = new Group()
  const hips = new Bone()
  const head = new Bone()
  hips.add(head)
  root.add(hips)
  const part = (name: string, inverse: Matrix4) => {
    const mesh = new SkinnedMeshClass(new BoxGeometry(), new MeshStandardMaterial())
    mesh.name = name
    mesh.bind(new Skeleton([hips, head], [new Matrix4(), inverse]), new Matrix4())
    root.add(mesh)
  }
  part("Body", new Matrix4())
  part("Cape_Tinted", capeInverse)
  return root
}

function skinned(root: Group): SkinnedMesh[] {
  const found: SkinnedMesh[] = []
  root.traverse((node) => {
    if ((node as SkinnedMesh).isSkinnedMesh) found.push(node as SkinnedMesh)
  })
  return found
}

describe("cloneRig", () => {
  test("parts on the same bones and bind pose share one skeleton (one bone upload a frame)", () => {
    const [body, cape] = skinned(cloneRig(character()) as Group)
    expect(body?.skeleton).toBe(cape?.skeleton as Skeleton)
  })

  test("the shared skeleton drives the copy's own bones, not the source's", () => {
    const source = character()
    const copy = cloneRig(source) as Group
    const [body] = skinned(copy)
    const [sourceBody] = skinned(source)
    expect(body?.skeleton.bones[0]).not.toBe(sourceBody?.skeleton.bones[0] as Bone)
    expect(copy.getObjectById(body?.skeleton.bones[0]?.id ?? -1)).toBeDefined()
  })

  test("a part with a different bind pose keeps its own skeleton", () => {
    const [body, cape] = skinned(cloneRig(character(new Matrix4().makeTranslation(0, 1, 0))) as Group)
    expect(body?.skeleton).not.toBe(cape?.skeleton as Skeleton)
  })
})

describe("singlePass", () => {
  test("a transparent double-sided material draws in one pass; others are left alone", () => {
    const glass = new MeshStandardMaterial({ transparent: true, side: DoubleSide })
    const cloth = new MeshStandardMaterial({ side: DoubleSide })
    const pane = new MeshStandardMaterial({ transparent: true, side: FrontSide })
    singlePass({ glass, cloth, pane })
    expect([glass.forceSinglePass, cloth.forceSinglePass, pane.forceSinglePass]).toEqual([true, false, false])
  })
})
