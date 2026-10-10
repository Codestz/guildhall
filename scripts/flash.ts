/**
 * The flash probe: drives the PRODUCTION build (the showcase, as Vercel builds it, plus the probe
 * hooks that only expose `quality`) through everything a visitor does, films the page as the
 * compositor shows it (CDP screencast, so a blank canvas over the body's colour is seen as well as a
 * blank draw), and fails on any frame that flashes: a near-white spike between dark frames, or a
 * frame whose middle is one flat colour. Every flash is printed with the interaction and the canvas / DPR /
 * quality events around it.
 *
 *   bun scripts/flash.ts [--repo facebook/react] [--hand] [--quick] [--keep] [--url http://…]
 *
 * `--hand` the hand island (no `?repo=`); `--quick` a shorter tour (what `bun run check` would take);
 * `--url` an already-running build instead of building one. Holds the GPU lock (scripts/gpulock.ts).
 * Why a screencast: the bug it guards lived between the canvas and
 * the page, not in a draw call: reading pixels back from WebGL cannot see it.
 */
import { mkdir } from "node:fs/promises"
import { type CDPSession, chromium, type Page } from "playwright-core"
import { acquireGpu } from "./gpulock.ts"
import { CHROME, CHROME_ARGS, PROBE_DIR, ROOT } from "./steps.ts"

const argv = process.argv.slice(2)
const flag = (name: string) => argv.includes(`--${name}`)
const option = (name: string) => (flag(name) ? argv[argv.indexOf(`--${name}`) + 1] : undefined)
const REPO = flag("hand") ? "" : (option("repo") ?? "facebook/react")
const QUICK = flag("quick")
const OUT = `${PROBE_DIR}/flash`
const BUILD = `${PROBE_DIR}/flash-build`
const SIZE = { width: 1280, height: 800 }

/** A frame is a flash when its mean luminance jumps this far from the recent frames and ends up near white. */
const SPIKE = 0.22
const WHITE = 0.78
/** Share of the middle of the frame within `FLAT_TOL` of its centre pixel's colour: a frame this flat is blank (the HUD frames the edges). */
const FLAT_SHARE = 0.97
const FLAT_TOL = 6

interface Frame {
  t: number
  data: string
}
interface Mark {
  t: number
  what: string
}
interface Stat {
  t: number
  luma: number
  flat: number
}

// ── the build and the server ──

async function build(): Promise<void> {
  const proc = Bun.spawn(["bunx", "vite", "build", "--outDir", BUILD, "--emptyOutDir"], {
    cwd: `${ROOT}packages/hall`,
    env: { ...process.env, VITE_GUILDHALL_PROBE: "1", VITE_GUILDHALL_SHOWCASE: "1" },
    stdout: "ignore",
    stderr: "pipe",
  })
  if ((await proc.exited) !== 0)
    throw new Error(`vite build failed:\n${await new Response(proc.stderr).text()}`)
}

async function serve(): Promise<{ url: string; stop: () => void }> {
  const free = Bun.serve({ port: 0, fetch: () => new Response() })
  const port = free.port
  free.stop(true)
  const proc = Bun.spawn(
    [
      "bunx",
      "vite",
      "preview",
      "--outDir",
      BUILD,
      "--port",
      String(port),
      "--strictPort",
      "--host",
      "127.0.0.1",
    ],
    { cwd: `${ROOT}packages/hall`, stdout: "ignore", stderr: "ignore" },
  )
  const url = `http://127.0.0.1:${port}/`
  for (let tries = 0; tries < 100; tries++) {
    if (
      await fetch(url).then(
        (r) => r.ok,
        () => false,
      )
    )
      return { url, stop: () => proc.kill() }
    await Bun.sleep(100)
  }
  proc.kill()
  throw new Error("vite preview did not start")
}

// ── the page's own event log: what changed the canvas, and when ──

const WATCH = `(() => {
  const log = (what) => (window.__flash ||= []).push({ t: Date.now() / 1000, what })
  window.__mark = log
  addEventListener('webglcontextlost', (e) => log('webglcontextlost'), true)
  addEventListener('webglcontextrestored', () => log('webglcontextrestored'), true)
  // Runs a state change right after a callback that drew a frame, as the adaptive quality's own change
  // does (it is made in a frame callback, then committed in the microtask after the draw): a change
  // made from a plain task is drawn before it is shown, and hides the bug.
  const raf = window.requestAnimationFrame.bind(window)
  let pending = null
  window.requestAnimationFrame = (cb) => raf((t) => {
    const info = window.r3f && window.r3f.gl.info.render
    const before = info && info.frame
    cb(t)
    if (pending && info && info.frame !== before) { const run = pending; pending = null; run() }
  })
  window.__afterDraw = (fn) => new Promise((done) => { pending = () => { fn(); done() } })
  new MutationObserver((records) => {
    for (const r of records) {
      const n = r.target
      if (n.tagName === 'CANVAS') log('canvas ' + r.attributeName + ' -> ' + n.getAttribute(r.attributeName) + (r.attributeName === 'width' ? ' (dpr ' + (n.width / n.clientWidth).toFixed(2) + ')' : ''))
      else if (n.dataset && r.attributeName === 'data-boot') log('boot -> ' + n.dataset.boot)
    }
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ['width', 'height', 'data-boot'] })
  new MutationObserver((records) => {
    for (const r of records) for (const n of r.removedNodes) if (n.tagName === 'CANVAS') log('canvas REMOVED')
    for (const r of records) for (const n of r.addedNodes) if (n.tagName === 'CANVAS') log('canvas ADDED')
  }).observe(document, { subtree: true, childList: true })
})()`

