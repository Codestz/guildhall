/**
 * Variant B, the heraldic shield: an escutcheon whose tincture is the role's banner, parted by a division
 * seeded from the session id, with a charge per body family. Pure SVG in a 60×70 box: no GPU, prints on
 * the Chronicle card.
 */
import type { ReactNode } from "react"
import { type Charge, type Division, type ShieldArms, shade } from "./model.ts"

export const SHIELD_PATH = "M5 5 H55 V34 Q55 58 30 67 Q5 58 5 34 Z"
const ARGENT = "#f3e9d4"

function division(d: Division, colour: string): ReactNode {
  switch (d) {
    case "pale":
      return <rect x="30" y="0" width="30" height="70" fill={colour} />
    case "fess":
      return <rect x="0" y="34" width="60" height="36" fill={colour} />
    case "bend":
      return <path d="M0 0 H20 L60 50 V70 H40 L0 20 Z" fill={colour} />
    case "chevron":
      return <path d="M0 50 L30 24 L60 50 V70 H0 Z" fill={colour} />
    case "quarterly":
      return (
        <>
          <rect x="30" y="0" width="30" height="34" fill={colour} />
          <rect x="0" y="34" width="30" height="36" fill={colour} />
        </>
      )
    case "saltire":
      return <path d="M0 0 L60 70 M60 0 L0 70" stroke={colour} strokeWidth="13" />
  }
}

function charge(c: Charge, ink: string): ReactNode {
  const stroke = { stroke: ARGENT, strokeLinecap: "round" as const, strokeLinejoin: "round" as const }
  const outline = { stroke: ink, strokeWidth: 1.2, paintOrder: "stroke" as const }
  switch (c) {
    case "star":
      return (
        <path
          d="M30 17l4 9 9.6.9-7.3 6.4 2.2 9.4L30 37.8l-8.5 4.9 2.2-9.4-7.3-6.4 9.6-.9z"
          fill={ARGENT}
          {...outline}
        />
      )
    case "cross":
      return <path d="M27 16h6v9h9v6h-9v15h-6V31h-9v-6h9z" fill={ARGENT} {...outline} />
    case "bow":
      return (
        <g fill="none" {...stroke}>
          <path d="M22 17 Q38 31 22 45" strokeWidth="3.4" />
          <path d="M22 17 V45" strokeWidth="1.4" />
          <path d="M18 31 H42 M38 27.5 L42 31 L38 34.5" strokeWidth="2.6" />
        </g>
      )
    case "axe":
      return (
        <g {...stroke}>
          <path d="M23 46 L37 22" strokeWidth="3.4" />
          <path d="M33 17 Q44 18 44 30 L35 25 Z" fill={ARGENT} strokeWidth="1.5" />
        </g>
      )
    case "key":
      return (
        <g fill="none" {...stroke} strokeWidth="3.2">
          <circle cx="30" cy="22" r="6" />
          <path d="M30 28 V46 M30 40 H36 M30 45 H35" />
        </g>
      )
  }
}

/** The shield's art in its 60×70 box; `clip` is a document-unique id for the field's clip path. */
export function ShieldArt({ arms, banner, clip }: { arms: ShieldArms; banner: string; clip: string }) {
  const dark = shade(banner, 0.55)
  return (
    <g>
      <defs>
        <clipPath id={clip}>
          <path d={SHIELD_PATH} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <rect width="60" height="70" fill={banner} />
        <g transform={arms.flip ? "translate(60 0) scale(-1 1)" : undefined}>
          {division(arms.division, dark)}
        </g>
        {charge(arms.charge, dark)}
        <path d="M5 5 H55 V12 H5 Z" fill="#fff" opacity="0.08" />
      </g>
    </g>
  )
}
