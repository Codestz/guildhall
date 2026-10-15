/**
 * The Chronicle format as the builder writes it: the types and readers are V2's own
 * (packages/sim/src/repo/chronicle.ts, unchanged from V1), plus the two pieces only a writer needs.
 */
import type { Chronicle } from "@guildhall/sim/chronicle"

export * from "@guildhall/sim/chronicle"

/** One week's commit count as its activity character ('0'–'9' then 'a'–'z', 35 meaning 35 or more). */
export function activityChar(commits: number): string {
  return Math.max(0, Math.min(35, Math.round(commits))).toString(36)
}

/** The chronicle as compact JSON. */
export function encodeChronicle(c: Chronicle): string {
  return JSON.stringify(c)
}
