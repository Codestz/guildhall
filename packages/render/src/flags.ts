/**
 * What the page asks of every stage it makes. The app reads these from its address (render never reads a
 * URL) and sets them before it mounts a screen: GPU timer queries (`?timers=1`), and a fixed DPR
 * (`?dpr=`, the raw value; governor.ts `parseDprPin`). Its own entry (`@guildhall/render/flags`), so the
 * shell sets them without loading three.
 */
export interface StageFlags {
  gpuTimers: boolean
  dpr: string | null
}

let flags: StageFlags = { gpuTimers: false, dpr: null }

/** Sets what the next stages are made with. */
export function setStageFlags(next: Partial<StageFlags>): void {
  flags = { ...flags, ...next }
}

/** What the next stage is made with. */
export const stageFlags = (): StageFlags => flags
