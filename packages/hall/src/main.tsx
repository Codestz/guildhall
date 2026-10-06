import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { quality } from "./guild/quality.ts"
import { GuildStore } from "./guild/store.ts"
import { Hall } from "./Hall.tsx"
import "./hall.css"

const root = document.getElementById("root")
if (!root) throw new Error("#root missing from index.html")

const store = new GuildStore()
if (import.meta.env.DEV) Object.assign(window, { guild: store, quality })

createRoot(root).render(
  <StrictMode>
    <Hall store={store} />
  </StrictMode>,
)
