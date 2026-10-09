import { describe, expect, test } from "bun:test"
import {
  filmZoom,
  groundOf,
  type Land,
  landOf,
  ORTHO_BACK,
  orthoBackOf,
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
        const film = groundOf(screen, filmZoom(screen, land.reach * 1.2))
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
