/**
 * The polish-1 shots: one subject each, same viewport and DPR before/after (.probe/polish1/).
 *   bun tools/shots/polish1.ts <prefix> <outdir> chips splash shoot pin cheer scaffold
 * PORT (default 5750). Burst shots hold the work-FX clock and advance it to a few moments of the burst.
 */
import { mkdirSync } from "node:fs"
import { launchChrome } from "./src/chrome.ts"

const [prefix, out, ...which] = process.argv.slice(2)
mkdirSync(out as string, { recursive: true })
const port = process.env.PORT ?? "5750"
const browser = await launchChrome("polish1")
// biome-ignore lint/suspicious/noExplicitAny: the page's debug surface
type G = any
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 560 }, deviceScaleFactor: 1 })
  await page.goto(`http://localhost:${port}/town/1?files=4000&workfx=1&fx=1`, { waitUntil: "load" })
  await page.waitForFunction(() => (window as G).guildhall?.ext?.workfx, null, { timeout: 90000 })
  await page.waitForTimeout(4000)
  await page.addStyleTag({
    content: "body *:not(canvas){visibility:hidden!important} canvas{visibility:visible!important}",
  })
  const look = (at: number[], distance: number, elevation: number, azimuth: number) =>
    page.evaluate(
      ([a, d, e, z]) => {
        const g = (window as G).guildhall
        g.camera.set({ ...g.camera.get(), target: a, distance: d, elevation: e, azimuth: z })
      },
      [at, distance, elevation, azimuth] as const,
    )
  const ROAD = [-26, 2.0, -1.2]
  const burst = async (
    kind: string,
    at: number[],
    o: { distance: number; times: number[]; elevation?: number; azimuth?: number; yaw?: number },
  ) => {
    await look(at, o.distance, o.elevation ?? 38, o.azimuth ?? 20)
    await page.waitForTimeout(1500)
    for (const t of o.times) {
      await page.evaluate(
        ([k, s, yaw, t0]) => {
          const w = (window as G).guildhall.ext.workfx
          w.clear()
          w.freeze(true)
          for (const kk of k === "splash" ? ["splash", "ring"] : [k])
            w.emit(kk, s, { force: true, seed: 3, yaw })
          w.advance(t0)
        },
        [kind, at, o.yaw ?? 0, t] as const,
      )
      await page.waitForTimeout(500)
      await page.screenshot({ path: `${out}/${prefix}-${kind}-${Math.round(t * 100)}.png` })
    }
    await page.evaluate(() => (window as G).guildhall.ext.workfx.freeze(false))
  }

  for (const w of which) {
    if (w === "chips")
      await burst("chips", [ROAD[0] as number, 2.35, ROAD[2] as number], {
        distance: 4.5,
        times: [0.2, 0.45],
      })
    if (w === "splash") {
      const spot = await page.evaluate(() => {
        const g = (window as G).guildhall
        const [x, , z] = g.camera.get().target
        g.camera.set({ ...g.camera.get(), target: [-60, 1, 50] })
        return g.ext.workfx.fire("splash", { force: true }).at as number[]
      })
      await page.waitForTimeout(500)
      await burst("splash", spot, { distance: 5, times: [0.2, 0.6, 1.0], elevation: 42, azimuth: 200 })
    }
    if (w === "shoot")
      await burst("shoot", [ROAD[0] as number, 3.0, ROAD[2] as number], {
        distance: 5,
        times: [0.1, 0.3, 0.7],
        yaw: 1.2,
        azimuth: 120,
      })
    if (w === "pin")
      await burst("pin", [ROAD[0] as number, 3.2, ROAD[2] as number], {
        distance: 4,
        times: [0.25, 0.8, 1.6],
      })
    if (w === "cheer")
      await burst("cheer", [ROAD[0] as number, 2.9, ROAD[2] as number], {
        distance: 6,
        times: [0.3, 0.7, 1.1],
      })
    if (w === "scaffold") {
      for (const [name, zone, at] of [
        ["red", "0", [-29.9, 7, 5]],
        ["blue", "20", [-64.2, 7, 17.4]],
      ] as const) {
        await page.evaluate(
          ([z]) => {
            const f = (window as G).guildhall.ext.fx
            f.busy([z], true)
            f.progress(z, 1, true)
          },
          [zone] as const,
        )
        await look([...at], 20, 22, 200)
        await page.waitForTimeout(2500)
        await page.screenshot({ path: `${out}/${prefix}-scaffold-${name}.png` })
        await page.evaluate(() => (window as G).guildhall.ext.fx.busy([], true))
      }
    }
  }
} finally {
  await browser.close()
}
