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
import { log } from "@guildhall/core"
import {
  BackSide,
  DoubleSide,
  FrontSide,
  type Material,
  MeshDepthMaterial,
  type Object3D,
  type Scene,
  WebGLRenderTarget,
} from "three"
import type { Stage } from "./stage.ts"

/** How often a pending link is asked whether it is done, ms. */
const POLL_MS = 10
/** A link not done after this is drawn anyway (the wait then lands in that frame, as before). */
const GIVE_UP_MS = 4000

/**
 * A linked (or linking) program as three keeps it per material; `isReady` polls KHR_parallel_shader_compile,
 * `getUniforms` and `getAttributes` read the linked program's layout (sync GL calls) the first time.
 */
interface Program {
  isReady(): boolean
  getUniforms(): unknown
  getAttributes(): unknown
}
const logger = log("render:warm")
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
  stage: WarmStage,
  object: Object3D,
  materials?: readonly Material[],
  options: WarmOptions = {},
): Promise<void> {
  const { renderer, scene, camera } = stage
  // a bare renderer (the tests' stand-ins) has nothing to link
  if (typeof renderer.compile !== "function" || !renderer.properties) return
  const start = performance.now()
  const programs = new Set<Program>()
  const collect = (material: Material) => {
    const held = (renderer.properties.get(material) as Props).programs
    if (held) for (const p of held.values()) programs.add(p)
  }
  // A program's key takes in the render target it draws into (its colour space, its tone mapping), so
  // the compile binds the one the scene is drawn into: the post pipeline's target, or the canvas (or
  // `options.into`, for a pass that draws into its own target). A depth material draws into a shadow
  // map: any target but the canvas keys it the same. The key also takes in the scene drawn (its fog, its
  // lights): `options.scene` for an object drawn in a scene of its own (the post passes' quad), and the
  // shadow pass draws its depth materials with no scene at all (three passes null: no fog, the lights
  // of the frame), so a depth material compiles with the scene's fog off, or the program made here is
  // one the shadow pass never draws with (measured: every warmed depth program was built twice).
  const compile = (material?: Material) => {
    const was = renderer.getRenderTarget()
    const depth = (material as { isMeshDepthMaterial?: boolean } | undefined)?.isMeshDepthMaterial === true
    const into =
      options.into !== undefined
        ? options.into
        : depth
          ? (stage.drawTarget ?? offscreen())
          : (stage.drawTarget ?? null)
    const target = options.scene ?? scene
    const fog = target.fog
    if (depth) target.fog = null
    renderer.setRenderTarget(into)
    try {
      renderer.compile(object, camera, target)
    } finally {
      renderer.setRenderTarget(was)
      target.fog = fog
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
  const count = programs.size
  let ready = 0
  while (performance.now() - start < GIVE_UP_MS) {
    for (const p of programs) {
      if (!p.isReady()) continue
      // The layout reads (active uniforms and attributes) are sync GL calls that wait for the link to
      // be really done (on ANGLE/Metal `isReady` turns true before the shaders are compiled, 0.3–1.4 s
      // for the big ones): made here, the wait is this task's and the first draw's frame is spared;
      // a stand-in compiled ahead (`prefetch: false`) leaves it to whoever draws the program first.
      if (options.prefetch !== false) {
        p.getUniforms()
        p.getAttributes()
      }
      programs.delete(p)
      ready++
    }
    if (programs.size === 0) break
    await new Promise<void>((done) => setTimeout(done, POLL_MS))
  }
  logger.debug("warmed", {
    object: object.name || object.type,
    programs: count,
    ready,
    ms: Math.round(performance.now() - start),
  })
}

export interface WarmOptions {
  /** The render target the programs will draw into (null: the canvas); default the stage's draw target. */
  into?: WebGLRenderTarget | null
  /** Read the programs' layouts once ready (default), which waits for the real compile; false resolves at `isReady`. */
  prefetch?: boolean
  /** The scene the object is drawn in (its fog and lights key the program); default the stage's. */
  scene?: Scene
}

/** The slice of a Stage the warm-up needs (a bare renderer in the tests). */
export type WarmStage = Pick<Stage, "renderer" | "scene" | "camera"> & Partial<Pick<Stage, "drawTarget">>

/**
 * Links the programs of everything in the scene now (every material, with the scene's lights) against
 * the target the scene is drawn into, in the background, and resolves when they are ready: for what a
 * world adds before its first frame (the sky, the clouds, the lamps), so the first draw links nothing.
 * The caller holds the stage meanwhile (`stage.hold`): a frame drawn before would wait for the links.
 */
export async function warmScene(stage: WarmStage): Promise<void> {
  const { renderer, scene, camera } = stage
  const compile = renderer.compileAsync
  if (typeof compile !== "function") return
  const start = performance.now()
  const was = renderer.getRenderTarget()
  renderer.setRenderTarget(stage.drawTarget ?? null)
  let run: Promise<unknown>
  try {
    run = compile.call(renderer, scene, camera)
  } finally {
    renderer.setRenderTarget(was)
  }
  await run.catch(() => undefined)
  logger.debug("warmed scene", { ms: Math.round(performance.now() - start) })
}
