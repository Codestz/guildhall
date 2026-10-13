/**
 * The loading screen, watched from outside (apps/studio/src/hexworld/ready.ts says what "ready" is).
 *
 *   bun tools/shots/loading.ts cast <url> <outdir> [w] [h]
 *       a cold load as a real frame burst: the browser's own screencast (one JPEG per composited frame,
 *       so a pop would show), each file named with the ms since navigation and the world's state:
 *       the cover, then (if the loader works) one reveal and nothing in between.
 *   bun tools/shots/loading.ts timeline <url> <outdir> [w] [h] [every-ms]
 *       the same with plain screenshots every `every-ms` (default 400): sparser, but sharp.
 *   bun tools/shots/loading.ts time <url> [w] [h] [runs]
 *       navigation to reveal, measured in the page with rAF timestamps (vsync-true) and the world's marks,
 *       per run: when the cover first painted, when the gate opened ("ready"), when the cover had gone
 *       ("revealed"), the longest task, the longest frame gap under the cover and after it, and
 *       `exposed`: frames drawn before "ready" in which the cover was missing or see-through after
 *       it had first appeared (must be 0: no partial island is ever on screen).
 *   bun tools/shots/loading.ts sheet <dir> <out.png> [columns] [title]
 *       a contact sheet of a folder's images.
 *
 * "Revealed" is `<html data-world="revealed">` (the cover has finished fading); "ready" is the moment the
 * gate opened and the cover began to fade. `?loader=0` has no cover and no gate. Needs the GPU lock like
 * every shots tool (launchChrome takes it).
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { Page } from "playwright-core"
import { launchChrome } from "./src/chrome.ts"

const [mode, first, ...rest] = process.argv.slice(2)

const worldState = (page: Page): Promise<string> =>
  page.evaluate(() => document.documentElement.dataset.world ?? "none").catch(() => "none")

const pad = (n: number, w = 5) => String(Math.round(n)).padStart(w, "0")

async function cast(url: string, out: string, w: number, h: number) {
  mkdirSync(out, { recursive: true })
  const browser = await launchChrome("loading-cast")
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  const cdp = await page.context().newCDPSession(page)
  const frames: { at: number; data: string }[] = []
  cdp.on("Page.screencastFrame", (frame) => {
    frames.push({ at: frame.metadata.timestamp ?? 0, data: frame.data })
    void cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => {})
  })
  const t0 = Date.now() / 1000
  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: 72,
    maxWidth: w,
    maxHeight: h,
    everyNthFrame: 1,
  })
  page.goto(url, { waitUntil: "commit" }).catch(() => {})
  let after = 0
  const log: string[] = []
  while (after < 6 && Date.now() / 1000 - t0 < 120) {
    await page.waitForTimeout(250)
    if ((await worldState(page)) === "revealed") after++
  }
  await cdp.send("Page.stopScreencast").catch(() => {})
  const marks = await page.evaluate(() => ({
    origin: performance.timeOrigin,
    marks: performance.getEntriesByType("mark").map((m) => [m.name, m.startTime] as const),
  }))
  const at = (name: string) => marks.marks.find(([n]) => n === name)?.[1]
  const ready = at("world:ready")
  const revealed = at("world:revealed")
  frames.sort((a, b) => a.at - b.at)
  frames.forEach((f, k) => {
    const ms = f.at * 1000 - marks.origin
    const state =
      revealed !== undefined && ms >= revealed
        ? "revealed"
        : ready !== undefined && ms >= ready
          ? "ready"
          : "loading"
    const name = `${pad(k, 3)}-${pad(Math.max(0, ms))}ms-${state}.jpg`
    writeFileSync(join(out, name), Buffer.from(f.data, "base64"))
    log.push(name)
  })
  writeFileSync(join(out, "frames.txt"), `${log.join("\n")}\nready ${ready} revealed ${revealed}\n`)
  console.log(
    `${frames.length} frames; ready ${Math.round(ready ?? -1)} ms, revealed ${Math.round(revealed ?? -1)} ms`,
  )
  await browser.close()
}

async function timeline(url: string, out: string, w: number, h: number, every: number) {
  mkdirSync(out, { recursive: true })
  const browser = await launchChrome("loading-timeline")
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  const t0 = Date.now()
  const log: string[] = []
  page.goto(url, { waitUntil: "commit" }).catch(() => {})
  let after = 0
  for (let k = 0; k < 400 && after < 3; k++) {
    await page.waitForTimeout(every)
    const state = await worldState(page)
    const name = `t${pad(k, 3)}-${pad(Date.now() - t0)}ms-${state}`
    await page.screenshot({ path: join(out, `${name}.png`) })
    log.push(name)
    if (state === "revealed") after++
  }
  writeFileSync(join(out, "timeline.txt"), `${log.join("\n")}\n`)
  console.log(log.join("\n"))
  await browser.close()
}

interface Run {
  [key: string]: number
}

async function time(url: string, w: number, h: number, runs: number) {
  const browser = await launchChrome("loading-time")
  const results: Run[] = []
  for (let r = 0; r < runs; r++) {
    const context = await browser.newContext({ viewport: { width: w, height: h } })
    const page = await context.newPage()
    await page.addInitScript(() => {
      const s = {
        exposed: 0,
        covered: 0,
        coverAt: -1,
        last: 0,
        gapUnder: 0,
        gapAfter: 0,
        longTask: 0,
        done: false,
      }
      ;(window as unknown as { __s: typeof s }).__s = s
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) s.longTask = Math.max(s.longTask, e.duration)
      }).observe({ entryTypes: ["longtask"] })
      const frame = (ts: number) => {
        const state = document.documentElement.dataset.world
        const cover = document.querySelector(".ui-loader") as HTMLElement | null
        const opacity = cover ? Number(getComputedStyle(cover).opacity) : -1
        if (cover && s.coverAt < 0) s.coverAt = Math.round(ts)
        const gap = s.last ? ts - s.last : 0
        s.last = ts
        if (state === "loading") {
          if (s.coverAt >= 0 && opacity < 0.999) s.exposed++
          if (cover) s.covered++
          s.gapUnder = Math.max(s.gapUnder, gap)
        } else if (state) s.gapAfter = Math.max(s.gapAfter, gap)
        if (state === "revealed") s.done = true
        else requestAnimationFrame(frame)
      }
      requestAnimationFrame(frame)
    })
    await page.goto(url, { waitUntil: "commit" })
    await page.waitForFunction(() => document.documentElement.dataset.world === "revealed", undefined, {
      timeout: 180_000,
      polling: 50,
    })
    await page.waitForTimeout(300)
    const got = await page.evaluate(() => {
      const s = (window as unknown as { __s: Record<string, number> }).__s
      const mark = (n: string) => performance.getEntriesByName(n, "mark")[0]?.startTime ?? -1
      return {
        cover: s.coverAt,
        ready: Math.round(mark("world:ready")),
        revealed: Math.round(mark("world:revealed")),
        exposed: s.exposed,
        covered: s.covered,
        longTaskMs: Math.round(s.longTask),
        gapUnderMs: Math.round(s.gapUnder),
        gapAfterMs: Math.round(s.gapAfter),
      }
    })
    results.push(got)
    console.log(JSON.stringify(got))
    await context.close()
  }
  const med = (k: string) => {
    const v = results.map((x) => x[k] ?? 0).sort((a, b) => a - b)
    return v[Math.floor(v.length / 2)] ?? 0
  }
  console.log(
    `median of ${runs}: cover ${med("cover")} ms, ready ${med("ready")} ms, revealed ${med("revealed")} ms, exposed ${Math.max(...results.map((x) => x.exposed ?? 0))}`,
  )
  await browser.close()
}

async function sheet(dir: string, out: string, columns: number, title: string) {
  // PICK=000,008,…: only the files whose names start with one of these (a cast's frame numbers)
  const pick = process.env.PICK?.split(",").filter(Boolean)
  const files = readdirSync(dir)
    .filter((f) => /\.(png|jpe?g)$/.test(f))
    .filter((f) => !pick || pick.some((p) => f.startsWith(p)))
    .sort()
  const cells = files
    .map((f) => {
      const mime = f.endsWith(".png") ? "png" : "jpeg"
      const src = `data:image/${mime};base64,${readFileSync(join(dir, f)).toString("base64")}`
      return `<figure><img src="${src}" alt=""><figcaption>${f.replace(/\.(png|jpe?g)$/, "")}</figcaption></figure>`
    })
    .join("")
  const cell = Math.floor(2400 / columns) - 12
  const browser = await launchChrome("loading-sheet")
  const page = await browser.newPage({ viewport: { width: 2400, height: 800 } })
  await page.setContent(
    `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#1b1712;color:#f3e9d4;font:14px ui-sans-serif,system-ui}
h1{font:600 20px ui-sans-serif;margin:14px 12px 4px}main{display:grid;grid-template-columns:repeat(${columns},${cell}px);gap:8px;padding:8px 12px 14px}
figure{margin:0}img{display:block;width:100%;border-radius:4px}figcaption{padding:3px 2px;opacity:.75;font-size:12px}</style>
<h1>${title}</h1><main>${cells}</main>`,
    { waitUntil: "load" },
  )
  await page.screenshot({ path: out, fullPage: true })
  await browser.close()
  console.log(out)
}

const size = (a: string | undefined, d: number) => (a ? Number(a) : d)
if (mode === "cast") await cast(first!, rest[0]!, size(rest[1], 1440), size(rest[2], 900))
else if (mode === "timeline")
  await timeline(first!, rest[0]!, size(rest[1], 1440), size(rest[2], 900), size(rest[3], 400))
else if (mode === "time") await time(first!, size(rest[0], 1440), size(rest[1], 900), size(rest[2], 3))
else if (mode === "sheet") await sheet(first!, rest[0]!, size(rest[1], 4), rest[2] ?? "Loading")
else {
  console.error("usage: loading.ts cast|timeline|time|sheet … (see the file's header)")
  process.exit(2)
}
