import { useFrame, useThree } from "@react-three/fiber"
import { useEffect, useMemo, useRef } from "react"
import { type DirectionalLight, type OrthographicCamera, type PerspectiveCamera, Vector3 } from "three"
import { biasOf, cascadeRadii, cellOf, fitCascade, nearRadius, snap } from "./cascades.ts"
import { shadows } from "./shadows.ts"
import { sky } from "./state.ts"

/**
 * The key light on a gen 2 island: the sun by day, the moon by night, drawn as `count` cascades
 * (cascades.ts) instead of one box. Each cascade is its own directional light with its own shadow
 * map; the first carries the colour, the others have intensity 0 and exist for their maps
 * (cascadeChunk.ts reads them all). Each map is a cache like the single one was
 * (atmosphere/shadows.ts): redrawn when the sun turns or a caster changes, and otherwise only when
 * the camera's target leaves that cascade's grid cell. The near cascade follows the camera closely;
 * the far one is the whole island and never moves, so orbiting costs the far map nothing.
 */
export function CascadeKey({
  count,
  map,
  far,
  ceiling,
}: {
  count: number
  map: number
  /** The island's radius: the last cascade covers it. */
  far: number
  /** The tallest ground or roof, world units: the cylinders reach this high. */
  ceiling: number
}) {
  const lights = useRef<(DirectionalLight | null)[]>([])
  const scene = useThree((state) => state.scene)
  const gl = useThree((state) => state.gl)
  const span = useMemo(() => ({ floor: -2, ceiling: Math.max(ceiling + 8, 24) }), [ceiling])
  /** What each cascade was last drawn for. */
  const drawn = useRef({
    cells: [] as { cx: number; cz: number; radius: number }[],
    dx: 0,
    dy: 0,
    dz: 0,
    geometries: -1,
  })

  useEffect(() => {
    gl.shadowMap.autoUpdate = false
    shadows.request()
    return () => {
      gl.shadowMap.autoUpdate = true
    }
  }, [gl])

  // The targets live in the scene so their matrices are the scene's. Remounting (a new count or
  // map size) is a fresh set of empty maps.
  // biome-ignore lint/correctness/useExhaustiveDependencies: count and map are the remount's own triggers
  useEffect(() => {
    const targets = lights.current.flatMap((light) => (light ? [light.target] : []))
    for (const target of targets) scene.add(target)
    drawn.current.cells = []
    shadows.request()
    return () => {
      for (const target of targets) scene.remove(target)
    }
  }, [scene, count, map])

  useFrame((state) => {
    const set = lights.current
    const key = set[0]
    if (!key) return
    const last = drawn.current
    const controls = state.controls as unknown as { target?: Vector3 } | null
    const at = controls?.target ?? ORIGIN
    const radii = cascadeRadii(count, nearRadius(needOf(state.camera, at), far, count), far)
    const [dx, dy, dz] = sky.keyDirection
    const geometries = gl.info.memory.geometries
    if (geometries !== last.geometries) {
      last.geometries = geometries
      shadows.request()
    }
    const turned = dx * last.dx + dy * last.dy + dz * last.dz < TURN_COS
    let any = false
    for (let k = 0; k < count; k++) {
      const light = set[k]
      if (!light) continue
      const radius = radii[k] as number
      const cell = cellOf(radius, k === count - 1)
      const cx = snap(at.x, cell)
      const cz = snap(at.z, cell)
      const was = last.cells[k]
      if (!(shadows.dirty || turned || !was || was.cx !== cx || was.cz !== cz || was.radius !== radius))
        continue
      const fit = fitCascade(sky.keyDirection, cx, cz, radius, span, map)
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
      last.cells[k] = { cx, cz, radius }
      any = true
    }
    if (any) {
      gl.shadowMap.needsUpdate = true
      shadows.dirty = false
      shadows.draws++
      last.dx = dx
      last.dy = dy
      last.dz = dz
    }
    for (let k = 0; k < count; k++) {
      const light = set[k]
      if (!light) continue
      light.color.copy(sky.keyColor)
      // Only the first is lit; the rest are shadow maps for it to read.
      light.intensity = k === 0 ? sky.keyIntensity : 0
      light.shadow.intensity = sky.keyShadow
    }
  })

  return (
    <>
      {Array.from({ length: count }, (_, k) => (
        <directionalLight
          // biome-ignore lint/suspicious/noArrayIndexKey: the cascades are an ordered, fixed set
          key={`${count}-${map}-${k}`}
          ref={(light) => {
            lights.current[k] = light
          }}
          castShadow
          shadow-mapSize={[map, map]}
        />
      ))}
    </>
  )
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
const ORIGIN = new Vector3()
