/**
 * The probe server: a warm, headless Chrome on the running hall (`bun run dev` first), so a visual
 * check costs about a second instead of a cold launch and a 12 s island load (scripts/shot.ts).
 *
 *   bun scripts/probe.ts start           (or: bun scripts/probe-server.ts [--url U] [--port P] [--dpr D])
 *   bun scripts/probe.ts stop
 *
 * Same Chrome, flags and GPU settings as shot.ts (Metal, uncapped), its own throwaway profile:
 * never your browser, never your tabs. DPR 2 by default (`--dpr 1` for faster, smaller shots).
 * Math.random is seeded on every load, so the island's random dressing is the same each time.
 *
 * Why a fresh state is a reload: applied in place, a link only changes what it names. The story,
 * a rush's crowd size (store.ts RUSH, module state), weather still easing, adventurers mid-walk all
 * carried over from the last state — a crowd shot left 301 adventurers in the next, a storm its
 * clouds. A load re-runs every module with Math.random re-seeded, so it repeats.
 *
 * HTTP on 127.0.0.1 only (port 5299 by default; written to .probe/probe-server.json), JSON in/out:
 *
 *   GET  /health                     { ok, url, dpr, meshes, loads, uptime }
 *   POST /state  { query, fresh?, settle? }   a deep link (guild/deeplink.ts). fresh (default true):
 *                                    the page loaded afresh at ?query (~1 s), exactly a cold load of
 *                                    that link whatever came before; fresh: false applies it in place
 *                                    on top of the current state (history kept: walkers, weather)
 *   POST /look   { at, settle? }      just the camera: a site, landmark or "x,z" (in place)
 *   POST /shot   { name, state?, after?, lab?, settle?, fresh?, png?, viewport?: [w, h] }
 *                                    state as /state; `after`, a second link applied in place once
 *                                    that settled (a lever moved live), AFTER_MS before the shot.
 *                                    One request, so no other client's state lands in between   → { path, ms }  (.probe/<name>.jpg,
 *                                    q90, ~0.35 s at DPR 2; png: true for a lossless .png, ~1.5 s)
 *   POST /eval   { js, lab? }         → { result }
 *   POST /steps  { steps, lab? }      a shot.ts steps array (scripts/steps.ts) → { evals, shots }
 *   POST /reload { query? }           a full reload of the hall at ?query (the link applied at startup)
 *   POST /diff   { reference, current, out, pixel?, threshold? }   pixel diff of two images
 *                                    (scripts/golden.ts); the diff image is written only over threshold
 *   POST /stop
 *
 * `lab` runs on a second page (`?lab=…`, lab/labs.ts) so the island page stays warm.
 * Every reply carries `errors`: page errors and console errors since the last request.
 *
 * Recovery: a navigation (Vite's full reload after an edit) marks the world unready, and the next
 * request waits for it to mount again; a world that never mounts (mesh count under MIN_MESHES), a
 * lost WebGL context or a crashed tab is reloaded, then the page replaced.
 */
import { mkdir } from "node:fs/promises"
import { type Browser, type BrowserContext, chromium, type Page } from "playwright-core"
import { parseDeepLink } from "../packages/hall/src/guild/deeplink.ts"
import {
  CHROME,
  CHROME_ARGS,
  capture,
  INFO_PATH,
  loadSettle,
  PROBE_DIR,
  runSteps,
  type Step,
  shotPath,
  VIEWPORT,
} from "./steps.ts"

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const BASE = arg("url") ?? process.env.PROBE_URL ?? "http://localhost:5199/"
const PORT = Number(arg("port") ?? process.env.PROBE_PORT ?? 5299)
const DPR = Number(arg("dpr") ?? process.env.DPR ?? 2)
/**
 * A mounted island is ~120–160 meshes (most things are instanced); the canvas before it, a handful.
 * Mounted also means the store's hold is released (scene/Scene.tsx WorldReady).
 */
const MIN_MESHES = 60
const MOUNT_TIMEOUT_MS = 45_000
const SEED = 0x5a6a
/** After a state applied in place: the camera's cut, a seek's re-cast, a new weather settling in. Measured: 150 ms is
 * already within GPU noise of 3 s for a site close-up; 600 leaves room for slower scenes. */
const SETTLE_MS = 600
/** After a shot's `after` link: a quality tier's remount and its first frames. */
const AFTER_MS = 1200

let browser: Browser
let context: BrowserContext
let hall: Page
let lab: Page | undefined
let ready = false
let loads = 0
let errors: string[] = []
const started = Date.now()

