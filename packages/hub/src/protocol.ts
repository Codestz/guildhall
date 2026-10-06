import type { Change, GuildEvent } from "@guildhall/core"

/** Default port (ADR 0003; Agentry's Workbench uses 4317). */
export const HUB_PORT = 4747
/**
 * Every POST from a herald carries this header. A custom header forces a CORS preflight, which the
 * hub never answers — so a web page open in the browser can't forge events into the hall.
 */
export const HERALD_HEADER = "x-guildhall-herald"

/** What a herald sends: a batch of translated changes, plus the raw events behind them. */
export interface Dispatch {
  guild: string
  /** Which OpenCode the herald runs in. */
  opencode: 1 | 2
  changes: Change[]
  /** The host events as received, for re-translation and tuning (kept locally, never served). */
  raw?: unknown[]
}

/** Hub → hall over WebSocket. */
export type HubMessage =
  | { type: "hello"; version: number; events: GuildEvent[] }
  | { type: "events"; events: GuildEvent[] }
