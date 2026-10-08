import { existsSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"

/**
 * The guild a Claude Code session belongs to: its project, named after the git root above `cwd`
 * (the directory holding `.git`, a folder or a worktree's file), or after `cwd` itself outside git.
 * A session started in `repo/src` and one in `repo` are one guild, and the same project opened in
 * OpenCode at its root lands in the same guild. Walks the file system; runs no git.
 */
export function guildOf(cwd: string): string {
  const start = resolve(cwd)
  for (let dir = start; ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".git"))) return basename(dir) || basename(start)
    if (dirname(dir) === dir) return basename(start)
  }
}
