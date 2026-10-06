/**
 * Headless probe of the running hall (`bun run dev` first), with your installed Chrome.
 *
 *   bun scripts/shot.ts [url] [steps.json]
 *
 * Steps: [{ "wait": ms } | { "shot": "name" } | { "eval": "js" } | { "key": "w", "hold": ms }
 *        | { "drag": [x1, y1, x2, y2], "button": "left" | "right" } | { "wheel": dy, "at": [x, y] }
 *        | { "profile": ms }]   (a CPU profile: prints the top functions by self time)
 * Screenshots land in .probe/ (git-ignored). Prints page errors and every `eval` result.
 */
import { chromium } from "playwright-core"

type Step =
  | { wait: number }
  | { shot: string }
  | { eval: string }
  | { key: string; hold?: number }
  | { drag: [number, number, number, number]; button?: "left" | "right" }
  | { wheel: number; at?: [number, number] }
  | { profile: number }

const url = process.argv[2] ?? "http://localhost:5199/"
const steps: Step[] = process.argv[3]
  ? await Bun.file(process.argv[3]).json()
  : [{ wait: 6000 }, { shot: "hall" }]
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

// Uncapped frame rate (no vsync, no 60 Hz limit), so fps/frame-time readings show real headroom
// against the 120 fps budget instead of the headless 60 cap.
const browser = await chromium.launch({
  executablePath: chrome,
  args: ["--use-angle=metal", "--enable-gpu", "--disable-gpu-vsync", "--disable-frame-rate-limit"],
})
// Retina-like by default (DPR=2), like the Mac this is built on; DPR=1 bun scripts/shot.ts … to compare.
const page = await browser.newPage({
  viewport: { width: 1440, height: 860 },
  deviceScaleFactor: Number(process.env.DPR ?? 2),
})
const errors: string[] = []
page.on("pageerror", (error) => errors.push(error.message))
// Shader compile failures and WebGL errors arrive as console errors, not page exceptions.
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text().slice(0, 600)}`)
})
await page.goto(url)

for (const step of steps) {
  if ("wait" in step) await page.waitForTimeout(step.wait)
  else if ("profile" in step) await profile(step.profile)
  else if ("shot" in step) await page.screenshot({ path: `.probe/${step.shot}.png` })
  else if ("eval" in step) console.log(JSON.stringify(await page.evaluate(step.eval)))
  else if ("key" in step) {
    await page.keyboard.down(step.key)
    await page.waitForTimeout(step.hold ?? 50)
    await page.keyboard.up(step.key)
  } else if ("drag" in step) {
    const [x1, y1, x2, y2] = step.drag
    await page.mouse.move(x1, y1)
    await page.mouse.down({ button: step.button ?? "left" })
    await page.mouse.move(x2, y2, { steps: 12 })
    await page.mouse.up({ button: step.button ?? "left" })
  } else if ("wheel" in step) {
    const [x, y] = step.at ?? [720, 430]
    await page.mouse.move(x, y)
    await page.mouse.wheel(0, step.wheel)
  }
}
console.log(errors.length ? `errors: ${JSON.stringify(errors)}` : "no page errors")
await browser.close()

/** Samples the main thread for `ms` and prints where the time went, by function (self time). */
async function profile(ms: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("Profiler.enable")
  await cdp.send("Profiler.setSamplingInterval", { interval: 200 })
  await cdp.send("Profiler.start")
  await page.waitForTimeout(ms)
  const { profile } = await cdp.send("Profiler.stop")
  const self = new Map<string, number>()
  const byId = new Map(profile.nodes.map((node) => [node.id, node]))
  const deltas = profile.timeDeltas ?? []
  ;(profile.samples ?? []).forEach((id, i) => {
    const frame = byId.get(id)?.callFrame
    if (!frame) return
    const file = frame.url.split("/").slice(-2).join("/").replace(/\?.*$/, "")
    const key = `${frame.functionName || "(anon)"}  ${file}:${frame.lineNumber + 1}`
    self.set(key, (self.get(key) ?? 0) + (deltas[i] ?? 0) / 1000)
  })
  const total = [...self.values()].reduce((a, b) => a + b, 0)
  const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)
  console.log(`profile ${ms} ms (sampled ${total.toFixed(0)} ms):`)
  for (const [key, time] of top) console.log(`  ${time.toFixed(1).padStart(8)} ms  ${key}`)
  await cdp.detach()
}
