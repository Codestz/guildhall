/**
 * The grip editor's side panel: prop search, body and clip with the t scrubber, then the mount's
 * fields (slot, handle, axis and edge pickers with fine rotation, upright, scale), the current clip's
 * override, the problems and Save. It draws the state it is handed and reports edits through
 * `actions`; the screen owns the state.
 */
import type { CatalogEntry, Mount, Vec3 } from "@guildhall/assets"
import {
  AXIS_NAMES,
  type AxisName,
  axisName,
  type ClipEdit,
  clipEdit,
  edgeChoices,
  SLOT_CHOICES,
  type SlotChoice,
  slotChoice,
} from "./state.ts"

export interface PanelState {
  piece: CatalogEntry | null
  props: readonly CatalogEntry[]
  /** The search lists only held and worn props. */
  holdable: boolean
  bodies: readonly CatalogEntry[]
  body: string
  clips: readonly string[]
  clip: string
  t: number
  mount: Mount
  /** validateMount's problems with the edited mount, and anything a save refused. */
  problems: readonly string[]
  /** The last save's outcome, or "" before one. */
  status: string
  saving: boolean
}

export interface PanelActions {
  search(text: string, holdable: boolean): void
  pickProp(id: string): void
  pickBody(id: string): void
  pickClip(clip: string): void
  scrub(t: number): void
  slot(choice: SlotChoice): void
  handle(handle: Vec3): void
  axis(name: AxisName): void
  edge(name: AxisName): void
  twist(deg: number): void
  tilt(deg: number): void
  upright(up: AxisName | null): void
  scale(k: number): void
  clip(edit: ClipEdit): void
  save(): void
}

export interface Panel {
  update(state: PanelState): void
  dispose(): void
}

/** Degrees per fine-rotation click and per roll-slider step. */
export const STEP_DEG = 5

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function chip(text: string, onclick: () => void): HTMLButtonElement {
  const b = el("button", "gh-grip-chip", text)
  b.type = "button"
  b.onclick = onclick
  return b
}

function section(title: string, ...children: Node[]): HTMLElement {
  const s = el("section", "gh-grip-sec")
  s.append(el("p", "gh-eyebrow", title), ...children)
  return s
}

function row(label: string, ...children: Node[]): HTMLElement {
  const r = el("div", "gh-grip-row")
  r.append(el("span", "gh-grip-label", label), ...children)
  return r
}

function numberInput(step: number, onchange: (v: number) => void): HTMLInputElement {
  const input = el("input", "gh-grip-num")
  input.type = "number"
  input.step = String(step)
  input.onchange = () => {
    const v = Number(input.value)
    if (Number.isFinite(v)) onchange(v)
  }
  return input
}

/** Sets an input's value unless the user is typing in it. */
function show(input: HTMLInputElement, value: string): void {
  if (document.activeElement !== input && input.value !== value) input.value = value
}

const fmtVec = (v: Vec3) => `[${v.map((x) => x.toFixed(3)).join(", ")}]`

