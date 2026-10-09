const flag = (name: string): boolean =>
  typeof location === "undefined" || new URLSearchParams(location.search).get(name) !== "off"

/**
 * The gen 2 island's wide-view look: cascaded shadows (CascadeKey.tsx) and aerial perspective
 * (GradeEffect.aerial). `?cascades=off` and `?haze=off` turn each off, for A/B shots and benches
 * against the single shadow box and the plain fog.
 */
export const WIDE_VIEW = { cascades: flag("cascades"), haze: flag("haze") }
