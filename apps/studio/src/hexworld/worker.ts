/**
 * The hex island's build worker (the town worker's pattern): one job per screen, its stages posted as
 * they are ready with their arrays handed over. The screen terminates it when it goes.
 */
import { type FromWorker, runHexJob, type ToWorker, transferables } from "./job.ts"

interface Scope {
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null
  postMessage(message: FromWorker, transfer?: Transferable[]): void
}
const scope = self as unknown as Scope

scope.onmessage = (e) => {
  try {
    runHexJob(e.data.spec, (msg) => scope.postMessage(msg, transferables(msg)))
  } catch (error) {
    scope.postMessage({ type: "fail", message: error instanceof Error ? error.message : String(error) })
  }
}
