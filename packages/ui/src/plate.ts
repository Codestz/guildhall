/**
 * A plate: a label pinned to a point in a scene (a tile's name, a grip row), drawn by a vanilla screen
 * each frame. The look is `.ui-plate` (theme/components.ts): a display-face title, a mono line under it,
 * and a tone on the border and the line when the label carries a status.
 */
export interface PlateSpec {
  title: string
  /** The mono line under the title. */
  detail?: string
  tone?: "ok" | "warn" | "fail"
  /** `head`: a column or board heading, brass-edged. */
  kind?: "head"
  /** The CSS transform that hangs it off its point (default: centred above it). */
  anchor?: string
}

export function plate(spec: PlateSpec): HTMLDivElement {
  const el = document.createElement("div")
  el.className = "ui-plate"
  if (spec.tone) el.dataset.tone = spec.tone
  if (spec.kind) el.dataset.kind = spec.kind
  el.style.transform = spec.anchor ?? "translate(-50%, -100%)"
  el.style.left = "0"
  el.style.top = "0"
  const title = document.createElement("b")
  title.textContent = spec.title
  el.append(title)
  if (spec.detail) {
    const detail = document.createElement("small")
    detail.textContent = spec.detail
    el.append(detail)
  }
  el.title = spec.detail ? `${spec.title} · ${spec.detail}` : spec.title
  return el
}

/** Moves a plate to screen point `at` (CSS px in its layer), or hides it when the point is off screen. */
export function placePlate(el: HTMLElement, at: readonly [number, number] | null): void {
  if (!at) {
    el.style.display = "none"
    return
  }
  el.style.display = ""
  el.style.translate = `${at[0]}px ${at[1]}px`
}
