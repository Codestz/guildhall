import { fileURLToPath } from "node:url"
import { main, setHubEntry } from "@guildhall/claude-code"

/**
 * The Claude Code hook as the package runs it (`opencode-guildhall claude-code --print` points
 * Claude Code at it): Node or Bun, one process per hook event. A hub it finds down is started from
 * the bundle beside this one, with Bun from PATH.
 */
setHubEntry(fileURLToPath(new URL("./hub.js", import.meta.url)))
await main()
