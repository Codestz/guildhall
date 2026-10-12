/**
 * Paths a repo keeps to itself: never counted, sized, dated or named in its chronicle. Applied by
 * both builders before anything else (deep.ts, quick.ts), so no section can leak them. A rule ending
 * in "/" is a top-level folder; any other is one top-level file.
 */
const PRIVATE: Record<string, readonly string[]> = {
  "codestz/guildhall": ["docs/", ".agents/", ".claude/", "CONTEXT.md", "skills-lock.json"],
}

/** A test for `repo`'s private paths (always false for a repo without any). */
export function privateTo(repo: string): (path: string) => boolean {
  const rules = PRIVATE[repo.toLowerCase()]
  if (!rules) return () => false
  return (path) =>
    rules.some((rule) =>
      rule.endsWith("/") ? path === rule.slice(0, -1) || path.startsWith(rule) : path === rule,
    )
}

/** Whether `repo` has any private paths: its languages then come from its filtered tree, not GitHub. */
export const hasPrivatePaths = (repo: string): boolean => PRIVATE[repo.toLowerCase()] !== undefined
