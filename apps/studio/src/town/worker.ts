/**
 * The town's generation worker (the planner's pattern): towns grow here so the 3D view keeps drawing
 * while a new seed is laid out, and its ground and water meshes are built (their arrays are handed
 * over, not copied). Jobs run in arrival order; the screen drops replies it no longer wants.
 */
import type { JobLib } from "../planner/job.ts"
import { type FromWorker, runTownJob, type ToWorker, transferables } from "./job.ts"

interface Scope {
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null
  postMessage(message: FromWorker, transfer?: Transferable[]): void
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
    const job = runTownJob(msg.spec, lib)
    scope.postMessage({ type: "done", id: msg.id, job }, transferables(job))
  } catch (error) {
    scope.postMessage({
      type: "fail",
      id: msg.id,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
