import { answer, type GrowRequest } from "./job.ts"

/** The Web Worker that grows islands off the main thread (grow/pool.ts spawns it); all it does is `answer`. */
self.onmessage = ({ data }: MessageEvent<GrowRequest>) => {
  const { reply, transfer } = answer(data)
  self.postMessage(reply, { transfer })
}
