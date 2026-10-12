import { fileURLToPath } from "node:url"
import herald from "@guildhall/herald"
import { setHubEntry } from "@guildhall/herald/courier"

/**
 * The plugin OpenCode loads (`{ "plugin": ["opencode-guildhall"] }`, ADR 0002): the herald, with the
 * hub it starts pointed at the bundle beside this one. One default export `{ id, server, setup }`,
 * the shape both OpenCode 1 and 2 load (docs/opencode/v2.md).
 */
setHubEntry(fileURLToPath(new URL("./hub.js", import.meta.url)))

export default herald
