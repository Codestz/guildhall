import { useFrame, useThree } from "@react-three/fiber"
import { useEffect } from "react"
import { frameStats } from "../guild/stats.ts"

/**
 * Counts what a whole frame costs. `renderer.info` normally resets on every render call, and the
 * post-processing passes each render — so the last pass (a fullscreen quad) would be all we saw.
 * The composer (priority 1) turns auto reset off and resets once per frame before rendering; we
 * read at priority 2, after it has drawn everything, so the numbers cover the whole frame.
 */
export function FrameStats() {
  const gl = useThree((state) => state.gl)

  useEffect(() => {
    gl.info.autoReset = false
    return () => {
      gl.info.autoReset = true
    }
  }, [gl])

  useFrame((_, delta) => {
    const info = gl.info
    const ms = delta * 1000
    frameStats.ms = frameStats.ms === 0 ? ms : frameStats.ms * 0.92 + ms * 0.08
    frameStats.fps = frameStats.ms > 0 ? 1000 / frameStats.ms : 0
    frameStats.calls = info.render.calls
    frameStats.triangles = info.render.triangles
    frameStats.geometries = info.memory.geometries
    frameStats.textures = info.memory.textures
    frameStats.programs = info.programs?.length ?? 0
    info.reset()
  }, 2)

  return null
}
