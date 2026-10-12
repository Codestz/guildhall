import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import type { ProjectRef } from "@guildhall/core/project"
import { MAX_GUILD, validGuild } from "./validate.ts"

/**
 * The projects the hub has heard from, and the guild each one is shown as (PROTOCOL.md §3.1). Two
 * projects both named `app` (two clones, two `app` repos) are two guilds, `app` and `app·2`: the
 * first to be heard keeps the plain name. Each project keeps its guild for good — the registry is
 * written to `<home>/projects.json` — so a hub restart never swaps them. Dispatches without a project
 * (older adapters) keep the guild they name, as before, and old chronicles keep their names.
 */

export interface KnownProject {
  id: string
  guild: string
  github?: string
  branch?: string
  /** When the hub last heard from it, ms since the epoch. */
  seen: number
}

export interface Projects {
  /** The guild for `project`'s dispatches, asking for `name`. Registers the project on first sight. */
  claim(name: string, project: ProjectRef, now?: number): string
  /** The projects heard from at or after `since`. */
  active(since: number): KnownProject[]
}

export function createProjects(file: string): Projects {
  const known = load(file)

  function save(): void {
    try {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(`${file}.tmp`, `${JSON.stringify([...known.values()], null, 2)}\n`)
      renameSync(`${file}.tmp`, file)
    } catch (error) {
      // Names still hold until the hub restarts; a project then asks again and gets the same one
      // unless another took it meanwhile.
      console.warn(`hub: could not write ${file}: ${String(error)}`)
    }
  }

  return {
    claim(name, project, now = Date.now()) {
      const had = known.get(project.id)
      if (had) {
        had.seen = now
        if (had.github !== project.github || had.branch !== project.branch) {
          had.github = project.github
          had.branch = project.branch
          save()
        }
        return had.guild
      }
      const guild = freeName(name, new Set([...known.values()].map((p) => p.guild)))
      known.set(project.id, {
        id: project.id,
        guild,
        ...(project.github ? { github: project.github } : {}),
        ...(project.branch ? { branch: project.branch } : {}),
        seen: now,
      })
      save()
      return guild
    },
    active(since) {
      return [...known.values()].filter((project) => project.seen >= since)
    },
  }
}

/** `name`, or `name·2`, `name·3`… whichever no project has yet, within MAX_GUILD. */
export function freeName(name: string, taken: ReadonlySet<string>): string {
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? "" : `·${n}`
    const candidate = `${name.slice(0, MAX_GUILD - suffix.length)}${suffix}`
    if (!taken.has(candidate)) return candidate
  }
}

function load(file: string): Map<string, KnownProject> {
  const known = new Map<string, KnownProject>()
  let list: unknown
  try {
    list = JSON.parse(readFileSync(file, "utf8"))
  } catch {
    return known
  }
  if (!Array.isArray(list)) return known
  for (const item of list) {
    const p = item as Partial<KnownProject>
    if (typeof p?.id !== "string" || !validGuild(p.guild) || known.has(p.id)) continue
    known.set(p.id, {
      id: p.id,
      guild: p.guild,
      ...(typeof p.github === "string" ? { github: p.github } : {}),
      ...(typeof p.branch === "string" ? { branch: p.branch } : {}),
      seen: typeof p.seen === "number" ? p.seen : 0,
    })
  }
  return known
}
