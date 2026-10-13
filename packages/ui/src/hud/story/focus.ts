/**
 * Modal focus (V1's hud/focus.ts): Tab stays inside a dialog, and focus goes back where it came from
 * when the dialog closes. Pure DOM, no React state.
 */
import { useEffect, useRef } from "react"

export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** The elements Tab reaches inside `root`, in order: visible ones, one radio per group. */
export function tabStops(root: HTMLElement): HTMLElement[] {
  const groups = new Map<string, HTMLInputElement[]>()
  const all = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.getClientRects().length > 0 && !el.closest("[hidden], [inert]"),
  )
  for (const el of all)
    if (el instanceof HTMLInputElement && el.type === "radio" && el.name) {
      const group = groups.get(el.name) ?? []
      group.push(el)
      groups.set(el.name, group)
    }
  return all.filter((el) => {
    if (!(el instanceof HTMLInputElement) || el.type !== "radio" || !el.name) return true
    const group = groups.get(el.name) ?? []
    return (group.find((r) => r.checked) ?? group[0]) === el
  })
}

/**
 * Keep Tab inside `root`: from the last stop to the first and back. A focus outside every stop (the
 * heading, focused on open) goes to the first or, with Shift, the last.
 */
export function trapTab(
  event: { key: string; shiftKey: boolean; preventDefault(): void },
  root: HTMLElement,
) {
  if (event.key !== "Tab") return
  const stops = tabStops(root)
  if (stops.length === 0) {
    event.preventDefault()
    return
  }
  const first = stops[0] as HTMLElement
  const last = stops.at(-1) as HTMLElement
  const at = document.activeElement
  const inside = at instanceof HTMLElement && stops.includes(at)
  if (!inside) {
    event.preventDefault()
    ;(event.shiftKey ? last : first).focus()
  } else if (event.shiftKey && at === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && at === last) {
    event.preventDefault()
    first.focus()
  }
}

/**
 * While mounted: focus `target` on open, and give focus back to whatever had it when the component
 * closes (the button that opened it), if that is still on the page.
 */
export function useModalFocus(target: { current: HTMLElement | null }) {
  const opener = useRef<Element | null>(null)
  useEffect(() => {
    opener.current = document.activeElement
    target.current?.focus({ preventScroll: true })
    return () => {
      const back = opener.current
      if (back instanceof HTMLElement && back.isConnected) requestAnimationFrame(() => back.focus())
    }
  }, [target])
}
