/**
 * Burst of frames at one pose (flicker hunting): bun tools/shots/frames.ts <url> <outdir> [n] [w] [h].
 * EVAL sets the pose, STEP (deg) turns the azimuth between frames. CLOCK=<ms> takes the page's clock over
 * once the pose has settled and moves it exactly that much between frames (16.7: consecutive 60 fps
 * frames, whatever the screenshots cost; 0: animation held still, so only what is unstable from frame
 * to frame still changes). DSF sets the device scale factor (2: a Retina screen,
 * where the DPR governor has room to move). The page's DOM chrome is hidden (CHROME=1 keeps it).
 * Each frame's DPR is logged to <outdir>/dpr.txt.
 */
import { writeFileSync } from "node:fs"
import { launchChrome } from "./src/chrome.ts"

const [url, out, n = "10", w = "1400", h = "900"] = process.argv.slice(2)
const browser = await launchChrome("frames")
const page = await browser.newPage({
  viewport: { width: Number(w), height: Number(h) },
  deviceScaleFactor: Number(process.env.DSF ?? 1),
})
await page.goto(url!, { waitUntil: "load" })
await page.waitForTimeout(Number(process.env.WAIT ?? 14000))
if (process.env.EVAL) await page.evaluate(process.env.EVAL)
await page.waitForTimeout(3000)
if (process.env.CHROME !== "1")
  await page.addStyleTag({
    content: "body *:not(canvas){visibility:hidden!important} canvas{visibility:visible!important}",
  })
const clock = process.env.CLOCK === undefined ? null : Number(process.env.CLOCK)
type Clocked = { __t: number }
if (clock !== null)
  await page.evaluate(() => {
    const w = window as unknown as Clocked
    w.__t = performance.now()
    performance.now = () => w.__t
    Date.now = () => w.__t
    const raf = window.requestAnimationFrame.bind(window)
    window.requestAnimationFrame = (fn) => raf(() => fn(w.__t))
  })
await page.waitForTimeout(500)
const step = Number(process.env.STEP ?? 0)
const dprs: string[] = []
for (let k = 0; k < Number(n); k++) {
  if (step)
    await page.evaluate((s) => {
      const g = (
        window as unknown as { guildhall: { camera: { get(): { azimuth: number }; set(p: object): void } } }
      ).guildhall
      const p = g.camera.get()
      g.camera.set({ ...p, azimuth: p.azimuth + s })
    }, step)
  if (clock)
    await page.evaluate((ms) => {
      ;(window as unknown as Clocked).__t += ms
    }, clock)
  await page.waitForTimeout(120)
  dprs.push(
    String(
      await page.evaluate(
        () =>
          (window as unknown as { guildhall: { perf: { now(): { dpr: number } } } }).guildhall.perf.now().dpr,
      ),
    ),
  )
  await page.screenshot({ path: `${out}/f${String(k).padStart(2, "0")}.png` })
}
writeFileSync(`${out}/dpr.txt`, `${dprs.join("\n")}\n`)
await browser.close()
