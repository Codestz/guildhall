import { useSyncExternalStore } from "react"

/**
 * Boot readiness, shared by the scene (scene/BootWatch.tsx, which measures it) and the overlay
 * (hud/Loader.tsx, which shows it): what the viewer waits on, from the first paint until the world
 * is genuinely drawn, and again each time the hall goes to another island in place.
 *
 *   world   the island is being grown (the worker, world/grow) and any far islands with it
 *   models  its models and textures are downloading, or the world has not mounted yet
 *   light   shaders compiled, the shadow map drawn, a run of smooth frames rendered behind the loader
 *   ready   nothing is left: the loader lifts and the opening (guild/opening.ts) or the camera starts
 *
 * `<html data-boot>` mirrors it for automation: "loading" → "ready" (the loader is fading) →
 * "revealed" (the loader is gone and the camera has landed): what scripts/probe-server.ts waits for,
 * so a screenshot never catches the loader or a half-made sweep.
 */
export type BootStage = "world" | "models" | "light" | "ready"

export interface BootState {
  stage: BootStage
  /** Honest progress, 0..1, never backwards within one boot: each stage owns a slice of the bar. */
  progress: number
  /** "boot": the page's first load, over everything. "visit": going to another island, under the HUD. */
  kind: "boot" | "visit"
  /** The island being gone to (a visit). */
  label: string
  /** Counts boots, so a visit's overlay starts afresh. */
  epoch: number
  /** The loader is on screen: false once it has faded away. */
  shown: boolean
  /** The measuring runs: false while a visit's veil falls and the old island is swapped out. */
  armed: boolean
}

let state: BootState = {
  stage: "world",
  progress: 0.02,
  kind: "boot",
  label: "",
  epoch: 0,
  shown: true,
  armed: true,
}
const listeners = new Set<() => void>()
const waiters: Array<() => void> = []
let held = 0
let faded = false
let landed = false

function set(patch: Partial<BootState>): void {
  state = { ...state, ...patch }
  mirror()
  for (const listener of listeners) listener()
}

function mirror(): void {
  if (typeof document === "undefined") return
  const html = document.documentElement
  if (state.stage !== "ready") html.dataset.boot = "loading"
  else html.dataset.boot = faded && landed ? "revealed" : "ready"
}
mirror()

export const boot = {
  get: (): BootState => state,
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  /** Reports where the boot has got to; never backwards, and nothing once ready. */
  report(stage: BootStage, progress: number): void {
    if (state.stage === "ready") return
    const next = Math.max(state.progress, Math.min(1, progress))
    if (stage === state.stage && next === state.progress) return
    if (stage !== state.stage) performance.mark(`boot:${stage}`)
    set({ stage, progress: next })
  },
  /** Everything is drawn: the loader may lift. */
  finish(): void {
    if (state.stage === "ready") return
    performance.mark("boot:ready")
    set({ stage: "ready", progress: 1 })
    for (const resolve of waiters.splice(0)) resolve()
  },
  /** A visit to `label`'s island: the loader comes back (under the HUD) until it is drawn. */
  begin(label: string): void {
    faded = false
    landed = true
    set({
      stage: "world",
      progress: 0.02,
      kind: "visit",
      label,
      epoch: state.epoch + 1,
      shown: true,
      armed: false,
    })
  },
  /** The island has been swapped in: start measuring that it is drawn. */
  arm(): void {
    if (!state.armed) set({ armed: true })
  },
  /** The loader has finished fading away. */
  faded(): void {
    faded = true
    set({ shown: false })
  },
  /** The first sweep onto the island has landed (scene/CameraRig.tsx). */
  land(): void {
    landed = true
    mirror()
  },
  /** Resolves when the current boot is ready. */
  ready(): Promise<void> {
    return state.stage === "ready" ? Promise.resolve() : new Promise((resolve) => waiters.push(resolve))
  },
  /** Work the boot also waits on (the far islands growing): the world stage lasts until it settles. */
  hold(work: Promise<unknown>): void {
    held++
    const done = () => void held--
    work.then(done, done)
  },
  held: (): number => held,
}

export function useBoot(): BootState {
  return useSyncExternalStore(boot.subscribe, boot.get)
}
