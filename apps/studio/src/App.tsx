import { configureLog, type FrameStats, log } from "@guildhall/core"
import { PerfHud } from "@guildhall/ui"
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react"
import type { DebugHost } from "./debug.ts"
import { BASE } from "./env.ts"
import { screenFor } from "./screens.ts"
import { HOME_ID, openable, placeOf } from "./shell/directory.ts"
import { follow } from "./shell/nav.ts"
import { canonical, here, resolve } from "./shell/router.ts"
import { BAR_PX } from "./shell/style.ts"
import { TopBar } from "./shell/TopBar.tsx"
import { isSiteScreen, mountKey } from "./site/routes.ts"

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

/** The Viewer's top-right tools row (40 px buttons and a 12 px gutter) the perf HUD keeps clear of. */
const VIEWER_TOOLS_PX = 52

const fill: CSSProperties = { position: "fixed", inset: 0, overflow: "hidden" }
/** Below the top bar: screens fill what is left, so the bar never covers them. */
const belowBar: CSSProperties = { ...fill, top: BAR_PX }
/** The perf HUD's frame: its own `top: 12; right: 12` then lands below the bar. */
const hudFrame = (top: number): CSSProperties => ({ position: "fixed", top, left: 0, right: 0, zIndex: 40 })
const missing: CSSProperties = {
  ...fill,
  display: "grid",
  placeContent: "center",
  background: "#15110d",
  color: "#f3e9d4",
  font: "14px/1.6 ui-monospace, Menlo, monospace",
}
const link: CSSProperties = { color: "#e2b85c" }

/** The URL now, after replacing an old `?screen=` link (or any non-canonical form) in place. */
function sync(): string {
  const want = canonical(here())
  if (want !== here()) history.replaceState(null, "", want)
  return here()
}

/** The URL (path and query), kept in step with back/forward and `guildhall.open`. */
function useUrl(): string {
  const [url, setUrl] = useState(sync)
  useEffect(() => {
    const onPop = () => setUrl(sync())
    addEventListener("popstate", onPop)
    return () => removeEventListener("popstate", onPop)
  }, [])
  return url
}

/** The tab's title for a screen: its directory name, "Not found" for a path no screen answers. */
function titleOf(id: string | null, fallback: string): string {
  if (id === "island") return "Guildhall"
  if (isSiteScreen(id)) return `${fallback} · Guildhall`
  if (id === HOME_ID) return "Guildhall Studio"
  const name = id ? (placeOf(id)?.tool.name ?? fallback) : "Not found"
  return `${name} · Guildhall Studio`
}

/** The studio shell: the top bar, the screen the URL names in the window below it, the perf HUD. */
export function App({ debug }: { debug: DebugHost }) {
  const url = useUrl()
  const host = useRef<HTMLDivElement>(null)
  const { pathname, search } = new URL(url, location.origin)
  const { screen: id, query } = resolve(pathname, search)
  const screen = id ? screenFor(id) : undefined
  const [hud, setHud] = useState(query.get("hud") === "perf")
  // a Viewer screen has its tools top-right: the perf HUD hangs below them
  const [viewer, setViewer] = useState(false)
  // `?bar=0` hides the top bar: bare screens, for shots and embeds.
  const bar = query.get("bar") !== "0"

  useEffect(() => {
    document.title = titleOf(screen ? screen.id : null, screen?.title ?? "")
  }, [screen])

  // A deep link is a fresh load: any change to the URL remounts a Studio screen. A site screen remounts
  // only when its world or section changes (`/` to `/demos` keeps the island it has built).
  const key = mountKey(id ?? "", query, url)
  // biome-ignore lint/correctness/useExhaustiveDependencies: `url` is read for what `key` says changed
  useEffect(() => {
    const at = new URL(url, location.origin)
    const { screen: id, query: params } = resolve(at.pathname, at.search)
    const spec = params.get("log")
    if (spec) configureLog(spec)
    setHud(params.get("hud") === "perf")
    const target = id ? screenFor(id) : undefined
    if (!target || !host.current) {
      logger.warn("unknown route", { url })
      debug.mounted()
      return
    }
    logger.info("mount", { screen: target.id })
    const dispose = target.mount(host.current, { query: params, attach: debug.attach, load: debug.load })
    // screens load as their own chunks, so the Viewer may arrive after the mount: watch for it
    const el = host.current
    const seen = () => setViewer(el.querySelector("[data-gh-viewer]") !== null)
    seen()
    const watch = new MutationObserver(seen)
    watch.observe(el, { childList: true, subtree: true })
    debug.mounted()
    return () => {
      watch.disconnect()
      dispose()
      debug.attach(null)
    }
  }, [key, debug])

  // a move inside one site screen's mount (`/` to `/demos`) is still a navigation `open()` waits for
  useEffect(() => {
    if (url) debug.mounted()
  }, [url, debug])

  useEffect(() => {
    const toggle = (e: KeyboardEvent) => {
      if (e.code === "Backquote" && !e.repeat) setHud((on) => !on)
    }
    addEventListener("keydown", toggle)
    return () => removeEventListener("keydown", toggle)
  }, [])

  const stats = useCallback(() => debug.stage()?.stats() ?? NO_STATS, [debug])

  if (!screen) {
    const known = openable()
      .map((p) => p.tool.name)
      .join(", ")
    return (
      <div style={missing}>
        <p>Nothing at “{pathname}”.</p>
        <p>
          The studio has: {known}.{" "}
          <a style={link} href={BASE} onClick={follow(HOME_ID)}>
            Go home
          </a>
        </p>
      </div>
    )
  }
  const site = isSiteScreen(screen.id)
  return (
    <>
      {bar && !site && <TopBar screen={screen.id} title={screen.title} hud={hud} onHud={setHud} />}
      <div ref={host} style={bar && !site ? belowBar : fill} data-screen={screen.id} />
      {hud && screen.id !== HOME_ID && (
        <div style={hudFrame((bar && !site ? BAR_PX : 0) + (viewer ? VIEWER_TOOLS_PX : 0))}>
          <PerfHud stats={stats} />
        </div>
      )}
    </>
  )
}
