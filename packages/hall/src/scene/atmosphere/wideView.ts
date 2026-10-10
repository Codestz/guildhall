import { DEV } from "../../guild/devFlags.ts"

/**
 * The gen 2 island's wide-view look: cascaded shadows (CascadeKey.tsx) and aerial perspective
 * (GradeEffect.aerial). `?cascades=off`, `?haze=off` and `?characters=off` (real shadows for characters,
 * characterShadows.ts) turn each off, for A/B shots and benches against the single shadow box and the
 * plain fog. Dev and probe builds only (guild/devFlags.ts): the showcase always has all three.
 */
export const WIDE_VIEW = { cascades: DEV.cascades, haze: DEV.haze, characters: DEV.characters }