async function launch(): Promise<void> {
  // Capped at the display rate unless PROBE_UNCAPPED=1: shots need pixels, not headroom, and an
  // uncapped page burns the GPU (and the battery) for nothing. Frame-rate work uses bench.ts.
  const args =
    process.env.PROBE_UNCAPPED === "1" ? CHROME_ARGS : CHROME_ARGS.filter((arg) => !UNCAPPED.has(arg))
  browser = await chromium.launch({ executablePath: CHROME, args })
  browser.on("disconnected", () => {
    if (!stopping) void relaunch()
  })
  context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: DPR })
  // The same random island dressing every load (mulberry32, as scripts/record.ts seeds it).
  await context.addInitScript((seed: number) => {
    let s = seed >>> 0
    Math.random = () => {
      s = (s + 0x6d2b79f5) >>> 0
      let t = s
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }, SEED)
  hall = await openHall()
}

async function relaunch(): Promise<void> {
  console.log("browser lost: relaunching")
  lab = undefined
  ready = false
  frozen = false
  await launch()
}

function watch(page: Page, name: string): void {
  page.on("pageerror", (error) => errors.push(`${name}: ${error.message}`))
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`${name} console: ${message.text().slice(0, 600)}`)
  })
}

async function openHall(): Promise<Page> {
  const page = await context.newPage()
  watch(page, "hall")
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      ready = false
      loads++
    }
  })
  page.on("crash", () => {
    errors.push("hall: the tab crashed")
    ready = false
  })
  await page.goto(BASE)
  return page
}

/** Meshes in the hall's scene (−1 before the canvas, −2 with the WebGL context lost). */
async function meshes(page: Page): Promise<number> {
  return page
    .evaluate(() => {
      const r3f = (
        window as unknown as {
          r3f?: {
            scene: { traverse(f: (o: { isMesh?: boolean }) => void): void }
            gl: { getContext(): WebGLRenderingContext }
          }
        }
      ).r3f
      if (!r3f?.scene) return -1
      if (r3f.gl.getContext().isContextLost()) return -2
      let n = 0
      r3f.scene.traverse((o) => {
        if (o.isMesh) n++
      })
      return n
    })
    .catch(() => -1)
}

async function waitMounted(page: Page, timeout: number): Promise<boolean> {
  const until = Date.now() + timeout
  while (Date.now() < until) {
    const n = await meshes(page)
    if (n === -2) return false
    if (n >= MIN_MESHES) {
      // The probe bridge (main.tsx) is there, and the world released the store's hold.
      const released = await page
        .evaluate(
          () =>
            "deeplink" in window && (window as unknown as { guild: { held: boolean } }).guild.held === false,
        )
        .catch(() => false)
      if (released) return true
    }
    await Bun.sleep(150)
  }
  return false
}

/** The hall, mounted: waits after a reload, reloads a stuck world, replaces a dead page. */
async function ensureHall(): Promise<void> {
  if (lab) {
    await lab.close().catch(() => {})
    lab = undefined
    await setHallFrozen(false)
    await hall.bringToFront()
  }
  if (ready && !hall.isClosed() && (await meshes(hall)) >= MIN_MESHES) return
  if (!hall.isClosed() && (await waitMounted(hall, MOUNT_TIMEOUT_MS))) return finishMount()
  console.log("world not mounted: reloading")
  if (!hall.isClosed()) {
    await hall.reload().catch(() => {})
    if (await waitMounted(hall, MOUNT_TIMEOUT_MS)) return finishMount()
    await hall.close().catch(() => {})
  }
  console.log("still blank: a new page")
  hall = await openHall()
  if (await waitMounted(hall, MOUNT_TIMEOUT_MS)) return finishMount()
  throw new Error(`the hall did not mount at ${BASE} (is \`bun run dev\` running?)`)
}

async function finishMount(): Promise<void> {
  // Let the first frames compile shaders and the opening reveal (3.2 s) land before anyone shoots.
  await hall.waitForTimeout(3500)
  ready = true
}

/**
 * The hall loaded afresh at `?query` (the deep link applied at startup, before the first frame):
 * no history from earlier states — nobody mid-walk, no cloud or weather easing from the last look.
 * ~2 s with Vite's modules cached. scripts/golden.ts renders every view this way.
 */
