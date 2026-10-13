/**
 * The studio's way into `@guildhall/ui`'s Viewer: the shell's names (the directory's tool and group), the
 * router (knobs live in the deep link; a rebuild opens the screen again), `?ui=0` / `?bar=0` for a bare
 * stage, and a Stage's frame stats and pixels for the perf chip and the screenshot button. Every screen
 * that shows a world mounts through here (decisions.md "Studio UI system + generic 3D Viewer").
 */
import type { Stage } from "@guildhall/render"
import { createViewer, type Viewer, type ViewerOptions } from "@guildhall/ui"
import type { ScreenCtx } from "../screens.ts"
import { placeOf } from "./directory.ts"
import { current, href, replaceQuery } from "./router.ts"

export interface StudioViewer extends Viewer {
  /** The 3D stage under the viewer: its frame stats feed the perf chip, its pixels the screenshot. */
  attachStage(stage: Stage): void
  /** A 2D canvas under the viewer: its pixels feed the screenshot. */
  attachCanvas(canvas: HTMLCanvasElement): void
}

export type StudioViewerOptions = Omit<
  ViewerOptions,
  "query" | "writeQuery" | "reload" | "chrome" | "title"
> & {
  /** What is on the stage ("Island IV"); default the tool's name in the directory. */
  title?: string
}

/** The open URL's query with the viewer's keys set from `values` (a key missing there is removed). */
function merged(values: URLSearchParams, keys: readonly string[]): URLSearchParams {
  const out = current().query
  for (const key of keys) {
    const v = values.get(key)
    if (v === null) out.delete(key)
    else out.set(key, v)
  }
  return out
}

/** What the stage draws next, as a PNG: read in the frame after a draw, before the buffer is cleared. */
export function captureStage(stage: Stage): Promise<string | null> {
  return new Promise((done) => {
    const off = stage.onFrame(() => {
      off()
      // registered during frame N, after the stage asked for N+1: runs right after N+1 is drawn
      requestAnimationFrame(() => {
        try {
          done(stage.renderer.domElement.toDataURL("image/png"))
        } catch {
          done(null)
        }
      })
    })
  })
}

export function mountViewer(
  host: HTMLElement,
  ctx: ScreenCtx,
  screen: string,
  opts: StudioViewerOptions,
): StudioViewer {
  const place = placeOf(screen)
  const bare = ctx.query.get("ui") === "0" || ctx.query.get("bar") === "0"
  const viewer = createViewer(host, {
    ...opts,
    // the top bar already says group / tool: a card naming what is on stage carries the tool as its eyebrow
    eyebrow: opts.eyebrow ?? (opts.title ? place?.tool.name : place?.group?.name),
    title: opts.title ?? place?.tool.name ?? screen,
    name: opts.name ?? screen,
    query: ctx.query,
    chrome: !bare,
    writeQuery: (values, keys) => replaceQuery(merged(values, keys)),
    reload(values, keys) {
      const at = current().screen ?? screen
      const url = href(at, merged(values, keys))
      if (window.guildhall) void window.guildhall.open(url)
      else {
        history.pushState(null, "", url)
        dispatchEvent(new PopStateEvent("popstate"))
      }
    },
  })
  return {
    ...viewer,
    attachStage(stage) {
      viewer.attach({
        stats: () => {
          const s = stage.stats()
          return {
            fps: s.fps,
            p95: s.frameMs.p95,
            passes: s.passes,
            cpu: s.cpu,
            calls: s.calls,
            tris: s.tris,
            dpr: s.dpr,
          }
        },
        capture: () => captureStage(stage),
      })
    },
    attachCanvas(canvas) {
      viewer.attach({ capture: async () => canvas.toDataURL("image/png") })
    },
  }
}
