import type { CameraPose } from "@guildhall/core"
import {
  Box3,
  Color,
  DirectionalLight,
  HemisphereLight,
  type Object3D,
  PerspectiveCamera,
  Scene,
  Sphere,
  SRGBColorSpace,
  type WebGLRenderer,
  WebGLRenderTarget,
} from "three"
import { poseToCamera } from "./camera.ts"

export interface ThumbnailOpts {
  /** Pixels a side. */
  size: number
  azimuth: number
  elevation: number
}

export interface FitView {
  /** Vertical field of view, degrees. */
  fov: number
  /** Width over height. */
  aspect: number
  azimuth: number
  elevation: number
  /** How much room is left around the sphere: 1 touches the frame edge. */
  margin?: number
}

const DEFAULTS: ThumbnailOpts = { size: 256, azimuth: 35, elevation: 28 }
/** A narrow lens, so the 3/4 view reads close to orthographic and pieces compare across tiles. */
const THUMB_FOV = 30
const THUMB_MARGIN = 1.05
const SAMPLES = 4
const WEBP_QUALITY = 0.9
const RAD = Math.PI / 180

/**
 * The pose at `view`'s angles that frames a sphere: aimed at its centre, at the distance where the
 * sphere just fits the narrower of the two fields of view (times `margin`). Pure maths.
 */
export function fitSphere(centre: [number, number, number], radius: number, view: FitView): CameraPose {
  const halfV = (view.fov / 2) * RAD
  const halfH = Math.atan(Math.tan(halfV) * view.aspect)
  // An empty object has no sphere: frame a 1 m one rather than a zero distance.
  const r = radius > 0 ? radius : 1
  const distance = (r * (view.margin ?? 1.1)) / Math.sin(Math.min(halfV, halfH))
  return { target: [...centre], azimuth: view.azimuth, elevation: view.elevation, distance }
}

/** The world bounding sphere of `object` (skinned meshes in their current pose). */
export function boundingSphere(object: Object3D): { centre: [number, number, number]; radius: number } {
  object.updateWorldMatrix(true, false)
  object.updateMatrixWorld(true)
  const box = new Box3().setFromObject(object, true)
  if (box.isEmpty()) return { centre: [0, 0, 0], radius: 0 }
  const sphere = box.getBoundingSphere(new Sphere())
  return { centre: sphere.center.toArray(), radius: sphere.radius }
}

/**
 * GL's rows (bottom first, colour premultiplied by the antialiased edge coverage over a transparent
 * clear) as canvas rows (top first, straight alpha), so edges do not come out dark.
 */
export function canvasPixels(gl: Uint8Array, size: number): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(size * size * 4)
  const row = size * 4
  for (let y = 0; y < size; y++) {
    const from = (size - 1 - y) * row
    for (let i = 0; i < row; i += 4) {
      const a = gl[from + i + 3] as number
      const k = a === 0 ? 0 : 255 / a
      const to = y * row + i
      out[to] = (gl[from + i] as number) * k
      out[to + 1] = (gl[from + i + 1] as number) * k
      out[to + 2] = (gl[from + i + 2] as number) * k
      out[to + 3] = a
    }
  }
  return out
}

let rig: Scene | null = null

/** The thumbnail light rig: fixed in the world, the stage's sky and sun, so every tile is lit alike. */
function lightRig(): Scene {
  if (rig) return rig
  rig = new Scene()
  rig.add(new HemisphereLight("#ffffff", "#8a7f6c", 1.6))
  const sun = new DirectionalLight("#fff4e0", 2.2)
  sun.position.set(6, 10, 4)
  rig.add(sun)
  return rig
}

/**
 * A square WebP of `object` from a fixed 3/4 view fitted to its bounding sphere, on a transparent
 * background, drawn offscreen with `renderer` (its own target and clear state are put back after).
 * The object is lent to the rig for the draw and returned to its parent. Same object, same pixels.
 */
export async function renderThumbnail(
  renderer: WebGLRenderer,
  object: Object3D,
  opts: Partial<ThumbnailOpts> = {},
): Promise<Blob> {
  const { size, azimuth, elevation } = { ...DEFAULTS, ...opts }
  const scene = lightRig()
  const parent = object.parent
  scene.add(object)
  const { centre, radius } = boundingSphere(object)
  const pose = fitSphere(centre, radius, {
    fov: THUMB_FOV,
    aspect: 1,
    azimuth,
    elevation,
    margin: THUMB_MARGIN,
  })
  const reach = Math.max(radius, 1) * 2
  const camera = new PerspectiveCamera(
    THUMB_FOV,
    1,
    Math.max(0.01, pose.distance - reach),
    pose.distance + reach,
  )
  camera.position.set(...poseToCamera(pose))
  camera.lookAt(...pose.target)

  // An sRGB target: the shader writes linear, the hardware encodes once, the read gets sRGB bytes.
  const target = new WebGLRenderTarget(size, size, { samples: SAMPLES, colorSpace: SRGBColorSpace })
  const pixels = new Uint8Array(size * size * 4)
  const previous = { target: renderer.getRenderTarget(), alpha: renderer.getClearAlpha() }
  const clearColour = renderer.getClearColor(new Color())
  try {
    renderer.setRenderTarget(target)
    renderer.setClearColor(0x000000, 0)
    renderer.clear()
    renderer.render(scene, camera)
    await renderer.readRenderTargetPixelsAsync(target, 0, 0, size, size, pixels)
  } finally {
    renderer.setRenderTarget(previous.target)
    renderer.setClearColor(clearColour, previous.alpha)
    target.dispose()
    scene.remove(object)
    parent?.add(object)
  }

  const canvas = new OffscreenCanvas(size, size)
  const context = canvas.getContext("2d")
  if (!context) throw new Error("renderThumbnail: no 2d context")
  context.putImageData(new ImageData(canvasPixels(pixels, size), size, size), 0, 0)
  return canvas.convertToBlob({ type: "image/webp", quality: WEBP_QUALITY })
}
