/**
 * OpenCode's wildcard match for permission patterns, the same on 1.18.32 (`Wildcard.match`) and
 * 2.0.18 (`H0`): `*` is `.*` with the dotall flag, so it crosses spaces, slashes and `>`; `?` is
 * any one character; only a trailing `" *"` is optional. Backslashes are read as `/`.
 *
 * Shared by the shell guard (src/guard.ts), which checks redirect targets against the same
 * protected-path patterns OpenCode checks edits against, and by the tests' port of OpenCode's
 * permission resolution.
 */
export function match(value: string, pattern: string): boolean {
  const text = value.replaceAll("\\", "/")
  let source = pattern
    .replaceAll("\\", "/")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")
  if (source.endsWith(" .*")) source = `${source.slice(0, -3)}( .*)?`
  return new RegExp(`^${source}$`, "s").test(text)
}
