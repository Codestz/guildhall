/**
 * A GLB fetched and parsed, gzipped on the wire or not. A static host sends `model/gltf-binary` as it
 * is (Vercel compresses text, JSON, JS and wasm, never a GLB), so the showcase build ships every
 * library GLB gzipped under `<name>.glb.gz` (the rig's animation JSON and the pieces' index data
 * shrink by half to three quarters) and the page gunzips it here with the browser's own
 * DecompressionStream. The bytes decide, not the name: gzip's magic (1f 8b) is inflated, anything
 * else is handed to the loader as it is, so a host that already decoded a `Content-Encoding: gzip`
 * answer, a plain `.glb` from the dev server, or a CDN of either kind all read the same.
 */
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js"
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js"

let loader: GLTFLoader | null = null

/** Whether `bytes` are a gzip member (its magic). */
export const isGzip = (bytes: Uint8Array): boolean => bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b

/** `bytes` inflated when gzipped, else as they are (a copy-free view either way). */
export async function inflateIfGzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (!isGzip(bytes)) return bytes
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("gzip"))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** The GLB at `url` as bytes ready to parse (gunzipped when the host sent gzip bytes). */
export async function fetchGlb(url: string, fetcher: typeof fetch = fetch): Promise<ArrayBuffer> {
  const response = await fetcher(url)
  if (!response.ok) throw new Error(`GLB ${url}: HTTP ${response.status}`)
  const bytes = await inflateIfGzip(new Uint8Array(await response.arrayBuffer()))
  // the loader wants an ArrayBuffer of exactly the file
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? (bytes.buffer as ArrayBuffer)
    : bytes.slice().buffer
}

/** The GLB at `url` parsed (meshopt-compressed or not); every library piece and rig loads through here. */
export async function loadGltf(url: string): Promise<GLTF> {
  loader ??= new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  const buffer = await fetchGlb(url)
  return loader.parseAsync(buffer, url.slice(0, url.lastIndexOf("/") + 1))
}
