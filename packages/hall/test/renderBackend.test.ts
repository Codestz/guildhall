import { describe, expect, test } from "bun:test"
import {
  CustomToneMapping,
  DirectionalLight,
  NeutralToneMapping,
  NoToneMapping,
  PointLight,
  Scene,
} from "three"
import { backendUrl, frameCounts, maxAnisotropy, requestedBackend } from "../src/render/backend.ts"
import { glFor } from "../src/render/renderer.ts"
import { shimLowGrade, shimReadback, syncShadows } from "../src/render/shims.ts"
import { packExposure } from "../src/scene/atmosphere/lowGrade.ts"

describe("requestedBackend", () => {
  test("WebGPU only when the link asks for it", () => {
    expect(requestedBackend("?renderer=webgpu")).toBe("webgpu")
    expect(requestedBackend("?story=party&renderer=webgpu&paused=1")).toBe("webgpu")
  })
  test("WebGL by default and for anything else", () => {
    expect(requestedBackend("")).toBe("webgl")
    expect(requestedBackend("?story=party")).toBe("webgl")
    expect(requestedBackend("?renderer=webgl")).toBe("webgl")
    expect(requestedBackend("?renderer=WEBGPU")).toBe("webgl")
  })
})

describe("backendUrl", () => {
  test("sets the renderer and keeps every other parameter and the hash", () => {
    const url = new URL(backendUrl("http://localhost:5199/?story=saga&hour=23&paused=1#x", "webgpu"))
    expect(url.searchParams.get("renderer")).toBe("webgpu")
    expect(url.searchParams.get("story")).toBe("saga")
    expect(url.searchParams.get("hour")).toBe("23")
    expect(url.searchParams.get("paused")).toBe("1")
    expect(url.hash).toBe("#x")
  })
  test("replaces a renderer already asked for, and round-trips through requestedBackend", () => {
    const url = new URL(backendUrl("http://localhost:5199/?renderer=webgpu&quality=2", "webgl"))
    expect(url.searchParams.getAll("renderer")).toEqual(["webgl"])
    expect(requestedBackend(url.search)).toBe("webgl")
  })
  test("a bare page gains only the renderer", () => {
    expect(backendUrl("http://localhost:5199/", "webgpu")).toBe("http://localhost:5199/?renderer=webgpu")
  })
})

describe("glFor", () => {
  test("the default path keeps the plain renderer options it always had", () => {
    expect(glFor("webgl")).toEqual({ antialias: false })
  })
  test("WebGPU is an async factory (R3F 9)", () => {
    expect(typeof glFor("webgpu")).toBe("function")
  })
})

describe("frameCounts", () => {
  const info = {
    render: { calls: 9001, drawCalls: 140, triangles: 500_000 },
    memory: { textures: 60, programs: 40 },
    programs: [1, 2, 3],
  }
  test("WebGPU: this frame's draws, not the running total", () => {
    expect(frameCounts(info, "webgpu")).toEqual({ calls: 140, triangles: 500_000, programs: 40 })
  })
  test("WebGL: render.calls and the program list", () => {
    expect(frameCounts(info, "webgl")).toEqual({ calls: 9001, triangles: 500_000, programs: 3 })
  })
  test("WebGL with no program list counts none", () => {
    expect(frameCounts({ ...info, programs: null }, "webgl").programs).toBe(0)
  })
})

describe("maxAnisotropy", () => {
  test("reads the WebGPU method or the WebGL capabilities", () => {
    expect(maxAnisotropy({ getMaxAnisotropy: () => 16 })).toBe(16)
    expect(maxAnisotropy({ capabilities: { getMaxAnisotropy: () => 8 } })).toBe(8)
  })
})

