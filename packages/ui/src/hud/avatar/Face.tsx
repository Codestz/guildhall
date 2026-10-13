/**
 * Variant C, the chibi face: an SVG head per body family (wizard hat, knight helm, ranger hood, horned
 * barbarian, rogue mask) on a tile in the banner's dark, with seeded features and an expression that
 * follows the phase. Drawn in a 60-unit box; decorative (the badge names the hero and its state).
 */
import type { ReactNode } from "react"
import type { Family } from "../types.ts"
import { type Expression, type FaceFeatures, shade } from "./model.ts"

const INK = "#15110d"
const MOUTH = "#7a2a1a"

/** The headgear, behind (`back`) and over (`front`) the face. */
function headgear(family: Family, banner: string): { back?: ReactNode; front: ReactNode } {
  const dark = shade(banner, 0.62)
  switch (family) {
    case "mage":
      return {
        front: (
          <>
            <path d="M31 1 L45 23 H15 Z" fill={banner} stroke={dark} strokeWidth="1.2" />
            <path d="M31 1 Q37 4 41 0" stroke={banner} strokeWidth="3" fill="none" strokeLinecap="round" />
            <ellipse cx="30" cy="24" rx="20" ry="4.2" fill={banner} stroke={dark} strokeWidth="1.2" />
            <path
              d="M28 12 l1.2 2.6 2.8.3-2.1 1.9.6 2.8-2.5-1.4-2.5 1.4.6-2.8-2.1-1.9 2.8-.3z"
              fill="#ffe08a"
            />
          </>
        ),
      }
    case "knight":
      return {
        front: (
          <>
            <path d="M14.5 33 Q14 14 30 13 Q46 14 45.5 33 V36 H41 V30 H19 V36 H14.5 Z" fill="#a3acb7" />
            <path d="M14.5 33 Q14 14 30 13 Q46 14 45.5 33" fill="none" stroke="#5d6672" strokeWidth="1.3" />
            <rect x="18" y="27" width="24" height="3.4" rx="1.2" fill="#2a2f36" />
            <path d="M30 13 V27" stroke="#7c8692" strokeWidth="1.4" />
            <path d="M30 13 Q33 3 42 5 Q37 8 36 14" fill={banner} stroke={dark} strokeWidth="1" />
          </>
        ),
      }
    case "ranger":
      return {
        back: <path d="M9 52 Q8 14 30 10 Q52 14 51 52 Z" fill={dark} />,
        front: (
          <path
            d="M9 46 Q8 12 30 9 Q52 12 51 46 L46 40 Q46 21 30 20 Q14 21 14 40 Z"
            fill={banner}
            stroke={dark}
            strokeWidth="1.2"
          />
        ),
      }
    case "barbarian":
      return {
        front: (
          <>
            <path d="M16 27 Q5 22 7 8 Q11 19 19 21 Z" fill="#efe3c8" stroke="#b9a988" strokeWidth="1" />
            <path d="M44 27 Q55 22 53 8 Q49 19 41 21 Z" fill="#efe3c8" stroke="#b9a988" strokeWidth="1" />
            <path d="M15 28 Q15 15 30 15 Q45 15 45 28 Z" fill="#7c858f" stroke="#4d555e" strokeWidth="1.2" />
            <rect
              x="14.5"
              y="26"
              width="31"
              height="4"
              rx="1.5"
              fill={banner}
              stroke={dark}
              strokeWidth="0.8"
            />
          </>
        ),
      }
    case "rogue":
      return {
        back: <path d="M12 50 Q10 16 30 13 Q50 16 48 50 Z" fill="#3a3340" />,
        front: (
          <>
            <path d="M13 34 Q12 13 30 12 Q48 13 47 34 Q44 22 30 21 Q16 22 13 34 Z" fill="#4a4250" />
            <rect x="15" y="31" width="30" height="8.5" rx="4" fill={INK} />
            <path d="M45 33 L52 30 L50 37 Z" fill={banner} />
          </>
        ),
      }
  }
}

function eyes(ex: Expression, f: FaceFeatures, masked: boolean): ReactNode {
  const l = 24 - f.spread
  const r = 36 + f.spread
  const pupil = masked ? "#f3e9d4" : INK
  switch (ex) {
    case "failed":
      return (
        <g stroke={pupil} strokeWidth="2.3" strokeLinecap="round">
          <path d={`M${l - 3} 33l6 6M${l + 3} 33l-6 6M${r - 3} 33l6 6M${r + 3} 33l-6 6`} />
        </g>
      )
    case "idle":
      return (
        <g stroke={pupil} strokeWidth="2.2" strokeLinecap="round" fill="none">
          <path d={`M${l - 3} 36.5q3 2 6 0M${r - 3} 36.5q3 2 6 0`} />
        </g>
      )
    case "loot":
      return (
        <g stroke={pupil} strokeWidth="2.3" strokeLinecap="round" fill="none">
          <path d={`M${l - 3} 37q3-4 6 0M${r - 3} 37q3-4 6 0`} />
        </g>
      )
    case "thinking":
      return (
        <>
          <circle cx={l + 0.6} cy="33.6" r="2.6" fill={pupil} />
          <circle cx={r + 0.6} cy="33.6" r="2.6" fill={pupil} />
          {!masked && <circle cx={l + 1.4} cy="32.6" r="0.9" fill="#fff" />}
          {!masked && <circle cx={r + 1.4} cy="32.6" r="0.9" fill="#fff" />}
        </>
      )
    case "plea":
      return (
        <>
          <circle cx={l} cy="36" r="3.2" fill={pupil} />
          <circle cx={r} cy="36" r="3.2" fill={pupil} />
          {!masked && <circle cx={l + 1} cy="35" r="1.2" fill="#fff" />}
          {!masked && <circle cx={r + 1} cy="35" r="1.2" fill="#fff" />}
        </>
      )
    default:
      return (
        <>
          <circle cx={l} cy="36" r="2.4" fill={pupil} />
          <circle cx={r} cy="36" r="2.4" fill={pupil} />
        </>
      )
  }
}

