import { join } from "node:path"
import { type Chronicle, readChronicle } from "../src/index.ts"

/**
 * V1's bundled Repo Chronicles (main:packages/hall/public/chronicles, built 2026-10-09 by V1's deep
 * builder): Guildhall's first three days, react's thirteen years, opencode's nineteen months and
 * opencode-cockpit's three weeks.
 */
export type RepoName = "guildhall" | "react" | "opencode" | "cockpit"
export const REPOS: readonly RepoName[] = ["guildhall", "react", "opencode", "cockpit"]

export const REPO_DIR = join(import.meta.dir, "fixtures", "repo")

export async function chronicle(name: RepoName): Promise<Chronicle> {
  return readChronicle(new Uint8Array(await Bun.file(join(REPO_DIR, `${name}.json.gz`)).arrayBuffer()))
}
