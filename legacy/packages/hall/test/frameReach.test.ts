import { describe, expect, test } from "bun:test"
import {
  filmZoom,
  fogReachOf,
  groundOf,
  type Land,
  landOf,
  ORTHO_BACK,
  orthoBackOf,
  orthoMaxOf,
  roundLand,
  viewReachOf,
  widestOf,
} from "../src/scene/frameReach.ts"
import { seaRadiusOf } from "../src/world/archipelago.ts"
import { handWorld } from "../src/world/world.ts"

/**
 * The ground the orthographic cameras can show (scene/frameReach.ts): the sea reaches past it and
 * the camera stands far enough back that none of it falls inside the near plane (a gen 2 island's
 * growth film, and any island on a portrait phone, ran off the edge of the world).
 */

const DESKTOP = { width: 1440, height: 860 }
const PHONE = { width: 390, height: 844 }
const SCREENS = [DESKTOP, PHONE, { width: 820, height: 1180 }, { width: 2560, height: 1080 }]
/** A big generated island (react at gen 2) and a hamlet. */
const BIG: Land = { reach: 250, outreach: 2, peak: 60 }
const SMALL: Land = { reach: 70, outreach: 1, peak: 0 }

describe("the hand island on a desktop", () => {
  const land = landOf(handWorld())

  test("keeps the camera and the sea it always had", () => {
    expect(orthoBackOf(DESKTOP, land)).toBe(ORTHO_BACK * land.outreach + 2 * land.peak)
    expect(viewReachOf(DESKTOP, land)).toBeLessThanOrEqual(420)
  })
})

describe("the growth film's pull-back", () => {
  for (const screen of SCREENS)
    test(`${screen.width}x${screen.height}: the sea covers it and the camera stands clear of it`, () => {
      for (const land of [BIG, SMALL]) {
        // The film holds the land's whole radius (growth/orbit.ts), at most the island's reach and a bit.
        const film = groundOf(screen, filmZoom(screen, roundLand(land.reach * 1.2)))
        expect(viewReachOf(screen, land)).toBeGreaterThan(film.radius + land.reach * 0.2)
        expect(orthoBackOf(screen, land)).toBeGreaterThan(film.depth + 2 * land.peak)
      }
    })
})

describe("the controls' furthest zoom-out", () => {
  for (const screen of SCREENS)
    test(`${screen.width}x${screen.height}: the sea covers it and the camera stands clear of it`, () => {
      for (const land of [BIG, SMALL]) {
        const widest = groundOf(screen, widestOf(screen, land))
        expect(viewReachOf(screen, land)).toBeGreaterThan(widest.radius)
        expect(orthoBackOf(screen, land)).toBeGreaterThan(widest.depth)
      }
    })
})

describe("a portrait phone", () => {
  test("sees several reaches of sea round a big island, past what a 2x reach disc covered", () => {
    expect(viewReachOf(PHONE, BIG)).toBeGreaterThan(seaRadiusOf(BIG.reach))
    expect(orthoBackOf(PHONE, BIG)).toBeGreaterThan(ORTHO_BACK * BIG.outreach + 2 * BIG.peak)
  })

  test("opens a small island across the screen's width, not a speck mid-screen", () => {
    const across = 2 * SMALL.reach * widestOf(PHONE, SMALL)
    expect(across).toBeGreaterThan(PHONE.width * 0.9)
    expect(across).toBeLessThanOrEqual(PHONE.width)
  })

  test("leaves the controls' zoom-out alone where the island already fills the screen, and on a desktop", () => {
    expect(widestOf(PHONE, BIG) * 2 * BIG.reach).toBeGreaterThan(PHONE.width)
    expect(widestOf(DESKTOP, SMALL)).toBeCloseTo((DESKTOP.height / 31) * 0.21, 5)
  })
})