function brows(ex: Expression, f: FaceFeatures, family: Family): ReactNode {
  if (family === "knight" || family === "rogue") return null
  const l = 24 - f.spread
  const r = 36 + f.spread
  // worry lifts the inner ends, a fall knits them, thinking raises both
  const d =
    ex === "plea"
      ? `M${l - 3} 31.5l6-2M${r + 3} 31.5l-6-2`
      : ex === "failed"
        ? `M${l - 3} 29.5l6 2M${r + 3} 29.5l-6 2`
        : ex === "thinking"
          ? `M${l - 3} 29.5q3-2.5 6 0M${r - 3} 29.5q3-2.5 6 0`
          : f.brows === "stern"
            ? `M${l - 3} 30.5l6 1M${r + 3} 30.5l-6 1`
            : f.brows === "arched"
              ? `M${l - 3} 31q3-2 6 0M${r - 3} 31q3-2 6 0`
              : null
  return d && <path d={d} stroke={f.hair} strokeWidth="1.8" strokeLinecap="round" fill="none" />
}

function mouth(ex: Expression): ReactNode {
  switch (ex) {
    case "loot":
      return (
        <>
          <path d="M22.5 42.5 Q30 52 37.5 42.5 Z" fill={MOUTH} />
          <path d="M23.6 43.3 H36.4" stroke="#fff" strokeWidth="1.6" />
        </>
      )
    case "plea":
      return <ellipse cx="30" cy="45.2" rx="2.6" ry="3.2" fill={MOUTH} />
    case "failed":
      return <path d="M24.5 47 q2.7-3 5.5 0 q2.8 3 5.5 0" stroke={MOUTH} strokeWidth="2" fill="none" />
    case "idle":
      return <path d="M27 45 h6" stroke={MOUTH} strokeWidth="2" strokeLinecap="round" />
    case "thinking":
      return (
        <path d="M27 45.4 q3 -1.6 6 0.6" stroke={MOUTH} strokeWidth="2" fill="none" strokeLinecap="round" />
      )
    default:
      return (
        <path d="M25 44 q5 3.6 10 0" stroke={MOUTH} strokeWidth="2.2" fill="none" strokeLinecap="round" />
      )
  }
}

function beard(f: FaceFeatures): ReactNode {
  switch (f.beard) {
    case "full":
      return <path d="M17 39 Q18 56 30 57 Q42 56 43 39 Q40 47 30 47 Q20 47 17 39 Z" fill={f.hair} />
    case "moustache":
      return (
        <path d="M23 42.6 Q27 39.8 30 42 Q33 39.8 37 42.6 Q33 42 30 43.4 Q27 42 23 42.6 Z" fill={f.hair} />
      )
    case "stubble":
      return (
        <path
          d="M19 43 Q21 53 30 54 Q39 53 41 43"
          fill="none"
          stroke={f.hair}
          strokeWidth="2.4"
          strokeDasharray="1 2"
          opacity="0.6"
        />
      )
    default:
      return null
  }
}

/** The mark of the moment, top right: a thought, a drop of sweat, a sparkle, sleep. */
function flourish(ex: Expression): ReactNode {
  switch (ex) {
    case "thinking":
      return (
        <g fill="#f3e9d4">
          <circle cx="50" cy="12" r="4.6" />
          <circle cx="44.5" cy="20" r="1.9" />
        </g>
      )
    case "plea":
      return <path d="M48 26 q4 6 0 8.6 q-4-2.6 0-8.6 z" fill="#8fd0e6" stroke="#3d7f99" strokeWidth="0.8" />
    case "loot":
      return <path d="M49 6 l1.5 4.5 4.5 1.5-4.5 1.5-1.5 4.5-1.5-4.5-4.5-1.5 4.5-1.5z" fill="#ffe08a" />
    case "idle":
      return (
        <g fill="#f3e9d4" fontFamily="Marcellus SC, Georgia, serif">
          <text x="45" y="17" fontSize="10">
            z
          </text>
          <text x="51" y="10" fontSize="7">
            z
          </text>
        </g>
      )
    default:
      return null
  }
}

/** The face in its 60-unit box (no tile): for the badge, the portrait's fallback and the lab. */
export function FaceArt({
  family,
  banner,
  expression,
  features,
}: {
  family: Family
  banner: string
  expression: Expression
  features: FaceFeatures
}) {
  const gear = headgear(family, banner)
  const masked = family === "rogue"
  return (
    <g>
      {gear.back}
      <circle cx="30" cy="38" r="15" fill={features.skin} />
      {features.cheeks && expression !== "failed" && (
        <g fill="#f2988a" opacity="0.55">
          <circle cx="19.5" cy="42" r="3" />
          <circle cx="40.5" cy="42" r="3" />
        </g>
      )}
      {beard(features)}
      {mouth(expression)}
      {gear.front}
      {brows(expression, features, family)}
      {eyes(expression, features, masked)}
      {flourish(expression)}
    </g>
  )
}
