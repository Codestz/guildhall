import { describe, expect, test } from "bun:test"
import { ShaderChunk } from "three"
import { skipDarkPointLights } from "../src/night/lamps.ts"

/** Three's own unroll pattern (WebGLProgram.js): the loop body is read up to the first `}` before the end pragma. */
const UNROLL =
  /#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g

describe("dark point lights are skipped in the fragment shader", () => {
  test("the chunk three compiles holds the branch round the whole point-light term", () => {
    const chunk = ShaderChunk.lights_fragment_begin
    const at = chunk.indexOf("pointLight = pointLights[ i ];")
    const loop = chunk.slice(at, chunk.indexOf("#pragma unroll_loop_end", at))
    expect(loop).toContain("if ( pointLight.color != vec3( 0.0 ) ) {")
    // both the falloff and the BRDF are inside the branch
    expect(loop.indexOf("if ( pointLight.color")).toBeLessThan(loop.indexOf("getPointLightInfo("))
    expect(loop.indexOf("RE_Direct( directLight")).toBeLessThan(loop.lastIndexOf("}"))
  })

  test("three's unroll pattern still reads every loop with balanced braces", () => {
    const text = ShaderChunk.lights_fragment_begin.replaceAll(/NUM_\w+_LIGHTS; i \+\+/g, "8; i ++")
    const loops = [...text.matchAll(UNROLL)]
    expect(loops.length).toBeGreaterThanOrEqual(5)
    for (const [, , , body] of loops)
      expect((body?.match(/{/g) ?? []).length).toBe((body?.match(/}/g) ?? []).length)
    const point = loops.find(([, , , body]) => body?.includes("getPointLightInfo"))
    expect(point?.[3]).toContain("if ( pointLight.color != vec3( 0.0 ) ) {")
  })

  test("applied once: a chunk already patched is left alone", () => {
    const once = ShaderChunk.lights_fragment_begin
    expect(skipDarkPointLights(once)).toBe(once)
  })
})
