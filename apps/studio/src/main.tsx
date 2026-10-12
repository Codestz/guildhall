import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

const host = document.getElementById("root")
if (!host) throw new Error("studio: #root is missing from index.html")

createRoot(host).render(
  <StrictMode>
    <h1>Guildhall Studio</h1>
  </StrictMode>,
)
