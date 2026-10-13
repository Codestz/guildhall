/**
 * Burst of frames at one pose (flicker hunting): bun tools/shots/frames.ts <url> <outdir> [n] [w] [h].
 * EVAL sets the pose, STEP (deg) turns the azimuth between frames, PAN (m) slides the target along the
 * view (the one motion that re-aims the near shadow cascades), ZOOM (a factor) multiplies the orbit's
 * distance between frames (the zoom-sweep gate's dolly: 1.1 for ten per cent further out a frame; the
 * rig clamps at its furthest), HOUR moves the world's clock (the sun) between frames. CLOCK=<ms> takes the page's clock over
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
// The clock is taken over at a fixed time (AT, ms, default 20 s), not at whatever the load took, so two
// bursts on different builds see the same clouds and the same sky and can be diffed frame for frame.
if (clock !== null)
  await page.evaluate(
    (at) => {
      const w = window as unknown as Clocked
      w.__t = at
      performance.now = () => w.__t
      Date.now = () => w.__t
      const raf = window.requestAnimationFrame.bind(window)
      window.requestAnimationFrame = (fn) => raf(() => fn(w.__t))
    },
    Number(process.env.AT ?? 20000),
  )
await page.waitForTimeout(500)
const step = Number(process.env.STEP ?? 0)
const pan = Number(process.env.PAN ?? 0)
const zoom = Number(process.env.ZOOM ?? 0)
const hour = Number(process.env.HOUR ?? 0)
const dprs: string[] = []
type Driven = {
  guildhall: {
    camera: {
      get(): { azimuth: number; distance: number; target: [number, number, number] }
      set(p: object): void
    }
    ext: { clock?: { get(): number; set(h: number): void } }
  }
}
for (let k = 0; k < Number(n); k++) {
  if (zoom)
    await page.evaluate((z) => {
      const g = (window as unknown as Driven).guildhall
      const p = g.camera.get()
      g.camera.set({ ...p, distance: p.distance * z })
    }, zoom)
  if (step)
    await page.evaluate((s) => {
      const g = (window as unknown as Driven).guildhall
      const p = g.camera.get()
      g.camera.set({ ...p, azimuth: p.azimuth + s })
    }, step)
  if (pan)
    await page.evaluate((m) => {
      const g = (window as unknown as Driven).guildhall
      const p = g.camera.get()
      // the rig looks along (-sin az, -cos az): the target walks away from the eye
      const rad = (p.azimuth * Math.PI) / 180
      const [x, y, z] = p.target
      g.camera.set({ ...p, target: [x - Math.sin(rad) * m, y, z - Math.cos(rad) * m] })
    }, pan)
  if (hour)
    await page.evaluate((h) => {
      const clock = (window as unknown as Driven).guildhall.ext.clock
      clock?.set(clock.get() + h)
    }, hour)
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
