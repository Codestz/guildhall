import { PROBE } from "./mode.ts"

/**
 * The dev-only URL params (guild/params.ts, tier "dev"), read in one place. They are honoured only
 * in a dev or probe build (guild/mode.ts PROBE, a compile-time constant); in the published showcase
 * and the hub-served build every flag has its default, so a shared link cannot toggle internals.
 *
 * Grammar: the "off" switches take `off`, `0` or `false`; the "on" switches take `1`, `on` or `true`.
 * `quality` and `event` are dev too, but they are deep-link values: guild/deeplink.ts gates them
 * with the same `probe`. `grow=t:N` is gated where `grow` is read (scene/growth/Growth.tsx).
 */
export interface DevFlags {
  /** Cascaded shadows (`?cascades=off` for the single box), aerial haze, real character shadows. */
  cascades: boolean
  haze: boolean
  characters: boolean
  /** The island's folk (`?folk=off`). */
  folk: boolean
  /** Node materials on WebGL (`?tsl=1`). */
  tsl: boolean
  /** A hub anywhere, not only on this machine (`?live=...&anyhub=1`, guild/feeds/live.ts). */
  anyhub: boolean
  /** `?townsfolk=N`: caps the town for a measurement (0: nobody). */
  townsfolk: number | undefined
  /** `?bridgemax=N`: bridges islands whose quays are that close. */
  bridgemax: number | undefined
}

/** `?showcase` (force the showcase mode) is dev too, read by guild/mode.ts itself: it sits below this module. */

const DEFAULTS: DevFlags = Object.freeze({
  cascades: true,
  haze: true,
  characters: true,
  folk: true,
  tsl: false,
  anyhub: false,
  townsfolk: undefined,
  bridgemax: undefined,
})

const OFF = new Set(["off", "0", "false"])
const ON = new Set(["1", "on", "true"])

/** The flags a search string asks for; the defaults when not `probe`. */
export function devFlagsOf(search: string, probe: boolean): DevFlags {
  if (!probe) return DEFAULTS
  const params = new URLSearchParams(search)
  const off = (key: string) => !OFF.has(params.get(key) ?? "")
  const on = (key: string) => ON.has(params.get(key) ?? "")
  const count = (key: string, min: number) => {
    const value = params.get(key)
    if (value === null || value === "" || Number.isNaN(Number(value))) return undefined
    return Number(value) >= min ? Number(value) : undefined
  }
  return Object.freeze({
    cascades: off("cascades"),
    haze: off("haze"),
    characters: off("characters"),
    folk: off("folk"),
    tsl: on("tsl"),
    anyhub: on("anyhub"),
    townsfolk: count("townsfolk", 0),
    bridgemax: count("bridgemax", 0) || undefined,
  })
}

/** This page's flags, read once at load. */
export const DEV: DevFlags = devFlagsOf(typeof location === "undefined" ? "" : location.search, PROBE)
