/**
 * Where the hall is running. "showcase" is the published website: a clean view of the simulated
 * guild with the minimal HUD (no console of levers). "app" is the local install and dev server.
 * Showcase is chosen at build time (`VITE_GUILDHALL_SHOWCASE=1`); a dev or probe build also takes
 * `?showcase`. A production build ignores the param: the site is the showcase by construction.
 */
export type Mode = "app" | "showcase"

/**
 * Automation hooks on `window` (guild, quality, r3f) for scripts/shot.ts: always in dev, and in a
 * production build only when built with `VITE_GUILDHALL_PROBE=1` (to measure what ships). It also
 * gates the dev-only URL params (guild/devFlags.ts, guild/params.ts).
 */
export const PROBE: boolean = import.meta.env.DEV || import.meta.env.VITE_GUILDHALL_PROBE === "1"

export const MODE: Mode =
  import.meta.env.VITE_GUILDHALL_SHOWCASE === "1" ||
  (PROBE && typeof location !== "undefined" && new URLSearchParams(location.search).has("showcase"))
    ? "showcase"
    : "app"

/**
 * Built to be served by the hub, as the npm package ships it (`VITE_GUILDHALL_SERVED=1`, ADR 0002):
 * the hall then follows the hub that served the page from the start, without `?live`.
 */
export const SERVED: boolean = import.meta.env.VITE_GUILDHALL_SERVED === "1"
