import { configureLog, type FrameStats, log } from "@guildhall/core"
import { setStageFlags } from "@guildhall/render/flags"
import { holdSiteStyle, NotFoundPage, PerfHud } from "@guildhall/ui"
import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { holdStudioStyle } from "./browser/style.ts"
import type { DebugHost } from "./debug.ts"
import { param } from "./params.ts"
import { screenFor } from "./screens.ts"
import { HOME_ID, placeOf } from "./shell/directory.ts"
import { canonical, here, href, resolve } from "./shell/router.ts"
import { BAR_PX } from "./shell/style.ts"
import { TopBar } from "./shell/TopBar.tsx"
import { openUrl } from "./site/nav.ts"
import { destHref, isSiteScreen, mountKey } from "./site/routes.ts"

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
/** How long the boot cover takes to fade (index.html's transition), ms. */
const BOOT_FADE_MS = 300

/**
 * Retires index.html's boot cover (painted before any script, so the page is never bare): once the
 * screen has mounted, it fades over whatever is up now (a world's own loading cover is the same ink and
 * crest, so the hand-off shows nothing; a site page is its own) and is removed after the fade. A world
 * screen's cover is already in `host` when `mount` returns (the viewer builds it synchronously), so no
 * frame between them shows the canvas's clear colour.
 */
function retireBoot(host: HTMLElement | null): void {
  const boot = document.getElementById("boot")
  if (!boot) return
  const covered =
    host?.querySelector(".ui-loader") !== null && host?.querySelector(".ui-loader") !== undefined
  // a world's cover is up at once: hand off now; a page without one fades the boot over its first paint
  const fade = () => {
    boot.dataset.state = "out"
    setTimeout(() => boot.remove(), BOOT_FADE_MS + 50)
  }
  if (covered) fade()
  else requestAnimationFrame(() => requestAnimationFrame(fade))
}

function titleOf(id: string | null, fallback: string): string {
  if (id === null) return "Lost at sea · Guildhall"
  if (id === "island") return "Guildhall"
  if (isSiteScreen(id)) return `${fallback} · Guildhall`
  if (id === HOME_ID) return "Guildhall Studio"
  const name = id ? (placeOf(id)?.tool.name ?? fallback) : "Not found"
  return `${name} · Guildhall Studio`
}

/** A path nothing answers: the site's own "Lost at sea" page, with the way back to the island, the demos, the harbour. */
function NotFound({ path }: { path: string }) {
  // the tokens and the site's sheet are up before the first paint, so the page never shows unstyled
  useLayoutEffect(() => {
    const studio = holdStudioStyle()
    const site = holdSiteStyle()
    return () => {
      site()
      studio.release()
    }
  }, [])
  return (
    <NotFoundPage
      path={path}
      hrefs={{ island: href("island"), demos: destHref("demos"), harbour: destHref("harbour") }}
      onNavigate={(id) => openUrl(id === "island" ? href("island") : destHref(id))}
    />
  )
}

/** The studio shell: the top bar, the screen the URL names in the window below it, the perf HUD. */
export function App({ debug }: { debug: DebugHost }) {
  const url = useUrl()
  const host = useRef<HTMLDivElement>(null)
  const { pathname, search } = new URL(url, location.origin)
  const { screen: id, query } = resolve(pathname, search)
  const screen = id ? screenFor(id) : undefined
  const [hud, setHud] = useState(param(query, "hud") === "perf")
  // a Viewer screen has its tools top-right: the perf HUD hangs below them
  const [viewer, setViewer] = useState(false)
  // `?bar=0` hides the top bar: bare screens, for shots and embeds.
  const bar = param(query, "bar")

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
    const spec = param(params, "log")
    if (spec) configureLog(spec)
    // the stages this screen makes: GPU timers and a fixed DPR (render never reads the address itself)
    setStageFlags({ gpuTimers: param(params, "timers"), dpr: param(params, "dpr") })
    setHud(param(params, "hud") === "perf")
    const target = id ? screenFor(id) : undefined
    if (!target || !host.current) {
      logger.warn("unknown route", { url })
      retireBoot(null)
      debug.mounted()
      return
    }
    logger.info("mount", { screen: target.id })
    const dispose = target.mount(host.current, { query: params, attach: debug.attach, load: debug.load })
    retireBoot(host.current)
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

  if (!screen) return <NotFound path={pathname} />
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
