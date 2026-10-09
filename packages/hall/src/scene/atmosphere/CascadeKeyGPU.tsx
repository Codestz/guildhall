import { useFrame, useThree } from "@react-three/fiber"
import { useEffect, useMemo, useRef } from "react"
import { DirectionalLight, type OrthographicCamera, type PerspectiveCamera, Vector3 } from "three"
import { freshDrawn, stepCascades } from "./cascadeDrive.ts"
import { CascadeShadowNode, Caster } from "./cascadeShadowNode.ts"
import { shadows } from "./shadows.ts"
import { sky } from "./state.ts"

/**
 * The key light on a gen 2 island under WebGPU: the same fitted cascades as WebGL's
 * (CascadeKey.tsx, cascades.ts), the same cache (cascadeDrive.ts: far maps stay until the sun
 * turns, the near one is redrawn when the camera's target leaves its grid cell), behind ONE
 * light. That light only lights: it points along the sun and its shadow is the cascade node
 * (cascadeShadowNode.ts), so the lighting loop runs one light however many cascades there are.
 * The loaded module is lazy (three/webgpu): atmosphere/Atmosphere.tsx KeyLight suspends on it.
 */
export function CascadeKeyGPU({
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
  const scene = useThree((state) => state.scene)
  const gl = useThree((state) => state.gl)
  const span = useMemo(() => ({ floor: -2, ceiling: Math.max(ceiling + 8, 24) }), [ceiling])
  // A new count or map size is a fresh set of empty maps (and a fresh shadow node: the lit
  // materials rebuild on it).
  const key = useMemo(() => {
    const light = new DirectionalLight()
    light.castShadow = true
    const casters = Array.from({ length: count }, (_, k) => new Caster(map, k > 0))
    light.shadow.shadowNode = new CascadeShadowNode(light, casters)
    return { light, casters }
  }, [count, map])
  const drawn = useRef(freshDrawn())

  useEffect(() => {
    const { light } = key
    scene.add(light.target)
    drawn.current = freshDrawn()
    shadows.request()
    return () => {
      scene.remove(light.target)
      light.shadow.shadowNode?.dispose()
    }
  }, [scene, key])

  useFrame((state) => {
    const { light, casters } = key
    const controls = state.controls as unknown as { target?: Vector3 } | null
    stepCascades(casters, drawn.current, {
      camera: state.camera as OrthographicCamera | PerspectiveCamera,
      at: controls?.target ?? ORIGIN,
      geometries: gl.info.memory.geometries,
      far,
      span,
      map,
    })
    // The light itself: along the sun, exactly (the cascades' boxes may lie flatter, cascades.ts).
    const [dx, dy, dz] = sky.keyDirection
    light.position.set(dx, dy, dz)
    light.target.position.set(0, 0, 0)
    light.color.copy(sky.keyColor)
    light.intensity = sky.keyIntensity
  })

  return <primitive object={key.light} />
}

const ORIGIN = new Vector3()
