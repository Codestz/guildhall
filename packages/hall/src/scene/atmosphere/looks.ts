import { useMemo, useSyncExternalStore } from "react"
import { type Looks, quality } from "../../guild/quality.ts"

/** The looks in force (the tier's, plus any probe override), re-rendering when either changes. */
export function useLooks(): Looks {
  const key = useSyncExternalStore(quality.subscribe, () => `${quality.tier}:${quality.revision}`)
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the change signal
  return useMemo(() => quality.looks(), [key])
}