async function reloadHall(query: string): Promise<void> {
  await ensureHall()
  const url = new URL(BASE)
  url.search = query
  await hall.goto(url.href)
  if (!(await waitMounted(hall, MOUNT_TIMEOUT_MS))) {
    ready = false
    await ensureHall()
  } else ready = true
  loaded = loads
}
/** `loads` when reloadHall last finished: more since means the page navigated on its own (Vite). */
let loaded = 0

let frozen = false
/**
 * One page draws at a time. Both render uncapped, so a lab drawing while the island does (or the
 * other way round) fights it for the GPU: shots took 2–12 s instead of 0.4. Using a lab freezes the
 * hall (its timers and frames stop, its state stays); going back closes the lab and thaws the hall.
 */
async function setHallFrozen(on: boolean): Promise<void> {
  if (frozen === on || hall.isClosed()) return
  const cdp = await hall.context().newCDPSession(hall)
  await cdp.send("Page.setWebLifecycleState", { state: on ? "frozen" : "active" })
  await cdp.detach()
  frozen = on
}

/**
 * Idle pages are frozen: both render uncapped, so a warm server left alone drew the whole island
 * at full speed between checks (two GPU-bound Chrome helpers on battery). After IDLE_MS without a
 * request every open page is frozen; the next request thaws the ones that were drawing.
 */
const IDLE_MS = 20_000
const UNCAPPED = new Set(["--disable-gpu-vsync", "--disable-frame-rate-limit"])
let idleTimer: ReturnType<typeof setTimeout> | undefined
let dozing: Page[] = []

async function setFrozen(page: Page, on: boolean): Promise<void> {
  if (page.isClosed()) return
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("Page.setWebLifecycleState", { state: on ? "frozen" : "active" })
  await cdp.detach()
}

async function doze(): Promise<void> {
  const awake = [lab && !lab.isClosed() ? lab : undefined, frozen ? undefined : hall]
  dozing = awake.filter((page): page is Page => page !== undefined && !page.isClosed())
  for (const page of dozing) await setFrozen(page, true).catch(() => {})
}

async function wake(): Promise<void> {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = undefined
  const pages = dozing
  dozing = []
  for (const page of pages) await setFrozen(page, false).catch(() => {})
}

function restLater(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => void serial(doze), IDLE_MS)
}

/** The lab page at `?lab=<query>`, navigated only when the query changes. */
async function labPage(query: string): Promise<Page> {
  await setHallFrozen(true)
  if (!lab || lab.isClosed()) {
    lab = await context.newPage()
    watch(lab, "lab")
  }
  const url = new URL(BASE)
  url.search = `?lab=${query}`
  if (lab.url() !== url.href) {
    await lab.goto(url.href)
    await lab.waitForFunction(() => "lab" in window, undefined, { timeout: 20_000 })
    await lab.waitForTimeout(400)
  }
  await lab.bringToFront()
  return lab
}

/**
 * A deep link: `fresh`, the hall loaded afresh at it (settled per loadSettle unless `settle` says);
 * else applied in place on top of the current state. Returns what the link ignored or couldn't do.
 */
async function applyState(query: string, fresh: boolean, settle: number | undefined): Promise<string[]> {
  if (fresh) {
    await reloadHall(query)
    await hall.waitForTimeout(settle ?? loadSettle(query))
    // The load applied it (main.tsx) and keeps no report: what it ignored is parsed again here.
    return parseDeepLink(query, true).ignored
  }
  await ensureHall()
  const notes = await hall.evaluate(
    (query) => (window as unknown as { deeplink: { apply(q: string): string[] } }).deeplink.apply(query),
    query,
  )
  await hall.waitForTimeout(settle ?? SETTLE_MS)
  return notes
}

/** The lab page for a `lab` query, else the hall (mounted). */
async function pageFor(labQuery: string | undefined): Promise<Page> {
  if (labQuery !== undefined) return labPage(labQuery)
  await ensureHall()
  return hall
}

type Body = Record<string, unknown>
const str = (body: Body, key: string): string | undefined =>
  typeof body[key] === "string" ? (body[key] as string) : undefined
const num = (body: Body, key: string): number | undefined =>
  typeof body[key] === "number" ? (body[key] as number) : undefined

