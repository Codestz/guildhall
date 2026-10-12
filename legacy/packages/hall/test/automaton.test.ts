import { describe, expect, spyOn, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { Mesh, MeshStandardMaterial, Object3D, SkinnedMesh } from "three"
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js"
import { type GLTF, GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { construct } from "../src/scene/automaton.ts"
import { bakeClips, boneMap } from "../src/scene/crowd/bake.ts"
import { dyeOf } from "../src/scene/dye.ts"

/**
 * scene/automaton.ts on the real assets: the bots' construct is the graveyard's minion re-cast,
 * on the adventurers' rig (so the baked crowd draws it), without touching the graveyard's copy.
 */
const assets = join(import.meta.dir, "../public/assets")
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)

async function glb(path: string): Promise<GLTF> {
  const bytes = readFileSync(path)
  // The palette texture can't decode without a DOM; geometry, skins and materials are all we need.
  const quiet = spyOn(console, "warn").mockImplementation(() => {})
  try {
    return await loader.parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      "",
    )
  } finally {
    quiet.mockRestore()
  }
}

const meshes = (root: Object3D): Mesh[] => {
  const found: Mesh[] = []
  root.traverse((node) => {
    if ((node as Mesh).isMesh) found.push(node as Mesh)
  })
  return found
}

describe("the Automaton", async () => {
  const minion = await glb(join(assets, "characters/skeleton-minion.glb"))
  const knight = await glb(join(assets, "characters/knight.glb"))
  const anims = await glb(join(assets, "anims.glb"))

  test("its body is the tinted part (the archetype's bronze dyes it), its eyes glow", () => {
    const parts = meshes(construct(minion.scene))
    const body = parts.find((m) => /Body/.test(m.name))
    const eyes = parts.find((m) => /Eyes/.test(m.name))
    if (!body || !eyes) throw new Error("the minion has a body and eyes")
    expect(body.name).toMatch(/Tinted$/)
    expect((body.material as MeshStandardMaterial).metalness).toBeGreaterThan(0.3)
    expect((eyes.material as MeshStandardMaterial).emissiveIntensity).toBeGreaterThan(1)
  })

  test("one construct per loaded scene, and the graveyard's minion is left as it was", () => {
    expect(construct(minion.scene)).toBe(construct(minion.scene))
    for (const mesh of meshes(minion.scene)) expect(mesh.name).not.toMatch(/Tinted/)
  })

  test("every part maps onto the adventurers' bake: it joins the baked crowd", () => {
    const bake = bakeClips(knight.scene, anims.animations.slice(0, 2), 30)
    for (const mesh of meshes(construct(minion.scene)))
      expect({ part: mesh.name, mapped: boneMap(bake, mesh as SkinnedMesh) !== null }).toEqual({
        part: mesh.name,
        mapped: true,
      })
  })
})

describe("a cape's dye by rank", () => {
  test("an apprentice wears the colour as is; a journeyman deeper, a master deeper still", () => {
    expect(dyeOf("#e0702f", "apprentice")).toBe("#e0702f")
    const lum = (hex: string) => [1, 3, 5].reduce((n, i) => n + Number.parseInt(hex.slice(i, i + 2), 16), 0)
    expect(lum(dyeOf("#e0702f", "journeyman"))).toBeLessThan(lum("#e0702f"))
    expect(lum(dyeOf("#e0702f", "master"))).toBeLessThan(lum(dyeOf("#e0702f", "journeyman")))
  })
})
