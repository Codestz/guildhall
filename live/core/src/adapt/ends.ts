// from opencode-cockpit: packages/subagents/src/core/adapt/ends.ts (ADR 0001)
/**
 * When a stored run ended, read off what was stored — shared by the interface, which draws reopened
 * runs, and the agent side, which lists them. Pure.
 */

import type { Change } from "../model/changes.ts"

/** The last moment a stored run did anything: its latest change, or `fallback` when it has none. */
export function endOf(changes: readonly Change[], fallback: number): number {
  let last = 0
  for (const change of changes) {
    last = Math.max(last, change.at)
    if (change.type === "tool" && change.ended !== undefined) last = Math.max(last, change.ended)
  }
  return last || fallback
}

/**
 * When a reloaded run's last message *finished*, read off the messages themselves.
 *
 * History stamps each change with its message's creation time, so a run of one prompt and one answer —
 * an advisor consulted once — ended, by `endOf`, a moment after it started: "done · 0s" for a call that
 * took a minute. A message records when it completed; that is the end. Takes OpenCode 1's
 * `{ info, parts }` and OpenCode 2's bare messages alike.
 */
export function finishedAt(messages: readonly unknown[]): number {
  let last = 0
  for (const each of messages) {
    if (!each || typeof each !== "object") continue
    const message = ((each as { info?: unknown }).info ?? each) as { time?: { completed?: unknown } }
    const completed = Number(message.time?.completed)
    if (Number.isFinite(completed) && completed > last) last = completed
  }
  return last
}
