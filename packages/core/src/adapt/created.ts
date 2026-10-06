// from opencode-cockpit: packages/subagents/src/core/adapt/created.ts (ADR 0001)
/**
 * The session an event says was just created, on either OpenCode: v1's `{ type, properties: { info } }`,
 * v2's `{ type, data: { sessionID } }` (the interface's carry `details.data`). A session seen from its
 * creation is one whose whole run the events will tell; any other was already running before we
 * listened, and its start has to be read from the store. Pure.
 */
export function createdSession(event: unknown): string | undefined {
  if (!event || typeof event !== "object") return undefined
  const raw = event as {
    type?: unknown
    name?: unknown
    properties?: { info?: { id?: unknown } }
    data?: { sessionID?: unknown }
    details?: { data?: { sessionID?: unknown } }
  }
  if ((raw.type ?? raw.name) !== "session.created") return undefined
  const id = raw.properties?.info?.id ?? raw.data?.sessionID ?? raw.details?.data?.sessionID
  return typeof id === "string" && id ? id : undefined
}
