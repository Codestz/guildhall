import { beforeAll, describe, expect, spyOn, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  BoxGeometry,
  Color,
  type InstancedMesh,
  type Material,
  Matrix4,
  MeshStandardMaterial,
  type Object3D,
  PerspectiveCamera,
  Scene,
  Texture,
  Vector3,
} from "three"
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { MeshStandardNodeMaterial, WebGPURenderer, WGSLNodeBuilder } from "three/webgpu"
import { bakeClips } from "../src/scene/crowd/bake.ts"
import { Crowd, type Gear } from "../src/scene/crowd/Crowd.ts"
import { FADE_S, ONCE } from "../src/scene/crowd/cast.ts"
import { GLSL_SHADING, wantsNodes } from "../src/scene/crowd/material.ts"
import { crowdNodeMaterial, NODE_SHADING } from "../src/scene/crowd/materialNodes.ts"

/**
 * The crowd's skinning as node materials (crowd/materialNodes.ts: WebGPU, and WebGL with `?tsl=1`):
 * a crowd made with them, on the real knight and bake, builds into a WGSL vertex shader that reads
 * the same textures and attributes as the GLSL path, lit as the part's own material.
 */

const assets = join(import.meta.dir, "../public/assets")
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)

async function scene(path: string) {
  const bytes = readFileSync(path)
  // The models' palette texture can't decode without a DOM; geometry and skins are all we need.
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

let knight: Object3D
let bake: ReturnType<typeof bakeClips>

beforeAll(async () => {
  const [model, anims] = await Promise.all([
    scene(join(assets, "characters/knight.glb")),
    scene(join(assets, "anims.glb")),
  ])
  knight = model.scene
  bake = bakeClips(knight, anims.animations, 30, { once: ONCE })
})

/**
 * `mesh`'s vertex shader as WebGPU would compile it. No GPU here: a renderer that was never
 * initialised, with the two device facts the builder asks for (a uniform buffer limit; no
 * float32-filterable feature, as on most adapters).
 */
function vertexShader(mesh: InstancedMesh): string {
  const canvas = { getContext: () => null, addEventListener() {}, removeEventListener() {}, style: {} }
  const renderer = new WebGPURenderer({ canvas: canvas as never })
  const device = { limits: { maxUniformBufferBindingSize: 65536 }, features: new Set() }
  Object.assign(renderer.backend, { device })
  Object.assign(renderer, { hasFeature: () => false })
  const builder = new WGSLNodeBuilder(mesh, renderer)
  builder.scene = new Scene()
  builder.camera = new PerspectiveCamera()
  builder.material = mesh.material as Material
  builder.build()
  return builder.vertexShader
}

function meshNamed(crowd: Crowd, name: string): InstancedMesh {
  const mesh = crowd.root.getObjectByName(name) as InstancedMesh | undefined
  if (!mesh) throw new Error(`no mesh ${name}`)
  return mesh
}

const hammer: Gear = {
  geometry: new BoxGeometry(0.1, 0.4, 0.1),
  material: new MeshStandardMaterial({ name: "hammer" }),
  bone: "handslotr",
  matrix: new Matrix4(),
}
const mug: Gear = { ...hammer, material: new MeshStandardMaterial({ name: "mug" }), up: new Vector3(0, 1, 0) }

describe("the crowd as node materials (WebGPU, ?tsl=1)", () => {
  test("GLSL stays the default shading, and only WebGPU (or ?tsl=1) asks for nodes", () => {
    const crowd = new Crowd(bake, { knight }, [], FADE_S)
    crowd.join("knight")
    expect((meshNamed(crowd, "Knight_Body").material as MeshStandardNodeMaterial).isNodeMaterial).toBeFalsy()
    expect(wantsNodes({})).toBe(false)
    expect(wantsNodes({ isWebGPURenderer: true })).toBe(true)
  })

  test("a body's graph builds: member from the stage, four weighted bones from the bake", () => {
    const crowd = new Crowd(bake, { knight }, [], FADE_S, NODE_SHADING)
    crowd.join("knight", "#c0392b")
    crowd.flush()
    const body = meshNamed(crowd, "Knight_Body")
    expect(body.material).toBeInstanceOf(MeshStandardNodeMaterial)
    const wgsl = vertexShader(body)
    for (const input of ["crowdMember", "skinIndex", "skinWeight", "position", "normal"])
      expect(wgsl).toContain(`${input} :`)
    for (const weight of ["x", "y", "z", "w"]) expect(wgsl).toContain(`skinWeight.${weight} > 0.0`)
    // Three stage texels; per bone, its pivot and two texels from each of two rows, twice (two clips).
    expect(wgsl.match(/textureLoad\(/g)?.length).toBe(3 + 4 * (1 + 8))
    // The instance matrices are identity and never read (as on the GLSL path).
    expect(wgsl).not.toContain("instanceIndex ]")
  })

  test("a tinted part takes its member's tint per instance; an untinted one has none", () => {
    const crowd = new Crowd(bake, { knight }, [], FADE_S, NODE_SHADING)
    crowd.join("knight", "#c0392b")
    crowd.flush()
    const meshes = crowd.root.children as InstancedMesh[]
    const tinted = meshes.find((mesh) => mesh.instanceColor)
    const plain = meshes.find((mesh) => !mesh.instanceColor)
    if (!tinted || !plain) throw new Error("the knight has a tinted and an untinted part")
    expect(vertexShader(tinted)).toContain("InstanceColor")
    expect(vertexShader(plain)).not.toContain("InstanceColor")
  })

  test("gear rides its one bone (no joints read); a levelled grip's graph differs from a plain one's", () => {
    const crowd = new Crowd(bake, { knight }, [], FADE_S, NODE_SHADING)
    const id = crowd.join("knight")
    crowd.carry(id, [hammer, mug])
    crowd.flush()
    const plain = meshNamed(crowd, "hammer")
    const level = meshNamed(crowd, "mug")
    const shaders = [vertexShader(plain), vertexShader(level)]
    for (const wgsl of shaders) expect(wgsl).not.toContain("skinIndex")
    expect(shaders[0]).not.toEqual(shaders[1])
    // Same type, same node properties: only the crowd's own key keeps their programs apart.
    const keys = [plain, level].map((mesh) => (mesh.material as Material).customProgramCacheKey())
    expect(keys[0]).not.toEqual(keys[1])
  })

  test("lit as the part's own material: its colour, map, roughness and name carried over", () => {
    const map = new Texture()
    const base = new MeshStandardMaterial({
      color: "#336699",
      map,
      roughness: 0.3,
      metalness: 0.1,
      name: "cape",
    })
    const material = crowdNodeMaterial(base, NODE_SHADING.uniforms(bake))
    expect([
      material.color.getHex(),
      material.map,
      material.roughness,
      material.metalness,
      material.name,
    ]).toEqual([new Color("#336699").getHex(), map, 0.3, 0.1, "cape"])
  })

  test("refuses GLSL uniforms (the two shadings' uniforms don't mix)", () => {
    expect(() => crowdNodeMaterial(new MeshStandardMaterial(), GLSL_SHADING.uniforms(bake))).toThrow(
      /texture node/,
    )
  })
})
