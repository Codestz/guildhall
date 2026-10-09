import { type Change, declaredCraft } from "@guildhall/core"

/**
 * Stamps OpenCode's tool changes with their craft (PROTOCOL.md §1.2), so the wire says what a deed
 * means and not only what OpenCode calls it. OpenCode 2 names a call once, as its input starts, and
 * sends the input later without the name: the name is kept per call until the call ends. A shell
 * call is stamped only once its command is known, since the command decides between run, test and
 * lint. Changes are stamped in place and returned.
 */
export function createCrafter(): (changes: Change[]) => Change[] {
  const names = new Map<string, string>()
  return (changes) => {
    for (const change of changes) {
      if (change.type !== "tool") continue
      const key = `${change.id}\u0000${change.call}`
      if (change.name) names.set(key, change.name)
      const name = change.name ?? names.get(key)
      const craft = name ? declaredCraft(name, change.input) : undefined
      if (craft) change.craft = craft
      if (change.state === "completed" || change.state === "failed") names.delete(key)
    }
    return changes
  }
}
