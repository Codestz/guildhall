/**
 * The recorded runs, ported from V1 (main:packages/core/test/fixtures): one per OpenCode, a main
 * agent that launched one `explore` subagent to map a small repo. The sim's tests replay them too.
 */

import { join } from "node:path"

export interface Recorded {
  events: { at: number; event: unknown }[]
  history: Record<string, unknown>
}

/** The fixtures folder, for a test elsewhere that reads the same runs. */
export const FIXTURES = join(import.meta.dir, "fixtures")

export async function recorded(version: 1 | 2): Promise<Recorded> {
  const text = await Bun.file(join(FIXTURES, `v${version}.jsonl`)).text()
  const lines = text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { kind: string; at: number; event: unknown } & Record<string, unknown>)
  const history = lines.find((line) => line.kind === "history")
  if (!history) throw new Error(`fixture v${version} has no history line`)
  return { events: lines.filter((line) => line.kind === "event"), history }
}
