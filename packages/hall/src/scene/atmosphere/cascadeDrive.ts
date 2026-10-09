import type { LightShadow, Object3D, OrthographicCamera, PerspectiveCamera, Vector3 } from "three"
import { biasOf, cascadeRadii, cellOf, fitCascade, nearRadius, type Span, snap } from "./cascades.ts"
import { shadows } from "./shadows.ts"
import { sky } from "./state.ts"

/**
 * The cache policy of the cascaded key light (cascades.ts), shared by both backends: WebGL draws it
 * with `count` directional lights (CascadeKey.tsx), WebGPU with `count` bare shadow casters behind
 * one light (CascadeKeyGPU.tsx, cascadeShadowNode.ts). Each frame this refits the cascades that
 * need it and flags just those maps for a redraw: all of them when the sun turns or a caster
 * changes (`shadows.request()`), otherwise only the ones whose grid cell the camera's target left.
 * The near cascade follows the camera closely; the far one is the whole island and never moves, so
 * orbiting costs the far map nothing.
 */

/** A cascade's light, as far as the fit reads and writes it. */
export interface CascadeLight {
  position: Vector3
  target: Object3D
  shadow: LightShadow
  updateMatrixWorld(): void
}

/** What each cascade was last drawn for. */
export interface Drawn {
  cells: { cx: number; cz: number; radius: number }[]
  dx: number
  dy: number
  dz: number
  geometries: number
}

export const freshDrawn = (): Drawn => ({ cells: [], dx: 0, dy: 0, dz: 0, geometries: -1 })

/** What a frame's refit looks at. */
export interface CascadeView {
  camera: OrthographicCamera | PerspectiveCamera
  /** The camera's target: the ground the cascades centre on. */
  at: Vector3
  /** The renderer's count of geometries: new ones are casters not yet drawn. */
  geometries: number
  /** The island's radius, plus a margin: the last cascade covers it. */
  far: number
  span: Span
  map: number
}

/**
 * Refit and flag the cascades that need a redraw; true when any does (the caller then tells its
 * renderer: WebGL's `shadowMap.needsUpdate`; WebGPU's shadow nodes read each shadow's own flag).
 */
export function stepCascades(lights: (CascadeLight | null)[], drawn: Drawn, view: CascadeView): boolean {
  const count = lights.length
  const radii = cascadeRadii(count, nearRadius(needOf(view.camera, view.at), view.far, count), view.far)
  const [dx, dy, dz] = sky.keyDirection
  if (view.geometries !== drawn.geometries) {
    drawn.geometries = view.geometries
    shadows.request()
  }
  const turned = dx * drawn.dx + dy * drawn.dy + dz * drawn.dz < TURN_COS
  let any = false
  for (let k = 0; k < count; k++) {
    const light = lights[k]
    if (!light) continue
    const radius = radii[k] as number
    const cell = cellOf(radius, k === count - 1)
    const cx = snap(view.at.x, cell)
    const cz = snap(view.at.z, cell)
    const was = drawn.cells[k]
    if (!(shadows.dirty || turned || !was || was.cx !== cx || was.cz !== cz || was.radius !== radius))
      continue
    const fit = fitCascade(sky.keyDirection, cx, cz, radius, view.span, view.map)
    const shadow = light.shadow
    light.position.set(...fit.position)
    light.target.position.set(...fit.target)
    light.target.updateMatrixWorld()
    light.updateMatrixWorld()
    const camera = shadow.camera as OrthographicCamera
    camera.left = -fit.half
    camera.right = fit.half
    camera.top = fit.halfUp
    camera.bottom = -fit.halfUp
    camera.near = fit.near
    camera.far = fit.far
    camera.updateProjectionMatrix()
    Object.assign(shadow, biasOf(fit))
    shadow.autoUpdate = false
    shadow.needsUpdate = true
    drawn.cells[k] = { cx, cz, radius }
    any = true
  }
  if (any) {
    shadows.dirty = false
    shadows.draws++
    drawn.dx = dx
    drawn.dy = dy
    drawn.dz = dz
  }
  for (const light of lights) if (light) light.shadow.intensity = sky.keyShadow
  return any
}

/**
 * How many units of ground round the target the near cascade should keep crisp: most of what the
 * camera shows: an orthographic view's world height (1.2 × its half, the tilt stretching the ground
 * it shows), a perspective one's distance less a third.
 */
function needOf(camera: OrthographicCamera | PerspectiveCamera, at: Vector3): number {
  if ((camera as OrthographicCamera).isOrthographicCamera) {
    const ortho = camera as OrthographicCamera
    return ((ortho.top - ortho.bottom) / ortho.zoom / 2) * 1.2
  }
  return camera.position.distanceTo(at) * 0.7
}

/** Redraw when the sun or moon has turned by more than ~0.4°. */
const TURN_COS = Math.cos((0.4 * Math.PI) / 180)
