/**
 * The graveyard's undead, close up (world events Task B): bun tools/shots/undead.ts <shots.json> <outdir>
 *
 * shots.json: { "url": "...", "wait"?: ms, "shots": [{ "name", "scene"?: "rise" | "vigil" | "sink" |
 * "minion" | "all", "hold"?: ms into the scene (held there), "run"?: ms to let the scene play live
 * (its puffs fly) before it is held where it got to, "seek"?: run time ms from a hall session's start,
 * "at"?: "gate" | grave slot (default 0) | [x, y, z], "distance"?, "elevation"?, "azimuth"? (default:
 * three-quarters onto the grave's front; "turn"?: degrees off its front instead), "lift"?: metres over its feet
 * the camera looks at }]}.
 * The camera flies the free camera (the orbit keeps 10 m off). Each writes <outdir>/<name>.png (900 px
 * wide) and <outdir>/<name>.json (what was drawn: the figures, the undead's stats, the heroes).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { launchChrome } from "./src/chrome.ts"

interface Shot {
  name: string
  scene?: string
  hold?: number
  run?: number
  seek?: number
  at?: "gate" | number | [number, number, number]
  distance?: number
  elevation?: number
  azimuth?: number
  lift?: number
  /** Degrees off the grave's front the camera stands (default 30). */
  turn?: number
}

const [file, out] = process.argv.slice(2)
const spec = JSON.parse(readFileSync(file!, "utf8")) as { url: string; wait?: number; shots: Shot[] }
mkdirSync(out!, { recursive: true })
const browser = await launchChrome("undead")
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 620 } })
  page.on("console", (m) => {
    if (m.type() === "error") console.log("console:", m.text().slice(0, 300))
  })
  await page.goto(spec.url, { waitUntil: "load" })
  await page.waitForTimeout(spec.wait ?? 22000)
  await page.addStyleTag({
    content: "body *:not(canvas){visibility:hidden!important} canvas{visibility:visible!important}",
  })
  // biome-ignore lint/suspicious/noExplicitAny: the page's debug surface
  type G = any
  for (const s of spec.shots) {
    // the framing first
    await page.evaluate(async (sh) => {
      const g = (window as G).guildhall
      const u = g.ext.undead
      const grave = typeof sh.at === "number" || sh.at === undefined ? u.graves()[sh.at ?? 0] : null
      const at = Array.isArray(sh.at)
        ? sh.at
        : sh.at === "gate"
          ? u.gate()
          : [grave.x, grave.y + (sh.lift ?? 0.45), grave.z]
      // the camera looks along (−sin az, −cos az)
      const az =
        sh.azimuth ?? (grave ? (grave.facing * 180) / Math.PI + (sh.turn ?? 30) : g.camera.get().azimuth)
      const el = sh.elevation ?? 30
      const d = sh.distance ?? 4
      const a = (az * Math.PI) / 180
      const e = (el * Math.PI) / 180
      await g.camera.setMode?.("free")
      await g.camera.fly?.({
        eye: [
          at[0] + Math.sin(a) * Math.cos(e) * d,
          at[1] + Math.sin(e) * d,
          at[2] + Math.cos(a) * Math.cos(e) * d,
        ],
        yaw: az,
        pitch: -el,
      })
    }, s as never)
    // then the moment
    await page.evaluate(async (sh) => {
      const g = (window as G).guildhall
      const u = g.ext.undead
      g.ext.workfx?.freeze(false)
      if (sh.scene) u.play(sh.scene)
      if (sh.hold !== undefined) u.hold(sh.hold)
      if (sh.seek !== undefined) {
        const session = g.ext.session
        session.clock.play(false)
        session.clock.seek(session.clock.get().start + sh.seek, { jump: true })
      }
      await u.ready()
    }, s as never)
    await page.waitForTimeout(s.run ?? 900)
    if (s.run !== undefined)
      await page.evaluate(() => {
        const g = (window as G).guildhall
        g.ext.undead.hold(g.ext.undead.at())
        g.ext.workfx?.freeze(true)
      })
    await page.waitForTimeout(400)
    const info = await page.evaluate(() => {
      const g = (window as G).guildhall
      return {
        figures: g.ext.undead.figures(),
        stats: g.ext.undead.stats(),
        at: g.ext.undead.at(),
        agents: g.ext.life?.agents?.() ?? null,
      }
    })
    await page.screenshot({ path: `${out}/${s.name}.png` })
    writeFileSync(`${out}/${s.name}.json`, `${JSON.stringify(info, null, 1)}\n`)
    console.log(s.name, "done", JSON.stringify(info.stats), "at", Math.round(info.at))
  }
} finally {
  await browser.close()
}
