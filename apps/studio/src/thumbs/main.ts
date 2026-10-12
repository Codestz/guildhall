/**
 * The thumbnail page (thumbs.html), driven headless by `bun import thumbs`:
 *
 *   await guildhall.ext.thumbs.render([{ id, url }, …])  →  [{ id, webpBase64 } | { id, error }, …]
 *
 * One renderer for the page's life; each batch loads its pieces through `loadPiece`, draws them with
 * `renderThumbnail` (fixed 3/4 view, transparent WebP) and frees their geometry once the batch is done.
 */
import { createStage, disposeObject, loadPiece, renderThumbnail } from "@guildhall/render"
import { createDebug } from "../debug.ts"

export interface ThumbJob {
  id: string
  url: string
}

export type ThumbResult = { id: string; webpBase64: string } | { id: string; error: string }

export interface ThumbsExt {
  render(jobs: ThumbJob[]): Promise<ThumbResult[]>
}

const debug = createDebug()
window.guildhall = debug.api

/** The blob's bytes as base64, which is what crosses back to the tool. */
function base64(blob: Blob): Promise<string> {
  return new Promise((done, fail) => {
    const reader = new FileReader()
    reader.onload = () => done(String(reader.result).slice(String(reader.result).indexOf(",") + 1))
    reader.onerror = () => fail(reader.error)
    reader.readAsDataURL(blob)
  })
}

/** One renderer for the page's life, lent by a stage whose own canvas stays a pixel. */
function start(): ThumbsExt {
  const host = document.createElement("div")
  host.style.cssText = "width:1px;height:1px"
  document.body.append(host)
  const stage = createStage(host, { dpr: [1, 1] })
  debug.attach(stage)
  return {
    async render(jobs) {
      const loaded: Awaited<ReturnType<typeof loadPiece>>[] = []
      const out: ThumbResult[] = []
      try {
        for (const job of jobs) {
          try {
            const piece = await loadPiece(job.url)
            loaded.push(piece)
            out.push({ id: job.id, webpBase64: await base64(await renderThumbnail(stage.renderer, piece)) })
          } catch (error) {
            out.push({ id: job.id, error: error instanceof Error ? error.message : String(error) })
          }
        }
      } finally {
        for (const piece of loaded) disposeObject(piece)
      }
      return out
    },
  }
}

// Without WebGL there is no `ext.thumbs`; the page still reports ready, so the tool can say why.
try {
  debug.api.ext.thumbs = start()
} catch (error) {
  console.error(`thumbs: no renderer: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  debug.mounted()
}
