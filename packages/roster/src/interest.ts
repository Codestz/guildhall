import type { Change } from "@guildhall/core"

/**
 * How much a change is worth showing — the Bard camera eases toward the highest recent score
 * (ADR 0005). 0 = not worth a shot. Kept next to `deedLook` so "how it looks" and "how much it
 * matters" are tuned together.
 */
export function interestOf(change: Change): number {
  if (change.type === "status") {
    if (change.status === "waiting") return 5
    if (change.status === "failed") return 4
    return 0
  }
  if (change.type === "tool") {
    if (change.state === "failed") return 4
    if (change.state === "running" && (change.name === "task" || change.name === "subagent")) return 3
    if (change.state === "running" && (change.name === "webfetch" || change.name === "websearch")) return 2
    return 0
  }
  if (change.type === "reply" && change.done) return 2
  return 0
}
