import { createHash } from "node:crypto"
import { existsSync, readFileSync, statSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"

/**
 * Which project a directory belongs to, for the adapters (PROTOCOL.md §3.1, `Dispatch.project`). Reads
 * the git files directly — `.git/HEAD`, `.git/config`, a worktree's `.git` file — and runs no git, so
 * it is cheap enough for a hook process per event. Node only: imported as `@guildhall/core/project`,
 * never from the core index the hall loads.
 */

/** What an adapter says about its project on the wire. */
export interface ProjectRef {
  /** Stable for the project's directory: a hash of its git root (or of the directory outside git). */
  id: string
  /** `owner/name`, when `origin` is a GitHub remote. Only the slug: never the URL, which may hold a credential. */
  github?: string
  /** The checked-out branch; absent on a detached HEAD or outside git. */
  branch?: string
}

export interface Project extends ProjectRef {
  /** The git root: the directory holding `.git` (a folder, or a worktree's or submodule's file). */
  root: string
  /** The guild name the adapter asks for: the root's directory name. The hub may make it unique. */
  name: string
}

/** The project `dir` is in: its git root, or `dir` itself outside git. Never throws. */
export function projectOf(dir: string): Project {
  const start = resolve(dir)
  const root = gitRootOf(start)
  const at = root ?? start
  const project: Project = { id: projectId(at), root: at, name: basename(at) || basename(start) || "guild" }
  if (!root) return project
  const git = gitDirOf(root)
  if (!git) return project
  const branch = branchOf(read(join(git.dir, "HEAD")))
  const github = githubOf(originOf(read(join(git.common, "config"))))
  return { ...project, ...(github ? { github } : {}), ...(branch ? { branch } : {}) }
}

/** The wire part of a project. */
export function refOf(project: Project): ProjectRef {
  const { id, github, branch } = project
  return { id, ...(github ? { github } : {}), ...(branch ? { branch } : {}) }
}

export function projectId(root: string): string {
  return createHash("sha256").update(resolve(root)).digest("hex").slice(0, 16)
}

/** The nearest directory at or above `dir` that holds a `.git` (folder or file). */
export function gitRootOf(dir: string): string | undefined {
  for (let at = resolve(dir); ; at = dirname(at)) {
    if (existsSync(join(at, ".git"))) return at
    if (dirname(at) === at) return undefined
  }
}

/**
 * Where a root's git data is. `dir` holds its HEAD; `common` its config. They differ in a linked
 * worktree, whose `.git` file says `gitdir: <main>/.git/worktrees/<name>` and whose gitdir holds a
 * `commondir` naming the main `.git`. A submodule's `.git` file points at a gitdir with no
 * `commondir`: both are that gitdir.
 */
export function gitDirOf(root: string): { dir: string; common: string } | undefined {
  const dotGit = join(root, ".git")
  try {
    if (statSync(dotGit).isDirectory()) return { dir: dotGit, common: dotGit }
  } catch {
    return undefined
  }
  const pointer = /^gitdir:\s*(.+?)\s*$/m.exec(read(dotGit))?.[1]
  if (!pointer) return undefined
  const dir = resolve(root, pointer)
  const common = read(join(dir, "commondir")).trim()
  return { dir, common: common ? resolve(dir, common) : dir }
}

/** The branch a HEAD file names: `ref: refs/heads/<branch>`. A detached HEAD (a sha) has none. */
export function branchOf(head: string): string | undefined {
  return /^ref:\s*refs\/heads\/(.+?)\s*$/m.exec(head)?.[1]
}

/** `origin`'s first `url` in a git config file's text. */
export function originOf(config: string): string | undefined {
  let inOrigin = false
  for (const raw of config.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith("[")) {
      inOrigin = /^\[\s*remote\s+"origin"\s*\]$/i.test(line)
      continue
    }
    if (!inOrigin) continue
    const url = /^url\s*=\s*(.*)$/i.exec(line)?.[1]
    if (url !== undefined) return url.replace(/^"(.*)"$/, "$1").trim() || undefined
  }
  return undefined
}

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/
const REPO = /^[A-Za-z0-9._-]{1,100}$/

/**
 * The `owner/name` of a GitHub remote URL, or undefined for anything else. Reads the forms git takes:
 * `https://github.com/o/r(.git)`, with a `user:token@` too (never kept), `ssh://git@github.com[:port]/o/r`,
 * `git://github.com/o/r`, and scp-like `git@github.com:o/r.git`. `ssh.github.com` (SSH over 443) counts.
 */
export function githubOf(url: string | undefined): string | undefined {
  if (!url) return undefined
  let host: string
  let path: string
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/\/)(.+)$/.exec(url)
  if (scp && !/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    host = scp[1] ?? ""
    path = scp[2] ?? ""
  } else {
    try {
      const parsed = new URL(url)
      if (!["https:", "http:", "ssh:", "git:", "git+ssh:", "ssh+git:"].includes(parsed.protocol))
        return undefined
      host = parsed.hostname
      path = parsed.pathname
    } catch {
      return undefined
    }
  }
  if (!["github.com", "www.github.com", "ssh.github.com"].includes(host.toLowerCase())) return undefined
  const [owner, repo, ...rest] = path
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/, "")
    .split("/")
  if (rest.length > 0 || !owner || !repo || !OWNER.test(owner) || !REPO.test(repo)) return undefined
  if (repo === "." || repo === "..") return undefined
  return `${owner}/${repo}`
}

function read(file: string): string {
  try {
    return readFileSync(file, "utf8")
  } catch {
    return ""
  }
}
