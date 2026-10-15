/**
 * The post pipeline (V1's look: legacy/packages/hall/src/scene/atmosphere/Post.tsx): the scene drawn
 * into a multisampled half-float target with its depth, then a mip-chain bloom and one composite pass to
 * the canvas — ink outlines from the depth, bloom, exposure and Neutral tone mapping, the mood LUT per
 * hour, the hour's grade and a vignette. The stage draws through it once enabled (`stage.setDraw`).
 *
 * Anti-aliasing: SMAA by default, as V1 (three's SMAAPass, luma edges, on the graded picture). 4x MSAA
 * on the half-float scene target (`aa: "msaa"`) measured ~+11 ms GPU at DPR 2 on the hex island (M-series,
 * Metal), the canvas's own MSAA it replaces far less: the same finding that made V1 drop it.
 *
 * The palette material's in-shader grade (atmosphere/air.ts `airGrade`) is held off while the scene
 * is drawn and applied in the composite instead, after tone mapping, where it belongs.
 */
import { log } from "@guildhall/core"
import {
  AddEquation,
  BufferAttribute,
  BufferGeometry,
  Color,
  CustomBlending,
  Data3DTexture,
  DepthTexture,
  HalfFloatType,
  LinearFilter,
  Mesh,
  NoBlending,
  OneFactor,
  OrthographicCamera,
  type PerspectiveCamera,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  type Texture,
  UnsignedByteType,
  UnsignedIntType,
  Vector2,
  WebGLRenderTarget,
} from "three"
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js"
import { AIR } from "../atmosphere/air.ts"
import type { DayLight } from "../light.ts"
import type { Stage } from "../stage.ts"
import { warmPrograms } from "../warm.ts"
import { bakeLut, copyLook, createLook, lookDistance, lookFor, type MoodId } from "./lut.ts"
import {
  COMPOSITE_FRAGMENT,
  DOWN_FRAGMENT,
  FULLSCREEN_VERTEX,
  PREFILTER_FRAGMENT,
  UP_FRAGMENT,
} from "./shaders.ts"

export type { MoodId } from "./lut.ts"
export { bakeLut, gradeColour, lookFor } from "./lut.ts"

/** The pipeline's parts, each switchable (before/after shots). */
export interface PostLook {
  bloom: boolean
  ink: boolean
  lut: boolean
  vignette: boolean
}

export const DEFAULT_POST_LOOK: PostLook = { bloom: true, ink: true, lut: true, vignette: true }

export interface PostOpts {
  /** The hour's light (the sky's `light()`): golden hour and night move the LUT, bloom, ink and vignette. */
  light: () => DayLight
  /** V1's film stock; "keep" (clean storybook) when left out. */
  mood?: MoodId
  /** "smaa" (default): SMAA after the composite; "msaa": 4x MSAA on the scene target; "none". */
  aa?: PostAa
  look?: Partial<PostLook>
}

export type PostAa = "smaa" | "msaa" | "none"

export interface Post {
  setLook(look: Partial<PostLook>): void
  look(): PostLook
  setMood(mood: MoodId): void
  /**
   * Links every pass's program in the background (warm.ts), each against the target it draws into,
   * and resolves when they are ready: the first frame through the pipeline then compiles nothing.
   */
  warm(): Promise<void>
  /**
   * One still through the pipeline, from `camera` into `into` (an 8-bit target of any size, its aspect
   * the camera's): the scene into a half-float target `STILL_SUPERSAMPLE` times as big (kept for the next
   * still until `releaseStill`), the bloom, the composite drawn down into `into`. No SMAA: the composite's
   * downsample is the anti-aliasing. `distance` (metres to what the still looks at) fades the ink as the
   * frame's own does. The canvas and the frame's targets are left as they were.
   */
  still(camera: PerspectiveCamera, into: WebGLRenderTarget, distance: number): void
  /** Frees the stills' scene target. */
  releaseStill(): void
  dispose(): void
}

/** A still's scene is drawn at this many times its size and drawn down by the composite. */
export const STILL_SUPERSAMPLE = 2

