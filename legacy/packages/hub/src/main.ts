import { startHub } from "./hub.ts"

/** `bun packages/hub/src/main.ts` — the hub as its own process (heralds start it if it's down). */
const server = startHub()
console.log(`guildhall hub on http://127.0.0.1:${server.port}`)
