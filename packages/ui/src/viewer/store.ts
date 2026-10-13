import { useSyncExternalStore } from "react"
import type { LoaderState } from "../components/display.tsx"
import type { KnobSection, KnobValues } from "./knobs.ts"
import type { HelpEntry, PerfReading, Readout, TitleInfo, TransportSpec } from "./types.ts"

export interface ViewState {
  info: TitleInfo
  readout: readonly Readout[]
  sections: readonly KnobSection[]
  help: readonly HelpEntry[]
  /** What the knobs show now (staged reload values included). */
  values: KnobValues
  /** What the screen was built with: a reload knob that differs is staged. */
  built: KnobValues
  inspector: boolean
  helpOpen: boolean
  transport: (TransportSpec & { playing: boolean }) | null
  loader: LoaderState | null
  perf: PerfReading | null
  canCapture: boolean
  toasts: readonly { id: number; text: string; detail?: string }[]
}

export interface Store {
  get(): ViewState
  set(patch: Partial<ViewState> | ((s: ViewState) => Partial<ViewState>)): void
  subscribe(fn: () => void): () => void
}

export function createStore(initial: ViewState): Store {
  let state = initial
  const fns = new Set<() => void>()
  return {
    get: () => state,
    set(patch) {
      const next = typeof patch === "function" ? patch(state) : patch
      state = { ...state, ...next }
      for (const fn of fns) fn()
    },
    subscribe(fn) {
      fns.add(fn)
      return () => fns.delete(fn)
    },
  }
}

/** One slice of the state: the component re-renders only when the slice changes. */
export function useSlice<T>(store: Store, pick: (s: ViewState) => T): T {
  return useSyncExternalStore(store.subscribe, () => pick(store.get()))
}
