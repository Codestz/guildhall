/**
 * A recorded session played on the hall's session clock (plan §3.3 Replay): a guild chronicle the hub
 * wrote (`~/.cache/guildhall/chronicles/<guild>/<boot>.jsonl`, served to the dev Studio on loopback by
 * the `/chronicles/` endpoint), or any `.jsonl` of the shapes `readRecording` reads (core's V1
 * fixtures). The whole file is read into the session at once; the clock then plays it, and a seek is
 * the log's `stateAt(t)`, so playing and scrubbing show the same world.
 */
import type { Feed, FeedSink, FeedStatus } from "./feed.ts"
import { readRecording } from "./wire.ts"

export interface ReplayFeedOptions {
  /** What it plays, for the Brand: the file's name. */
  name: string
  /** Reads the recording's text (a fetch, a fixture). Rejects, or resolves null, when there is none. */
  load: () => Promise<string | null>
  /** Which guilds of the file to keep (all by default). */
  keep?: (guild: string) => boolean
}

export class ReplayFeed implements Feed {
  readonly kind = "replay"
  readonly name: string
  private state: FeedStatus = "offline"
  private live = false
  /** Lines the last read left out. */
  skipped = 0

  constructor(private readonly opts: ReplayFeedOptions) {
    this.name = opts.name
  }

  status(): FeedStatus {
    return this.state
  }

  start(sink: FeedSink): void {
    if (this.live) return
    this.live = true
    this.state = "connecting"
    sink.status("connecting")
    this.opts.load().then(
      (text) => {
        if (!this.live) return
        if (text === null) return this.fail(sink, "no recording")
        const read = readRecording(text, this.opts.keep)
        this.skipped = read.skipped
        if (read.inputs.length === 0) return this.fail(sink, "an empty recording")
        sink.reset()
        for (const input of read.inputs) sink.take(input, false)
        sink.loaded?.()
        this.state = "replay"
        sink.status("replay")
      },
      (error: unknown) => {
        if (this.live) this.fail(sink, String(error))
      },
    )
  }

  stop(): void {
    this.live = false
  }

  private fail(sink: FeedSink, note: string): void {
    this.state = "offline"
    sink.status("offline", note)
  }
}

/** Where the dev Studio serves a guild's chronicles (vite.config.ts `chronicles`, loopback only). */
export const CHRONICLES = "/chronicles"

/**
 * The recording a link asks for: `?src=<file>` names one of the guild's chronicles (`2026-10-06T05-13-43-981Z`),
 * `?src=/path.jsonl` any file this origin serves; by default the guild's newest. Never another origin.
 */
export function recordingUrl(guild: string, src: string | null): string {
  const g = encodeURIComponent(guild)
  if (!src) return `${CHRONICLES}/${g}/latest.jsonl`
  if (src.startsWith("/") && !src.startsWith("//")) return src
  const file = src.replace(/[^A-Za-z0-9._-]/g, "")
  return `${CHRONICLES}/${g}/${file.endsWith(".jsonl") ? file : `${file}.jsonl`}`
}

/** The recording at `url`, or null when this origin has none there (a 404: no chronicle, or not the dev Studio). */
export async function fetchRecording(url: string): Promise<string | null> {
  const res = await fetch(url)
  if (res.status === 404 || res.status === 403) return null
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  return res.text()
}