export function createPanel(side: HTMLElement, actions: PanelActions): Panel {
  // ── head ───────────────────────────────────────────────────────
  const title = el("h1")
  const subtitle = el("p")
  const head = el("header", "gh-grip-head")
  head.append(el("p", "gh-eyebrow", "Grips · mount editor"), title, subtitle)

  // ── prop search ───────────────────────────────────────────────
  const search = el("input", "gh-grip-search")
  search.type = "search"
  search.placeholder = "search props, weapons, tools"
  let holdable = true
  const holdChip = chip("held · worn", () => actions.search(search.value, !holdable))
  search.oninput = () => actions.search(search.value, holdable)
  const results = el("div", "gh-grip-results")
  const searchBar = el("div", "gh-grip-bar")
  searchBar.append(search, holdChip)

  // ── body, clip, t ─────────────────────────────────────────────
  const body = el("select")
  body.onchange = () => actions.pickBody(body.value)
  const clip = el("select")
  clip.onchange = () => actions.pickClip(clip.value)
  const t = el("input", "gh-grip-range")
  t.type = "range"
  t.min = "0"
  t.max = "1"
  t.step = "0.01"
  t.oninput = () => actions.scrub(Number(t.value))
  const tValue = el("span", "num")

  // ── mount fields ──────────────────────────────────────────────
  const slots = new Map<SlotChoice, HTMLButtonElement>()
  const slotBar = el("div", "gh-grip-bar")
  for (const s of SLOT_CHOICES) {
    const b = chip(s, () => actions.slot(s))
    slots.set(s, b)
    slotBar.append(b)
  }

  const handle = [0, 1, 2].map(() => numberInput(1, () => actions.handle(readHandle())))
  const readHandle = (): Vec3 => handle.map((i) => Number(i.value) / 100) as Vec3

  const axisChips = new Map<AxisName, HTMLButtonElement>()
  const edgeChips = new Map<AxisName, HTMLButtonElement>()
  const axisBar = el("div", "gh-grip-bar")
  const edgeBar = el("div", "gh-grip-bar")
  for (const n of AXIS_NAMES) {
    const a = chip(n, () => actions.axis(n))
    const e = chip(n, () => actions.edge(n))
    axisChips.set(n, a)
    edgeChips.set(n, e)
    axisBar.append(a)
    edgeBar.append(e)
  }
  const axisValue = el("span", "gh-grip-vec num")
  const edgeValue = el("span", "gh-grip-vec num")
  const fine = el("div", "gh-grip-bar")
  fine.append(
    el("span", "gh-grip-label", "twist"),
    chip(`−${STEP_DEG}°`, () => actions.twist(-STEP_DEG)),
    chip(`+${STEP_DEG}°`, () => actions.twist(STEP_DEG)),
    el("span", "gh-grip-label", "tilt"),
    chip(`−${STEP_DEG}°`, () => actions.tilt(-STEP_DEG)),
    chip(`+${STEP_DEG}°`, () => actions.tilt(STEP_DEG)),
  )

  const uprightBox = el("input")
  uprightBox.type = "checkbox"
  const upChips = new Map<AxisName, HTMLButtonElement>()
  const upBar = el("div", "gh-grip-bar")
  const uprightLabel = el("label", "gh-grip-check")
  uprightLabel.append(uprightBox, document.createTextNode("upright"))
  upBar.append(uprightLabel)
  let currentUp: AxisName = "+y"
  uprightBox.onchange = () => actions.upright(uprightBox.checked ? currentUp : null)
  for (const n of AXIS_NAMES) {
    const b = chip(n, () => actions.upright(n))
    upChips.set(n, b)
    upBar.append(b)
  }
  const scale = numberInput(0.05, (v) => actions.scale(v))

  // ── the current clip's override ───────────────────────────────
  const clipTitle = el("p", "gh-eyebrow")
  const roll = el("input", "gh-grip-range")
  roll.type = "range"
  roll.min = "-180"
  roll.max = "180"
  roll.step = String(STEP_DEG)
  const rollValue = el("span", "num")
  const offset = [0, 1, 2].map(() => numberInput(1, () => actions.clip(readClip())))
  const hide = el("input")
  hide.type = "checkbox"
  const hideLabel = el("label", "gh-grip-check")
  hideLabel.append(hide, document.createTextNode("hide in this clip"))
  const readClip = (): ClipEdit => ({
    rollDeg: Number(roll.value),
    offset: offset.map((i) => Number(i.value) / 100) as Vec3,
    hide: hide.checked,
  })
  roll.oninput = () => actions.clip(readClip())
  hide.onchange = () => actions.clip(readClip())
  const clipSec = el("section", "gh-grip-sec")
  clipSec.append(clipTitle, row("roll", roll, rollValue), row("offset cm", ...offset), row("", hideLabel))

  // ── problems, save ────────────────────────────────────────────
  const problems = el("ul", "gh-grip-problems")
  const save = el("button", "gh-grip-save", "Save to data/mounts.json")
  save.type = "button"
  save.onclick = () => actions.save()
  const status = el("p", "gh-grip-status")
  const hint = el("p", "gh-grip-hint")
  hint.append(
    document.createTextNode("Save merges this prop into data/mounts.json; then run "),
    el("code", "", "bun import overlay"),
    document.createTextNode(" to apply the overlay to the catalog."),
  )

  const scroll = el("div", "gh-grip-scroll")
  scroll.append(
    section("Prop", searchBar, results),
    section("Character", row("body", body), row("clip", clip), row("t", t, tValue)),
    section("Slot", slotBar),
    section("Handle · drag the gold marker", row("cm", ...handle)),
    section(
      "Handle axis → working end",
      axisBar,
      axisValue,
      el("p", "gh-eyebrow", "Strike edge"),
      edgeBar,
      edgeValue,
      fine,
    ),
    section("Upright", upBar),
    section("Scale", row("×", scale)),
    clipSec,
  )
  const foot = el("footer", "gh-grip-foot")
  foot.append(problems, save, status, hint)
  side.append(head, scroll, foot)

  const options = (
    select: HTMLSelectElement,
    items: readonly { value: string; text: string }[],
    value: string,
  ) => {
    const key = items.map((i) => i.value).join("\n")
    if (select.dataset.key !== key) {
      select.dataset.key = key
      select.replaceChildren(
        ...items.map((i) => {
          const o = el("option", "", i.text)
          o.value = i.value
          return o
        }),
      )
    }
    select.value = value
  }

  let listed = ""
  return {
    update(s) {
      title.textContent = s.piece?.name ?? "no prop"
      subtitle.textContent = s.piece
        ? `${s.piece.id} · ${s.piece.compose.attach} · ${s.piece.size.join(" × ")} m`
        : ""
      holdable = s.holdable
      holdChip.setAttribute("aria-pressed", String(holdable))

      const key = s.props.map((p) => p.id).join("\n")
      if (key !== listed) {
        listed = key
        results.replaceChildren(
          ...s.props.map((p) => {
            const b = el("button", "gh-grip-result")
            b.type = "button"
            b.dataset.id = p.id
            b.append(el("span", "", p.name), el("small", "", `${p.pack} · ${p.compose.attach}`))
            b.onclick = () => actions.pickProp(p.id)
            return b
          }),
        )
      }
      for (const b of results.children) {
        const node = b as HTMLElement
        node.setAttribute("aria-pressed", String(node.dataset.id === s.piece?.id))
      }

      options(
        body,
        s.bodies.map((b) => ({ value: b.id, text: b.name })),
        s.body,
      )
      options(
        clip,
        s.clips.map((c) => ({ value: c, text: c })),
        s.clip,
      )
      show(t, String(s.t))
      tValue.textContent = s.t.toFixed(2)

      const m = s.mount
      for (const [c, b] of slots) b.setAttribute("aria-pressed", String(c === slotChoice(m)))
      for (const [i, input] of handle.entries()) show(input, String(Math.round((m.handle[i] ?? 0) * 100)))
      const a = axisName(m.axis)
      const e = axisName(m.edge)
      const perpendicular = edgeChoices(m.axis, m.edge)
      for (const [n, b] of axisChips) b.setAttribute("aria-pressed", String(n === a))
      for (const [n, b] of edgeChips) {
        b.setAttribute("aria-pressed", String(n === e))
        b.disabled = a !== null && !perpendicular.includes(n)
      }
      axisValue.textContent = `axis ${fmtVec(m.axis)}${a ? "" : " (fine-rotated)"}`
      edgeValue.textContent = `edge ${fmtVec(m.edge)}${e ? "" : " (fine-rotated)"}`
      const up = m.upright ? axisName(m.upright.up) : null
      if (up) currentUp = up
      uprightBox.checked = m.upright !== undefined
      for (const [n, b] of upChips) {
        b.setAttribute("aria-pressed", String(n === up))
        b.disabled = !m.upright
      }
      show(scale, String(m.scale ?? 1))

      const c = clipEdit(m, s.clip)
      clipTitle.textContent = `This clip only · ${s.clip}`
      show(roll, String(c.rollDeg))
      rollValue.textContent = `${c.rollDeg}°`
      for (const [i, input] of offset.entries()) show(input, String(Math.round((c.offset[i] ?? 0) * 100)))
      hide.checked = c.hide

      problems.replaceChildren(...s.problems.map((p) => el("li", "", p)))
      problems.hidden = s.problems.length === 0
      save.disabled = s.saving || s.piece === null
      status.textContent = s.status
    },
    dispose() {
      side.replaceChildren()
    },
  }
}
