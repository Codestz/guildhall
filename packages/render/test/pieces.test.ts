import { describe, expect, test } from "bun:test"
import {
  Bone,
  BoxGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
} from "three"
import { paletteMaterial } from "../src/material.ts"
import { pieceCache, preparePiece } from "../src/pieces.ts"

const meshes = (root: Object3D) => {
  const found: Mesh[] = []
  root.traverse((node) => {
    if (node instanceof Mesh) found.push(node)
  })
  return found
}

/** A box carrying COLOR_0, as every imported piece does. */
function colouredBox(): BoxGeometry {
  const geometry = new BoxGeometry(1, 1, 1)
  const n = geometry.getAttribute("position").count
  geometry.setAttribute("color", new Float32BufferAttribute(new Array(n * 3).fill(0.5), 3))
  return geometry
}

/** What GLTFLoader hands back for a library piece: nested nodes, each mesh with its own material(s). */
function fakeGltfScene(): Object3D {
  const root = new Group()
  const wall = new Mesh(colouredBox(), new MeshStandardMaterial({ color: "#ff0000" }))
  const roof = new Mesh(colouredBox(), [new MeshStandardMaterial(), new MeshBasicMaterial()])
  const node = new Group()
  node.add(roof)
  root.add(wall, node)
  return root
}

describe("preparePiece", () => {
  test("swaps every material, arrays included, for the shared palette material", () => {
    const root = preparePiece(fakeGltfScene())
    const all = meshes(root)
    expect(all).toHaveLength(2)
    for (const mesh of all) expect(mesh.material).toBe(paletteMaterial())
  })

  test("frees the materials it replaces", () => {
    const scene = fakeGltfScene()
    let disposed = 0
    for (const mesh of meshes(scene))
      for (const material of [mesh.material].flat()) material.addEventListener("dispose", () => disposed++)
    preparePiece(scene)
    expect(disposed).toBe(3)
  })

  test("every mesh casts and receives shadows", () => {
    for (const mesh of meshes(preparePiece(fakeGltfScene()))) {
      expect(mesh.castShadow).toBe(true)
      expect(mesh.receiveShadow).toBe(true)
    }
  })
})

describe("pieceCache", () => {
  const counting = (make: () => Object3D = fakeGltfScene) => {
    const calls: string[] = []
    const load = pieceCache(async (url) => {
      calls.push(url)
      return make()
    })
    return { load, calls }
  }

  test("loads a url once however many copies are asked for", async () => {
    const { load, calls } = counting()
    await Promise.all([load("/a.glb"), load("/a.glb")])
    await load("/a.glb")
    expect(calls).toEqual(["/a.glb"])
  })

  test("each url loads separately", async () => {
    const { load, calls } = counting()
    await Promise.all([load("/a.glb"), load("/b.glb")])
    expect(calls.sort()).toEqual(["/a.glb", "/b.glb"])
  })

  test("copies are distinct scene graphs sharing one geometry", async () => {
    const { load } = counting()
    const [one, two] = await Promise.all([load("/a.glb"), load("/a.glb")])
    expect(one).not.toBe(two)
    const [a, b] = [meshes(one as Object3D), meshes(two as Object3D)]
    expect(a[0]).not.toBe(b[0])
    expect(a[0]?.geometry).toBe(b[0]?.geometry as BoxGeometry)
  })

  test("moving one copy leaves the others where they were", async () => {
    const { load } = counting()
    const one = await load("/a.glb")
    one.position.x = 5
    expect((await load("/a.glb")).position.x).toBe(0)
  })

  test("a failed load is forgotten, so the next ask retries", async () => {
    let attempts = 0
    const load = pieceCache(async () => {
      attempts++
      if (attempts === 1) throw new Error("offline")
      return fakeGltfScene()
    })
    await expect(load("/a.glb")).rejects.toThrow("offline")
    await expect(load("/a.glb")).resolves.toBeDefined()
    expect(attempts).toBe(2)
  })

  test("a character copy is skinned to its own bones, not the cached template's", async () => {
    const template = () => {
      const geometry = new BoxGeometry(1, 2, 1)
      const n = geometry.getAttribute("position").count
      geometry.setAttribute("skinIndex", new Uint16BufferAttribute(new Array(n * 4).fill(0), 4))
      geometry.setAttribute(
        "skinWeight",
        new Float32BufferAttribute(new Array(n).fill([1, 0, 0, 0]).flat(), 4),
      )
      const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial())
      const bone = new Bone()
      const root = new Group()
      root.add(bone, mesh)
      mesh.bind(new Skeleton([bone]))
      return root
    }
    const { load } = counting(template)
    const [one, two] = await Promise.all([load("/hero.glb"), load("/hero.glb")])
    const skinOf = (root: Object3D) => meshes(root)[0] as SkinnedMesh
    const bone = skinOf(one as Object3D).skeleton.bones[0]
    expect(bone).not.toBe(skinOf(two as Object3D).skeleton.bones[0])
    expect(bone?.parent).toBe(one as Object3D)
  })
})
