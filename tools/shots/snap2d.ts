/** Plain page screenshot (2D screens with no stage): bun tools/shots/snap2d.ts <url> <out.png> [w] [h] */
import { launchChrome } from "./src/chrome.ts"

const [url, out, w = "1600", h = "1000"] = process.argv.slice(2)
const browser = await launchChrome("snap2d")
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } })
page.on("console", (m) => console.log("[console]", m.type(), m.text()))
page.on("pageerror", (e) => console.log("[pageerror]", e.message))
await page.goto(url!, { waitUntil: "load" })
await page.waitForTimeout(2000)
await page.screenshot({ path: out! })
await browser.close()
console.log(out)
