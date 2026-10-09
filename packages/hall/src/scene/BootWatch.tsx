import { useProgress } from "@react-three/drei"
import { useFrame, useThree } from "@react-three/fiber"
import { useLayoutEffect, useRef } from "react"
import { boot } from "../guild/boot.ts"
import { MODE } from "../guild/mode.ts"
import { opening } from "../guild/opening.ts"
import { useGuildStore } from "../guild/useGuild.ts"
import { worldSource } from "../world/source.ts"
import { shadows } from "./atmosphere/shadows.ts"

/** Frames under this long count as smooth (the first frames after mounting compile shaders). */
const CALM_FRAME_S = 0.05
/** Smooth frames in a row, drawn behind the loader, before it lifts. */
const CALM_FRAMES = 10
/** Never keep the loader up longer than this (a stalled download), and never past a failed one. */
const MAX_WAIT_S = 30

/** The bar's slices: growing the world, then the models, then the light. */
const WORLD_END = 0.3
const MODELS_END = 0.7

/** How many copies of the world's layers are mounted (see WorldMounted). */
let mounts = 0

/**
 * Inside the world's Suspense boundary, so it is mounted exactly while the island is built. A
 * layout effect, not a passive one: React tears those down when the boundary suspends again (the
 * hall going to another island) and sets them up when it shows, which a passive effect does not.
 */
export function WorldMounted() {
  useLayoutEffect(() => {
    mounts++
    return () => void mounts--
  }, [])
  return null
}

interface Run {
  epoch: number
  waited: number
  compiling: boolean
  compiled: boolean
  frames: number
}

/**
 * Outside the world's Suspense, in the canvas: measures that the world is *drawn*, not only built
 * (guild/boot.ts says what the viewer sees of it). It walks the stages in order, each only once the
 * one before is true:
 *
 *   world   the island is grown (world/source.ts), and anything else the boot holds
 *   models  its layers are mounted and no model or texture is still downloading
 *   light   every material compiled for this scene (`compileAsync`: parallel, off the render
 *           thread), the shadow map drawn once, then a run of smooth frames
 *
 * When all three hold the boot finishes: the loader lifts, and the showcase's opening begins.
 */
export function BootWatch() {
  const store = useGuildStore()
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const camera = useThree((state) => state.camera)
  const run = useRef<Run>({ epoch: -1, waited: 0, compiling: false, compiled: false, frames: 0 })

  useFrame((_, delta) => {
    const now = boot.get()
    if (now.stage === "ready" || !now.armed) return
    if (run.current.epoch !== now.epoch) {
      run.current = { epoch: now.epoch, waited: 0, compiling: false, compiled: false, frames: 0 }
    }
    const r = run.current
    r.waited += delta
    const fetched = useProgress.getState()

    if (r.waited >= MAX_WAIT_S || fetched.errors.length > 0) {
      performance.mark("boot:timeout")
      return finish(store)
    }
    if (worldSource.status.state === "loading" || boot.held() > 0) {
      return boot.report("world", Math.min(WORLD_END, 0.02 + r.waited * 0.04))
    }
    if (mounts === 0 || fetched.active) {
      const share = fetched.total > 0 ? fetched.loaded / fetched.total : 0
      return boot.report("models", WORLD_END + (MODELS_END - WORLD_END) * share)
    }
    if (!r.compiling) {
      r.compiling = true
      gl.compileAsync(scene, camera)
        .catch(() => undefined)
        .then(() => {
          if (run.current !== r) return
          performance.mark("boot:compiled")
          r.compiled = true
          // The shadow map is drawn on demand (atmosphere/shadows.ts): ask for the first one now,
          // behind the loader, so its cost is not paid in the viewer's first frame.
          shadows.request()
        })
    }
    if (r.compiled) r.frames = delta < CALM_FRAME_S ? r.frames + 1 : 0
    boot.report("light", MODELS_END + (1 - MODELS_END) * (0.3 + 0.7 * (r.frames / CALM_FRAMES)))
    if (r.compiled && r.frames >= CALM_FRAMES) finish(store)
  })
  return null
}

function finish(store: ReturnType<typeof useGuildStore>): void {
  if (boot.get().kind === "boot" && MODE === "showcase" && opening.get().stage === "card") {
    // Start the story with the reveal, not somewhere in the middle of the loading (at its start, or
    // where a deep link asked: GuildStore.startAt).
    if (store.mode === "sim") store.seek(store.startAt)
    opening.begin()
  }
  boot.finish()
}