/** LUT table size: 16³ RGBA8 = 16 KB, re-baked (~0.3 ms) only when the look has moved. */
const LUT_SIZE = 16
const REBAKE = 0.004
/** Bloom levels below the half-size bright pass. */
const BLOOM_LEVELS = 5
/** V1's levels (sky.ts): bloom 0.55 by day to 1.1 by night, over a threshold of 1 (linear HDR). */
const BLOOM_DAY = 0.55
const BLOOM_NIGHT = 0.55
const BLOOM_THRESHOLD = 1
/** V1's vignette: offset 0.3, darkness 0.3 by day, + 0.15 at night. */
const VIGNETTE_OFFSET = 0.3
const VIGNETTE_DAY = 0.3
const VIGNETTE_NIGHT = 0.15
/** V1's ink: 0.8 by day, a third lighter at night, ~1.5 CSS px wide. */
const INK_DAY = 0.8
const INK_NIGHT = 0.35
const INK_TOLERANCE = 0.28

const logger = log("render:post")

function fullscreen(): Mesh<BufferGeometry, ShaderMaterial> {
  const geometry = new BufferGeometry()
  // One triangle over the whole screen.
  geometry.setAttribute("position", new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3))
  const mesh = new Mesh(geometry, new ShaderMaterial())
  mesh.frustumCulled = false
  return mesh
}

const pass = (fragmentShader: string, uniforms: Record<string, { value: unknown }>) =>
  new ShaderMaterial({
    vertexShader: FULLSCREEN_VERTEX,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
    blending: NoBlending,
    toneMapped: false,
  })

const target = (samples = 0, depth = false) => {
  const t = new WebGLRenderTarget(1, 1, {
    type: HalfFloatType,
    format: RGBAFormat,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    depthBuffer: depth,
    samples,
  })
  if (depth) {
    t.depthTexture = new DepthTexture(1, 1, UnsignedIntType)
  }
  return t
}

