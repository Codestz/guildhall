import type { Resolved, Stats } from "../world/prefabs/index.ts"

/**
 * The prefab lab's inspector (dev and probe only): a side panel for the prefab picked in
 * `?lab=prefabs`, in the hall's own ink-and-brass (hall.css: --ink, --brass, --display) and kept to
 * what fits a glance: its id and footprint, parts, doors and fixtures, size, triangles, draw calls and
 * bytes, and, where the prefab varies by seed, a stepper through its variants.
 */

export interface InspectorView {
  stats: Stats
  /** Its place in the catalogue, 1-based, and how many there are. */
  at: number
  of: number
  /** The seed shown; `variant` is undefined for a prefab that does not vary. */
  seed: number
  variant?: Resolved
  /** How many props the seed let in on top of the prefab's own parts. */
  props: number
  isolated: boolean
}

export interface InspectorActions {
  prev(): void
  next(): void
  /** Steps the seed by ±1 (never below 0, the plain prefab). */
  vary(delta: number): void
  isolate(): void
  close(): void
}

const STYLE = `
.pfi{position:fixed;top:16px;right:16px;bottom:16px;width:312px;display:flex;flex-direction:column;z-index:50;
  color:var(--paper,#f3e9d4);font:14px/1.4 var(--body,sans-serif);background:var(--ink,rgba(20,15,11,.86));
  border:1px solid var(--hair-2,rgba(243,233,212,.16));border-radius:var(--r,7px);
  box-shadow:var(--shadow,0 18px 40px -18px #000b);backdrop-filter:blur(10px);overflow:hidden}
.pfi[hidden]{display:none}
.pfi-head{display:flex;align-items:flex-start;gap:8px;padding:14px 12px 10px 16px}
.pfi-id{flex:1;min-width:0}
.pfi-eyebrow{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--faint,#ab9e85)}
.pfi h2{margin:0;font:400 22px/1.15 var(--display,serif);letter-spacing:.04em;color:var(--brass-hi,#f1d590)}
.pfi-code{font:12px var(--mono,monospace);color:var(--muted,#cdbfa3)}
.pfi button{all:unset;cursor:pointer;display:grid;place-items:center;min-width:26px;height:26px;padding:0 6px;box-sizing:border-box;
  border-radius:var(--r-sm,5px);color:var(--muted,#cdbfa3);font:13px var(--body,sans-serif)}
.pfi button:hover{background:var(--raise-2,rgba(255,238,205,.09));color:var(--paper,#f3e9d4)}
.pfi button:focus-visible{outline:1px solid var(--brass,#dcb662)}
.pfi button[aria-pressed=true]{color:var(--brass-hi,#f1d590);background:var(--brass-wash,rgba(220,182,98,.16))}
.pfi-nav{display:flex;gap:2px;align-items:center}
.pfi-body{flex:1;min-height:0;overflow-y:auto;border-top:1px solid var(--hair,rgba(243,233,212,.1));padding:6px 16px 12px;
  scrollbar-width:thin;scrollbar-color:var(--hair-2,#fff3) transparent}
.pfi dl{margin:6px 0 0;display:grid;grid-template-columns:auto 1fr;gap:3px 12px}
.pfi dt{color:var(--faint,#ab9e85)}
.pfi dd{margin:0;text-align:right;font:13px var(--mono,monospace);font-variant-numeric:tabular-nums}
.pfi h3{margin:14px 0 4px;font:400 13px var(--display,serif);letter-spacing:.1em;color:var(--brass,#dcb662)}
.pfi ul{list-style:none;margin:0;padding:0}
.pfi li{display:flex;justify-content:space-between;gap:8px;padding:2px 0;border-bottom:1px solid var(--hair,#fff1);font:12.5px var(--mono,monospace)}
.pfi li b{font-weight:400;color:var(--brass-hi,#f1d590)}
.pfi-step{display:flex;align-items:center;gap:6px;margin-top:2px}
.pfi-step span{flex:1;text-align:center;font:13px var(--mono,monospace)}
.pfi-note{margin:4px 0 0;color:var(--muted,#cdbfa3);font-size:13px}
.pfi-keys{padding:8px 16px;border-top:1px solid var(--hair,#fff1);color:var(--faint,#ab9e85);font-size:12px}
.pfi-hint{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:50;padding:5px 12px;
  color:var(--muted,#cdbfa3);font:12.5px var(--body,sans-serif);background:var(--ink,rgba(20,15,11,.86));
  border:1px solid var(--hair,#fff1);border-radius:var(--r,7px);pointer-events:none}
.pfi-label{position:absolute;transform:translate(-50%,0);padding:1px 6px;border-radius:3px;pointer-events:none;white-space:nowrap;
  font:12px var(--mono,monospace);color:#1d1813;background:#fff8}
.pfi-label[data-on]{color:var(--paper,#f3e9d4);background:var(--ink-solid,#15110d);outline:1px solid var(--brass,#dcb662)}
`

