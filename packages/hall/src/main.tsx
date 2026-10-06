import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { PROBE } from "./guild/mode.ts"
import { quality } from "./guild/quality.ts"
import { GuildStore, liveUrlOf } from "./guild/store.ts"
import { Hall } from "./Hall.tsx"
import "./hall.css"

const root = document.getElementById("root")
if (!root) throw new Error("#root missing from index.html")

const store = new GuildStore()
// `?live` follows the hub (real OpenCode sessions); `?live=ws://localhost:port/ws` picks another
// hub on this machine (`&anyhub=1` for one elsewhere).
const live = liveUrlOf(location.search)
if (live !== null) store.live(live)
if (PROBE) Object.assign(window, { guild: store, quality })

createRoot(root).render(
  <StrictMode>
    <Hall store={store} />
  </StrictMode>,
)
