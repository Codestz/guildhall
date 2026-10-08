import { type ProjectRef, projectOf, refOf } from "@guildhall/core/project"

/**
 * The guild a Claude Code session belongs to: its project, named after the git root above `cwd`
 * (the directory holding `.git`, a folder or a worktree's file), or after `cwd` itself outside git.
 * A session started in `repo/src` and one in `repo` are one guild, and the same project opened in
 * OpenCode at its root lands in the same guild. Walks the file system; runs no git.
 */
export function guildOf(cwd: string): string {
  return projectOf(cwd).name
}

/**
 * What the hook sends as its dispatch's `project` (PROTOCOL.md §3.1): the project's stable id, its
 * GitHub `owner/name` and its branch, read from the git files (`@guildhall/core/project`). With it the
 * hub keeps two projects that share a name apart, and watches the project's GitHub remote.
 */
export function projectRefOf(cwd: string): ProjectRef {
  return refOf(projectOf(cwd))
}
