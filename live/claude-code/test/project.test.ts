import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { guildOf, projectRefOf } from "../src/project.ts"

describe("the project a hook event is from", () => {
  test("from a worktree under the cwd: the worktree's name and branch, the main repo's GitHub remote", () => {
    const base = mkdtempSync(join(tmpdir(), "guildhall-cc-project-"))
    const main = join(base, "shop")
    const gitdir = join(main, ".git", "worktrees", "shop-fix")
    mkdirSync(gitdir, { recursive: true })
    writeFileSync(join(main, ".git", "HEAD"), "ref: refs/heads/main\n")
    writeFileSync(join(main, ".git", "config"), '[remote "origin"]\n\turl = git@github.com:acme/shop.git\n')
    writeFileSync(join(gitdir, "HEAD"), "ref: refs/heads/fix\n")
    writeFileSync(join(gitdir, "commondir"), "../..\n")
    const tree = join(base, "shop-fix")
    mkdirSync(join(tree, "src"), { recursive: true })
    writeFileSync(join(tree, ".git"), `gitdir: ${gitdir}\n`)

    expect(guildOf(join(tree, "src"))).toBe("shop-fix")
    const ref = projectRefOf(join(tree, "src"))
    expect(ref).toMatchObject({ github: "acme/shop", branch: "fix" })
    expect(ref.id).not.toBe(projectRefOf(main).id)
  })

  test("two repos named alike get one guild name but two project ids (the hub tells them apart)", () => {
    const a = join(mkdtempSync(join(tmpdir(), "guildhall-cc-a-")), "app")
    const b = join(mkdtempSync(join(tmpdir(), "guildhall-cc-b-")), "app")
    for (const root of [a, b]) mkdirSync(join(root, ".git"), { recursive: true })
    expect(guildOf(a)).toBe(guildOf(b))
    expect(projectRefOf(a).id).not.toBe(projectRefOf(b).id)
  })
})
