/**
 * Where the hall is running. "showcase" is the published website: a clean view of the simulated
 * guild with the minimal HUD (no console of levers). "app" is the local install and dev server.
 * Showcase is chosen at build time (`VITE_GUILDHALL_SHOWCASE=1`) or with `?showcase` in the URL.
 */
export type Mode = "app" | "showcase"

export const MODE: Mode =
  import.meta.env.VITE_GUILDHALL_SHOWCASE === "1" ||
  (typeof location !== "undefined" && new URLSearchParams(location.search).has("showcase"))
    ? "showcase"
    : "app"

/**
 * Automation hooks on `window` (guild, quality, r3f) for scripts/shot.ts: always in dev, and in a
 * production build only when built with `VITE_GUILDHALL_PROBE=1` (to measure what ships).
 */
export const PROBE: boolean = import.meta.env.DEV || import.meta.env.VITE_GUILDHALL_PROBE === "1"
