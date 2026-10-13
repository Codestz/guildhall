/**
 * Shader programs linked before their first draw (perf2-contract §2). Three builds a program the first
 * time an object is drawn and, in that same frame, waits for the link (`getUniforms`): on ANGLE over
 * Metal that is 60–400 ms for the palette shaders (measured: the batch 25 ms, the crowd's heroes
 * 180–385 ms, the water 65 ms), and any sync GL call that follows (a `bufferData`, a `getExtension`)
 * blocks on the GPU process until the links behind it are done. With KHR_parallel_shader_compile the
 * link runs on the GPU process's own threads and its completion can be polled without blocking, so
 * `warmPrograms` compiles an object's materials ahead and resolves when every program is ready; the
 * object is shown afterwards and its first draw costs nothing more than any other.
 *
 *   mesh.visible = false; scene.add(mesh)
 *   await warmPrograms(stage, mesh)                 the mesh's own material
 *   await warmPrograms(stage, mesh, [other])        another material the same object will draw with
 *   mesh.visible = true
 *
 * The shadow pass draws a caster with three's own depth material, a variant per object kind (batched,
 * instanced, skinned) and per side: `depthMaterialFor` makes one with the same program key, so a
 * caster warms its shadow program too. Where the extension is missing three reports every program
 * ready at once and the link waits stay where they were.
 */
import {
  BackSide,
  DoubleSide,
  FrontSide,
  type Material,
  MeshDepthMaterial,
  type Object3D,
  WebGLRenderTarget,
} from "three"
import type { Stage } from "./stage.ts"

/** How often a pending link is asked whether it is done, ms. */
const POLL_MS = 10
/** A link not done after this is drawn anyway (the wait then lands in that frame, as before). */
const GIVE_UP_MS = 4000

/** A linked (or linking) program as three keeps it per material; `isReady` polls KHR_parallel_shader_compile. */
interface Program {
  isReady(): boolean
}
type Props = { programs?: Map<string, Program> }

/** The side the shadow pass draws a caster of `material` with (three's `shadowSide` table). */
const shadowSide = (material: Material) =>
  material.shadowSide ??
  { [FrontSide]: BackSide, [BackSide]: FrontSide, [DoubleSide]: DoubleSide }[material.side]

/** A target that is not the canvas, for keying the shadow pass's programs when the scene draws to the canvas. */
let shadowLike: WebGLRenderTarget | null = null
const offscreen = () => {
  shadowLike ??= new WebGLRenderTarget(1, 1)
  return shadowLike
}

/** The depth material three's shadow pass will use for a caster drawn with `material`, for warming. */
export function depthMaterialFor(material: Material): MeshDepthMaterial {
  return new MeshDepthMaterial({ side: shadowSide(material) ?? BackSide })
}

/**
 * Compiles `object` (every mesh under it) with each of `materials` in turn (default: the meshes' own)
 * against the stage's scene and lights, and resolves once their programs are linked. The object keeps
 * its own materials; it need not be visible, nor in the scene.
 */
export async function warmPrograms(
  stage: Pick<Stage, "renderer" | "scene" | "camera"> & Partial<Pick<Stage, "drawTarget">>,
  object: Object3D,
  materials?: readonly Material[],
): Promise<void> {
  const { renderer, scene, camera } = stage
  // a bare renderer (the tests' stand-ins) has nothing to link
  if (typeof renderer.compile !== "function" || !renderer.properties) return
  const programs = new Set<Program>()
  const collect = (material: Material) => {
    const held = (renderer.properties.get(material) as Props).programs
    if (held) for (const p of held.values()) programs.add(p)
  }
  // A program's key takes in the render target it draws into (its colour space, its tone mapping), so
  // the compile binds the one the scene is drawn into: the post pipeline's target, or the canvas. A
  // depth material draws into a shadow map: any target but the canvas keys it the same.
  const compile = (material?: Material) => {
    const was = renderer.getRenderTarget()
    const into = (material as { isMeshDepthMaterial?: boolean } | undefined)?.isMeshDepthMaterial
      ? (stage.drawTarget ?? offscreen())
      : (stage.drawTarget ?? null)
    renderer.setRenderTarget(into)
    try {
      renderer.compile(object, camera, scene)
    } finally {
      renderer.setRenderTarget(was)
    }
  }
  if (!materials) {
    compile()
    object.traverse((node) => {
      const m = (node as { material?: Material | Material[] }).material
      if (!m) return
      for (const material of Array.isArray(m) ? m : [m]) collect(material)
    })
  } else {
    type WithMaterial = Object3D & { material?: Material | Material[] }
    const meshes: WithMaterial[] = []
    object.traverse((node) => {
      if ((node as WithMaterial).material) meshes.push(node as WithMaterial)
    })
    for (const material of materials) {
      const own = meshes.map((m) => m.material)
      for (const m of meshes) m.material = material
      try {
        compile(material)
      } finally {
        meshes.forEach((m, i) => {
          m.material = own[i]
        })
      }
      collect(material)
    }
  }
  const start = performance.now()
  while (performance.now() - start < GIVE_UP_MS) {
    for (const p of programs) if (p.isReady()) programs.delete(p)
    if (programs.size === 0) return
    await new Promise<void>((done) => setTimeout(done, POLL_MS))
  }
}
