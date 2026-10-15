/**
 * Work FX (game feel, task C): the little bursts that show work being done — sparks off an anvil, chips
 * off a log or a rock face, a splash and a ring where a line comes out of the water, a puff of dust,
 * pages fluttering, motes of light, a coin's glint, steam off a quench.
 *
 * One instanced draw of at most `MAX_PARTICLES` cards, animated wholly in the vertex shader from each
 * burst's origin, time and seed (shader.ts): an emit writes its few slots once, and a frame only moves
 * the clock. Bursts spawn only near the camera and on the screen (`inView`) and thin out with distance,
 * so a zoom never pops one. With nothing alive the mesh is hidden: no draw, and the picture is exactly
 * the island's own.
 *
 *   workfx.emit("sparks", [x, y, z])                 a burst of a kind
 *   workfx.beat("hit", [x, y, z], sample)            a life beat (the shared sample's `beat`): `beatKinds`
 */
import {
  AddEquation,
  BufferAttribute,
  CustomBlending,
  DoubleSide,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Matrix4,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
  Vector2,
  Vector3,
} from "three"
import type { DayLight } from "../light.ts"
import type { Stage } from "../stage.ts"
import { warmPrograms } from "../warm.ts"
import { type BeatSample, beatKinds, KIND, type WorkKind } from "./kinds.ts"
import {
  aliveAt,
  burstCount,
  burstSeed,
  createSlots,
  FADE_M,
  inView,
  MAX_PARTICLES,
  NEAR_M,
  particleSeed,
  takeSlots,
} from "./pool.ts"
import { FRAGMENT, VERTEX } from "./shader.ts"

export {
  type Driver,
  driveWorkFx,
  RHYTHM,
  type SitePiece,
  siteFor,
  type WorkFxSpec,
  workfxOf,
} from "./debug.ts"
export {
  type BeatSample,
  beatKinds,
  KIND,
  type KindSpec,
  MAX_BURST,
  WORK_KINDS,
  type WorkKind,
} from "./kinds.ts"
export {
  aliveAt,
  burstCount,
  burstSeed,
  createSlots,
  FADE_M,
  inView,
  MAX_PARTICLES,
  NEAR_M,
  particleSeed,
  type Slots,
  takeSlots,
} from "./pool.ts"

type V3 = readonly [number, number, number]

export interface EmitOpts {
  /** Bigger or smaller (0.5 … 1.5): the particles' size and, a little, their number. */
  scale?: number
  /** Which way the work faces (radians about +y, 0 = +z): sparks lean that way. */
  yaw?: number
  /**
   * The burst's seed: the same (kind, where, seed) draws the same particles. A beat's own time on its
   * routine's clock is a good one; without it the FX clock's time is used (cosmetic, not replayable).
   */
  seed?: number
  /** Seconds since the beat (it was seen late): the burst starts that far along. */
  ago?: number
  /** Spawn even far off or off the screen (shots). */
  force?: boolean
}

export interface WorkFxStats {
  alive: number
  /** Bursts spawned, and skipped (too far, off the screen, or no free slots). */
  emitted: number
  skipped: number
  /** Mean CPU ms per frame (the clock and the visibility), and per emit. */
  ms: number
  emitMs: number
  visible: boolean
}

export interface WorkFx {
  ready: Promise<void>
  /** A burst of `kind` at `at`; how many particles it spawned (0: skipped). */
  emit(kind: WorkKind, at: V3, opts?: EmitOpts): number
  /** A life beat at `at` (`beatKinds`: which bursts it makes); the particles spawned. */
  beat(beat: string, at: V3, sample?: BeatSample, opts?: EmitOpts): number
  /** The FX clock, s (the shots freeze it to hold a burst). */
  time(): number
  /** Holds the clock (true) or lets it run; `advance` moves it by hand. */
  freeze(on: boolean): void
  advance(s: number): void
  /** Everything alive goes at once (a seek). */
  clear(): void
  /** Off: nothing spawns and nothing draws. */
  setEnabled(on: boolean): void
  stats(): WorkFxStats
  dispose(): void
}

export interface WorkFxOpts {
  /** The day's light: the lit kinds (chips, dust, splashes) take it. */
  light?: () => DayLight
}

/** A white card's brightness under the day's light (linear): half the sun (cards face the camera), the sky's fill. */
function cardLight(l: DayLight, out: Vector3): Vector3 {
  const sun = l.sunIntensity * 0.55
  const sky = l.hemiIntensity
  return out
    .set(
      l.sun.r * sun + l.hemiSky.r * sky,
      l.sun.g * sun + l.hemiSky.g * sky,
      l.sun.b * sun + l.hemiSky.b * sky,
    )
    .multiplyScalar(1 / Math.PI)
}

