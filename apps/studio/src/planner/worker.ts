/**
 * The planner's generation worker: towns are grown here so dragging the seed never stalls the map.
 * Jobs run in arrival order; the screen drops replies it no longer wants.
 */
import { type FromWorker, type JobLib, runJob, type ToWorker } from "./job.ts"

interface Scope {
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null
  postMessage(message: FromWorker): void
}
const scope = self as unknown as Scope

let lib: JobLib | null = null

scope.onmessage = (e) => {
  const msg = e.data
  if (msg.type === "lib") {
    lib = msg.lib
    return
  }
  if (!lib) {
    scope.postMessage({ type: "fail", id: msg.id, message: "no library yet" })
    return
  }
  try {
    scope.postMessage({ type: "done", id: msg.id, result: runJob(msg.spec, lib) })
  } catch (error) {
    scope.postMessage({
      type: "fail",
      id: msg.id,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