describe("syncShadows", () => {
  function world() {
    const scene = new Scene()
    const key = new DirectionalLight()
    key.castShadow = true
    const lamp = new PointLight()
    scene.add(key, lamp)
    key.shadow.needsUpdate = false
    lamp.shadow.needsUpdate = false
    return { scene, key, lamp }
  }

  test("a request draws each casting light once and caches it after", () => {
    const { scene, key, lamp } = world()
    const gl = { shadowMap: { enabled: true, autoUpdate: false, needsUpdate: true } }
    syncShadows(gl, scene)
    expect(key.shadow.autoUpdate).toBe(false)
    expect(key.shadow.needsUpdate).toBe(true)
    expect(gl.shadowMap.needsUpdate).toBe(false)
    expect(lamp.shadow.needsUpdate).toBe(false)
  })

  test("no request, no change", () => {
    const { scene, key } = world()
    syncShadows({ shadowMap: { enabled: true, autoUpdate: false, needsUpdate: false } }, scene)
    expect(key.shadow.autoUpdate).toBe(true)
    expect(key.shadow.needsUpdate).toBe(false)
  })

  test("with the cache off, lights go back to redrawing every frame", () => {
    const { scene, key } = world()
    key.shadow.autoUpdate = false
    syncShadows({ shadowMap: { enabled: true, autoUpdate: true, needsUpdate: true } }, scene)
    expect(key.shadow.autoUpdate).toBe(true)
  })
})

describe("shimLowGrade", () => {
  test("Low's custom tone mapping reads as Neutral with its exposure unpacked", () => {
    const renderer = { toneMapping: NoToneMapping as number, toneMappingExposure: 1 }
    shimLowGrade(renderer)
    renderer.toneMapping = CustomToneMapping
    renderer.toneMappingExposure = packExposure(0.7, 0.5)
    expect(renderer.toneMapping).toBe(NeutralToneMapping)
    expect(renderer.toneMappingExposure).toBeCloseTo(0.7, 5)
  })
  test("Low survives three's save/restore of the renderer state (each shadow redraw does one)", () => {
    const renderer = { toneMapping: NoToneMapping as number, toneMappingExposure: 1 }
    shimLowGrade(renderer)
    renderer.toneMapping = CustomToneMapping
    renderer.toneMappingExposure = packExposure(1.25, 0.3)
    // RendererUtils.saveRendererState / restoreRendererState: read both, write both back.
    const saved = { toneMapping: renderer.toneMapping, exposure: renderer.toneMappingExposure }
    renderer.toneMapping = saved.toneMapping
    renderer.toneMappingExposure = saved.exposure
    // The next frame's grade writes the packed value again (Atmosphere.tsx).
    renderer.toneMappingExposure = packExposure(1.25, 0.3)
    expect(renderer.toneMapping).toBe(NeutralToneMapping)
    expect(renderer.toneMappingExposure).toBeCloseTo(1.25, 5)
  })
  test("other tone mappings and exposures pass through untouched", () => {
    const renderer = { toneMapping: NoToneMapping as number, toneMappingExposure: 1 }
    shimLowGrade(renderer)
    renderer.toneMapping = NeutralToneMapping
    renderer.toneMappingExposure = 1.3
    expect(renderer.toneMapping).toBe(NeutralToneMapping)
    expect(renderer.toneMappingExposure).toBe(1.3)
  })
})

describe("shimReadback", () => {
  test("a renderer without synchronous readback gets a no-op that leaves the buffer empty", () => {
    const renderer: { readRenderTargetPixels?: (...args: unknown[]) => void } = {}
    shimReadback(renderer)
    const pixels = new Uint8Array(4)
    expect(() => renderer.readRenderTargetPixels?.(null, 0, 0, 1, 1, pixels)).not.toThrow()
    expect([...pixels]).toEqual([0, 0, 0, 0])
  })
  test("a renderer that has it keeps its own", () => {
    const own = () => {}
    const renderer = { readRenderTargetPixels: own }
    shimReadback(renderer)
    expect(renderer.readRenderTargetPixels).toBe(own)
  })
})
