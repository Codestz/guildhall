import type { AnchorHTMLAttributes, ButtonHTMLAttributes, MouseEvent, ReactNode } from "react"

/**
 * A destination: a real link when `href` is known (middle-click and copy-link work), and `onNavigate` for
 * a plain click, so the shell routes without a reload. With no href it is a button.
 */
export function Dest({
  href,
  onNavigate,
  children,
  ...rest
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "onClick"> & {
  onNavigate?: () => void
  children: ReactNode
}) {
  if (!href)
    return (
      <button type="button" onClick={onNavigate} {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}>
        {children}
      </button>
    )
  const click = (e: MouseEvent<HTMLAnchorElement>) => {
    if (
      !onNavigate ||
      e.defaultPrevented ||
      e.button !== 0 ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey
    )
      return
    e.preventDefault()
    onNavigate()
  }
  return (
    <a href={href} onClick={click} {...rest}>
      {children}
    </a>
  )
}

const svg = (children: ReactNode, size = 16) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {children}
  </svg>
)

export const ArrowIcon = ({ size = 14 }: { size?: number }) => svg(<path d="M3 8h9.5M8.5 4l4 4-4 4" />, size)
export const CloseGlyph = ({ size = 14 }: { size?: number }) => svg(<path d="m4 4 8 8M12 4l-8 8" />, size)
export const RepoGlyph = () =>
  svg(<path d="M8 2 13 4.8v6.4L8 14l-5-2.8V4.8zM8 8 3.2 5.2M8 8l4.8-2.8M8 8v5.8" />, 18)
export const FlagGlyph = () => svg(<path d="M4 14V2.5M4 3h8l-1.6 2.6L12 8.2H4" />, 18)
export const StudioGlyph = () =>
  svg(<path d="M2.5 13.5 9 7M9 7l1.6-3.6L14 2l-1.4 3.4L9 7zM2.5 13.5l1 1" />, 18)
export const BookGlyph = () =>
  svg(
    <path d="M3 3.2c1.8-.6 3.6-.4 5 .8v9c-1.4-1.2-3.2-1.4-5-.8zM13 3.2c-1.8-.6-3.6-.4-5 .8v9c1.4-1.2 3.2-1.4 5-.8z" />,
    18,
  )
/** A picture leaving its frame: what the HUD's Chronicle card shares. */
export const ShareGlyph = () =>
  svg(
    <path d="M8 10V2.5M5 5.2 8 2.3l3 2.9M5.5 7.5H4a1 1 0 0 0-1 1v4.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V8.5a1 1 0 0 0-1-1h-1.5" />,
    18,
  )
export const ArrowGlyph = () => svg(<path d="M3 8h9.5M8.5 4l4 4-4 4" />, 16)
export const CheckGlyph = () => svg(<path d="m3.5 8.4 3 3 6-6.4" />, 14)
export const AlertGlyph = () => svg(<path d="M8 2 14.2 13H1.8zM8 6.4v3M8 11.4v.1" />, 14)
export const AnchorGlyph = () =>
  svg(
    <path d="M8 2.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM8 5.5v8M5.5 8h5M3 9.5c0 2.2 2.2 4 5 4s5-1.8 5-4" />,
    18,
  )
