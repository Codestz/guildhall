/**
 * The town's generation worker (the planner's pattern): towns grow here so the 3D view keeps drawing
 * while a new seed is laid out. Jobs run in arrival order; the screen drops replies it no longer wants.
 */
import type { JobLib } from "../planner/job.ts"
import { type FromWorker, runTownJob, type ToWorker } from "./job.ts"

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
    scope.postMessage({ type: "done", id: msg.id, job: runTownJob(msg.spec, lib) })
  } catch (error) {
    scope.postMessage({
      type: "fail",
      id: msg.id,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
