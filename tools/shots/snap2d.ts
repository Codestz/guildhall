/** Plain page screenshot (2D screens with no stage): bun tools/shots/snap2d.ts <url> <out.png> [w] [h] */
import { launchChrome } from "./src/chrome.ts"

const [url, out, w = "1600", h = "1000"] = process.argv.slice(2)
const browser = await launchChrome("snap2d")
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } })
page.on("console", (m) => console.log("[console]", m.type(), m.text()))
page.on("pageerror", (e) => console.log("[pageerror]", e.message))
await page.goto(url!, { waitUntil: "load" })
await page.waitForTimeout(Number(process.env.WAIT ?? 2000))
if (process.env.EVAL) {
  await page.evaluate(process.env.EVAL)
  await page.waitForTimeout(2500)
}
await page.screenshot({ path: out!, timeout: 120000 })
await browser.close()
console.log(out)
