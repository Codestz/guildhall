import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { MODE, PROBE } from "./guild/mode.ts"
import { quality } from "./guild/quality.ts"
import { GuildStore, liveUrlOf } from "./guild/store.ts"
import { Hall } from "./Hall.tsx"
import "./hall.css"

const root = document.getElementById("root")
if (!root) throw new Error("#root missing from index.html")

// The grip lab (lab/gripLab.ts): dev and probe builds only, `?grips`, instead of the hall.
const lab = PROBE && new URLSearchParams(location.search).has("grips")
if (lab) void import("./lab/gripLab.ts").then((module) => module.start(root))

const store = new GuildStore()
// The showcase tells the Saga (sim/saga.ts): five acts, every world event, the story's own hours.
if (MODE === "showcase") store.load("saga")
// Until the world has mounted (scene/Scene.tsx WorldReady): see GuildStore.hold.
store.hold()
// The safety release, here rather than only inside the <Canvas>: if WebGL fails the canvas never
// mounts, and the HUD must not stay frozen by the hold (review-2 #23). Idempotent.
setTimeout(() => store.release(), 20_000)
// `?live` follows the hub (real OpenCode sessions); `?live=ws://localhost:port/ws` picks another
// hub on this machine (`&anyhub=1` for one elsewhere).
const live = liveUrlOf(location.search)
if (live !== null) store.live(live)
if (PROBE) Object.assign(window, { guild: store, quality })

if (!lab)
  createRoot(root).render(
    <StrictMode>
      <Hall store={store} />
    </StrictMode>,
  )
