/** A batch of island shots in one browser (one GPU lock): bun tools/shots/roadshots.ts <list.json> <outdir> <suffix> */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { launchChrome } from "./src/chrome.ts"

interface Shot {
  name: string
  url: string
  target: [number, number, number]
  azimuth: number
  elevation: number
  distance: number
}
const [list, out, suffix = ""] = process.argv.slice(2)
const shots = JSON.parse(readFileSync(list!, "utf8")) as Shot[]
const browser = await launchChrome("roadshots")
for (const s of shots)
  for (const collide of [false, true]) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
    const url = collide ? `${s.url}${s.url.includes("?") ? "&" : "?"}collide=1` : s.url
    await page.goto(url, { waitUntil: "load" })
    await page.waitForTimeout(Number(process.env.WAIT ?? 16000))
    await page.evaluate(
      `window.guildhall.camera.set(${JSON.stringify({ target: s.target, azimuth: s.azimuth, elevation: s.elevation, distance: s.distance })})`,
    )
    await page.waitForTimeout(3000)
    const file = join(out!, `${s.name}${collide ? "-collide" : ""}-${suffix}.png`)
    await page.screenshot({ path: file, timeout: 120000 })
    console.log(file)
    await page.close()
  }
await browser.close()
