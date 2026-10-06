import { Canvas } from "@react-three/fiber"
import type { GuildStore } from "./guild/store.ts"
import { GuildContext } from "./guild/useGuild.ts"
import { Hud } from "./hud/Hud.tsx"
import { Scene } from "./scene/Scene.tsx"

/**
 * The hall: one guild store, the 3D scene, and the overlay on top.
 * The store is made once outside React (main.tsx): StrictMode would otherwise create two, and the
 * Canvas's context bridge could hand the scene a different one than the HUD reads.
 */
export function Hall({ store }: { store: GuildStore }) {
  return (
    <GuildContext.Provider value={store}>
      <Canvas
        orthographic
        shadows
        dpr={1}
        camera={{ position: [0.01, 240, 2], zoom: 6, near: 0.1, far: 900 }}
        gl={{ antialias: false }}
      >
        <Scene />
      </Canvas>
      <Hud />
    </GuildContext.Provider>
  )
}
