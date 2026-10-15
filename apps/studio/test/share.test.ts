/**
 * "Share island" (hall/hud/share.ts, shell/router.ts `publicLink`): the HUD offers the card while it can
 * draw one and takes the offer back; the card's link is the address on screen with its public params only.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { offerShare, onShareOffer, shareOffer } from "../src/hall/hud/share.ts"
import { publicLink } from "../src/shell/router.ts"

const g = globalThis as unknown as Record<string, unknown>
afterEach(() => {
  offerShare(null)
  delete g.location
})

describe("share island", () => {
  test("the offer comes and goes with the HUD, and the menu hears it", () => {
    let heard = 0
    const off = onShareOffer(() => heard++)
    expect(shareOffer()).toBeNull()
    let opened = 0
    offerShare(() => opened++)
    shareOffer()?.()
    expect(opened).toBe(1)
    offerShare(null)
    expect(shareOffer()).toBeNull()
    expect(heard).toBe(2)
    off()
  })

  test("the link reopens the same island at the same moment, dev params left out", () => {
    g.location = new URL(
      "http://guildhall.test/hall/facebook/react?t=2018-05-01&hud=perf&season=winter&labels=0",
    )
    expect(publicLink()).toBe("http://guildhall.test/hall/facebook/react?t=2018-05-01&season=winter")
    g.location = new URL("http://guildhall.test/?story=saga&act=3&next=0&hour=22")
    expect(publicLink()).toBe("http://guildhall.test/?story=saga&act=3&hour=22")
  })
})
