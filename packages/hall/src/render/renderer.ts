import type { GLProps } from "@react-three/fiber"
import { WebGLRenderer } from "three"
import { active, type Backend } from "./backend.ts"

/** The default path's renderer options (unchanged): no MSAA, the post pass anti-aliases (atmosphere/Post.tsx). */
const WEBGL = { antialias: false } as const

/** What R3F 9 hands a `gl` factory: its renderer defaults and the canvas. */
type Defaults = Parameters<Extract<GLProps, (defaults: never) => Promise<unknown>>>[0]

/**
 * The Canvas's `gl` prop for a requested backend. WebGL: the plain options, exactly as before the
 * flag existed. WebGPU: R3F 9's async factory, which loads three's WebGPU build only now, and falls
 * back to the default WebGLRenderer (with a console note) when the browser has no WebGPU adapter or
 * the renderer fails to start.
 */
export function glFor(backend: Backend): GLProps {
  if (backend === "webgl") return WEBGL
  return async (defaults: Defaults) => {
    const reason = await webgpuMissing()
    if (!reason) {
      try {
        const { createWebGPURenderer } = await import("./webgpu.ts")
        const renderer = await createWebGPURenderer(defaults.canvas)
        active.backend = "webgpu"
        return renderer
      } catch (error) {
        return fallBack(defaults, `WebGPURenderer failed to start (${String(error)})`)
      }
    }
    return fallBack(defaults, reason)
  }
}

function fallBack(defaults: Defaults, reason: string): WebGLRenderer {
  console.info(`[hall] ?renderer=webgpu: ${reason}; drawing with WebGL instead`)
  active.backend = "webgl"
  return new WebGLRenderer({ ...defaults, ...WEBGL, canvas: defaults.canvas as HTMLCanvasElement })
}

/** Why WebGPU can't be used here, or null when it can: the API and an adapter both present. */
async function webgpuMissing(): Promise<string | null> {
  const gpu = (navigator as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
  if (!gpu) return "this browser has no WebGPU (navigator.gpu)"
  try {
    return (await gpu.requestAdapter()) ? null : "no WebGPU adapter"
  } catch {
    return "no WebGPU adapter"
  }
}
