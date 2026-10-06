import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { MODE, PROBE } from "./guild/mode.ts"
import { quality } from "./guild/quality.ts"
import { GuildStore, liveUrlOf } from "./guild/store.ts"
import { Hall } from "./Hall.tsx"
import "./hall.css"

const root = document.getElementById("root")
if (!root) throw new Error("#root missing from index.html")

const store = new GuildStore()
// Until the world has mounted (scene/Scene.tsx WorldReady): see GuildStore.hold.
store.hold()
// The showcase is a film: the Cinematic director by default. The app (your own agents) stays Calm.
if (MODE === "showcase") store.setDirector("cinematic")
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
