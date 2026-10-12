/**
 * Raw model file → glTF document. glTF and GLB are read directly; FBX goes through FBX2glTF first, as
 * a cached pre-step: the converted GLB lives at `<library>/.cache/fbx/<hash>.glb`, keyed by the FBX
 * bytes, so each file converts once.
 *
 * Why FBX2glTF: it is one self-contained binary (npm `fbx2gltf`, or $FBX2GLTF, or `FBX2glTF` on PATH)
 * that keeps materials' base colours, skins and animations and converts a small piece in ~50 ms. The
 * npm build is x86_64, so Apple silicon runs it under Rosetta 2. Blender's importer needs a 300 MB app
 * and a Python script; three's FBXLoader needs DOM shims under Bun.
 */
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { type } from "node:os"
import { dirname, extname, join } from "node:path"
import { type Document, Logger, type Node, NodeIO, type Scene } from "@gltf-transform/core"
import { ALL_EXTENSIONS } from "@gltf-transform/extensions"
import { cloneDocument, prune } from "@gltf-transform/functions"
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer"
import { contentHash } from "./cache.ts"

let ioPromise: Promise<NodeIO> | undefined
/** gltf-transform reports every prune and dedup at info; the importer logs what matters itself. */
const QUIET = new Logger(Logger.Verbosity.WARN)

/** One NodeIO for reading and writing, with every extension and the meshopt codec registered. */
export function gltfIO(): Promise<NodeIO> {
  ioPromise ??= Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]).then(() =>
    new NodeIO()
      .setLogger(QUIET)
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder }),
  )
  return ioPromise
}

/** The FBX2glTF binary, or undefined when none is installed. */
export function fbxConverter(env: Record<string, string | undefined> = process.env): string | undefined {
  if (env.FBX2GLTF) return env.FBX2GLTF
  try {
    const pkg = createRequire(import.meta.url).resolve("fbx2gltf/package.json")
    const bin = join(dirname(pkg), "bin", type(), type() === "Windows_NT" ? "FBX2glTF.exe" : "FBX2glTF")
    if (existsSync(bin)) return bin
  } catch {
    // not installed as a package; try PATH
  }
  return Bun.which("FBX2glTF") ?? undefined
}

/** Converts an FBX to a GLB under `cacheDir` (once per distinct file content) and returns its path. */
export async function fbxToGlb(file: string, cacheDir: string): Promise<string> {
  const key = contentHash(await Bun.file(file).bytes())
  const out = join(cacheDir, `${key}.glb`)
  if (existsSync(out)) return out
  const bin = fbxConverter()
  if (!bin)
    throw new Error(
      `${file}: FBX needs FBX2glTF (add the "fbx2gltf" package to tools/import, or set FBX2GLTF to the binary)`,
    )
  mkdirSync(cacheDir, { recursive: true })
  const tmp = join(cacheDir, `${key}.${process.pid}.${Math.random().toString(36).slice(2)}`)
  const proc = Bun.spawnSync([bin, "--binary", "--input", file, "--output", tmp], {
    stderr: "pipe",
    stdout: "pipe",
  })
  if (proc.exitCode !== 0 || !existsSync(`${tmp}.glb`)) {
    rmSync(`${tmp}.glb`, { force: true })
    const why = `${proc.stderr.toString()}${proc.stdout.toString()}`.trim().split("\n").slice(-3).join(" ")
    throw new Error(`${file}: FBX2glTF failed (exit ${proc.exitCode}): ${why}`)
  }
  renameSync(`${tmp}.glb`, out)
  return out
}

/** Reads a .glb, .gltf (external buffers and images resolved beside it) or .fbx. */
export async function readModel(file: string, cacheDir: string): Promise<Document> {
  const io = await gltfIO()
  const ext = extname(file).toLowerCase()
  if (ext === ".fbx") return io.read(await fbxToGlb(file, join(cacheDir, "fbx")))
  if (ext === ".glb" || ext === ".gltf") return io.read(file)
  throw new Error(`${file}: unsupported format ${ext}`)
}

export const defaultScene = (doc: Document): Scene | undefined =>
  doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]

/**
 * The piece-level nodes: the scene's children, looking through single wrapper nodes that carry no
 * mesh (converters wrap everything in one root). Each entry is the path of child indices from the scene.
 */
export function topNodes(doc: Document): { node: Node; path: number[] }[] {
  const scene = defaultScene(doc)
  if (!scene) return []
  let list = scene.listChildren()
  const path: number[] = []
  while (list.length === 1 && !list[0]?.getMesh() && (list[0]?.listChildren().length ?? 0) > 0) {
    path.push(0)
    list = (list[0] as Node).listChildren()
  }
  return list.map((node, i) => ({ node, path: [...path, i] }))
}

/** `split: "top-nodes"`: one document per piece-level node, everything else pruned away. */
export async function splitTopNodes(doc: Document): Promise<{ node: string; doc: Document }[]> {
  const parts = topNodes(doc)
  const out: { node: string; doc: Document }[] = []
  for (const [i, { node, path }] of parts.entries()) {
    const copy = cloneDocument(doc).setLogger(QUIET)
    const scene = defaultScene(copy) as Scene
    let parent: Scene | Node = scene
    for (const [depth, index] of path.entries()) {
      const children: Node[] = parent.listChildren()
      if (depth === path.length - 1) {
        for (const [j, child] of children.entries()) if (j !== index) parent.removeChild(child)
      } else parent = children[index] as Node
    }
    await copy.transform(prune({ keepAttributes: true, keepLeaves: true, keepSolidTextures: true }))
    out.push({ node: node.getName() || `node-${i}`, doc: copy })
  }
  return out
}
