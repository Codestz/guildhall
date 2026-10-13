#!/usr/bin/env bun
/**
 * Drive an app headless: URL + camera → PNG + metrics.
 *
 *   bun shots "http://localhost:5300/town/1?hud=perf" --camera 0,60,25,0,0,0 --out .probe/town/town
 *
 * Waits for `guildhall.ready()`, sets the camera, samples `perf` for `--sample` ms, screenshots, and
 * writes `<out>.png` and `<out>.json`. Any page or console error is reported there and exits 1. A
 * localhost URL nobody answers gets the studio dev server started on its port (and stopped after).
 */
import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import type { CameraPose, FrameStats } from "@guildhall/core"
import { openPage, waitReady } from "./app.ts"
import { parseArgs, report, type ShotOptions, USAGE } from "./args.ts"
import { launchChrome } from "./chrome.ts"
import { runPrefabs } from "./prefabs.ts"
import { type Server, serveStudio } from "./server.ts"
import { runSet } from "./set.ts"
import { runStills, runThumbs } from "./thumbs.ts"

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"])

async function shoot(options: ShotOptions): Promise<string[]> {
  const url = new URL(options.url)
  const server: Server | null = LOCAL_HOSTS.has(url.hostname)
    ? await serveStudio(Number(url.port || 80))
    : null
  const browser = await launchChrome("shots")
  const out = resolve(options.out)
  mkdirSync(dirname(out), { recursive: true })
  let camera: CameraPose | null = null
  let stats: FrameStats | null = null
  const errors: string[] = []
  try {
    const opened = await openPage(browser, options)
    const { page } = opened
    try {
      await page.goto(options.url)
      await waitReady(page)
      if (options.camera) await page.evaluate((pose) => window.guildhall?.camera.set(pose), options.camera)
      camera = await page.evaluate(() => window.guildhall?.camera.get() ?? null)
      stats = await page.evaluate((ms) => window.guildhall?.perf.sample(ms) ?? null, options.sampleMs)
    } catch (error) {
      errors.push(`shots: ${(error as Error).message.split("\n")[0]}`)
    }
    await page.screenshot({ path: `${out}.png`, type: "png" })
    errors.unshift(...opened.errors)
  } finally {
    await browser.close()
    await server?.stop()
  }
  const json = report(options.url, camera, stats, errors, new Date())
  await Bun.write(`${out}.json`, `${JSON.stringify(json, null, 2)}\n`)
  console.log(`${out}.png\n${out}.json`)
  return errors
}

// `bun shots set <name>`: a regression set (set.ts).
if (process.argv[2] === "set") process.exit(await runSet(process.argv.slice(3)))
// `bun shots prefabs`: every tile prefab alone, composed into review sheets (prefabs.ts).
if (process.argv[2] === "prefabs") process.exit(await runPrefabs(process.argv.slice(3)))

// `bun shots thumbs` / `bun shots stills`: the Studio's committed card previews and lab backdrops (thumbs.ts).
if (process.argv[2] === "thumbs") process.exit(await runThumbs(process.argv.slice(3)))
if (process.argv[2] === "stills") process.exit(await runStills(process.argv.slice(3)))

let options: ShotOptions
try {
  options = parseArgs(process.argv.slice(2))
} catch (error) {
  console.error(`${(error as Error).message}\n\n${USAGE}`)
  process.exit(2)
}
const errors = await shoot(options)
for (const error of errors) console.error(error)
process.exit(errors.length > 0 ? 1 : 0)
