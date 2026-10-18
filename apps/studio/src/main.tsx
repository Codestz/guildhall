import { Analytics } from "@vercel/analytics/react"
import { SpeedInsights } from "@vercel/speed-insights/react"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App.tsx"
import { createDebug } from "./debug.ts"
import { isLocalHost, SHOWCASE } from "./env.ts"

const host = document.getElementById("root")
if (!host) throw new Error("studio: #root is missing from index.html")

// Vercel Web Analytics (cookieless page views, /_vercel/insights) and Speed Insights (real visitors' Web
// Vitals, /_vercel/speed-insights), both same-origin: the public showcase only, never dev or a local preview
// of the build, where their scripts are not served.
const analytics = SHOWCASE && !isLocalHost(location.hostname)

// Installed before the first render, so tools can await `guildhall.ready()` from page load.
const debug = createDebug()
window.guildhall = debug.api

createRoot(host).render(
  <StrictMode>
    <App debug={debug} />
    {analytics && <Analytics />}
    {analytics && <SpeedInsights />}
  </StrictMode>,
)
