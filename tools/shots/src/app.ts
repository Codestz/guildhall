/**
 * A headless page on an app, ready to drive through `window.guildhall`. Shared by `bun shots` and
 * tools/import (the thumbnail page).
 *
 *   const { page, close } = await openApp({ app: "studio", query: { screen: "m0" } })
 */
import type { GuildhallDebug } from "@guildhall/core"
import type { Browser, Page } from "playwright-core"
import { DEFAULTS, type Size } from "./args.ts"
import { launchChrome } from "./chrome.ts"
import { serveStudio } from "./server.ts"

declare global {
  interface Window {
    guildhall?: GuildhallDebug
  }
}

const READY_TIMEOUT_MS = 30_000

export interface PageOptions {
  size?: Size
  dpr?: number
}

export interface AppPage {
  page: Page
  /** Page errors and console errors, as they happen. */
  errors: string[]
  close(): Promise<void>
}

/** A new page whose uncaught errors and console errors land in `errors`. */
export async function openPage(browser: Browser, options: PageOptions = {}): Promise<AppPage> {
  const context = await browser.newContext({
    viewport: options.size ?? DEFAULTS.size,
    deviceScaleFactor: options.dpr ?? DEFAULTS.dpr,
  })
  const page = await context.newPage()
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`))
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`)
  })
  return { page, errors, close: () => context.close() }
}

/** Waits for `window.guildhall` to exist and its `ready()` to resolve. */
export async function waitReady(page: Page, timeout = READY_TIMEOUT_MS): Promise<void> {
  await page.waitForFunction(() => window.guildhall !== undefined, undefined, { timeout })
  await page.evaluate(() => window.guildhall?.ready())
}

export interface OpenAppOptions extends PageOptions {
  app: "studio"
  page?: "index" | "thumbs"
  /** The deep link: `"screen=m0&hud=perf"` or `{ screen: "m0" }`. */
  query?: string | Record<string, string>
}

/** The URL of an app page on a server. */
export function appUrl(
  origin: string,
  page: "index" | "thumbs" = "index",
  query: OpenAppOptions["query"] = "",
) {
  const url = new URL(page === "index" ? "/" : `/${page}.html`, origin)
  url.search = new URLSearchParams(query).toString()
  return url.toString()
}

/**
 * Opens an app page headless and waits until it is ready, starting the app's vite server if none is
 * up. `close` shuts the browser and any server it started.
 */
export async function openApp(options: OpenAppOptions): Promise<AppPage & { url: string }> {
  const server = await serveStudio()
  let browser: Browser | undefined
  try {
    browser = await launchChrome(`openApp ${options.app}`)
    const opened = await openPage(browser, options)
    const url = appUrl(server.origin, options.page, options.query)
    await opened.page.goto(url)
    await waitReady(opened.page)
    const owned = browser
    return {
      ...opened,
      url,
      async close() {
        await owned.close()
        await server.stop()
      },
    }
  } catch (error) {
    await browser?.close()
    await server.stop()
    throw error
  }
}
