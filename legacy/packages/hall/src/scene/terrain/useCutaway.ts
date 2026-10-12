import { useFrame } from "@react-three/fiber"
import { useMemo } from "react"
import type { Vector3 } from "three"
import { positions } from "../../guild/useGuild.ts"
import { peakOf } from "../../world/peak.ts"
import type { World } from "../../world/world.ts"
import { FRAME } from "../frame.ts"
import { cutaway } from "./cutaway.ts"

/**
 * Where the townsfolk are this frame, by id (written by scene/life/Villagers.tsx). The heroes and
 * the crowd are `positions` (guild/useGuild.ts); together they are the figures the relief may hide.
 */
export const townsfolkAt = new Map<string, Vector3>()

const figures: Iterable<Vector3> = {
  *[Symbol.iterator]() {
    yield* positions.values()
    yield* townsfolkAt.values()
  },
}

/** Feeds the see-through cut (cutaway.ts) each frame, after the camera has moved. A world without relief costs nothing. */
export function useCutaway(world: World): void {
  const relief = world.relief
  const peak = useMemo(() => peakOf(world), [world])
  const heightAt = useMemo(() => relief && ((x: number, z: number) => relief.heightAt(x, z)), [relief])
  useFrame((state, delta) => {
    cutaway.update(delta, state.camera, state.size.width / state.size.height, figures, heightAt, peak)
  }, FRAME.WORLD)
}