// ── the tour ──

type Tour = (page: Page, mark: (what: string) => void) => Promise<void>

const wait = (ms: number) => Bun.sleep(ms)

async function orbit(page: Page, button: "left" | "right", dx: number, dy: number): Promise<void> {
  const x = SIZE.width / 2
  const y = SIZE.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down({ button })
  await page.mouse.move(x + dx, y + dy, { steps: 20 })
  await page.mouse.up({ button })
}

const quality = (page: Page, tier: number | "auto") =>
  page.evaluate(
    (t) =>
      (window as never as { __afterDraw(fn: () => void): Promise<void> }).__afterDraw(() =>
        (window as never as { quality: { choose(t: number | "auto"): void } }).quality.choose(t),
      ),
    tier,
  )

const tour: Tour = async (page, mark) => {
  const step = async (what: string, run: () => Promise<unknown>, after = 400) => {
    mark(`act: ${what}`)
    await run()
    await wait(after)
  }
  await step("idle", () => wait(QUICK ? 1200 : 3000), 0)
  await step("quality 2 (cold composer)", () => quality(page, 2), 1500)
  await step("orbit left", () => orbit(page, "left", 220, 40))
  await step("orbit back", () => orbit(page, "left", -300, -60))
  await step("pan", () => orbit(page, "right", 160, 90))
  await step("zoom in", async () => {
    await page.mouse.move(SIZE.width / 2, SIZE.height / 2)
    for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -240)
  })
  await step("zoom out", async () => {
    for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 240)
  })
  for (const [x, y] of [
    [640, 420],
    [560, 470],
    [720, 380],
  ] as const)
    await step(`click ${x},${y}`, () => page.mouse.click(x, y))
  await step("escape", () => page.keyboard.press("Escape"))
  for (const tier of QUICK ? [0, 2, 1, 3, 2] : [0, 1, 2, 3, 2, 0, 3, 1, 2])
    await step(`quality ${tier}`, () => quality(page, tier), 900)
  await step("quality auto", () => quality(page, "auto"), 600)
  for (const button of await page.locator(".toolbar button").all()) {
    await step("toolbar button", () => button.click().catch(() => {}), 500)
    await step("escape", () => page.keyboard.press("Escape"))
  }
  const sizes = QUICK
    ? [
        [1000, 700],
        [1280, 800],
      ]
    : [
        [1000, 700],
        [700, 900],
        [390, 780],
        [1600, 900],
        [1280, 800],
      ]
  for (const [width, height] of sizes as [number, number][])
    await step(`resize ${width}x${height}`, () => page.setViewportSize({ width, height }), 900)
  await step(
    "drag-resize sweep",
    async () => {
      for (let w = 1280; w >= 900; w -= 20)
        await page.setViewportSize({ width: w, height: 800 - (1280 - w) / 4 }).then(() => wait(40))
      for (let w = 900; w <= 1280; w += 20)
        await page.setViewportSize({ width: w, height: 800 - (1280 - w) / 4 }).then(() => wait(40))
    },
    600,
  )
  await step("orbit while auto-quality settles", () => orbit(page, "left", 120, 20), QUICK ? 1500 : 8000)
}

// ── filming and judging ──

async function film(cdp: CDPSession, frames: Frame[]): Promise<() => Promise<void>> {
  cdp.on(
    "Page.screencastFrame",
    (event: { data: string; sessionId: number; metadata: { timestamp?: number } }) => {
      frames.push({ t: event.metadata.timestamp ?? Date.now() / 1000, data: event.data })
      void cdp.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => {})
    },
  )
  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: 60,
    maxWidth: 256,
    maxHeight: 160,
    everyNthFrame: 1,
  })
  return () => cdp.send("Page.stopScreencast").then(() => undefined)
}