describe("the film's fit of a land's extents", () => {
  const SIN = Math.sin(Math.atan2(0.93, Math.SQRT2))
  /** The share of the screen's width, and of its height, the land's extents take at the film's zoom. */
  const fills = (screen: { width: number; height: number }, across: number, deep: number) => {
    const zoom = filmZoom(screen, { across, deep })
    return { wide: across / (screen.width / 2 / zoom), high: (deep * SIN) / (screen.height / 2 / zoom) }
  }

  test("a phone fits an even land by its width, to ~90% of it", () => {
    const { wide, high } = fills(PHONE, 100, 100)
    expect(wide).toBeCloseTo(0.9, 2)
    expect(high).toBeLessThan(0.5)
  })

  test("a desktop fits it by its height or its width, whichever it meets first, to ~90%", () => {
    const { wide, high } = fills(DESKTOP, 100, 100)
    expect(Math.max(wide, high)).toBeGreaterThan(0.8)
    expect(Math.max(wide, high)).toBeLessThanOrEqual(0.9 + 1e-9)
  })

  test("a land long across the view frames by that; one long along it frames tighter", () => {
    expect(filmZoom(DESKTOP, { across: 300, deep: 60 })).toBeCloseTo((DESKTOP.width * 0.9) / 2 / 300, 6)
    expect(filmZoom(DESKTOP, { across: 60, deep: 400 })).toBeLessThan(
      filmZoom(DESKTOP, { across: 300, deep: 60 }),
    )
  })

  test("never crops the land on any screen", () => {
    for (const screen of SCREENS)
      for (const [across, deep] of [
        [40, 200],
        [200, 40],
        [150, 150],
      ] as const) {
        const { wide, high } = fills(screen, across, deep)
        expect(wide).toBeLessThanOrEqual(0.9 + 1e-9)
        expect(high).toBeLessThanOrEqual(0.9 + 1e-9)
      }
  })

  test("eases as land grows: more land is less zoom, in small steps (no jump)", () => {
    let last = filmZoom(PHONE, { across: 20, deep: 20 })
    for (let r = 21; r <= 300; r++) {
      const zoom = filmZoom(PHONE, { across: r, deep: r })
      expect(zoom).toBeLessThan(last)
      expect(last / zoom).toBeLessThan(1.1)
      last = zoom
    }
  })

  test("a keep alone is not framed tighter than a floor", () => {
    expect(filmZoom(PHONE, { across: 2, deep: 2 })).toBe(filmZoom(PHONE, { across: 16, deep: 16 }))
  })
})

describe("the island fog", () => {
  /** The furthest ground from the origin any orthographic framing on `screen` shows (frameReach.ts viewReachOf, without its margin). */
  const seen = (screen: { width: number; height: number }, land: Land) =>
    land.reach * 0.5 +
    groundOf(screen, Math.min(widestOf(screen, land), filmZoom(screen, roundLand(land.reach * 1.25)))).radius
  /** Fog starts at this share of its radius at the least (atmosphere/sky.ts `fogNear`, in the haziest weather). */
  const NEAR = 0.58

  // (A phone is 0.4% short of fully upright, uprightOf.)
  test("starts past the ground a phone shows (the film's pull-back and the controls' zoom-out), not inside it", () => {
    for (const land of [BIG, SMALL, landOf(handWorld())]) {
      const coast = land.reach * 1.2
      expect(fogReachOf(PHONE, land, coast) * NEAR).toBeGreaterThanOrEqual(seen(PHONE, land) * 0.99)
    }
  })

  test("keeps the coast fade on a landscape screen, as it always was", () => {
    for (const land of [BIG, SMALL, landOf(handWorld())])
      expect(fogReachOf(DESKTOP, land, land.reach * 1.2)).toBe(land.reach * 1.2)
  })

  test("never closes in on the island's own coast, and eases in as a screen turns upright", () => {
    const tablet = { width: 820, height: 1180 }
    const coast = SMALL.reach * 1.2
    expect(fogReachOf(PHONE, SMALL, coast)).toBeGreaterThanOrEqual(coast)
    expect(fogReachOf(tablet, SMALL, coast)).toBeGreaterThan(coast)
    expect(fogReachOf(tablet, SMALL, coast)).toBeLessThan(fogReachOf(PHONE, SMALL, coast))
  })
})

describe("the camera controls' furthest distance", () => {
  test("holds the camera where the film and the zoom-out stand it, on every screen", () => {
    for (const screen of SCREENS)
      for (const land of [BIG, SMALL])
        expect(orthoMaxOf(land.outreach, orthoBackOf(screen, land))).toBeGreaterThan(
          orthoBackOf(screen, land),
        )
  })

  test("is what it was where the camera stands at its usual distance", () => {
    const hand = landOf(handWorld())
    expect(orthoMaxOf(hand.outreach, orthoBackOf(DESKTOP, hand))).toBe(300 * hand.outreach)
  })
})
