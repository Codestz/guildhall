import { OrbitControls } from "@react-three/drei"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import { Suspense, useEffect, useRef } from "react"
import { createRoot } from "react-dom/client"
import { AdditiveBlending, type InstancedMesh, type Material } from "three"
import type { Weather } from "../guild/environment.ts"
import { quality, type Tier } from "../guild/quality.ts"
import { frameStats } from "../guild/stats.ts"
import { GuildStore } from "../guild/store.ts"
import { GuildContext } from "../guild/useGuild.ts"
import { active, requestedBackend } from "../render/backend.ts"
import { glFor } from "../render/renderer.ts"
import { Atmosphere } from "../scene/atmosphere/Atmosphere.tsx"
import { Post } from "../scene/atmosphere/Post.tsx"
import { FrameStats } from "../scene/FrameStats.tsx"
import { Island } from "../scene/Island.tsx"
import { Rivers } from "../scene/nature/Rivers.tsx"
import { Water } from "../scene/nature/Water.tsx"
import { Quality, useTier } from "../scene/Quality.tsx"
import { WorldScope } from "../world/source.ts"
import { patchWaters, patchWorld } from "./waterPatch.ts"

/**
 * The water lab (dev and probe only; world-gen v2's R1 spike): rivers, a lake and waterfalls on a
 * small terraced patch (lab/waterPatch.ts), drawn by the hall's own layers — the Island's tiles,
 * the sea (Water.tsx, its shore baked from the patch), the sky, the post chain — plus the inland
 * water (scene/nature/Rivers.tsx). Drag to orbit.
 *
 *   ?lab=water                              midday, clear, High
 *   &hour=18.5&weather=rain&quality=1       any hour, weather and tier
 *   &look=falls                             close on the lake's falls (default `overview`)
 *   &renderer=webgpu | &tsl=1               the node materials (WebGPU, or TSL on WebGL)
 *
 * `window.lab`: `ready` once the world has mounted; `look(name)`; `stats()` → this frame's draw
 * calls and triangles; `waters` → the water as data. `window.natureStats` as the hall's (bench).
 */

/** Where the camera looks from and at, by name. */
const LOOKS = {
  overview: { at: [10, 2, 6], from: [62, 66, 86] },
  falls: { at: [13, 2, 9], from: [40, 26, 38] },
  spring: { at: [-12, 6, -15], from: [8, 26, 8] },
  top: { at: [8, 3, 6], from: [8, 120, 7] },
} as const satisfies Record<string, { at: readonly number[]; from: readonly number[] }>
type Look = keyof typeof LOOKS

export function start(root: HTMLElement, params: URLSearchParams): void {
  const store = new GuildStore()
  const hour = Number(params.get("hour") ?? 13)
  const weather = (params.get("weather") ?? "clear") as Weather
  store.setEnvironment({ time: "fixed", hour, weather })
  const tier = Math.min(3, Math.max(0, Number(params.get("quality") ?? 2))) as Tier
  quality.choice = tier
  quality.set(tier)
  const waters = patchWaters()
  const world = patchWorld(waters)
  const asked = params.get("look") ?? "overview"
  const first: Look = asked in LOOKS ? (asked as Look) : "overview"
  const lab = {
    ready: false,
    waters,
    world,
    look: (_: string): string => "not mounted yet",
    stats: () => ({ ...frameStats, backend: active.backend }),
  }
  Object.assign(window, {
    lab,
    natureStats: () => ({ calls: frameStats.calls, triangles: frameStats.triangles }),
  })
  document.title = "lab · water"

  /** The camera's levers: `lab.look(name)` moves it, and the lab is ready once the world has drawn. */
  function Levers() {
    const camera = useThree((state) => state.camera)
    const controls = useThree((state) => state.controls) as unknown as {
      target: { set(...xyz: number[]): void }
      update(): void
    } | null
    useEffect(() => {
      lab.look = (name: string) => {
        const look = LOOKS[name as Look]
        if (!look) return `no look "${name}": ${Object.keys(LOOKS).join(", ")}`
        camera.position.set(...(look.from as unknown as [number, number, number]))
        controls?.target.set(...look.at)
        controls?.update()
        return "ok"
      }
      lab.look(first)
      lab.ready = true
    }, [camera, controls])
    // Every world has the keep's gate torches (world/lights.ts: the keep stands at every island's
    // origin); this patch has no keep, so their halos (Atmosphere's Lamps) would glow out of a
    // hillside. Hidden here, once they exist.
    const scene = useThree((state) => state.scene)
    const halos = useRef(false)
    useFrame(() => {
      if (halos.current) return
      scene.traverse((object) => {
        const mesh = object as InstancedMesh
        if (mesh.isInstancedMesh && (mesh.material as Material).blending === AdditiveBlending) {
          mesh.visible = false
          halos.current = true
        }
      })
    })
    return null
  }

  function Lab() {
    const level = useTier()
    return (
      <Quality>
        <FrameStats />
        <WorldScope value={world}>
          <Atmosphere />
          <Suspense fallback={null}>
            <Island />
            <Water tier={level} />
            <Rivers waters={waters} tier={level} />
            <Levers />
          </Suspense>
        </WorldScope>
        <OrbitControls makeDefault target={LOOKS[first].at as unknown as [number, number, number]} />
        <Post />
      </Quality>
    )
  }

  root.innerHTML = ""
  createRoot(root).render(
    <GuildContext.Provider value={store}>
      <Canvas
        shadows="percentage"
        dpr={1}
        gl={glFor(requestedBackend(location.search))}
        camera={{
          position: LOOKS[first].from as unknown as [number, number, number],
          fov: 30,
          near: 1,
          far: 2000,
        }}
        style={{ width: "100vw", height: "100vh" }}
      >
        <Lab />
      </Canvas>
    </GuildContext.Provider>,
  )
}
