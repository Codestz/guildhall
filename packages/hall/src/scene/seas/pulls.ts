import type { Pull } from "../../guild/docket.ts"
import {
  ARRIVE_MS,
  along,
  BERTH,
  BERTH_STEP,
  berthSpot,
  clamp01,
  easeInOut,
  easeOut,
  FAR,
  fadeOut,
  LEAVE_MS,
  MERGE_MS,
  MOORED_MS,
  turn,
  type Voyage,
} from "./passage.ts"

/**
 * A pull request's ship (PROTOCOL.md §7), from its place on the docket (guild/docket.ts): sailing
 * in to its berth at the anchorage, at anchor, sailing in to moor by the quay once merged, moored,
 * or sailing away once closed. Its pennant flies its status, and the hull grows with its diff.
 * Undefined while it waits for a berth, and once its passage is over.
 */
export function pullVoyage(pull: Pull, time: number, moor: () => number): Voyage | undefined {
  if (pull.berth === -1) return undefined
  const base = { hull: "pr" as const, key: pull.key, crates: 0, size: pull.size }
  const anchor = berthSpot(pull.berth)
  const { ended } = pull
  if (!ended) {
    const p = clamp01((time - pull.seated) / ARRIVE_MS)
    const from = { side: anchor.side - 50, out: FAR }
    if (p < 1) {
      const at = along({ from, to: anchor }, easeOut(p))
      return {
        ...base,
        ...at,
        heading: turn(at.heading, Math.PI / 2, easeInOut(clamp01((p - 0.6) / 0.4))),
        shown: clamp01(p / 0.15),
        sailing: p < 0.95,
        mark: pull.status,
      }
    }
    return { ...base, ...anchor, heading: Math.PI / 2, shown: 1, sailing: false, mark: pull.status }
  }
  const age = time - ended.at
  if (ended.kind === "pr_closed") {
    if (age >= LEAVE_MS) return undefined
    const p = age / LEAVE_MS
    const at = along({ from: anchor, to: { side: anchor.side - 70, out: FAR } }, p * p)
    return {
      ...base,
      ...at,
      heading: turn(Math.PI / 2, at.heading, clamp01(p * 4)),
      shown: fadeOut(p),
      sailing: true,
      mark: "closed",
    }
  }
  if (age >= MERGE_MS + MOORED_MS + LEAVE_MS) return undefined
  const slot = moor()
  const moored = { side: BERTH.side + slot * BERTH_STEP, out: BERTH.out }
  const merged = { ...base, mark: "merged" as const }
  // Into the harbour: out a little to clear the anchorage, then in to the quay, bow to the island.
  const approach = { side: moored.side, out: moored.out + 22 }
  if (age < MERGE_MS) {
    const p = easeInOut(age / MERGE_MS)
    const first = p < 0.5
    const leg = first ? { from: anchor, to: approach } : { from: approach, to: moored }
    const at = along(leg, first ? p * 2 : (p - 0.5) * 2)
    const heading = first ? turn(Math.PI / 2, at.heading, clamp01(p * 6)) : at.heading
    return { ...merged, ...at, heading, shown: 1, sailing: true }
  }
  if (age < MERGE_MS + MOORED_MS) return { ...merged, ...moored, heading: Math.PI, shown: 1, sailing: false }
  const p = (age - MERGE_MS - MOORED_MS) / LEAVE_MS
  const at = along({ from: moored, to: { side: moored.side - 40, out: FAR } }, p * p)
  return { ...merged, ...at, shown: fadeOut(p), sailing: true }
}
