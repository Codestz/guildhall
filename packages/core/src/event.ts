import type { Change } from "./model/changes.ts"

/** Wire format version. Bump on any breaking change to `GuildEvent`; chronicles record it per line. */
export const WIRE_VERSION = 1

/**
 * One thing that happened in a guild, as the herald reports it and the hub records it.
 *
 * The payload is cockpit's `Change` — already one vocabulary for OpenCode 1 and 2. The hall turns
 * changes into deeds, pleas and loot itself (via the model), so the wire stays a thin envelope.
 */
export interface GuildEvent {
  v: typeof WIRE_VERSION
  /** The OpenCode project/instance this came from (CONTEXT.md: Guild). */
  guild: string
  /** Per-guild sequence number, so a reconnecting hall can ask for what it missed. */
  seq: number
  change: Change
}
