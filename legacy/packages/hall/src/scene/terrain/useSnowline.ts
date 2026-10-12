import { useFrame } from "@react-three/fiber"
import type { WebGLRenderer } from "three"
import { useGuildStore } from "../../guild/useGuild.ts"
import { isWebGPU } from "../../render/backend.ts"
import { type Relief, snowlineOf } from "../../world/gen/relief/index.ts"
import { installNodes } from "../tsl.ts"
import type { Snowline, SnowMaker } from "./snow.ts"

/** Degrees Celsius where winter's snow line has come all the way down, and where it starts to. */
const COLD = -8
const MILD = 8

/** 0 in summer, 1 in deep winter, from the weather's temperature (guild/environment.ts). */
export const winterOf = (celsius: number): number =>
  Math.min(1, Math.max(0, (MILD - celsius) / (MILD - COLD)))

/** Keeps `snowline` at the relief's snow line, lowered as the weather turns cold (nothing is written while it holds). */
export function useSnowline(relief: Relief | undefined, snowline: Snowline): void {
  const store = useGuildStore()
  useFrame(() => {
    if (!relief) return
    const next = snowlineOf(relief, winterOf(store.environment.temperature))
    if (Math.abs(snowline.value - next) > 0.01) snowline.value = next
  })
}

const nodeMakers = new WeakMap<object, Promise<SnowMaker>>()

/**
 * The node-material snow line, once the renderer can draw it (one promise per renderer, for `use`).
 * WebGPU draws node materials natively; WebGL needs the nodes handler first.
 */
export function nodeSnow(gl: WebGLRenderer): Promise<SnowMaker> {
  let maker = nodeMakers.get(gl)
  if (!maker) {
    const ready = isWebGPU(gl) ? Promise.resolve() : installNodes(gl)
    maker = ready.then(() => import("./snowNodes.ts")).then(({ snowNodeMaterial }) => snowNodeMaterial)
    nodeMakers.set(gl, maker)
  }
  return maker
}
