import type { Change, GuildEvent, SeaRecord } from "@guildhall/core"
import type { ProjectRef } from "@guildhall/core/project"

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
  /**
   * The project the changes come from (PROTOCOL.md §3.1). With it the hub keeps one guild per project
   * (`app`, `app·2`) and watches its GitHub remote; without it `guild` is taken as it is.
   */
  project?: ProjectRef
}

/** Hub → hall over WebSocket. */
export type HubMessage =
  /** `sea`: the recent sea records of the hello's guilds, when there are any. */
  | { type: "hello"; version: number; events: GuildEvent[]; sea?: SeaRecord[] }
  | { type: "events"; events: GuildEvent[] }
  /** What just happened on GitHub to a guild's project (PROTOCOL.md §7). */
  | { type: "sea"; events: SeaRecord[] }
