/**
 * The palette screen's DOM: the ramp list (name, group, three swatches with their hexes), the swatch
 * picker (colour input + hex field) and the Export dialog. It draws the state it is handed and reports
 * clicks and edits through `actions`; the screen owns the state.
 */
import type { Palette, Ramp } from "@guildhall/assets"
import { normalizeHex } from "./colour.ts"

export interface PanelState {
  /** The edited palette, one hex per swatch id. */
  hexes: readonly string[]
  biome: string
  selected: number | null
}

export interface PanelActions {
  setHex(id: number, hex: string): void
  select(id: number | null): void
  setBiome(biome: string): void
  /** The palette.json text for the Export dialog. */
  exportText(): string
}

export interface Panel {
  update(state: PanelState): void
  showExport(open: boolean): void
  dispose(): void
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** Builds the side panel into `side` and the picker and Export dialog over `view`. */
export function createPanel(
  palette: Palette,
  side: HTMLElement,
  view: HTMLElement,
  actions: PanelActions,
): Panel {
  const shipped = palette.swatches.map((s) => s.hex)

  // ── head: title, counts, biome chips, export ─────────────────────
  const head = el("header", "gh-pal-head")
  const summary = el("p")
  const bar = el("div", "gh-pal-bar")
  const chips = new Map<string, HTMLButtonElement>()
  for (const biome of Object.keys(palette.biomes)) {
    const chip = el("button", "gh-pal-chip", biome)
    chip.type = "button"
    chip.onclick = () => actions.setBiome(biome)
    chips.set(biome, chip)
    bar.append(chip)
  }
  const exportButton = el("button", "gh-pal-btn", "Export palette.json")
  exportButton.type = "button"
  exportButton.onclick = () => showExport(true)
  bar.append(exportButton)
  head.append(
    el("p", "gh-eyebrow", `Palette · ${palette.status}`),
    el("h1", "", "Shared palette"),
    summary,
    bar,
  )

  // ── the ramps, by group ─────────────────────────────────────────
  const list = el("div", "gh-pal-list")
  const swatchButtons: HTMLButtonElement[] = []
  const swapNotes = new Map<string, HTMLElement>()
  const rampRow = (ramp: Ramp): HTMLElement => {
    const row = el("div", "gh-pal-ramp")
    const name = el("div", "gh-pal-name", ramp.name)
    const note = el("small", "", ramp.group)
    swapNotes.set(ramp.name, note)
    name.append(note)
    row.append(name)
    for (const tone of ["dark", "base", "light"] as const) {
      const id = ramp.tones[tone]
      const swatch = palette.swatches[id]
      const button = el("button", "gh-pal-sw")
      button.type = "button"
      button.title = `${id} · ${swatch?.name ?? "?"} (${tone})`
      button.append(el("i"), el("span"))
      button.onclick = () => actions.select(id)
      swatchButtons[id] = button
      row.append(button)
    }
    return row
  }
  for (const group of palette.groups) {
    const ramps = palette.ramps.filter((r) => r.group === group)
    if (ramps.length === 0) continue
    list.append(el("p", "gh-eyebrow gh-pal-group", group), ...ramps.map(rampRow))
  }
  side.append(head, list)

  // ── picker ──────────────────────────────────────────────────────
  const picker = el("section", "gh gh-panel gh-pal-picker")
  const pickTitle = el("h2")
  const colour = el("input")
  colour.type = "color"
  const hex = el("input")
  hex.type = "text"
  hex.spellcheck = false
  hex.setAttribute("aria-label", "hex")
  const was = el("p")
  const reset = el("button", "gh-pal-chip", "reset to file")
  reset.type = "button"
  const close = el("button", "gh-pal-chip", "close")
  close.type = "button"
  const fields = el("div")
  fields.append(hex, was, reset, document.createTextNode(" "), close)
  const pick = el("div", "gh-pal-pick")
  pick.append(colour, fields)
  picker.append(el("p", "gh-eyebrow", "Swatch"), pickTitle, pick)
  view.append(picker)

  let selected: number | null = null
  colour.oninput = () => selected !== null && actions.setHex(selected, colour.value)
  hex.oninput = () => {
    const value = normalizeHex(hex.value)
    hex.setAttribute("aria-invalid", value ? "false" : "true")
    if (value && selected !== null) actions.setHex(selected, value)
  }
  reset.onclick = () => selected !== null && actions.setHex(selected, shipped[selected] ?? "#000000")
  close.onclick = () => actions.select(null)

  // ── export dialog ───────────────────────────────────────────────
  const dialog = el("section", "gh gh-panel gh-pal-export")
  const text = el("textarea")
  text.readOnly = true
  text.spellcheck = false
  const copy = el("button", "gh-pal-btn", "Copy")
  copy.type = "button"
  copy.onclick = async () => {
    text.select()
    try {
      await navigator.clipboard.writeText(text.value)
      copy.textContent = "Copied"
    } catch {
      copy.textContent = "Select all and copy"
    }
  }
  const done = el("button", "gh-pal-chip", "close")
  done.type = "button"
  done.onclick = () => showExport(false)
  const dialogHead = el("header")
  dialogHead.append(el("h2", "", "palette.json"), copy, done)
  dialog.append(
    dialogHead,
    el(
      "p",
      "",
      "The page cannot write files: paste this over packages/assets/src/palette.json, run bun run lint:fix, then bun import to re-bake.",
    ),
    text,
  )
  view.append(dialog)

  function showExport(open: boolean): void {
    dialog.hidden = !open
    if (!open) return
    text.value = actions.exportText()
    copy.textContent = "Copy"
  }
  showExport(false)

  return {
    update(state) {
      selected = state.selected
      const edited = state.hexes.filter((h, id) => h !== shipped[id]).length
      summary.innerHTML = ""
      summary.append(
        el("span", "num", String(palette.ramps.length)),
        document.createTextNode(" ramps · "),
        el("span", "num", String(palette.swatches.length)),
        document.createTextNode(" swatches · "),
        el("span", "num", String(edited)),
        document.createTextNode(" edited"),
      )
      for (const [biome, chip] of chips) chip.setAttribute("aria-pressed", String(biome === state.biome))
      const swaps = palette.biomes[state.biome] ?? {}
      for (const [ramp, note] of swapNotes) {
        const ramps = palette.ramps.find((r) => r.name === ramp)
        const to = swaps[ramp]
        note.textContent = to ? `${ramps?.group} · ${state.biome}: → ${to}` : (ramps?.group ?? "")
        if (to) note.dataset.swap = "true"
        else delete note.dataset.swap
      }
      for (const [id, button] of swatchButtons.entries()) {
        if (!button) continue
        const value = state.hexes[id] ?? "#000000"
        ;(button.firstChild as HTMLElement).style.background = value
        ;(button.lastChild as HTMLElement).textContent = value
        button.dataset.edited = String(value !== shipped[id])
        button.setAttribute("aria-pressed", String(id === state.selected))
      }
      picker.hidden = state.selected === null
      if (state.selected === null) return
      const swatch = palette.swatches[state.selected]
      const value = state.hexes[state.selected] ?? "#000000"
      pickTitle.textContent = swatch?.name ?? "?"
      pickTitle.append(
        el("small", "", `#${state.selected} · ${swatch?.ramp} ${swatch?.tone} · ${swatch?.group}`),
      )
      if (colour.value !== value) colour.value = value
      if (normalizeHex(hex.value) !== value) hex.value = value
      hex.setAttribute("aria-invalid", "false")
      was.textContent = `in the file: ${shipped[state.selected]}`
    },
    showExport,
    dispose() {
      side.innerHTML = ""
      picker.remove()
      dialog.remove()
    },
  }
}
