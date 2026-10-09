import { useFrame, useThree } from "@react-three/fiber"
import { useEffect, useMemo, useRef } from "react"
import { type DirectionalLight, type OrthographicCamera, type PerspectiveCamera, Vector3 } from "three"
import { freshDrawn, stepCascades } from "./cascadeDrive.ts"
import { cascadeKey } from "./cascadeLights.ts"
import { shadows } from "./shadows.ts"
import { sky } from "./state.ts"

/**
 * The key light on a gen 2 island: the sun by day, the moon by night, drawn as `count` cascades
 * (cascades.ts) instead of one box. Each cascade is its own directional light with its own shadow
 * map; the first carries the colour, the others have intensity 0 and exist for their maps
 * (cascadeChunk.ts reads them all). Each map is a cache like the single one was
 * (atmosphere/shadows.ts), refitted by cascadeDrive.ts: redrawn when the sun turns or a caster
 * changes, and otherwise only when the camera's target leaves that cascade's grid cell.
 * WebGPU draws the same cascades behind one light (CascadeKeyGPU.tsx).
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
  const drawn = useRef(freshDrawn())

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
    const set = lights.current.slice(0, count).flatMap((light) => (light ? [light] : []))
    for (const light of set) scene.add(light.target)
    // The TSL materials on WebGL (?tsl=1) read these same maps (grassNodes.ts keyShadow).
    cascadeKey.lights = set
    drawn.current.cells = []
    shadows.request()
    return () => {
      for (const light of set) scene.remove(light.target)
      cascadeKey.lights = []
    }
  }, [scene, count, map])

  useFrame((state) => {
    const set = lights.current
    if (!set[0]) return
    const controls = state.controls as unknown as { target?: Vector3 } | null
    const view = {
      camera: state.camera as OrthographicCamera | PerspectiveCamera,
      at: controls?.target ?? ORIGIN,
      geometries: gl.info.memory.geometries,
      far,
      span,
      map,
    }
    const cascades = Array.from({ length: count }, (_, k) => set[k] ?? null)
    if (stepCascades(cascades, drawn.current, view)) gl.shadowMap.needsUpdate = true
    for (const [k, light] of cascades.entries()) {
      if (!light) continue
      light.color.copy(sky.keyColor)
      // Only the first is lit; the rest are shadow maps for it to read.
      light.intensity = k === 0 ? sky.keyIntensity : 0
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

const ORIGIN = new Vector3()