async function handle(path: string, body: Body): Promise<Body> {
  switch (path) {
    case "/health":
      return {
        ok: true,
        url: BASE,
        dpr: DPR,
        ready,
        meshes: hall.isClosed() ? 0 : await meshes(hall),
        loads,
        uptime: Math.round((Date.now() - started) / 1000),
      }
    case "/state":
      return {
        notes: await applyState(str(body, "query") ?? "", body.fresh !== false, num(body, "settle")),
      }
    case "/look":
      return { notes: await applyState(`look=${str(body, "at") ?? ""}`, false, num(body, "settle") ?? 300) }
    case "/shot": {
      const name = str(body, "name")
      if (!name || !/^[\w./-]+$/.test(name) || name.includes(".."))
        throw new Error("shot needs a name ([\\w./-])")
      const t0 = performance.now()
      let notes: string[] = []
      const labQuery = str(body, "lab")
      const format = body.png === true ? "png" : "jpeg"
      const path = shotPath(name, format)
      if (labQuery !== undefined) {
        const page = await labPage(labQuery)
        await page.waitForTimeout(num(body, "settle") ?? 300)
        await capture(page, path, format)
        return { path, ms: Math.round(performance.now() - t0), notes }
      }
      // Another screen size (a phone): set first, so the framing is made for it; put back after.
      const size = body.viewport
      const sized =
        Array.isArray(size) &&
        size.length === 2 &&
        size.every((n) => typeof n === "number" && n >= 200 && n <= 4000)
      const state = str(body, "state")
      const after = str(body, "after")
      const js = str(body, "js")
      const fresh = state !== undefined && body.fresh !== false
      // A Vite full reload (another edit) between the load and the capture shoots the page
      // half-mounted, or without the `after` link: shot again from the load, once.
      for (let attempt = 0; attempt < 2; attempt++) {
        await ensureHall()
        if (sized) await hall.setViewportSize({ width: size[0], height: size[1] })
        if (state !== undefined) notes = await applyState(state, fresh, num(body, "settle"))
        if (after !== undefined) notes.push(...(await applyState(after, false, AFTER_MS)))
        // Page script run after the state, before the capture (a click that opens a panel), inside
        // this one request so another client's shot can't land in between.
        if (js !== undefined) await hall.evaluate(js)
        await capture(hall, path, format)
        if (!fresh || loads === loaded) break
        console.log(`${name}: the page reloaded mid-shot, again`)
      }
      if (sized) await hall.setViewportSize(VIEWPORT)
      return { path, ms: Math.round(performance.now() - t0), notes }
    }
    case "/eval": {
      const js = str(body, "js") ?? ""
      const labQuery = str(body, "lab")
      const page = await pageFor(labQuery)
      return { result: await page.evaluate(js) }
    }
    case "/steps": {
      const labQuery = str(body, "lab")
      const page = await pageFor(labQuery)
      const out = await runSteps(page, (body.steps ?? []) as Step[])
      return { ...out }
    }
    case "/reload": {
      const t0 = performance.now()
      await reloadHall(str(body, "query") ?? "")
      return { ms: Math.round(performance.now() - t0) }
    }
    case "/diff":
      return diff(body)
    case "/stop":
      setTimeout(() => void stop(), 50)
      return { stopping: true }
    default:
      throw new Error(`unknown ${path}`)
  }
}

/**
 * Pixel diff of two images (PNG or JPEG), computed in the browser (a blank page: no image library needed here).
 * A pixel differs when its colour moves more than `pixel` (0–1, YIQ-weighted like pixelmatch);
 * it *counts* only inside a cluster (≥ 5 of its 3×3 neighbourhood differ), so the GPU's 1 px edge
 * shimmer is ignored while a moved or recoloured object is not. Over `threshold` (a share of the
 * pixels, default 0: always) it writes reference | current | diff as one JPEG to `out`.
 */
