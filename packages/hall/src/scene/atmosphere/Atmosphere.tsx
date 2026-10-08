import { useFrame, useThree } from "@react-three/fiber"
import { useEffect, useLayoutEffect, useMemo, useRef } from "react"
import { type DirectionalLight, Fog, type HemisphereLight, Vector3 } from "three"
import { TIERS } from "../../guild/quality.ts"
import { useGuildStore } from "../../guild/useGuild.ts"
import { fogRadiusOf } from "../../world/archipelago.ts"
import { useArchipelago } from "../../world/archipelagoSource.ts"
import { useWorld } from "../../world/source.ts"
import { FRAME } from "../frame.ts"
import { useTier } from "../Quality.tsx"
import { flash, stepLightning } from "./flash.ts"
import { installRadialFog } from "./fog.ts"
import { Lamps } from "./Lamps.tsx"
import { installLowGrade, packExposure, rendererToneMapping } from "./lowGrade.ts"
import { SkyDome } from "./SkyDome.tsx"
import { shadows } from "./shadows.ts"
import { updateSky } from "./sky.ts"
import { sky } from "./state.ts"
import { stepWind } from "./wind.ts"

installRadialFog()
installLowGrade()

/**
 * Sky and light (ADR 0007, task "Sky"): the dome, radial fog, the hemisphere fill, the sun or moon
 * (one shadow-casting light), and the flames' glow — all from `store.environment` and the mood,
 * through `sky.ts`. Nothing here keeps its own clock.
 */
export function Atmosphere() {
  return (
    <>
      <Weathervane />
      <SkyDome sky={sky} />
      <Key />
      <Lamps sky={sky} />
    </>
  )
}

/**
 * Reads the environment into `sky` and `wind`, and sets the fog and the hemisphere fill. Runs at
 * FRAME.SKY (scene/frame.ts): after the guild's clock, before every reader of `sky` and `wind`.
 */
function Weathervane() {
  const store = useGuildStore()
  const scene = useThree((state) => state.scene)
  const gl = useThree((state) => state.gl)
  const hemi = useRef<HemisphereLight>(null)
  const lastStrike = useRef(-1)
  const post = TIERS[useTier()].post
  /**
   * Fog radii follow the island: the coast starts to fade, the hex sea is gone by the far radius.
   * Under an archipelago they follow all of it: every island clear, the open sea fading past them.
   */
  const { tiles } = useWorld().island
  const archipelago = useArchipelago()
  const sea = useMemo(() => {
    if (archipelago) return fogRadiusOf(archipelago.extent)
    let radius = 0
    for (const tile of tiles) radius = Math.max(radius, Math.hypot(tile.x, tile.z))
    return radius || 110
  }, [tiles, archipelago])
  const fog = useMemo(() => new Fog("#c6d9ea", sea, sea * 1.4), [sea])

  // One tone mapping everywhere: Neutral keeps KayKit's flat colours true while rolling off the
  // HDR flames and sun. The post pass applies it itself (the composer turns the renderer's off and
  // restores this when it goes). The Low tier, with no post, renders Neutral plus the grade's
  // saturation (atmosphere/lowGrade.ts), set even while a leaving composer holds NoToneMapping.
  // Layout effect: before the composer's own effect saves the renderer's value.
  useLayoutEffect(() => {
    gl.toneMapping = rendererToneMapping(post, gl.toneMapping)
  }, [gl, post])

  useEffect(() => {
    scene.fog = fog
    scene.background = null
    return () => {
      scene.fog = null
    }
  }, [scene, fog])

  useFrame((state, delta) => {
    const env = store.environment
    if (env.lightningAt !== lastStrike.current) {
      if (lastStrike.current !== -1 && env.lightningAt >= 0) flash(0.8 + Math.random() * 0.4)
      lastStrike.current = env.lightningAt
    }
    updateSky(sky, env, store.mood, stepLightning(Math.min(delta, 0.1)))
    stepWind(env.wind, state.clock.elapsedTime, delta)
    // The Low tier has no grade (no post pass): its tone mapping takes the grade's exposure and
    // saturation (lowGrade.ts), so a storm still darkens and greys and night still lifts there.
    // With post on, the composer renders with no renderer tone mapping and the grade does it
    // (GradeEffect.ts): the plain exposure, never packed.
    gl.toneMappingExposure = post ? sky.exposure : packExposure(sky.exposure, 1 - sky.saturation)
    fog.color.copy(sky.fog)
    fog.near = sea * sky.fogNear
    fog.far = sea * sky.fogFar
    const fill = hemi.current
    if (fill) {
      fill.color.copy(sky.hemiSky)
      fill.groundColor.copy(sky.hemiGround)
      fill.intensity = sky.hemiIntensity
    }
  }, FRAME.SKY)

  return <hemisphereLight ref={hemi} />
}

