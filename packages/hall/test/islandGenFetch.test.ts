import { describe, expect, test } from "bun:test"
import { fetchPublicTree, GitHubError, MAX_ENTRIES, parseRepo } from "../src/world/gen/fetch.ts"

/** A stand-in for GitHub: answers by URL suffix, records what was asked. */
function github(routes: Record<string, () => Response>): { fetcher: typeof fetch; asked: string[] } {
  const asked: string[] = []
  const fetcher = (async (input: string | URL | Request) => {
    const url = String(input)
    asked.push(url)
    for (const [suffix, answer] of Object.entries(routes)) if (url.endsWith(suffix)) return answer()
    return new Response("{}", { status: 404 })
  }) as typeof fetch
  return { fetcher, asked }
}
const json = (body: unknown, init?: ResponseInit) => () => Response.json(body, init)

describe("fetchPublicTree", () => {
  test("lists the default branch's tree, recursively", async () => {
    const { fetcher, asked } = github({
      "/repos/acme/tool": json({ default_branch: "trunk" }),
      "/git/trees/trunk?recursive=1": json({
        truncated: false,
        tree: [
          { path: "src", type: "tree", sha: "a", mode: "040000" },
          { path: "src/a.ts", type: "blob", size: 12, sha: "b", mode: "100644" },
          { path: "lib", type: "commit", sha: "c", mode: "160000" },
        ],
      }),
    })
    const tree = await fetchPublicTree("https://github.com/acme/tool.git", fetcher)
    expect(tree).toEqual({
      repo: "acme/tool",
      branch: "trunk",
      truncated: false,
      entries: [
        { path: "src", type: "tree" },
        { path: "src/a.ts", type: "blob", size: 12 },
        { path: "lib", type: "commit" },
      ],
    })
    expect(asked).toHaveLength(2)
  })

  test("passes GitHub's truncated flag on, and caps huge trees", async () => {
    const huge = Array.from({ length: MAX_ENTRIES + 5 }, (_, i) => ({ path: `f${i}`, type: "blob", size: 1 }))
    const { fetcher } = github({
      "/repos/big/mono": json({ default_branch: "main" }),
      "/git/trees/main?recursive=1": json({ truncated: false, tree: huge }),
    })
    const tree = await fetchPublicTree("big/mono", fetcher)
    expect(tree.entries).toHaveLength(MAX_ENTRIES)
    expect(tree.truncated).toBe(true)

    const cut = github({
      "/repos/big/cut": json({ default_branch: "main" }),
      "/git/trees/main?recursive=1": json({ truncated: true, tree: [{ path: "a", type: "blob", size: 1 }] }),
    })
    expect((await fetchPublicTree("big/cut", cut.fetcher)).truncated).toBe(true)
  })

  test("a used-up rate limit says so, with when it resets", async () => {
    const { fetcher } = github({
      "/repos/acme/tool": json(
        { message: "API rate limit exceeded" },
        { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1700000000" } },
      ),
    })
    const failure = fetchPublicTree("acme/tool", fetcher)
    await expect(failure).rejects.toBeInstanceOf(GitHubError)
    await expect(failure).rejects.toThrow(/rate limit.*2023-11-14T22:13:20/)
  })

  test("a missing or private repo is a clear 404", async () => {
    const { fetcher } = github({})
    await expect(fetchPublicTree("acme/ghost", fetcher)).rejects.toThrow(/no public repo "acme\/ghost"/)
  })

  test("only owner/name (or a GitHub URL) is accepted", () => {
    expect(parseRepo("github.com/a-b/c.d")).toBe("a-b/c.d")
    expect(parseRepo(" https://www.github.com/a/b/tree/main ")).toBe("a/b")
    expect(() => parseRepo("not a repo")).toThrow(/owner\/name/)
    expect(() => parseRepo("a/../../x")).toThrow()
  })
})
