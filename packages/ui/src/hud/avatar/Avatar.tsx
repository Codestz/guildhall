/**
 * A hero's avatar, one component with three looks (decisions.md "V1 UI parity", user picks):
 *
 *   face      C · a chibi face per body family whose expression follows the phase (where no portrait is
 *               drawn: the labs, a crowd's role badge; and standing in for a portrait until it lands)
 *   portrait  A · the hero's own KayKit figure as the island draws it, rendered once (render `portrait.ts`),
 *               in a round medallion of its banner with a rim in its own colour or its state's (the badge
 *               bar, roster rows, the dossier); the face stands in until it is drawn
 *   shield    B · a heraldic shield: the banner's tincture, a division seeded by the session, a family charge
 *               (the shareable card)
 *
 * State reads through the rim (plea, fail, loot) and the face; the words live beside it (the badge's
 * label, the row's status), so colour never speaks alone. Decorative unless given a `label`.
 */
import { type CSSProperties, useId } from "react"
import { roman } from "../../components/controls.tsx"
import type { HeroView } from "../types.ts"
import { FaceArt } from "./Face.tsx"
import { expressionOf, faceFeatures, rimTone, shade, shieldOf } from "./model.ts"
import { SHIELD_PATH, ShieldArt } from "./Shield.tsx"

export type AvatarVariant = "face" | "portrait" | "shield"

export interface AvatarProps {
  variant: AvatarVariant
  hero: Pick<HeroView, "id" | "family" | "banner" | "phase" | "ordinal">
  /** Shield: the session's id, which seeds the division (default: the hero's id). */
  session?: string
  /** CSS px a side (the shield is 7/6 as tall). Default 32. */
  size?: number
  /** Portrait: the rendered sprite's URL; until it comes the face stands in. */
  src?: string | null
  /** Names the avatar for assistive tech; left out, it is decorative. */
  label?: string
  /** The numeral pip for a second Warden (default on). */
  pip?: boolean
  className?: string
}

export function Avatar({
  variant,
  hero,
  session,
  size = 32,
  src,
  label,
  pip = true,
  className,
}: AvatarProps) {
  const id = useId()
  const tone = rimTone(hero.phase)
  const expression = expressionOf(hero.phase)
  const features = faceFeatures(hero.id, hero.family, {
    ...(hero.ordinal !== undefined ? { ordinal: hero.ordinal } : {}),
    kin: `${hero.family}:${hero.banner}`,
  })
  const ordinal = hero.ordinal ?? 1
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true }
  const style = { "--banner": hero.banner, "--accent": features.accent, "--av": `${size}px` } as CSSProperties

  return (
    <span
      className={`hud-avatar${className ? ` ${className}` : ""}`}
      data-variant={variant}
      data-tone={tone ?? "none"}
      data-expression={expression}
      data-idle={expression === "idle"}
      style={style}
      {...a11y}
    >
      {variant === "face" && (
        <svg viewBox="0 0 60 60" width={size} height={size} focusable="false" aria-hidden="true">
          <rect x="1.5" y="1.5" width="57" height="57" rx="14" fill={shade(hero.banner, 0.42)} />
          <FaceArt family={hero.family} banner={hero.banner} expression={expression} features={features} />
          <rect
            className="hud-avatar-rim"
            x="1.5"
            y="1.5"
            width="57"
            height="57"
            rx="14"
            fill="none"
            strokeWidth="3"
          />
        </svg>
      )}
      {variant === "portrait" && (
        <span className="hud-avatar-medal">
          {src ? (
            <img src={src} alt="" width={size} height={size} draggable={false} />
          ) : (
            <svg viewBox="4 6 52 52" width={size} height={size} focusable="false" aria-hidden="true">
              <FaceArt
                family={hero.family}
                banner={hero.banner}
                expression={expression}
                features={features}
              />
            </svg>
          )}
        </span>
      )}
      {variant === "shield" && (
        <svg viewBox="0 0 60 70" width={size} height={(size * 7) / 6} focusable="false" aria-hidden="true">
          <ShieldArt arms={shieldOf(session ?? hero.id, hero.family)} banner={hero.banner} clip={`${id}-f`} />
          <path
            className="hud-avatar-rim"
            d={SHIELD_PATH}
            fill="none"
            strokeWidth="3"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {pip && ordinal > 1 && <i className="hud-avatar-num">{roman(ordinal)}</i>}
    </span>
  )
}
