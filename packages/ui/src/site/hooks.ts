import { type RefObject, useEffect, useRef, useState } from "react"

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex]:not([tabindex="-1"])'

export const focusables = (root: HTMLElement): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  )

/**
 * A modal layer's keyboard contract: focus moves in on open (to `initial`, else the first control), Tab and
 * Shift+Tab wrap inside `ref`, Esc closes, and focus returns to what had it when the layer closes.
 */
export function useDialog(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  onClose: () => void,
  initial?: () => HTMLElement | null | undefined,
): void {
  const close = useRef(onClose)
  close.current = onClose
  const first = useRef(initial)
  first.current = initial
  useEffect(() => {
    const node = ref.current
    if (!open || !node) return
    const before = document.activeElement as HTMLElement | null
    const target = first.current?.() ?? focusables(node)[0] ?? node
    target.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        e.stopPropagation()
        close.current()
        return
      }
      if (e.key !== "Tab") return
      const list = focusables(node)
      const a = document.activeElement
      const head = list[0]
      const tail = list[list.length - 1]
      if (!head || !tail) return void e.preventDefault()
      if (e.shiftKey && (a === head || !node.contains(a))) {
        e.preventDefault()
        tail.focus()
      } else if (!e.shiftKey && (a === tail || !node.contains(a))) {
        e.preventDefault()
        head.focus()
      }
    }
    document.addEventListener("keydown", onKey, true)
    return () => {
      document.removeEventListener("keydown", onKey, true)
      if (before?.isConnected) before.focus({ preventScroll: true })
    }
  }, [open, ref])
}

export function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => typeof matchMedia === "function" && matchMedia(query).matches)
  useEffect(() => {
    const list = matchMedia(query)
    const change = () => setOn(list.matches)
    change()
    list.addEventListener("change", change)
    return () => list.removeEventListener("change", change)
  }, [query])
  return on
}
