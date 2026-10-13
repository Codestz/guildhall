/**
 * The Viewer: one shell every screen that shows a world mounts into (a 3D stage or a 2D canvas). It
 * gives the screen a stage element to draw in and draws the chrome round it in V1's corners: the title
 * card with headline figures, the tools (perf, screenshot, inspector), the transport, the camera help,
 * the Inspector with the screen's knobs (kept in the URL) and read-outs, a loading veil and toasts.
 * Imperative on purpose: vanilla screens call it as readily as React ones.
 */
import { createRoot } from "react-dom/client"
import { holdUiStyle } from "../theme/hold.ts"
import {
  allKnobs,
  applyOf,
  type Knob,
  type KnobValue,
  type KnobValues,
  readKnobs,
  withKnobs,
} from "./knobs.ts"
import { createStore, type ViewState } from "./store.ts"
import { VIEWER_CSS } from "./style.ts"
import type { Loading, Transport, TransportSpec, Viewer, ViewerHooks, ViewerOptions } from "./types.ts"
import { type Actions, View } from "./View.tsx"

let sheetUsers = 0
let sheet: HTMLStyleElement | null = null
function holdViewerSheet(): () => void {
  if (sheetUsers++ === 0) {
    sheet = document.createElement("style")
    sheet.dataset.gh = "viewer"
    sheet.textContent = VIEWER_CSS
    document.head.append(sheet)
  }
  let held = true
  return () => {
    if (!held) return
    held = false
    if (--sheetUsers > 0) return
    sheet?.remove()
    sheet = null
  }
}

const div = (cls: string): HTMLDivElement => {
  const el = document.createElement("div")
  el.className = cls
  return el
}

/** How long a live knob waits before writing the URL (history.replaceState is throttled by browsers). */
const URL_MS = 160
const TOAST_MS = 4200
const PERF_MS = 500
/** Below this width the Inspector starts closed (it would cover the stage). */
const WIDE = 900

const typing = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null
  return (
    !!el &&
    (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)
  )
}

