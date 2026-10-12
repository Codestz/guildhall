import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App.tsx"
import { createDebug } from "./debug.ts"

const host = document.getElementById("root")
if (!host) throw new Error("studio: #root is missing from index.html")

// Installed before the first render, so tools can await `guildhall.ready()` from page load.
const debug = createDebug()
window.guildhall = debug.api

createRoot(host).render(
  <StrictMode>
    <App debug={debug} />
  </StrictMode>,
)
