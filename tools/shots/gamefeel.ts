/**
 * Game-feel bursts: a few frames, close up, of what people do at named places (the game-feel audit's
 * shots, .probe/gamefeel/). bun tools/shots/gamefeel.ts <shots.json> <outdir>
 *
 * shots.json: { "url": "...", "wait": ms, "shots": [{ "name", "at": [x, y, z] | "hero:<name>", "hour"?,
 * "distance"?, "elevation"?, "azimuth"?, "frames"?, "gap"? (ms between frames) }] }. A shot `at` a hero
 * follows it (where `ext.life.heroAt` puts it at each frame). Each shot writes <outdir>/<name>-<k>.png,
 * and <outdir>/<name>.json what life said was there (the heroes' acts, the chips).
 * The page's DOM chrome is hidden except the chips layer (CHROME=1 keeps everything).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { launchChrome } from "./src/chrome.ts"

interface Shot {
  name: string
  at: [number, number, number] | string
  hour?: number
  distance?: number
  elevation?: number
  azimuth?: number
  frames?: number
  gap?: number
  /** Seconds to let pass after the hour is set (people walk to where the hour sends them). */
  settle?: number
  /** Frame the person drawn nearest `at` within this many metres (townsfolk move; spots are planned). */
  snap?: number
}

const [file, out] = process.argv.slice(2)
const spec = JSON.parse(readFileSync(file!, "utf8")) as { url: string; wait?: number; shots: Shot[] }
mkdirSync(out!, { recursive: true })
const browser = await launchChrome("gamefeel")
const page = await browser.newPage({
  viewport: { width: Number(process.env.W ?? 1100), height: Number(process.env.H ?? 720) },
  deviceScaleFactor: Number(process.env.DSF ?? 1),
})
await page.goto(spec.url, { waitUntil: "load" })
await page.waitForTimeout(spec.wait ?? 22000)
if (process.env.CHROME !== "1")
  await page.addStyleTag({
    content: `body *:not(canvas){visibility:hidden!important} canvas{visibility:visible!important}
      .ui-heroes, .ui-heroes *{visibility:visible!important}`,
  })

// biome-ignore lint/suspicious/noExplicitAny: the page's debug surface
type G = any
for (const s of spec.shots) {
  if (s.hour !== undefined) await page.evaluate((h) => (window as G).guildhall.ext.clock?.set(h), s.hour)
  await page.waitForTimeout((s.settle ?? 1.5) * 1000)
  const info: unknown[] = []
  for (let k = 0; k < (s.frames ?? 4); k++) {
    const placed = await page.evaluate((sh) => {
      const g = (window as G).guildhall
      let at = sh.at
      if (typeof at === "string") {
        const name = at.slice(5)
        const hero = g.ext.life?.agents().find((a: { name: string }) => a.name === name)
        at = hero ? g.ext.life.heroAt(hero.id) : null
        if (!at) return { missing: name }
      } else if (sh.snap) {
        // the person drawn nearest the point (within `snap` m), so a burst frames whoever works there
        let best: number[] | null = null
        let d = sh.snap
        for (const p of g.ext.life?.people() ?? []) {
          const dd = Math.hypot(p[0] - at[0], p[1] - at[2])
          if (dd < d) {
            d = dd
            best = p
          }
        }
        if (best) at = [best[0], at[1], best[1]]
      }
      const p = g.camera.get()
      g.camera.set({
        ...p,
        target: at,
        distance: sh.distance ?? 9,
        elevation: sh.elevation ?? 28,
        azimuth: sh.azimuth ?? p.azimuth,
      })
      return { at, hour: g.ext.clock?.get(), lifeHour: g.ext.life?.clock?.() }
    }, s as never)
    await page.waitForTimeout(k === 0 ? 900 : (s.gap ?? 600))
    const life = await page.evaluate(() => {
      const l = (window as G).guildhall.ext.life
      return l
        ? {
            agents: l.agents(),
            chips: l.chips().map((c: G) => ({ id: c.id, folded: c.folded, lift: c.lift })),
          }
        : null
    })
    info.push({ k, placed, life })
    await page.screenshot({ path: `${out}/${s.name}-${k}.png` })
  }
  writeFileSync(`${out}/${s.name}.json`, `${JSON.stringify(info, null, 1)}\n`)
  console.log(s.name, "done")
}
await browser.close()
