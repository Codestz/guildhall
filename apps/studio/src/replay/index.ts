/**
 * The history replay lab (`/lab/replay?repo=react`, spike S4 of plan-hud-events, now T1's): a
 * repository's island grown from its first commit by scrubbing, without a rebuild. The same history the
 * hall shows (hall/history.ts, on the hall's clock and its timeline bar), over the studio's own copy of
 * a chronicle and the generator's plain island (no named places), with the comparison knobs:
 *
 *   `?repo=`   react (default, years of history) or guildhall (three days)
 *   `?look=`   grow (default: tiles rise from the sea, pieces grow from their origin), dither, snap
 *   `?span=`   the frontier's width, tiles on their way in at once (default 12)
 *   `?t=`      where in the history to open: 0..1, or a day (2019-03-01); default today
 * plus every hex island key (`?seed=`, `?life=0`, `?hour=`, …). For shots, `guildhall.ext.replay`.
 */
import { log } from "@guildhall/core"
import { REVEAL_SPAN, type RevealLook } from "@guildhall/render"
import { filesAt, readChronicle } from "@guildhall/sim"
import { createClock, createHallTime } from "../hall/clock.ts"
import { createHistory, readT } from "../hall/history.ts"
import { mountTimeline } from "../hall/timeline.tsx"
import { mountHexWorld } from "../hexworld/index.ts"
import type { Screen } from "../screens.ts"

const logger = log("studio:replay")

const REPOS = new Set(["react", "guildhall"])
const lookOf = (v: string | null): RevealLook => (v === "dither" || v === "snap" ? v : "grow")

export const replayLab: Screen = {
  id: "replay",
  title: "History replay",
  mount(host, ctx) {
    const repo = REPOS.has(ctx.query.get("repo") ?? "") ? (ctx.query.get("repo") as string) : "react"
    const at = readT(ctx.query.get("t"))
    const time = createHallTime(createClock({ t: at && "t" in at ? at.t : 1 }))
    let disposed = false
    let unmount = () => {}
    const run = async () => {
      const bytes = new Uint8Array(await (await fetch(`/lab/repo/${repo}.json.gz`)).arrayBuffer())
      const c = await readChronicle(bytes)
      if (disposed) return
      const query = new URLSearchParams(ctx.query)
      query.set("files", String(filesAt(c, c.end)))
      for (const k of ["repo", "look", "span", "t"]) query.delete(k)
      const history = createHistory({
        time,
        chronicle: Promise.resolve(c),
        at,
        look: lookOf(ctx.query.get("look")),
        span: Number(ctx.query.get("span") ?? REVEAL_SPAN),
        figures: true,
      })
      const offWorld = mountHexWorld(host, { ...ctx, query }, history.hooks)
      const offBar = mountTimeline(host, time)
      unmount = () => {
        offBar()
        offWorld()
        history.dispose()
      }
    }
    ctx.load(run()).catch((error: unknown) => {
      logger.error("replay failed", { error: String(error) })
      host.textContent = `The replay did not start: ${String(error)}`
    })
    return () => {
      disposed = true
      unmount()
    }
  },
}