export function createWorkFx(stage: Stage, opts: WorkFxOpts = {}): WorkFx {
  const n = MAX_PARTICLES
  const geometry = new InstancedBufferGeometry()
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3),
  )
  geometry.setIndex([0, 1, 2, 0, 2, 3])
  const origin = new InstancedBufferAttribute(new Float32Array(n * 4), 4)
  const info = new InstancedBufferAttribute(new Float32Array(n * 4), 4)
  origin.setUsage(DynamicDrawUsage)
  info.setUsage(DynamicDrawUsage)
  // the slots start long dead
  for (let i = 0; i < n; i++) origin.setW(i, -1e6)
  geometry.setAttribute("aOrigin", origin)
  geometry.setAttribute("aInfo", info)
  geometry.instanceCount = n
  const uniforms = {
    uTime: { value: 0 },
    uLight: { value: new Vector3(1, 1, 1) },
    uFade: { value: new Vector2(...FADE_M) },
  }
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    // the ring lies flat (seen from above or below the quad's winding)
    side: DoubleSide,
    fog: false,
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneMinusSrcAlphaFactor,
  })
  const mesh = new Mesh(geometry, material)
  mesh.name = "workfx"
  mesh.frustumCulled = false
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.renderOrder = 9
  mesh.visible = false
  stage.scene.add(mesh)
  let disposed = false
  let warm = false
  const ready = warmPrograms(stage, mesh).then(() => {
    warm = true
  })

  const slots = createSlots(n)
  // how many may be alive at once (the quality ladder's lever): a burst past it is smaller, or nothing
  let cap = n
  ;(stage as Partial<Pick<Stage, "lever">>).lever?.("particles", (value) => {
    cap = Math.max(0, Math.min(n, Math.round(value)))
  })
  let clock = 0
  /** When the last particle alive is gone. */
  let until = 0
  let frozen = false
  let enabled = true
  let emitted = 0
  let skipped = 0
  const costs: number[] = []
  const emitCosts: number[] = []
  const vp = new Matrix4()
  const eye: [number, number, number] = [0, 0, 0]
  const light = new Vector3()

  /** Every slot dead and free. */
  const kill = () => {
    until = clock
    slots.free.fill(0)
    for (let i = 0; i < n; i++) origin.setW(i, -1e6)
    origin.addUpdateRange(0, n * 4)
    origin.needsUpdate = true
  }

  const show = () => {
    mesh.visible = warm && enabled && !disposed && clock < until
  }

  const off = stage.onFrame((dt) => {
    const t0 = performance.now()
    if (!frozen) clock += Math.min(dt, 0.1)
    // a long quiet: the clock starts over, so it keeps its float precision in the shader
    if (clock > 4000 && clock >= until) {
      clock = 0
      kill()
    }
    show()
    if (mesh.visible) {
      uniforms.uTime.value = clock
      if (opts.light) uniforms.uLight.value.copy(cardLight(opts.light(), light))
    }
    costs.push(performance.now() - t0)
    if (costs.length > 120) costs.shift()
  })

  const emit = (kind: WorkKind, at: V3, o: EmitOpts = {}): number => {
    if (!enabled || disposed) return 0
    const t0 = performance.now()
    const cam = stage.camera
    cam.updateMatrixWorld()
    vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)
    eye[0] = cam.position.x
    eye[1] = cam.position.y
    eye[2] = cam.position.z
    if (!o.force && !inView(at, eye, vp.elements, NEAR_M)) {
      skipped++
      return 0
    }
    const scale = o.scale ?? 1
    const start = clock - Math.max(0, o.ago ?? 0)
    const end = start + KIND[kind].life
    const room = cap >= n ? n : Math.max(0, cap - aliveAt(slots, clock))
    const taken = takeSlots(slots, Math.min(burstCount(kind, scale), room), clock, end)
    if (!taken.length) {
      skipped++
      return 0
    }
    const seed = burstSeed(kind, at, o.seed ?? clock)
    const id = KIND[kind].id
    taken.forEach((slot, k) => {
      origin.setXYZW(slot, at[0], at[1], at[2], start)
      info.setXYZW(slot, id, particleSeed(seed, k), scale, o.yaw ?? 0)
    })
    // only the slots written go up (a range round them)
    const lo = Math.min(...taken)
    const hi = Math.max(...taken)
    // (three uploads the ranges added since the last draw, then clears them)
    origin.addUpdateRange(lo * 4, (hi - lo + 1) * 4)
    info.addUpdateRange(lo * 4, (hi - lo + 1) * 4)
    origin.needsUpdate = true
    info.needsUpdate = true
    until = Math.max(until, end)
    emitted++
    show()
    emitCosts.push(performance.now() - t0)
    if (emitCosts.length > 120) emitCosts.shift()
    return taken.length
  }

  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

  return {
    ready,
    emit,
    beat(beat, at, sample, o) {
      let spawned = 0
      for (const kind of beatKinds(beat, sample)) spawned += emit(kind, at, o)
      return spawned
    },
    time: () => clock,
    freeze(on) {
      frozen = on
    },
    advance(s) {
      clock += s
      uniforms.uTime.value = clock
      show()
    },
    clear() {
      kill()
      show()
    },
    setEnabled(on) {
      enabled = on
      if (!on) until = clock
      show()
    },
    stats: () => ({
      alive: aliveAt(slots, clock),
      emitted,
      skipped,
      ms: mean(costs),
      emitMs: mean(emitCosts),
      visible: mesh.visible,
    }),
    dispose() {
      disposed = true
      off()
      mesh.removeFromParent()
      geometry.dispose()
      material.dispose()
    },
  }
}
