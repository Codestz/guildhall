import { describe, expect, test } from "bun:test"
import { gzipSync } from "node:zlib"
import { fetchGlb, inflateIfGzip, isGzip } from "../src/gltf.ts"

/** A GLB header (the magic "glTF", version 2, the length), enough to tell the bytes apart. */
const glb = (): Uint8Array => {
  const bytes = new Uint8Array(32)
  bytes.set([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, 32, 0, 0, 0])
  for (let i = 12; i < 32; i++) bytes[i] = i
  return bytes
}

const answering = (body: Uint8Array, ok = true): typeof fetch =>
  (async () =>
    ({
      ok,
      status: ok ? 200 : 404,
      arrayBuffer: async () => body.slice().buffer,
    }) as unknown as Response) as typeof fetch

describe("GLBs gzipped on the wire", () => {
  test("gzip's magic tells the gzipped bytes from a plain GLB", () => {
    expect(isGzip(gzipSync(glb()))).toBe(true)
    expect(isGzip(glb())).toBe(false)
    expect(isGzip(new Uint8Array(0))).toBe(false)
  })

  test("gzipped bytes are inflated back to the file; plain bytes come back as they are", async () => {
    const plain = glb()
    expect(await inflateIfGzip(gzipSync(plain))).toEqual(plain)
    expect(await inflateIfGzip(plain)).toBe(plain)
  })

  test("fetchGlb hands the loader exactly the file, gzipped by the host or already decoded", async () => {
    const plain = glb()
    const zipped = new Uint8Array(await fetchGlb("/x.glb.gz", answering(gzipSync(plain, { level: 9 }))))
    expect(zipped).toEqual(plain)
    const decoded = new Uint8Array(await fetchGlb("/x.glb.gz", answering(plain)))
    expect(decoded).toEqual(plain)
    expect(decoded.buffer.byteLength).toBe(plain.byteLength)
  })

  test("a missing file is an error naming it", async () => {
    await expect(fetchGlb("/gone.glb.gz", answering(new Uint8Array(0), false))).rejects.toThrow(
      "/gone.glb.gz",
    )
  })
})
