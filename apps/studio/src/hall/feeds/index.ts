/**
 * The hall's event feeds (plan-hud-events H1): `/hall/<owner>/<repo>?feed=live|replay|story`.
 *
 *   feed     `Feed`, `FeedSink`, `FeedStatus`: the lean V1 shape
 *   live     `LiveFeed`: the legacy hub's WebSocket (seq dedup, backoff, the backlog rule)
 *   replay   `ReplayFeed`: a recorded `.jsonl` (a guild chronicle the dev Studio serves, core's fixtures)
 *   story    `StoryFeed`: a demo story (sim `story(id)`, D1), told on the hall's repo
 *   session  `createSession`: the hall's one EventLog, its clock and a 10 Hz snapshot for React
 *   view     the session read into the HUD's props
 *
 *   probe    the live default: on localhost, with no `?feed=`, a hub that holds a guild of the repo opens `live`
 *
 * Link knobs: `?guild=` (the hub's guild, exactly; default: the repo's name and its `·n` clones),
 * `?hub=ws://127.0.0.1:<port>/ws`, `?src=` (a chronicle of the guild, or a path on this origin),
 * `?story=saga|solo|party|parties|rush|seas|factions`, `?seed=`, `?st=<seconds>` (open at), `?act=1..5` (a story opens at that act, like the home), `?play=0` (open paused).
 */

import { param } from "../../params.ts"
import type { Feed, FeedKind } from "./feed.ts"
import { hubUrlOf, LiveFeed } from "./live.ts"
import { fetchRecording, ReplayFeed, recordingUrl } from "./replay.ts"
import { actOf, StoryFeed, type StoryStage, storyOf } from "./story.ts"
import { guildMatcher } from "./wire.ts"

export type { Feed, FeedKind, FeedSink, FeedStatus } from "./feed.ts"
export { type AutoFeedOptions, autoFeed, isLocalHost, PROBE_MS, probeHub } from "./probe.ts"
export { createSession, type HallSession, type SessionSnapshot } from "./session.ts"

/** The feed a link asks for, or null (no `?feed=`: the hall shows its history only). */
export function feedKindOf(query: URLSearchParams): FeedKind | null {
  const asked = param(query, "feed")
  return asked === "live" || asked === "replay" || asked === "story" ? asked : null
}

/** The feed for a repo's hall (`slug`: `Codestz/guildhall`). */
export function openFeed(kind: FeedKind, slug: string, query: URLSearchParams, stage: StoryStage = {}): Feed {
  const repo = slug.split("/").pop() || slug
  const exact = param(query, "guild")
  const guild = exact ?? repo
  if (kind === "live")
    return new LiveFeed({
      url: hubUrlOf(param(query, "hub")),
      guild: guildMatcher(guild, exact !== null),
      name: guild,
    })
  if (kind === "replay") {
    const url = recordingUrl(guild, param(query, "src"))
    const file = decodeURIComponent(url.split("/").pop() ?? url)
    return new ReplayFeed({
      name: file === "latest.jsonl" ? "latest session" : file.replace(/\.jsonl$/, "").slice(0, 16),
      load: () => fetchRecording(url),
    })
  }
  const story = storyOf(param(query, "story"))
  const seed = param(query, "seed") ?? 0
  const act = actOf(query)
  return new StoryFeed(story, {
    ...stage,
    ...(act ? { act } : {}),
    ...(Number.isInteger(seed) && seed > 0 ? { seed } : {}),
  })
}
