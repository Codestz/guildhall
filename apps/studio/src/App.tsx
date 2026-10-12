import { configureLog, type FrameStats, log } from "@guildhall/core"
import { PerfHud } from "@guildhall/ui"
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react"
import type { DebugHost } from "./debug.ts"
import { DEFAULT_SCREEN, SCREENS, screenFor } from "./screens.ts"

const logger = log("studio:shell")

const NO_STATS: FrameStats = {
  fps: 0,
  frameMs: { p50: 0, p95: 0 },
  calls: 0,
  tris: 0,
  geometries: 0,
  textures: 0,
  dpr: 1,
}

const fill: CSSProperties = { position: "fixed", inset: 0, overflow: "hidden" }
const missing: CSSProperties = {
  ...fill,
  display: "grid",
  placeContent: "center",
  background: "#15110d",
  color: "#f3e9d4",
  font: "14px/1.6 ui-monospace, Menlo, monospace",
}

/** The URL's query, kept in step with back/forward and `guildhall.open`. */
function useSearch(): string {
  const [search, setSearch] = useState(location.search)
  useEffect(() => {
    const sync = () => setSearch(location.search)
    addEventListener("popstate", sync)
    return () => removeEventListener("popstate", sync)
  }, [])
  return search
}

/** The studio shell: mounts the screen the deep link names into a full-window host, plus the perf HUD. */
export function App({ debug }: { debug: DebugHost }) {
  const search = useSearch()
  const host = useRef<HTMLDivElement>(null)
  const query = new URLSearchParams(search)
  const screen = screenFor(query)
  const [hud, setHud] = useState(query.get("hud") === "perf")

  // A deep link is a fresh load: any change to the query remounts the screen.
  useEffect(() => {
    const params = new URLSearchParams(search)
    const spec = params.get("log")
    if (spec) configureLog(spec)
    setHud(params.get("hud") === "perf")
    const target = screenFor(params)
    if (!target || !host.current) {
      logger.warn("unknown screen", { screen: params.get("screen") })
      debug.mounted()
      return
    }
    logger.info("mount", { screen: target.id })
    const dispose = target.mount(host.current, { query: params, attach: debug.attach, load: debug.load })
    debug.mounted()
    return () => {
      dispose()
      debug.attach(null)
    }
  }, [search, debug])

  useEffect(() => {
    const toggle = (e: KeyboardEvent) => {
      if (e.code === "Backquote" && !e.repeat) setHud((on) => !on)
    }
    addEventListener("keydown", toggle)
    return () => removeEventListener("keydown", toggle)
  }, [])

  const stats = useCallback(() => debug.stage()?.stats() ?? NO_STATS, [debug])

  if (!screen) {
    const known = SCREENS.map((s) => s.id).join(", ")
    return (
      <div style={missing}>
        <p>
          No screen “{query.get("screen")}”. Known: {known} (default {DEFAULT_SCREEN}).
        </p>
      </div>
    )
  }
  return (
    <>
      <div ref={host} style={fill} data-screen={screen.id} />
      {hud && <PerfHud stats={stats} />}
    </>
  )
}
