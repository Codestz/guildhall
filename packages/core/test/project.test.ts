import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { branchOf, githubOf, originOf, projectId, projectOf, refOf } from "../src/project.ts"

describe("githubOf: a remote URL's owner/name", () => {
  test.each([
    ["https://github.com/Codestz/guildhall.git", "Codestz/guildhall"],
    ["https://github.com/Codestz/guildhall", "Codestz/guildhall"],
    ["https://github.com/Codestz/guildhall/", "Codestz/guildhall"],
    ["http://github.com/a-b/c.d_e.git", "a-b/c.d_e"],
    ["https://user:ghp_secret@github.com/acme/shop.git", "acme/shop"],
    ["git@github.com:Codestz/guildhall.git", "Codestz/guildhall"],
    ["git@github.com:Codestz/guildhall", "Codestz/guildhall"],
    ["github.com:acme/shop.git", "acme/shop"],
    ["ssh://git@github.com/acme/shop.git", "acme/shop"],
    ["ssh://git@github.com:22/acme/shop.git", "acme/shop"],
    ["ssh://git@ssh.github.com:443/acme/shop.git", "acme/shop"],
    ["git://github.com/acme/shop.git", "acme/shop"],
    ["https://GitHub.com/acme/shop", "acme/shop"],
  ])("%s → %s", (url, slug) => {
    expect(githubOf(url)).toBe(slug)
  })

  test.each([
    "https://gitlab.com/acme/shop.git",
    "git@bitbucket.org:acme/shop.git",
    "https://github.com.evil.example/acme/shop",
    "https://github.com/acme",
    "https://github.com/acme/shop/tree/main",
    "https://github.com/-bad/shop",
    "/srv/git/shop.git",
    "file:///srv/git/shop.git",
    "",
  ])("%s is not a GitHub repo", (url) => {
    expect(githubOf(url)).toBeUndefined()
  })
})

describe("reading the git files", () => {
  test("origin's url, whatever other remotes and sections say", () => {
    const config = [
      "[core]",
      "\turl = not-this",
      '[remote "upstream"]',
      "\turl = git@github.com:up/stream.git",
      '[remote "origin"]',
      "\tfetch = +refs/heads/*:refs/remotes/origin/*",
      '\tURL = "git@github.com:acme/shop.git"',
    ].join("\n")
    expect(originOf(config)).toBe("git@github.com:acme/shop.git")
    expect(originOf("[core]\n\tbare = false\n")).toBeUndefined()
  })

  test("the branch HEAD names; none when detached", () => {
    expect(branchOf("ref: refs/heads/feature/sea\n")).toBe("feature/sea")
    expect(branchOf(`${"a".repeat(40)}\n`)).toBeUndefined()
  })
})

/** A repo on disk: `.git/HEAD`, `.git/config` with an origin. */
function repo(name: string, origin?: string, branch = "main"): string {
  const root = join(mkdtempSync(join(tmpdir(), "guildhall-project-")), name)
  mkdirSync(join(root, ".git"), { recursive: true })
  writeFileSync(join(root, ".git", "HEAD"), `ref: refs/heads/${branch}\n`)
  writeFileSync(
    join(root, ".git", "config"),
    origin ? `[core]\n\tbare = false\n[remote "origin"]\n\turl = ${origin}\n` : "[core]\n",
  )
  return root
}

describe("projectOf", () => {
  test("from anywhere in a repo: its root, name, GitHub slug and branch", () => {
    const root = repo("shop", "git@github.com:acme/shop.git", "dark-mode")
    mkdirSync(join(root, "src", "cart"), { recursive: true })
    const project = projectOf(join(root, "src", "cart"))
    expect(project).toEqual({
      id: projectId(root),
      root,
      name: "shop",
      github: "acme/shop",
      branch: "dark-mode",
    })
    expect(project.id).toMatch(/^[0-9a-f]{16}$/)
  })

  test("two repos with one name are two projects: same name, different ids", () => {
    const a = projectOf(repo("app"))
    const b = projectOf(repo("app"))
    expect(a.name).toBe(b.name)
    expect(a.id).not.toBe(b.id)
    expect(projectOf(a.root).id).toBe(a.id)
  })

  test("a linked worktree: HEAD from its own gitdir, origin from the main repo's config", () => {
    const main = repo("shop", "https://github.com/acme/shop.git")
    const gitdir = join(main, ".git", "worktrees", "shop-fix")
    mkdirSync(gitdir, { recursive: true })
    writeFileSync(join(gitdir, "HEAD"), "ref: refs/heads/fix-login\n")
    writeFileSync(join(gitdir, "commondir"), "../..\n")
    const tree = join(main, "..", "shop-fix")
    mkdirSync(tree)
    writeFileSync(join(tree, ".git"), `gitdir: ${gitdir}\n`)
    const project = projectOf(tree)
    expect(project).toMatchObject({ root: tree, name: "shop-fix", github: "acme/shop", branch: "fix-login" })
    expect(project.id).not.toBe(projectOf(main).id)
  })

  test("a submodule: a relative gitdir with no commondir holds both", () => {
    const parent = repo("site")
    const modules = join(parent, ".git", "modules", "theme")
    mkdirSync(modules, { recursive: true })
    writeFileSync(join(modules, "HEAD"), "ref: refs/heads/main\n")
    writeFileSync(join(modules, "config"), '[remote "origin"]\n\turl = git@github.com:acme/theme.git\n')
    const sub = join(parent, "theme")
    mkdirSync(sub)
    writeFileSync(join(sub, ".git"), "gitdir: ../.git/modules/theme\n")
    expect(projectOf(sub)).toMatchObject({ name: "theme", github: "acme/theme", branch: "main" })
  })

  test("outside git: the directory itself, no slug or branch", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "guildhall-nogit-")), "scratch")
    mkdirSync(dir)
    expect(projectOf(dir)).toEqual({ id: projectId(dir), root: dir, name: "scratch" })
  })

  test("a broken .git file or no origin: still a project, never a throw", () => {
    const root = join(mkdtempSync(join(tmpdir(), "guildhall-broken-")), "odd")
    mkdirSync(root)
    writeFileSync(join(root, ".git"), "not a pointer")
    expect(projectOf(root)).toMatchObject({ root, name: "odd" })
    expect(projectOf(repo("plain")).github).toBeUndefined()
  })

  test("the wire part carries no path and no URL: a credential in origin never leaves", () => {
    const root = repo("shop", "https://me:ghp_supersecret@github.com/acme/shop.git")
    const ref = refOf(projectOf(root))
    expect(ref).toEqual({ id: projectId(root), github: "acme/shop", branch: "main" })
    expect(JSON.stringify(ref)).not.toContain("supersecret")
  })
})
