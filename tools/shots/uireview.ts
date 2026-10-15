/**
 * Focused UI-review shots at one viewport/DPR (the user's review notes, 10-14):
 *   bun tools/shots/uireview.ts <out.png> <url> <w> <h> [click-selector] [wait-ms]
 * Loads the url, waits for the world to settle, clicks the selector once (if given), and shoots.
 */
import { launchChrome } from "./src/chrome.ts"

const [out, url, w = "1440", h = "900", click, wait = "6000"] = process.argv.slice(2)
if (!out || !url) throw new Error("usage: uireview.ts <out.png> <url> <w> <h> [click] [wait]")
const browser = await launchChrome("uireview")
try {
  const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: 1 })
  await page.goto(url, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(Number(wait))
  if (click) {
    await page.locator(click).first().click()
    await page.waitForTimeout(800)
  }
  await page.screenshot({ path: out })
} finally {
  await browser.close()
}
