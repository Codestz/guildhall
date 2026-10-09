import { Canvas } from "@react-three/fiber"
import type { GuildStore } from "./guild/store.ts"
import { GuildContext } from "./guild/useGuild.ts"
import { Hud } from "./hud/Hud.tsx"
import { Loader } from "./hud/Loader.tsx"
import { requestedBackend } from "./render/backend.ts"
import { glFor } from "./render/renderer.ts"
import { Scene } from "./scene/Scene.tsx"

/** WebGL by default; `?renderer=webgpu` asks for WebGPU, falling back to WebGL (render/renderer.ts). */
const GL = glFor(requestedBackend(typeof location === "undefined" ? "" : location.search))

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
      {/* PCF shadows, named: `shadows` alone asks for PCFSoft, which three r18x no longer has (it
          warned and fell back to PCF on every load). The same picture, without the warning. */}
      <Canvas shadows="percentage" dpr={1} gl={GL} aria-hidden="true">
        <Scene />
      </Canvas>
      <Hud />
      {/* Over everything until the world is drawn (guild/boot.ts); back under the HUD for each island visit. */}
      <Loader />
    </GuildContext.Provider>
  )
}