async function diff(body: Body): Promise<Body> {
  const reference = str(body, "reference")
  const current = str(body, "current")
  const out = str(body, "out")
  if (!reference || !current || !out) throw new Error("diff needs reference, current and out")
  const page = await context.newPage()
  try {
    const dataUrl = async (file: string) =>
      `data:${file.endsWith(".png") ? "image/png" : "image/jpeg"};base64,${Buffer.from(await Bun.file(file).arrayBuffer()).toString("base64")}`
    const result = await page.evaluate(
      async ({ a, b, pixel, threshold }) => {
        const image = async (src: string) => {
          const img = new Image()
          img.src = src
          await img.decode()
          return img
        }
        const [ia, ib] = await Promise.all([image(a), image(b)])
        if (ia.width !== ib.width || ia.height !== ib.height)
          return { error: `size ${ia.width}×${ia.height} vs ${ib.width}×${ib.height}` }
        const w = ia.width
        const h = ia.height
        const read = (img: HTMLImageElement) => {
          const c = new OffscreenCanvas(w, h)
          const g = c.getContext("2d") as OffscreenCanvasRenderingContext2D
          g.drawImage(img, 0, 0)
          return g.getImageData(0, 0, w, h).data
        }
        const pa = read(ia)
        const pb = read(ib)
        const off = new Uint8Array(w * h)
        const limit = pixel * pixel * 35215 // pixelmatch's max YIQ delta
        for (let i = 0; i < w * h; i++) {
          const k = i * 4
          const dr = (pa[k] ?? 0) - (pb[k] ?? 0)
          const dg = (pa[k + 1] ?? 0) - (pb[k + 1] ?? 0)
          const db = (pa[k + 2] ?? 0) - (pb[k + 2] ?? 0)
          const y = dr * 0.29889531 + dg * 0.58662247 + db * 0.11448223
          const iq = dr * 0.59597799 - dg * 0.2741761 - db * 0.32180189
          const q = dr * 0.21147017 - dg * 0.52261711 + db * 0.31114694
          if (0.5053 * y * y + 0.299 * iq * iq + 0.1957 * q * q > limit) off[i] = 1
        }
        const canvas = new OffscreenCanvas(w * 3, h)
        const g = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D
        g.drawImage(ia, 0, 0)
        g.drawImage(ib, w, 0)
        const heat = g.createImageData(w, h)
        let counted = 0
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            const i = y * w + x
            const k = i * 4
            const grey = ((pb[k] ?? 0) + (pb[k + 1] ?? 0) + (pb[k + 2] ?? 0)) / 3
            let hot = false
            if (off[i]) {
              let near = 0
              for (let dy = -1; dy <= 1; dy++)
                for (let dx = -1; dx <= 1; dx++) {
                  const yy = y + dy
                  const xx = x + dx
                  if (yy >= 0 && yy < h && xx >= 0 && xx < w && off[yy * w + xx]) near++
                }
              hot = near >= 5
            }
            if (hot) counted++
            heat.data[k] = hot ? 255 : off[i] ? 255 : grey * 0.35
            heat.data[k + 1] = hot ? 0 : off[i] ? 190 : grey * 0.35
            heat.data[k + 2] = hot ? 40 : off[i] ? 0 : grey * 0.35
            heat.data[k + 3] = 255
          }
        const ratio = counted / (w * h)
        if (ratio <= threshold) return { width: w, height: h, counted, ratio, png: "" }
        g.putImageData(heat, w * 2, 0)
        const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 })
        const bytes = new Uint8Array(await blob.arrayBuffer())
        let binary = ""
        for (let i = 0; i < bytes.length; i += 0x8000)
          binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
        return { width: w, height: h, counted, ratio, png: btoa(binary) }
      },
      {
        a: await dataUrl(reference),
        b: await dataUrl(current),
        pixel: num(body, "pixel") ?? 0.1,
        threshold: num(body, "threshold") ?? 0,
      },
    )
    if ("error" in result) return { error: result.error }
    const { png, ...stats } = result
    if (!png) return stats
    await Bun.write(out, Buffer.from(png, "base64"))
    return { ...stats, out }
  } finally {
    await page.close()
  }
}

let queue: Promise<unknown> = Promise.resolve()
/** One request at a time: they share one page. */
function serial<T>(run: () => Promise<T>): Promise<T> {
  const next = queue.then(run, run)
  queue = next.catch(() => {})
  return next
}

let stopping = false
async function stop(): Promise<void> {
  stopping = true
  server.stop(true)
  await browser.close().catch(() => {})
  await Bun.file(INFO_PATH)
    .delete()
    .catch(() => {})
  console.log("probe server stopped")
  process.exit(0)
}

await mkdir(PROBE_DIR, { recursive: true })
await launch()
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  idleTimeout: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname
    const body = request.method === "POST" ? ((await request.json().catch(() => ({}))) as Body) : {}
    try {
      const out = await serial(async () => {
        await wake()
        return handle(path, body)
      })
      restLater()
      const said = errors
      errors = []
      return Response.json({ ...out, errors: said })
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : String(error), errors },
        { status: 500 },
      )
    }
  },
})
await Bun.write(INFO_PATH, JSON.stringify({ port: PORT, pid: process.pid, url: BASE, dpr: DPR }))
process.on("SIGINT", () => void stop())
process.on("SIGTERM", () => void stop())
console.log(`probe server on http://127.0.0.1:${PORT} (hall ${BASE}, DPR ${DPR}); warming…`)
await serial(() => ensureHall())
console.log(`warm: ${await meshes(hall)} meshes`)
