/**
 * Which OpenCode 2 events belong to this herald's project. The service's event stream carries
 * every open location's events, and a herald is set up per location (your project, and `~` for
 * the service itself). Most events say where they happened (`location.directory`), but some —
 * status (`session.execution.*`), usage, `session.viewed` — don't. Passing those through made
 * every herald record them, so a phantom guild named after the home directory collected half
 * of each session (measured on ses_eee782c2…: 74 status/usage events under "codestz").
 *
 * A session is this project's once a located event of it arrives here (every session's first
 * event, `session.created`, is located — checked on that recording, subagents included). An
 * event without a location is kept only when its session is one of ours; one without a session
 * or location is nobody's in particular and is dropped.
 */
export interface Located {
  location?: { directory?: string }
  data?: { sessionID?: string }
  durable?: { aggregateID?: string }
}

export function createLocationFilter(directory: string): (event: Located) => boolean {
  const mine = new Set<string>()
  return (event) => {
    const where = event.location?.directory
    const session = sessionOf(event)
    if (where) {
      if (where !== directory) return false
      if (session) mine.add(session)
      return true
    }
    return session !== undefined && mine.has(session)
  }
}

function sessionOf(event: Located): string | undefined {
  const id = event.data?.sessionID ?? event.durable?.aggregateID
  return typeof id === "string" && id.startsWith("ses_") ? id : undefined
}
