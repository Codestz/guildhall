/**
 * Which GPU backend draws the hall (Chapter 2, phase 2: docs/research/gpu-techniques.md §1). WebGL
 * is the default and the shipped path. `?renderer=webgpu` asks for three's WebGPURenderer; with no
 * WebGPU in the browser it falls back to the same WebGLRenderer as the default (never to
 * WebGPURenderer's own WebGL 2 backend, measured as the slowest of the three).
 *
 * Nothing here imports `three/webgpu`: the default path's bundle stays as it was. The WebGPU code
 * is loaded on demand (render/webgpu.ts, atmosphere/PostGPU.tsx).
 */
export type Backend = "webgl" | "webgpu"

/** The panel's name for a backend (Stats for nerds). */
export const BACKEND_NAME: Record<Backend, string> = { webgl: "WebGL", webgpu: "WebGPU" }

/** The backend a location search asks for: `renderer=webgpu`, or WebGL (the default, and for anything else). */
export function requestedBackend(search: string): Backend {
  return new URLSearchParams(search).get("renderer") === "webgpu" ? "webgpu" : "webgl"
}

/** The backend actually drawing, once the renderer exists (the factory sets it; WebGL until then). */
export const active: { backend: Backend } = { backend: "webgl" }

/** True for three's WebGPURenderer (its own flag; a WebGLRenderer has none). */
export function isWebGPU(gl: object): boolean {
  return (gl as { isWebGPURenderer?: boolean }).isWebGPURenderer === true
}

/** The two renderers' `info`, as far as Stats for nerds reads them. */
interface RenderInfo {
  render: { calls: number; drawCalls?: number; triangles: number }
  memory: { textures: number; programs?: number }
  programs?: unknown[] | null
}

/**
 * One frame's draw calls, triangles and shader programs, from whichever renderer's `info`.
 * WebGL counts this frame's draws in `render.calls`; WebGPU keeps `render.calls` as a running total
 * since start and counts the frame's in `render.drawCalls`. Programs: WebGL lists them
 * (`info.programs`), WebGPU counts them (`info.memory.programs`).
 */
export function frameCounts(
  info: RenderInfo,
  backend: Backend,
): { calls: number; triangles: number; programs: number } {
  if (backend === "webgpu")
    return {
      calls: info.render.drawCalls ?? 0,
      triangles: info.render.triangles,
      programs: info.memory.programs ?? 0,
    }
  return { calls: info.render.calls, triangles: info.render.triangles, programs: info.programs?.length ?? 0 }
}

/** The largest texture anisotropy the GPU allows: `capabilities` on WebGL, a method on WebGPU. */
export function maxAnisotropy(gl: object): number {
  const webgpu = gl as { getMaxAnisotropy?: () => number }
  if (typeof webgpu.getMaxAnisotropy === "function") return webgpu.getMaxAnisotropy()
  return (gl as { capabilities: { getMaxAnisotropy(): number } }).capabilities.getMaxAnisotropy()
}

/** True when the browser has the WebGPU API at all (an adapter is still checked at start: render/renderer.ts). */
export function webgpuAvailable(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator
}

/** The same page asking for `backend`: every other parameter kept, `renderer` set (Settings' Renderer choice). */
export function backendUrl(href: string, backend: Backend): string {
  const url = new URL(href)
  url.searchParams.set("renderer", backend)
  return url.toString()
}
