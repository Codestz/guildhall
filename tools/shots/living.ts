/**
 * The world never freezes (decisions.md "User review notes (10-14 evening)"), shot:
 * bun tools/shots/living.ts <origin> <outdir> [scene…]
 *
 * Scenes (default all): `solo` and `party` (a told story at its end, then 60 s on), `ghost` (the rush's
 * fallen rising and drifting to the graveyard), `next` (the home's "Next story" pill, and the next story
 * playing), `residents` (a repo's hall with no session at evening: its resident guild). Each writes
 * <outdir>/<name>.png at 900 × 600, DPR 1, and prints what the heroes were doing.
 */
import { mkdirSync } from "node:fs"
import type { Page } from "playwright-core"
import { launchChrome } from "./src/chrome.ts"

const [origin = "http://127.0.0.1:6200", out = ".probe/living", ...asked] = process.argv.slice(2)
const scenes = asked.length ? asked : ["solo", "party", "ghost", "next", "residents"]
mkdirSync(out, { recursive: true })
const VIEW = { width: 900, height: 600 }

// biome-ignore lint/suspicious/noExplicitAny: the page's debug surface
type G = any

async function open(page: Page, path: string): Promise<void> {
  await page.goto(`${origin}${path}`, { waitUntil: "load" })
  await page.waitForFunction(() => document.documentElement.dataset.world === "revealed", null, {
    timeout: 120_000,
  })
  await page.waitForFunction(() => (window as G).guildhall?.ext?.life?.agents, null, { timeout: 60_000 })
  await page.waitForTimeout(1500)
}

/** Plays the home's session to its end from `before` ms before it, and waits until it rests there. */
async function toEnd(page: Page, before: number): Promise<void> {
  await page.evaluate((ms) => {
    const s = (window as G).guildhall.ext.session
    const c = s.clock.get()
    s.clock.seek(c.end - ms, { jump: true })
    s.clock.play(true)
  }, before)
  await page.waitForFunction(() => (window as G).guildhall.ext.session.restedMs() > 300, null, {
    timeout: before + 60_000,
  })
}

const agents = (page: Page) =>
  page.evaluate(() =>
    (
      (window as G).guildhall.ext.life.agents() as {
        id: string
        name: string
        at: unknown
        act: string
        sample?: { clip: string }
      }[]
    ).map((a) => ({ id: a.id, name: a.name, at: a.at, act: a.act, clip: a.sample?.clip })),
  )

async function follow(page: Page, id: string): Promise<void> {
  await page.evaluate((who) => (window as G).guildhall.ext.camera.follow(who), id)
  await page.waitForTimeout(2500)
}

async function shot(
  page: Page,
  name: string,
  clip?: { x: number; y: number; width: number; height: number },
) {
  await page.screenshot({ path: `${out}/${name}.png`, ...(clip ? { clip } : {}) })
  console.log(name, JSON.stringify(await agents(page)))
}

async function story(page: Page, id: "solo" | "party") {
  await open(page, `/?story=${id}&next=0`)
  await toEnd(page, id === "solo" ? 4000 : 6000)
  const shown = (await agents(page)).filter((a) => a.at)
  const gm = shown[0]?.id
  if (gm) await follow(page, gm)
  await shot(page, `${id}-end`)
  await page.waitForTimeout(60_000)
  if (gm) await follow(page, gm)
  await shot(page, `${id}-end-60s`)
}

async function ghost(page: Page) {
  await open(page, "/?story=rush&next=0")
  // the first hero whose itinerary rises as a ghost: seek to just before it rises, follow it
  const g = await page.evaluate(() => {
    const ext = (window as G).guildhall.ext
    for (const a of ext.life.agents()) {
      const it = ext.life.itinerary(a.id)
      if (it?.ghost)
        return { id: a.id as string, from: it.ghost.from as number, fade: it.ghost.fade as number }
    }
    return null
  })
  if (!g) {
    console.log("ghost: none planned")
    return
  }
  await page.evaluate((at) => {
    const s = (window as G).guildhall.ext.session
    s.clock.seek(at - 3000, { jump: true })
    s.clock.play(true)
  }, g.from)
  await follow(page, g.id)
  await page.waitForTimeout(1200)
  await shot(page, "ghost-rising")
  await page.waitForTimeout(8000)
  await follow(page, g.id)
  await shot(page, "ghost-drifting")
  // at the grave, as it fades (after the story's end, on life's own time: rest there until then)
  const wait = await page.evaluate((at) => {
    const s = (window as G).guildhall.ext.session
    const c = s.clock.get()
    if (at - 6000 <= c.end) {
      s.clock.seek(at - 6000, { jump: true })
      s.clock.play(true)
      return 0
    }
    s.clock.play(false)
    s.clock.seek(c.end, { jump: true })
    return at - c.end - 6000
  }, g.fade)
  await page.waitForTimeout(wait)
  await follow(page, g.id)
  // lingering at its grave, a moment before it fades
  await page.waitForTimeout(6000 - 2500 - 1000)
  await shot(page, "ghost-grave")
}

async function next(page: Page) {
  await open(page, "/?story=solo")
  await toEnd(page, 3000)
  await page.waitForTimeout(14_000)
  // the pill, top centre
  await shot(page, "next-pill", { x: 200, y: 0, width: 500, height: 130 })
  await page.waitForFunction(
    () => location.search.includes("story=") && !location.search.includes("story=solo"),
    null,
    {
      timeout: 20_000,
    },
  )
  await page.waitForTimeout(4000)
  console.log("next story:", await page.evaluate(() => location.search))
  await shot(page, "next-playing")
}

async function residents(page: Page) {
  await open(page, "/hall/facebook/react?hour=19")
  await page.waitForTimeout(45_000)
  const shown = (await agents(page)).filter((a) => a.at)
  console.log("residents:", shown.length)
  if (shown[0]) await follow(page, shown[0].id)
  await shot(page, "residents-evening")
  await page.waitForTimeout(40_000)
  if (shown[1]) await follow(page, shown[1].id)
  await shot(page, "residents-evening-2")
}

const browser = await launchChrome("living")
try {
  for (const scene of scenes) {
    const page = await browser.newPage({ viewport: VIEW, deviceScaleFactor: 1 })
    page.on("console", (m) => {
      if (m.type() === "error") console.log("console:", m.text().slice(0, 300))
    })
    try {
      if (scene === "solo" || scene === "party") await story(page, scene)
      if (scene === "ghost") await ghost(page)
      if (scene === "next") await next(page)
      if (scene === "residents") await residents(page)
    } catch (error) {
      console.log(scene, "failed:", String(error).slice(0, 400))
    } finally {
      await page.close()
    }
  }
} finally {
  await browser.close()
}