const kb = (bytes: number): string => `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`
const count = (n: number): string => n.toLocaleString("en-US")

/** One variant in words: "red roof · mirrored · 2 props". */
function describe(variant: Resolved, props: number): string {
  const parts = [`${variant.kit} roof`]
  if (variant.mirrored) parts.push("mirrored")
  parts.push(...variant.swapped)
  if (props > 0) parts.push(`${props} extra prop${props > 1 ? "s" : ""}`)
  return parts.join(" · ")
}

export interface Inspector {
  /** A prefab's name tag above its hex (the lab's own labels share the panel's look). */
  label(text: string): HTMLDivElement
  show(view: InspectorView): void
  hide(): void
}

export function createInspector(root: HTMLElement, actions: InspectorActions): Inspector {
  const style = document.createElement("style")
  style.textContent = STYLE
  const panel = document.createElement("aside")
  panel.className = "pfi"
  panel.hidden = true
  panel.setAttribute("aria-label", "Prefab inspector")
  const hint = document.createElement("div")
  hint.className = "pfi-hint"
  hint.textContent = "click a prefab · ← → browse · ↑ ↓ variants · enter isolates"
  root.append(style, panel, hint)

  const button = (text: string, title: string, run: () => void): HTMLButtonElement => {
    const el = document.createElement("button")
    el.type = "button"
    el.textContent = text
    el.title = title
    el.setAttribute("aria-label", title)
    el.addEventListener("click", run)
    return el
  }
  const row = (term: string, value: string): string => `<dt>${term}</dt><dd>${value}</dd>`
  const list = (items: { piece: string; count: number }[]): string =>
    `<ul>${items.map((i) => `<li><span>${i.piece}</span><b>×${i.count}</b></li>`).join("")}</ul>`

  return {
    label(text) {
      const el = document.createElement("div")
      el.className = "pfi-label"
      el.textContent = text
      root.append(el)
      return el
    },
    hide() {
      panel.hidden = true
      hint.hidden = false
    },
    show({ stats, at, of, seed, variant, props, isolated }) {
      hint.hidden = true
      panel.hidden = false
      const head = document.createElement("div")
      head.className = "pfi-head"
      head.innerHTML = `<div class="pfi-id"><div class="pfi-eyebrow">${stats.kind} · ${at} of ${of}</div>
        <h2>${stats.label}</h2><div class="pfi-code">${stats.id}</div></div>`
      const nav = document.createElement("div")
      nav.className = "pfi-nav"
      const pin = button("▣", "Isolate (enter)", actions.isolate)
      pin.setAttribute("aria-pressed", String(isolated))
      nav.append(
        button("←", "Previous prefab (left arrow)", actions.prev),
        button("→", "Next prefab (right arrow)", actions.next),
        pin,
        button("✕", "Close (escape)", actions.close),
      )
      head.append(nav)

      const body = document.createElement("div")
      body.className = "pfi-body"
      const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`
      body.innerHTML = `<dl>
        ${row("Footprint", `${plural(stats.rings, "ring")} · ${plural(stats.hexes, "hex")}`)}
        ${stats.houses ? row("Homes", String(stats.houses)) : ""}
        ${row("Size", `${stats.size.join(" × ")}`)}
        ${row("Reach", `${stats.reach} from anchor`)}
        ${row("Doors", String(stats.doors))}${row("Windows", String(stats.windows))}${row("Chimneys", String(stats.chimneys))}
        ${row("Triangles", count(stats.tris))}
        ${row("Draw calls", `${stats.draws.loose} loose · ${stats.draws.batched} batched`)}
        ${row("Geometry", `${kb(stats.bytes)} in memory`)}
      </dl>
      <h3>VARIANTS</h3>
      <div class="pfi-variants"></div>
      <h3>PARTS · ${stats.parts.reduce((sum, p) => sum + p.count, 0)}</h3>${list(stats.parts)}
      ${stats.unknown ? `<p class="pfi-note">${stats.unknown} piece(s) not in the pack</p>` : ""}`
      const variants = body.querySelector(".pfi-variants")
      if (variants) {
        if (!variant) variants.innerHTML = `<p class="pfi-note">This prefab does not vary.</p>`
        else {
          const step = document.createElement("div")
          step.className = "pfi-step"
          const label = document.createElement("span")
          label.textContent = seed === 0 ? "plain" : `seed ${seed}`
          step.append(
            button("‹", "Previous variant (down arrow)", () => actions.vary(-1)),
            label,
            button("›", "Next variant (up arrow)", () => actions.vary(1)),
          )
          const note = document.createElement("p")
          note.className = "pfi-note"
          note.textContent = seed === 0 ? "as the catalogue draws it" : describe(variant, props)
          variants.append(step, note)
        }
      }
      const keys = document.createElement("div")
      keys.className = "pfi-keys"
      keys.textContent = "← → prefab · ↑ ↓ variant · enter isolate · esc close"
      panel.replaceChildren(head, body, keys)
    },
  }
}
