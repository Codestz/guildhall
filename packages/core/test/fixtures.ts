// from opencode-cockpit: packages/subagents/test/fixtures.ts (ADR 0001)
/** The recorded runs (docs/opencode/agents.md): one per OpenCode, a subagent mapping a small repo. */

import { join } from "node:path"

export interface Recorded {
  events: { at: number; event: unknown }[]
  history: Record<string, unknown>
}

export async function recorded(version: 1 | 2): Promise<Recorded> {
  const text = await Bun.file(join(import.meta.dir, "fixtures", `v${version}.jsonl`)).text()
  const lines = text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { kind: string; at: number; event: unknown } & Record<string, unknown>)
  const history = lines.find((line) => line.kind === "history")
  if (!history) throw new Error(`fixture v${version} has no history line`)
  return { events: lines.filter((line) => line.kind === "event"), history }
}
