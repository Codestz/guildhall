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
      {/*
        The 3D world is a picture of what the HUD already says in words: the roster names everyone
        and what they are doing, the dossier tells one adventurer's story. So the canvas, and the
        name chips drei mounts beside it, stay out of the accessibility tree.
      */}
      <Canvas shadows dpr={1} gl={{ antialias: false }} aria-hidden="true">
        <Scene />
      </Canvas>
      <Hud />
    </GuildContext.Provider>
  )
}
