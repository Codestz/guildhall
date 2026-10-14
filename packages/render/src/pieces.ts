import { log } from "@guildhall/core"
import { Mesh, type Object3D } from "three"
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js"
import { paletteMaterial } from "./material.ts"
import { builtOf, builtPiece } from "./props/built.ts"

const logger = log("render:pieces")

let loader: GLTFLoader | null = null

/**
 * Readies a library piece's scene graph to draw: every mesh's material is replaced by the shared
 * palette material (ADR 003) and the old ones freed, and every mesh casts and receives shadows.
 *
 * Colour needs no conversion here. glTF's COLOR_0 is linear (the colour stage writes linear floats or
 * normalized bytes), GLTFLoader hands it over untouched, and three treats vertex colours as linear
 * working-space values, so the one sRGB encode happens at output. Converting here would double it.
 */
export function preparePiece(root: Object3D): Object3D {
  root.traverse((node) => {
    if (!(node instanceof Mesh)) return
    const old = Array.isArray(node.material) ? node.material : [node.material]
    for (const material of old) if (material !== paletteMaterial()) material.dispose()
    node.material = paletteMaterial()
    node.castShadow = true
    node.receiveShadow = true
    if (!node.geometry.getAttribute("color")) logger.warn("no vertex colours", { mesh: node.name })
  })
  return root
}

/**
 * A url → piece loader that loads each url once and hands every caller its own copy of the scene
 * graph. Copies share geometry and the palette material, so the geometry belongs to the cache: remove
 * a copy from the scene, never dispose its geometry. A failed load is forgotten, so a retry refetches.
 */
export function pieceCache(load: (url: string) => Promise<Object3D>): (url: string) => Promise<Object3D> {
  const templates = new Map<string, Promise<Object3D>>()
  return async (url) => {
    let template = templates.get(url)
    if (!template) {
      template = load(url)
      templates.set(url, template)
      template.catch(() => templates.delete(url))
    }
    // SkeletonUtils.clone rebinds a character's skeleton to its own bones; plain clone would not.
    return clone(await template)
  }
}

/**
 * A library GLB (meshopt-compressed, vertex-coloured) as a ready-to-draw piece; cached by url. A
 * `built/<name>.glb` path is one of the props built in code (props/built.ts), made instead of fetched.
 */
export const loadPiece = pieceCache(async (url) => {
  const built = builtOf(url)
  if (built) return preparePiece(builtPiece(built))
  loader ??= new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  const gltf = await loader.loadAsync(url)
  const root = preparePiece(gltf.scene)
  // Kept on the root (and copied by clone) so a character's clips travel with it.
  root.animations = gltf.animations
  logger.debug("loaded", { url, clips: gltf.animations.length })
  return root
})