/** Turns the stage's draw into the post pipeline; `dispose` puts the plain draw back. */
export function createPost(stage: Stage, opts: PostOpts): Post {
  const { renderer, scene, camera } = stage
  const aa: PostAa = opts.aa ?? "smaa"
  const samples = aa === "msaa" ? 4 : 0
  let look: PostLook = { ...DEFAULT_POST_LOOK, ...opts.look }
  let mood: MoodId = opts.mood ?? "keep"

  const sceneTarget = target(samples, true)
  // SMAA reads the finished, display-encoded picture: the composite draws into this, SMAA to the canvas.
  const smaa = aa === "smaa" ? new SMAAPass() : null
  if (smaa) {
    smaa.renderToScreen = true
    smaa.clear = true
  }
  const finished = smaa ? new WebGLRenderTarget(1, 1, { type: UnsignedByteType, depthBuffer: false }) : null
  const levels = Array.from({ length: BLOOM_LEVELS + 1 }, () => target())
  const quad = fullscreen()
  const quadScene = new Scene()
  quadScene.add(quad)
  const quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)

  const prefilterU = {
    tInput: { value: null as Texture | null },
    texel: { value: new Vector2() },
    threshold: { value: BLOOM_THRESHOLD },
    knee: { value: 0.25 },
  }
  const downU = { tInput: { value: null as Texture | null }, texel: { value: new Vector2() } }
  const upU = {
    tInput: { value: null as Texture | null },
    texel: { value: new Vector2() },
    radius: { value: 0.85 },
  }
  const prefilter = pass(PREFILTER_FRAGMENT, prefilterU)
  const down = pass(DOWN_FRAGMENT, downU)
  const up = pass(UP_FRAGMENT, upU)
  up.blending = CustomBlending
  up.blendEquation = AddEquation
  up.blendSrc = OneFactor
  up.blendDst = OneFactor

  const lutData = new Uint8Array(LUT_SIZE ** 3 * 4)
  const lutTexture = new Data3DTexture(new Uint8Array(LUT_SIZE ** 3 * 4), LUT_SIZE, LUT_SIZE, LUT_SIZE)
  lutTexture.format = RGBAFormat
  lutTexture.minFilter = LinearFilter
  lutTexture.magFilter = LinearFilter
  lutTexture.unpackAlignment = 1
  const wanted = createLook()
  const baked = createLook()
  let first = true

  const u = {
    tScene: { value: sceneTarget.texture },
    tDepth: { value: sceneTarget.depthTexture },
    tBloom: { value: (levels[0] as WebGLRenderTarget).texture },
    tLut: { value: lutTexture },
    texel: { value: new Vector2() },
    cameraNear: { value: camera.near },
    cameraFar: { value: camera.far },
    exposure: { value: 1 },
    bloom: { value: BLOOM_DAY },
    inkStrength: { value: INK_DAY },
    inkWidth: { value: 1.5 },
    inkTolerance: { value: INK_TOLERANCE },
    inkTint: { value: new Color() },
    inkFade: { value: new Vector2(50, 140) },
    lut: { value: 1 },
    lutScale: { value: (LUT_SIZE - 1) / LUT_SIZE },
    lutOffset: { value: 0.5 / LUT_SIZE },
    vignette: { value: VIGNETTE_DAY },
    vignetteOffset: { value: VIGNETTE_OFFSET },
    time: { value: 0 },
  }
  const composite = pass(COMPOSITE_FRAGMENT, { ...AIR, ...u })

  const size = new Vector2()
  const resize = () => {
    renderer.getDrawingBufferSize(size)
    const w = Math.max(1, size.x)
    const h = Math.max(1, size.y)
    if (sceneTarget.width === w && sceneTarget.height === h) return
    sceneTarget.setSize(w, h)
    finished?.setSize(w, h)
    smaa?.setSize(w, h)
    let lw = w
    let lh = h
    for (const level of levels) {
      lw = Math.max(1, Math.floor(lw / 2))
      lh = Math.max(1, Math.floor(lh / 2))
      level.setSize(lw, lh)
    }
    u.texel.value.set(1 / w, 1 / h)
    logger.debug("resize", { w, h })
  }

  const run = (material: ShaderMaterial, to: WebGLRenderTarget | null, clear = true) => {
    quad.material = material
    renderer.setRenderTarget(to)
    if (clear) renderer.clear(true, false, false)
    renderer.render(quadScene, quadCamera)
  }

  const drawBloom = (input: WebGLRenderTarget = sceneTarget) => {
    const first = levels[0] as WebGLRenderTarget
    prefilterU.tInput.value = input.texture
    prefilterU.texel.value.set(1 / input.width, 1 / input.height)
    run(prefilter, first)
    for (let i = 1; i < levels.length; i++) {
      const from = levels[i - 1] as WebGLRenderTarget
      downU.tInput.value = from.texture
      downU.texel.value.set(1 / from.width, 1 / from.height)
      run(down, levels[i] as WebGLRenderTarget)
    }
    for (let i = levels.length - 1; i > 0; i--) {
      const from = levels[i] as WebGLRenderTarget
      upU.tInput.value = from.texture
      upU.texel.value.set(1 / from.width, 1 / from.height)
      run(up, levels[i - 1] as WebGLRenderTarget, false)
    }
  }

  const updateLevels = () => {
    const light = opts.light()
    const night = light.night
    // The LUT: the mood's day stock with golden hour and night added (V1 MoodLut.ts).
    lookFor(wanted, mood, { golden: light.golden, night, storm: 0 })
    if (first || lookDistance(wanted, baked) >= REBAKE) {
      first = false
      copyLook(baked, wanted)
      bakeLut(baked, LUT_SIZE, lutData)
      ;(lutTexture.image as { data: Uint8Array }).data.set(lutData)
      lutTexture.needsUpdate = true
    }
    u.exposure.value = renderer.toneMappingExposure
    // Bloom's mip chain sums every level onto the first: normalised by their count.
    u.bloom.value = look.bloom ? ((BLOOM_DAY + BLOOM_NIGHT * night) * 2) / levels.length : 0
    u.inkStrength.value = look.ink ? INK_DAY * (1 - night * INK_NIGHT) : 0
    u.inkWidth.value = Math.max(1, 1.5 * renderer.getPixelRatio())
    // V1's ink tint: the grade's shadow tone, a third as bright.
    u.inkTint.value.copy(AIR.uGradeShadows.value).multiplyScalar(0.34)
    // Lines thin out past the focus: they fade from just beyond the target to a couple of times as far.
    const distance = stage.getCamera().distance
    u.inkFade.value.set(Math.max(50, distance * 1.3), Math.max(140, distance * 3))
    u.lut.value = look.lut ? 1 : 0
    u.vignette.value = look.vignette ? VIGNETTE_DAY + VIGNETTE_NIGHT * night : 0
    u.cameraNear.value = camera.near
    u.cameraFar.value = camera.far
    u.time.value = (performance.now() / 1000) % 100
  }

  const draw = () => {
    resize()
    updateLevels()
    // The palette's own grade is the composite's now: off while the scene draws.
    const grade = AIR.uGrade.value
    AIR.uGrade.value = 0
    renderer.setRenderTarget(sceneTarget)
    renderer.render(scene, camera)
    AIR.uGrade.value = grade
    const autoClear = renderer.autoClear
    renderer.autoClear = false
    // bloom, the composite and SMAA are the "post" pass; the scene above stays the stage's "opaque"
    stage.timing.gpu.begin("post")
    if (look.bloom) drawBloom()
    if (smaa && finished) {
      run(composite, finished)
      smaa.render(renderer, null as unknown as WebGLRenderTarget, finished, 0, false)
    } else run(composite, null)
    stage.timing.gpu.end()
    renderer.autoClear = autoClear
  }
  stage.setDraw(draw, sceneTarget)
  logger.info("post", { aa, look, mood })

  let stillTarget: WebGLRenderTarget | null = null
  const still = (cam: PerspectiveCamera, into: WebGLRenderTarget, distance: number) => {
    resize()
    updateLevels()
    const w = Math.max(1, into.width * STILL_SUPERSAMPLE)
    const h = Math.max(1, into.height * STILL_SUPERSAMPLE)
    stillTarget ??= target(0, true)
    if (stillTarget.width !== w || stillTarget.height !== h) stillTarget.setSize(w, h)
    const kept = {
      target: renderer.getRenderTarget(),
      autoClear: renderer.autoClear,
      inkWidth: u.inkWidth.value,
    }
    u.inkFade.value.set(Math.max(50, distance * 1.3), Math.max(140, distance * 3))
    u.cameraNear.value = cam.near
    u.cameraFar.value = cam.far
    u.inkWidth.value = 1.5 * STILL_SUPERSAMPLE
    const grade = AIR.uGrade.value
    AIR.uGrade.value = 0
    renderer.setRenderTarget(stillTarget)
    renderer.render(scene, cam)
    AIR.uGrade.value = grade
    renderer.autoClear = false
    if (look.bloom) drawBloom(stillTarget)
    u.tScene.value = stillTarget.texture
    u.tDepth.value = stillTarget.depthTexture
    u.texel.value.set(1 / w, 1 / h)
    run(composite, into)
    // the frame's own again (its near and far, its ink fade: updateLevels writes them each frame)
    u.tScene.value = sceneTarget.texture
    u.tDepth.value = sceneTarget.depthTexture
    u.texel.value.set(1 / sceneTarget.width, 1 / sceneTarget.height)
    u.inkWidth.value = kept.inkWidth
    renderer.autoClear = kept.autoClear
    renderer.setRenderTarget(kept.target)
  }
  const releaseStill = () => {
    stillTarget?.depthTexture?.dispose()
    stillTarget?.dispose()
    stillTarget = null
  }

  return {
    setLook(next) {
      // Off parts weigh 0 in the composite (a stale bloom target is never added).
      look = { ...look, ...next }
    },
    look: () => ({ ...look }),
    setMood(next) {
      mood = next
      first = true
    },
    async warm() {
      resize()
      // each pass is keyed by the target it draws into, and by the quad's own scene (no fog, no lights:
      // compiled against the stage's scene, every pass got a second program the frame never drew with)
      const into = (material: ShaderMaterial, target: WebGLRenderTarget | null) =>
        warmPrograms(stage, quad, [material], { into: target, scene: quadScene })
      const first = levels[0] as WebGLRenderTarget
      // SMAA's three materials and the two targets between them are the pass's own (three keeps them
      // private); each program is keyed by the target it draws into, the blend's by the canvas
      const s = smaa as unknown as {
        _materialEdges: ShaderMaterial
        _materialWeights: ShaderMaterial
        _materialBlend: ShaderMaterial
        _edgesRT: WebGLRenderTarget
        _weightsRT: WebGLRenderTarget
      } | null
      await Promise.all([
        into(prefilter, first),
        into(down, levels[1] ?? first),
        into(up, first),
        into(composite, finished),
        ...(s
          ? [
              into(s._materialEdges, s._edgesRT),
              into(s._materialWeights, s._weightsRT),
              into(s._materialBlend, null),
            ]
          : []),
      ])
    },
    still,
    releaseStill,
    dispose() {
      releaseStill()
      stage.setDraw(null)
      sceneTarget.depthTexture?.dispose()
      sceneTarget.dispose()
      finished?.dispose()
      smaa?.dispose()
      for (const level of levels) level.dispose()
      for (const m of [prefilter, down, up, composite]) m.dispose()
      quad.geometry.dispose()
      lutTexture.dispose()
    },
  }
}
