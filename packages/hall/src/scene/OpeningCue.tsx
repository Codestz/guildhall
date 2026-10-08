import { useProgress } from "@react-three/drei"
import { useFrame, useThree } from "@react-three/fiber"
import { useEffect, useRef } from "react"
import { opening } from "../guild/opening.ts"
import { useGuildStore } from "../guild/useGuild.ts"

/** Share of the card's progress bar the downloads fill; mounting and compiling the world fill the rest. */
const FETCH_SHARE = 0.8
/** Frames under this long count as settled (the first frames after mounting compile shaders). */
const CALM_FRAME_S = 0.05
const CALM_FRAMES = 10
/** Never keep the card up longer than this (a stalled download), and never past a failed one. */
const MAX_WAIT_S = 30

/**
 * Showcase only, outside the world's Suspense: feeds the title card's progress bar from the
 * loading manager, and lifts the card anyway if a download fails or never finishes.
 */
export function OpeningProgress() {
  const store = useGuildStore()
  const loaded = useProgress((s) => s.loaded)
  const total = useProgress((s) => s.total)
  const failed = useProgress((s) => s.errors.length > 0)
  const waited = useRef(0)

  useEffect(() => {
    if (total > 0) opening.progress((loaded / total) * FETCH_SHARE)
  }, [loaded, total])

  useFrame((_, delta) => {
    if (opening.get().stage !== "card") return
    waited.current += delta
    if (failed || waited.current >= MAX_WAIT_S) {
      performance.mark("opening:timeout")
      begin(store)
    }
  })
  return null
}

/**
 * Showcase only, *inside* the world's Suspense boundary, so it mounts in the same commit as the
 * island: the world is built. It then compiles every material up front and waits for a run of
 * smooth frames, so the card never dissolves onto a half-built island or a shader stall.
 */
export function OpeningCue() {
  const store = useGuildStore()
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const camera = useThree((state) => state.camera)
  const calm = useRef({ compiled: false, frames: 0 })

  // biome-ignore lint/correctness/useExhaustiveDependencies: once, when the world has mounted
  useEffect(() => {
    performance.mark("opening:world")
    opening.progress(Math.max(opening.get().loaded, 0.9))
    let live = true
    gl.compileAsync(scene, camera)
      .catch(() => undefined)
      .then(() => {
        performance.mark("opening:compiled")
        if (live) calm.current.compiled = true
      })
    return () => {
      live = false
    }
  }, [])

  useFrame((_, delta) => {
    const c = calm.current
    if (!c.compiled || opening.get().stage !== "card") return
    c.frames = delta < CALM_FRAME_S ? c.frames + 1 : 0
    if (c.frames >= CALM_FRAMES) begin(store)
  })
  return null
}

function begin(store: ReturnType<typeof useGuildStore>): void {
  if (opening.get().stage !== "card") return
  // Start the story with the reveal, not somewhere in the middle of the loading (at its start, or
  // where a deep link asked: GuildStore.startAt).
  if (store.mode === "sim") store.seek(store.startAt)
  performance.mark("opening:reveal")
  opening.begin()
}
