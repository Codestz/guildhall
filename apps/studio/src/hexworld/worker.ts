/**
 * The hex island's build worker (the town worker's pattern): one job per screen, its stages posted as
 * they are ready with their arrays handed over. The screen terminates it when it goes. After the job it
 * keeps the life plan's desk (lifePlan.ts `AgentDesk`: the walk graph and the heroes' spots), and plans
 * a session's heroes on it as the session's log grows (`agents` messages, answered in turn).
 */
import { type FromWorker, runHexJob, type ToWorker, transferables } from "./job.ts"
import type { AgentDesk } from "./lifePlan.ts"

interface Scope {
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null
  postMessage(message: FromWorker, transfer?: Transferable[]): void
}
const scope = self as unknown as Scope
let desk: AgentDesk | null = null

/** A session's heroes planned on the desk (null: no desk, or the planning failed). */
const plan = (req: Parameters<AgentDesk["plan"]>[0]) => {
  try {
    return desk?.plan(req) ?? null
  } catch {
    return null
  }
}

scope.onmessage = (e) => {
  const msg = e.data
  try {
    if (msg.type === "job") desk = runHexJob(msg.spec, (out) => scope.postMessage(out, transferables(out)))
    else scope.postMessage({ type: "agents", id: msg.id, reply: plan(msg.req) })
  } catch (error) {
    scope.postMessage({ type: "fail", message: error instanceof Error ? error.message : String(error) })
  }
}
