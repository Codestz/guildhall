import { useFrame, useThree } from "@react-three/fiber"
import { useEffect } from "react"
import { TIERS } from "../guild/quality.ts"
import { frameStats } from "../guild/stats.ts"
import { active, frameCounts } from "../render/backend.ts"
import { syncShadows } from "../render/shims.ts"
import { composer, FRAME } from "./frame.ts"
import { useTier } from "./Quality.tsx"

/**
 * Counts what a whole frame costs. `renderer.info` normally resets on every render call, and the
 * post-processing passes each render — so the last pass (a fullscreen quad) would be all we saw.
 * The composer (FRAME.RENDER) turns auto reset off and resets once per frame before rendering; we
 * read at FRAME.STATS, after it has drawn everything, so the numbers cover the whole frame. On the
 * Low tier there is no composer, so this renders the frame itself (scene/frame.ts: who renders).
 */
export function FrameStats() {
  const gl = useThree((state) => state.gl)
  const post = TIERS[useTier()].post

  useEffect(() => {
    gl.info.autoReset = false
    return () => {
      gl.info.autoReset = true
    }
  }, [gl])

  useFrame(({ scene, camera }, delta) => {
    // A positive-priority frame callback turns off R3F's own render. With post-processing on, the
    // composer (FRAME.RENDER) draws the frame; without it, this is the one place that does: on Low,
    // and in the frames after a switch to a post tier until its composer is built (scene/frame.ts).
    if (!post || (!composer.live && active.backend !== "webgpu")) {
      gl.info.reset()
      // WebGPU: the on-demand shadow cache's request, handed to the lights (render/shims.ts).
      if (active.backend === "webgpu") syncShadows(gl, scene)
      gl.render(scene, camera)
    }
    const info = gl.info
    const ms = delta * 1000
    frameStats.ms = frameStats.ms === 0 ? ms : frameStats.ms * 0.92 + ms * 0.08
    frameStats.fps = frameStats.ms > 0 ? 1000 / frameStats.ms : 0
    // The two renderers name this frame's counts differently (render/backend.ts).
    const counts = frameCounts(info, active.backend)
    frameStats.calls = counts.calls
    frameStats.triangles = counts.triangles
    frameStats.geometries = info.memory.geometries
    frameStats.textures = info.memory.textures
    frameStats.programs = counts.programs
    info.reset()
  }, FRAME.STATS)

  return null
}
