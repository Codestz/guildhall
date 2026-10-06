import { fileURLToPath } from "node:url"
import { startHub } from "@guildhall/hub"

/**
 * The hub as the package runs it (a herald starts it on first use): its API, plus the hall built
 * beside it in `dist/hall`, at http://127.0.0.1:4747/ (GUILDHALL_PORT picks another port).
 */
const server = startHub({ hall: fileURLToPath(new URL("./hall", import.meta.url)) })
console.log(`guildhall hub on http://127.0.0.1:${server.port}`)