/**
 * The one shadow-casting light: the sun by day, the moon by night (handed over below the horizon,
 * where both are dark). It follows the camera's target: a tight shadow box (sharp shadows, one
 * 2048 map) over whatever the Bard is looking at, instead of one huge box over the island.
 */
function Key() {
  const map = TIERS[useTier()].shadowMap
  const light = useRef<DirectionalLight>(null)
  const scene = useThree((state) => state.scene)
  const gl = useThree((state) => state.gl)
  /** The shadow box's grid cell and the light direction it was last drawn for. */
  const drawn = useRef({ cx: Number.NaN, cz: Number.NaN, dx: 0, dy: 0, dz: 0, geometries: -1, map: 0 })

  // Render the shadow map on demand (scene/atmosphere/shadows.ts), not every frame.
  useEffect(() => {
    gl.shadowMap.autoUpdate = false
    shadows.request()
    return () => {
      gl.shadowMap.autoUpdate = true
    }
  }, [gl])

  useEffect(() => {
    const target = light.current?.target
    if (!target) return
    scene.add(target)
    return () => {
      scene.remove(target)
    }
  }, [scene])

  useFrame((state) => {
    const key = light.current
    if (!key) return
    const controls = state.controls as unknown as { target?: Vector3 } | null
    const at = controls?.target ?? ORIGIN
    const [dx, dy, dz] = sky.keyDirection
    // The box moves in whole grid cells, so a drifting camera doesn't force a redraw every frame.
    const cx = Math.round(at.x / CELL) * CELL
    const cz = Math.round(at.z / CELL) * CELL
    const last = drawn.current
    // New geometry on the GPU (a model finished loading, a tier remount): its casters need drawing.
    const geometries = gl.info.memory.geometries
    // …and a new map size (a tier change) is a fresh, empty map.
    if (geometries !== last.geometries || map !== last.map) {
      last.geometries = geometries
      last.map = map
      shadows.request()
    }
    const turned = dx * last.dx + dy * last.dy + dz * last.dz < TURN_COS
    if (shadows.dirty || turned || cx !== last.cx || cz !== last.cz) {
      key.position.set(cx + dx * DISTANCE, dy * DISTANCE, cz + dz * DISTANCE)
      key.target.position.set(cx, 0, cz)
      key.target.updateMatrixWorld()
      key.updateMatrixWorld()
      gl.shadowMap.needsUpdate = true
      shadows.dirty = false
      shadows.draws++
      last.cx = cx
      last.cz = cz
      last.dx = dx
      last.dy = dy
      last.dz = dz
    }
    key.color.copy(sky.keyColor)
    key.intensity = sky.keyIntensity
    key.shadow.intensity = sky.keyShadow
  })

  return (
    <directionalLight
      ref={light}
      castShadow
      key={map}
      shadow-mapSize={[map, map]}
      shadow-camera-left={-40}
      shadow-camera-right={40}
      shadow-camera-top={40}
      shadow-camera-bottom={-40}
      shadow-camera-near={1}
      shadow-camera-far={150}
      shadow-bias={-0.0004}
      shadow-normalBias={0.02}
    />
  )
}

const DISTANCE = 70
/** Shadow box snapping (the box is ±40; a 6-unit step keeps the view well inside it). */
const CELL = 6
/** Redraw when the sun or moon has turned by more than ~0.4°. */
const TURN_COS = Math.cos((0.4 * Math.PI) / 180)
const ORIGIN = new Vector3()