/** Mean luminance and flatness of each frame, decoded in a scratch page. */
async function measure(scratch: Page, frames: Frame[]): Promise<Stat[]> {
  const stats: Stat[] = []
  for (let i = 0; i < frames.length; i += 200) {
    const batch = frames.slice(i, i + 200)
    const got = await scratch.evaluate(
      async ([datas, tol]) => {
        const canvas = new OffscreenCanvas(64, 40)
        const g = canvas.getContext("2d", { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D
        const out: Array<[number, number]> = []
        for (const data of datas) {
          const bitmap = await createImageBitmap(await (await fetch(`data:image/jpeg;base64,${data}`)).blob())
          g.drawImage(bitmap, 0, 0, 64, 40)
          const px = g.getImageData(0, 0, 64, 40).data
          const mid = (20 * 64 + 32) * 4
          let sum = 0
          let flat = 0
          for (let p = 0; p < px.length; p += 4) {
            sum += (0.2126 * px[p]! + 0.7152 * px[p + 1]! + 0.0722 * px[p + 2]!) / 255
            const x = (p / 4) % 64
            const y = Math.floor(p / 4 / 64)
            if (x < 16 || x >= 48 || y < 10 || y >= 30) continue
            if (
              Math.abs(px[p]! - px[mid]!) +
                Math.abs(px[p + 1]! - px[mid + 1]!) +
                Math.abs(px[p + 2]! - px[mid + 2]!) <
              tol * 3
            )
              flat++
          }
          out.push([sum / (px.length / 4), flat / (32 * 20)])
        }
        return out
      },
      [batch.map((f) => f.data), FLAT_TOL] as const,
    )
    for (const [k, f] of batch.entries()) stats.push({ t: f.t, luma: got[k]![0], flat: got[k]![1] })
  }
  return stats
}

interface Flash {
  at: number
  luma: number
  before: number
  flat: number
  index: number
}

/** Frames that spike to near white against the median of those just before, or are one flat bright colour. */
function judge(stats: Stat[], from: number): Flash[] {
  const found: Flash[] = []
  for (let i = 6; i < stats.length; i++) {
    const s = stats[i]!
    if (s.t < from) continue
    const prior = stats
      .slice(i - 6, i)
      .map((x) => x.luma)
      .sort((a, b) => a - b)
    const before = prior[3]!
    const spike = s.luma - before > SPIKE && s.luma > WHITE
    const blank = s.flat > FLAT_SHARE
    if (spike || blank) found.push({ at: s.t, luma: s.luma, before, flat: s.flat, index: i })
  }
  return found
}

// ── main ──

await mkdir(OUT, { recursive: true })
const release = await acquireGpu("flash")
let server: { url: string; stop: () => void } | undefined
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
let failed = false
try {
  const given = option("url")
  if (!given) {
    if (!flag("keep") || !(await Bun.file(`${BUILD}/index.html`).exists())) await build()
    server = await serve()
  }
  const base = given ?? server!.url
  const url = `${base}?showcase${REPO ? `&repo=${REPO}` : ""}`
  browser = await chromium.launch({
    executablePath: CHROME,
    args: CHROME_ARGS.filter((a) => !a.includes("frame-rate")),
  })
  const context = await browser.newContext({
    viewport: SIZE,
    deviceScaleFactor: Number(process.env.DPR ?? 2),
  })
  const page = await context.newPage()
  const scratch = await (await browser.newContext()).newPage()
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  // Boots pinned on Low, so the first move to a post tier builds its composer cold (the worst stall).
  await page.addInitScript(`try { localStorage.setItem('guildhall.quality', '0') } catch {}`)
  await page.addInitScript(WATCH)
  const cdp = await context.newCDPSession(page)
  const frames: Frame[] = []
  const marks: Mark[] = []
  const mark = (what: string) => marks.push({ t: Date.now() / 1000, what })
  const stop = await film(cdp, frames)
  await page.goto(url)
  await page.waitForFunction(() => document.documentElement.dataset.boot === "revealed", undefined, {
    timeout: 120_000,
  })
  await wait(1500)
  const from = Date.now() / 1000
  mark("revealed")
  await tour(page, mark)
  await stop()
  const events = (await page.evaluate(
    () => (window as never as { __flash?: Mark[] }).__flash ?? [],
  )) as Mark[]
  const stats = await measure(scratch, frames)
  const flashes = judge(stats, from)
  const timeline = [...marks, ...events].sort((a, b) => a.t - b.t)
  console.log(
    `${REPO || "hand island"}: ${frames.length} frames filmed over ${(stats.at(-1)!.t - stats[0]!.t).toFixed(1)} s`,
  )
  for (const f of flashes) {
    failed = true
    const near = timeline.filter((m) => m.t <= f.at + 0.05 && m.t > f.at - 1.5)
    console.log(
      `FLASH at +${(f.at - from).toFixed(2)} s: luma ${f.luma.toFixed(2)} after ${f.before.toFixed(2)} (flat ${(f.flat * 100).toFixed(0)}%)`,
    )
    for (const m of near) console.log(`    ${((m.t - f.at) * 1000).toFixed(0).padStart(6)} ms  ${m.what}`)
    await Bun.write(`${OUT}/flash-${f.index}.jpg`, Buffer.from(frames[f.index]!.data, "base64"))
  }
  if (errors.length) console.log(`page errors: ${JSON.stringify(errors.slice(0, 5))}`)
  if (flag("verbose"))
    for (const m of timeline) console.log(`${(m.t - from).toFixed(2).padStart(7)}  ${m.what}`)
  console.log(flashes.length === 0 ? "no flash frames" : `${flashes.length} flash frame(s); stills in ${OUT}`)
} finally {
  await browser?.close()
  server?.stop()
  release()
}
process.exit(failed ? 1 : 0)
