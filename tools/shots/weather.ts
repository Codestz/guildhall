/**
 * The weather shots: one sky each, same viewport and DPR (.probe/weather/).
 *   bun tools/shots/weather.ts <outdir> <kind>@<hour> ...      e.g. rain@13 snow@23.5 clear@13
 * PORT (default 5870). Each loads the island fresh at the hour, jumps to the weather (no ease), lets it
 * settle a moment and shoots; it prints the draw calls and the drive's CPU ms a frame beside the clear sky's.
 */
import { mkdirSync } from "node:fs"
import { launchChrome } from "./src/chrome.ts"

const [out, ...which] = process.argv.slice(2)
mkdirSync(out as string, { recursive: true })
const port = process.env.PORT ?? "5870"
// biome-ignore lint/suspicious/noExplicitAny: the page's debug surface
type G = any
const browser = await launchChrome("weather")
try {
  for (const spec of which) {
    const [kind, hour] = spec.split("@") as [string, string]
    const page = await browser.newPage({ viewport: { width: 880, height: 600 }, deviceScaleFactor: 1 })
    await page.goto(`http://localhost:${port}/town/1?files=4000&fx=1&hour=${hour}`, { waitUntil: "load" })
    await page.waitForFunction(() => (window as G).guildhall?.ext?.fx, null, { timeout: 120000 })
    await page.waitForTimeout(5000)
    await page.addStyleTag({
      content: "body *:not(canvas){visibility:hidden!important} canvas{visibility:visible!important}",
    })
    await page.evaluate((k) => {
      const g = (window as G).guildhall
      g.ext.fx.weather(k, true)
      g.camera.set({ ...g.camera.get(), distance: 52, elevation: 20 })
    }, kind)
    await page.waitForTimeout(3500)
    const info = await page.evaluate(async () => {
      const g = (window as G).guildhall
      const r = g.ext.stage.renderer
      await new Promise((res) => setTimeout(res, 1200))
      return {
        calls: r.info.render.calls,
        tris: r.info.render.triangles,
        ms: g.ext.fx.stats().ms,
        weather: g.ext.fx.stats().weather,
      }
    })
    await page.screenshot({ path: `${out}/${kind}-${hour}.png` })
    console.log(spec, JSON.stringify(info))
    await page.close()
  }
} finally {
  await browser.close()
}
