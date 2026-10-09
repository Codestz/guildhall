import { useFrame, useThree } from "@react-three/fiber"
import { useEffect, useMemo, useRef } from "react"
import { DirectionalLight, type OrthographicCamera, type PerspectiveCamera, Vector3 } from "three"
import { FRAME } from "../frame.ts"
import { freshDrawn, stepCascades } from "./cascadeDrive.ts"
import { CascadeShadowNode, Caster } from "./cascadeShadowNode.ts"
import { type CharacterTier, driveCharacters } from "./characterShadows.ts"
import { shadows } from "./shadows.ts"
import { sky } from "./state.ts"

/**
 * The key light on a gen 2 island under WebGPU: the same fitted cascades as WebGL's
 * (CascadeKey.tsx, cascades.ts), the same cache (cascadeDrive.ts: far maps stay until the sun
 * turns, the near one is redrawn when the camera's target leaves its grid cell), behind ONE
 * light. That light only lights: it points along the sun and its shadow is the cascade node
 * (cascadeShadowNode.ts), so the lighting loop runs one light however many cascades there are.
 * With `characters` on (Medium and up) the shadow node also holds the characters' own map
 * (characterShadows.ts, characterShadowNode.ts), redrawn each frame it has casters.
 * The loaded module is lazy (three/webgpu): atmosphere/Atmosphere.tsx KeyLight suspends on it.
 */
export function CascadeKeyGPU({
  count,
  map,
  far,
  ceiling,
  characters,
}: {
  count: number
  map: number
  /** The island's radius: the last cascade covers it. */
  far: number
  /** The tallest ground or roof, world units: the cylinders reach this high. */
  ceiling: number
  /** Which characters cast real shadows in the near box, and how big (guild/quality.ts). */
  characters: CharacterTier
}) {
  const scene = useThree((state) => state.scene)
  const gl = useThree((state) => state.gl)
  const span = useMemo(() => ({ floor: -2, ceiling: Math.max(ceiling + 8, 24) }), [ceiling])
  const cast = characters.casts !== "off"
  // A new count or map size is a fresh set of empty maps (and a fresh shadow node: the lit
  // materials rebuild on it). The characters' map is one more, redrawn every frame it is used.
  const key = useMemo(() => {
    const light = new DirectionalLight()
    light.castShadow = true
    const casters = Array.from({ length: count }, (_, k) => new Caster(map, k > 0))
    const held = cast ? new Caster(characters.map, false) : undefined
    if (held) held.shadow.autoUpdate = false
    light.shadow.shadowNode = new CascadeShadowNode(light, casters, held)
    return { light, casters, held }
  }, [count, map, cast, characters.map])
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

  // The characters' map, after the world has moved them: who is in the near box, the light fitted to
  // it, and the draw asked for only when someone is (the node draws it, characterShadowNode.ts).
  useFrame(() => {
    const { held } = key
    if (!held) return
    const casting = driveCharacters(held, drawn.current.cells[0], characters, span)
    held.shadow.needsUpdate = casting > 0
  }, FRAME.WORLD + 0.75)

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
