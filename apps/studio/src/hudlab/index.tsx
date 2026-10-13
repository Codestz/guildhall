import { type HudMode, holdHudStyle, holdUiStyle } from "@guildhall/ui"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import type { Screen } from "../screens.ts"
import { replaceQuery } from "../shell/router.ts"
import { type LabState, STATES } from "./fixtures.ts"
import { HudLab } from "./HudLab.tsx"
import { LAB_CSS } from "./style.ts"

const pickOf = (q: URLSearchParams): string | boolean => {
  const v = q.get("pick")
  return v === null || v === "0" ? false : v === "1" ? true : v
}

/**
 * The HUD lab (`/lab/hud`): every HUD panel (@guildhall/ui hud) in V1's layout, fed by fixtures from V1's
 * `party` story. Query: `state` empty | busy | plea | error | crowd, `hud` detailed | minimal | hidden,
 * `pick=1` (or a hero id) opens a dossier, `settings=1`, `scale` history | session, `by=family`,
 * `still=1` holds the toasts for shots, `sheet` roster | chronicle opens one as a phone sheet, `dev=1` puts the fixture switch in Settings.
 */
export const hudLab: Screen = {
  id: "hudlab",
  title: "HUD lab",
  mount(host, ctx) {
    const q = ctx.query
    const ui = holdUiStyle()
    const releaseHud = holdHudStyle()
    const lab = document.createElement("style")
    lab.dataset.gh = "hudlab"
    lab.textContent = LAB_CSS
    document.head.append(lab)

    const node = document.createElement("div")
    node.className = "gh lab-hud-root"
    host.append(node)
    const root = createRoot(node)
    const state = STATES.includes(q.get("state") as LabState) ? (q.get("state") as LabState) : "busy"
    const hud = (["detailed", "minimal", "hidden"] as const).find((m) => m === q.get("hud")) ?? "detailed"
    const onState = (s: LabState) => {
      const next = new URLSearchParams(ctx.query)
      next.set("state", s)
      replaceQuery(next)
    }
    const render = () =>
      root.render(
        <HudLab
          state={state}
          hud={hud as HudMode}
          pick={pickOf(q)}
          settings={q.get("settings") === "1"}
          dev={q.get("dev") === "1"}
          scale={q.get("scale") === "history" ? "history" : "session"}
          by={q.get("by") === "family" ? "family" : "party"}
          still={q.get("still") === "1"}
          sheet={q.get("sheet") === "roster" ? "roster" : q.get("sheet") === "chronicle" ? "chronicle" : null}
          onState={onState}
        />,
      )
    // the faces first, so shots never catch the fallback
    ctx.load(ui.ready.then(() => flushSync(render))).catch(() => undefined)

    return () => {
      node.style.display = "none"
      // The shell tears screens down from its own React commit; a nested root unmounts after it.
      setTimeout(() => {
        root.unmount()
        node.remove()
        lab.remove()
        releaseHud()
        ui.release()
      }, 0)
    }
  },
}
