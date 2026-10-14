/** Raw model file → glTF document: glTF and GLB, read directly (every house-style pack ships them). */
import { extname } from "node:path"
import { type Document, Logger, type Node, NodeIO, type Scene } from "@gltf-transform/core"
import { ALL_EXTENSIONS } from "@gltf-transform/extensions"
import { cloneDocument, prune } from "@gltf-transform/functions"
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer"

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

/** Reads a .glb or .gltf (external buffers and images resolved beside it). */
export async function readModel(file: string): Promise<Document> {
  const io = await gltfIO()
  const ext = extname(file).toLowerCase()
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