export function createViewer(host: HTMLElement, opts: ViewerOptions): Viewer {
  const uiStyle = holdUiStyle()
  const releaseSheet = holdViewerSheet()
  const root = div("gh ui-viewer")
  root.dataset.ghViewer = ""
  root.dataset.chrome = opts.chrome === false ? "off" : "on"
  const stage = div("ui-viewer-stage")
  const labels = div("ui-viewer-labels")
  const chrome = div("ui-viewer-chrome")
  const camera = div("ui-viewer-camera")
  camera.style.display = "contents"
  root.append(stage, labels, chrome)
  host.append(root)

  const sections = opts.sections ?? []
  const knobs = allKnobs(sections)
  const initial = readKnobs(knobs, opts.query)
  const wide = (host.clientWidth || window.innerWidth) >= WIDE
  const store = createStore({
    info: {
      eyebrow: opts.eyebrow,
      title: opts.title,
      subtitle: opts.subtitle,
      figures: opts.figures,
      status: opts.status ?? null,
    },
    readout: [],
    sections,
    help: opts.help ?? [],
    values: initial,
    built: initial,
    inspector: (opts.inspector ?? false) && wide,
    helpOpen: false,
    transport: null,
    loader: null,
    perf: null,
    canCapture: false,
    toasts: [],
  } satisfies ViewState)

  let query = new URLSearchParams(opts.query)
  const layoutFns = new Set<() => void>()
  const layout = () => {
    for (const fn of layoutFns) fn()
  }
  const syncInspector = () => {
    root.dataset.inspector = store.get().inspector ? "open" : "closed"
  }
  syncInspector()

  let urlTimer: ReturnType<typeof setTimeout> | null = null
  const writeUrl = () => {
    if (urlTimer) clearTimeout(urlTimer)
    urlTimer = setTimeout(() => {
      urlTimer = null
      // only the live values: a staged reload value reaches the URL with its rebuild
      const live = knobs.filter((k) => applyOf(k) === "live")
      query = withKnobs(query, live, store.get().values)
      opts.writeQuery?.(
        query,
        live.map((k) => k.key),
      )
    }, URL_MS)
  }

  const setValues = (patch: KnobValues, fromScreen: boolean) => {
    const before = store.get().values
    const values = { ...before, ...patch }
    const moved = knobs.filter((k) => before[k.key] !== values[k.key])
    if (moved.length === 0) return
    const live = moved.filter((k) => applyOf(k) === "live")
    // a live knob is built as soon as it moves
    const built = { ...store.get().built }
    for (const k of live) built[k.key] = values[k.key] as KnobValue
    store.set({ values, built })
    if (live.length) {
      writeUrl()
      if (!fromScreen) opts.onKnobs?.(values, live)
    }
  }

  let toastId = 0
  const toast = (text: string, detail?: string) => {
    const id = ++toastId
    store.set((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, detail }] }))
    setTimeout(() => store.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), TOAST_MS)
  }

  let hooks: ViewerHooks = {}
  let playRaf = 0
  let playLast = 0
  let spec: TransportSpec | null = null
  const tick = (now: number) => {
    const t = store.get().transport
    if (!t?.playing || !spec) return
    const dt = Math.min(0.1, (now - playLast) / 1000)
    playLast = now
    let v = t.value + t.rate * dt
    if (v > t.max) v = t.wrap ? t.min + ((v - t.min) % (t.max - t.min)) : t.max
    store.set({ transport: { ...t, value: v, playing: v < t.max || !!t.wrap } })
    spec.onChange(v)
    playRaf = requestAnimationFrame(tick)
  }
  const play = (on: boolean) => {
    const t = store.get().transport
    if (!t) return
    cancelAnimationFrame(playRaf)
    store.set({ transport: { ...t, playing: on } })
    if (on) {
      playLast = performance.now()
      playRaf = requestAnimationFrame(tick)
    }
  }

  const act: Actions = {
    setKnob: (key, value) => setValues({ [key]: value }, false),
    rebuild() {
      const values = store.get().values
      opts.reload?.(
        withKnobs(query, knobs, values),
        knobs.map((k) => k.key),
      )
    },
    discard() {
      const { values, built } = store.get()
      const back: KnobValues = { ...values }
      for (const k of knobs) if (applyOf(k) === "reload") back[k.key] = built[k.key] as KnobValue
      store.set({ values: back })
    },
    resetAll() {
      const defaults: KnobValues = {}
      for (const k of knobs) defaults[k.key] = k.default
      const reloads = knobs.filter(
        (k: Knob) => applyOf(k) === "reload" && store.get().built[k.key] !== k.default,
      )
      setValues(defaults, false)
      if (reloads.length) act.rebuild()
    },
    toggleInspector(open) {
      store.set((s) => ({ inspector: open ?? !s.inspector }))
      syncInspector()
      layout()
    },
    toggleHelp: () => store.set((s) => ({ helpOpen: !s.helpOpen })),
    play,
    scrub(v) {
      const t = store.get().transport
      if (!t) return
      store.set({ transport: { ...t, value: v } })
      spec?.onChange(v)
    },
    async capture() {
      const url = await hooks.capture?.()
      if (!url) {
        toast("No screenshot: the stage would not give one")
        return
      }
      const stamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-")
      const name = `${opts.name ?? "guildhall"}-${stamp}.png`
      const a = document.createElement("a")
      a.href = url
      a.download = name
      a.click()
      toast("Screenshot saved", name)
    },
    dismiss: (id) => store.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return
    if (e.code === "KeyI" && store.get().sections.length + store.get().readout.length > 0) {
      e.preventDefault()
      act.toggleInspector()
    }
  }
  addEventListener("keydown", onKey)

  const ro = new ResizeObserver(layout)
  ro.observe(root)

  let perfTimer: ReturnType<typeof setInterval> | null = null

  const reactRoot = createRoot(chrome)
  // rendered on React's schedule: a screen mounts from inside the shell's own commit
  reactRoot.render(<View store={store} act={act} slot={camera} />)

  return {
    root,
    stage,
    labels,
    camera,
    values: () => store.get().values,
    setValues: (values) => setValues(values, true),
    setInfo: (info) => store.set((s) => ({ info: { ...s.info, ...info } })),
    setReadout: (readout) => store.set({ readout }),
    transport(next): Transport {
      spec = next
      store.set({ transport: { ...next, playing: false } })
      if (next.playing) play(true)
      return {
        set(v) {
          const t = store.get().transport
          if (t) store.set({ transport: { ...t, value: v } })
        },
        value: () => store.get().transport?.value ?? next.value,
        playing: () => store.get().transport?.playing ?? false,
        dispose() {
          cancelAnimationFrame(playRaf)
          spec = null
          store.set({ transport: null })
        },
      }
    },
    loading(title, steps): Loading {
      store.set({ loader: { title, steps, at: 0 } })
      const indexOf = (s: string | number) => (typeof s === "number" ? s : Math.max(0, steps.indexOf(s)))
      const status = (at: number) => (at < steps.length ? `${steps[at]}…` : null)
      return {
        step(s) {
          const at = indexOf(s)
          const l = store.get().loader
          if (l) store.set({ loader: { ...l, at } })
          if (!l || l.out) store.set((st) => ({ info: { ...st.info, status: status(at) } }))
        },
        lift() {
          const l = store.get().loader
          if (!l) return
          store.set((st) => ({ loader: { ...l, out: true }, info: { ...st.info, status: status(l.at) } }))
        },
        done() {
          const l = store.get().loader
          store.set((st) => ({
            loader: l ? { ...l, at: steps.length, out: true } : null,
            info: { ...st.info, status: null },
          }))
        },
        fail(message) {
          const l = store.get().loader
          store.set({ loader: { title, steps, at: l?.at ?? 0, error: message } })
        },
      }
    },
    attach(next) {
      hooks = { ...hooks, ...next }
      store.set({ canCapture: !!hooks.capture })
      if (perfTimer) clearInterval(perfTimer)
      perfTimer = null
      if (hooks.stats) {
        const read = () => {
          const s = hooks.stats?.()
          if (s && s.fps > 0) store.set({ perf: s })
        }
        perfTimer = setInterval(read, PERF_MS)
      }
    },
    toast,
    coveredRight() {
      if (!store.get().inspector || root.dataset.chrome === "off") return 0
      const panel = root.querySelector<HTMLElement>(".ui-inspector")
      // a bottom sheet (narrow) covers no right edge
      if (!panel || panel.offsetLeft < root.clientWidth / 2) return 0
      return root.clientWidth - panel.offsetLeft + 8
    },
    onLayout(fn) {
      layoutFns.add(fn)
      return () => layoutFns.delete(fn)
    },
    dispose() {
      removeEventListener("keydown", onKey)
      ro.disconnect()
      cancelAnimationFrame(playRaf)
      if (urlTimer) clearTimeout(urlTimer)
      if (perfTimer) clearInterval(perfTimer)
      layoutFns.clear()
      root.style.display = "none"
      // a screen is torn down from the shell's own React commit: the nested root unmounts after it
      setTimeout(() => {
        reactRoot.unmount()
        root.remove()
        releaseSheet()
        uiStyle.release()
      }, 0)
    },
  }
}
