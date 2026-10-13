/** Burst of frames at one pose (flicker hunting): bun tools/shots/frames.ts <url> <outdir> [n] [w] [h]; EVAL sets the pose, STEP (deg) turns the azimuth between frames. */
import { launchChrome } from "./src/chrome.ts"

const [url, out, n = "10", w = "1400", h = "900"] = process.argv.slice(2)
const browser = await launchChrome("frames")
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } })
await page.goto(url!, { waitUntil: "load" })
await page.waitForTimeout(Number(process.env.WAIT ?? 14000))
if (process.env.EVAL) await page.evaluate(process.env.EVAL)
await page.waitForTimeout(3000)
const step = Number(process.env.STEP ?? 0)
for (let k = 0; k < Number(n); k++) {
  if (step)
    await page.evaluate((s) => {
      const g = (
        window as unknown as { guildhall: { camera: { get(): { azimuth: number }; set(p: object): void } } }
      ).guildhall
      const p = g.camera.get()
      g.camera.set({ ...p, azimuth: p.azimuth + s })
    }, step)
  await page.waitForTimeout(120)
  await page.screenshot({ path: `${out}/f${String(k).padStart(2, "0")}.png` })
}
await browser.close()
