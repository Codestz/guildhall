// From V1 core (main:packages/core), itself from opencode-cockpit (V1 ADR 0001).
/**
 * When a stored run ended, read off what was stored — shared by the interface, which draws reopened
 * runs, and the agent side, which lists them. Pure.
 */

import type { Change } from "./changes.ts"

/** The last moment a stored run did anything: its latest change, or `fallback` when it has none. */
export function endOf(changes: readonly Change[], fallback: number): number {
  let last = 0
  for (const change of changes) {
    last = Math.max(last, change.at)
    if (change.type === "tool" && change.ended !== undefined) last = Math.max(last, change.ended)
  }
  return last || fallback
}
