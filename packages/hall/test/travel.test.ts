import { describe, expect, test } from "bun:test"
import { OrthographicCamera, PerspectiveCamera, Vector3 } from "three"
import { islandView } from "../src/guild/islandView.ts"
import { FADE_CUT_S, Flight, planTrip, type Sizes, travel } from "../src/scene/archipelago/flight.ts"
import { flightSeconds } from "../src/scene/archipelago/view.ts"
import { islandIndexOf } from "../src/world/archipelagoLink.ts"
import type { Archipelago } from "../src/world/archipelagoSource.ts"
import { HOME, islandAt, islandParam, neighbour, placesOf, ringOf } from "../src/world/islandRing.ts"

/** Home at the origin; a (east), b (south), c (west), d (north): clockwise from the north is d, a, b, c. */
const archipelago = {
  home: { repo: "h/home", name: "home", at: [0, 0], reach: 80 },
  islands: [
    { repo: "o/a", name: "a", at: [300, 0], reach: 100 },
    { repo: "o/b", name: "b", at: [0, 300], reach: 90 },
    { repo: "o/c", name: "c", at: [-300, 0], reach: 100 },
    { repo: "o/d", name: "d", at: [0, -300], reach: 90 },
  ],
} as unknown as Archipelago

describe("the ring round the home island", () => {
  const ring = ringOf(placesOf(archipelago))

  test("home first, then the far islands by the angle of their keeps", () => {
    // atan2(z, x): d at -π/2, a at 0, b at π/2, c at π — from the north, round.
    expect(ring).toEqual([HOME, 3, 0, 1, 2])
  })

  test("← and → walk it and wrap round", () => {
    expect(neighbour(ring, HOME, 1)).toBe(3)
    expect(neighbour(ring, 2, 1)).toBe(HOME)
    expect(neighbour(ring, HOME, -1)).toBe(2)
    expect(neighbour(ring, 0, -1)).toBe(3)
  })

  test("from the map, on is the first stop and back the last", () => {
    expect(neighbour(ring, "map", 1)).toBe(HOME)
    expect(neighbour(ring, "map", -1)).toBe(2)
  })

  test("a lone home island has itself as neighbour; none has nothing", () => {
    expect(neighbour([HOME], HOME, 1)).toBe(HOME)
    expect(neighbour([], HOME, 1)).toBeUndefined()
    expect(ringOf([])).toEqual([])
  })
})

describe("which island a point is on", () => {
  const places = placesOf(archipelago)

  test("inside a reach, that island; at sea, none", () => {
    expect(islandAt(places, 10, 10)).toBe(HOME)
    expect(islandAt(places, 320, 20)).toBe(0)
    expect(islandAt(places, -250, 0)).toBe(2)
    expect(islandAt(places, 150, 0)).toBeUndefined()
  })

  test("where two reaches overlap, the nearer keep", () => {
    const near = [
      { at: [0, 0], reach: 100 },
      { at: [120, 0], reach: 100 },
    ] as const
    expect(islandAt(near, 40, 0)).toBe(HOME)
    expect(islandAt(near, 90, 0)).toBe(0)
  })
})

describe("the island in the link", () => {
  test("home is the default, the map and an island are named, and each reads back", () => {
    expect(islandParam(HOME, archipelago)).toBeNull()
    expect(islandParam("map", archipelago)).toBe("map")
    const repos = archipelago.islands.map((island) => island.repo)
    for (let i = 0; i < repos.length; i++) {
      const param = islandParam(i, archipelago) as string
      expect(islandIndexOf(param, repos)).toBe(i)
    }
  })

  test("two islands with one short name are told apart by their repos", () => {
    const twins = {
      home: archipelago.home,
      islands: [
        { repo: "x/lib", name: "lib", at: [1, 1], reach: 1 },
        { repo: "y/lib", name: "lib", at: [2, 2], reach: 1 },
      ],
    } as unknown as Archipelago
    expect(islandParam(1, twins)).toBe("y/lib")
    expect(islandIndexOf("y/lib", ["x/lib", "y/lib"])).toBe(1)
  })
})

describe("a flight", () => {
  const sizes: Sizes = { wide: 3, mapZoom: 1, mapDistance: 900, far: 95, follow: 8 }
  const ask = (stop: number | "map", at?: [number, number]) => {
    islandView.go(stop, at ? { at } : {})
    return islandView.get()
  }

  test("takes 1.4 to 1.8 s whatever the distance", () => {
    for (const distance of [0, 10, 300, 900, 5000]) {
      expect(flightSeconds(distance)).toBeGreaterThanOrEqual(1.4)
      expect(flightSeconds(distance)).toBeLessThanOrEqual(1.8)
    }
    expect(flightSeconds(900)).toBeGreaterThan(flightSeconds(10))
  })

  test("arcs over the sea: off the straight line, pulled back halfway, landing on the frame", () => {
    const camera = new OrthographicCamera()
    camera.zoom = 6
    camera.position.set(1, 1, 1).multiplyScalar(500)
    const control = { target: new Vector3(0, 1, 0) }
    const trip = planTrip(ask(0), archipelago, control.target, 6, true, sizes)
    const flight = new Flight()
    flight.begin(control.target, trip, 0, { cut: false, fade: false })
    expect(travel.heading).toBe(0)

    let widest = Number.POSITIVE_INFINITY
    let offLine = 0
    let steps = 0
    while (flight.step(1 / 60, camera, control, true, 500, new Vector3(1, 1, 1))) {
      widest = Math.min(widest, camera.zoom)
      // Distance from the straight line home → a (the x axis): the arc's bow.
      offLine = Math.max(offLine, Math.abs(control.target.z))
      steps++
      if (steps > 600) throw new Error("never lands")
    }
    expect(steps / 60).toBeGreaterThanOrEqual(1.4)
    expect(steps / 60).toBeLessThanOrEqual(1.9)
    expect(widest).toBeLessThan(3) // pulled out below the wide it lands on
    expect(offLine).toBeGreaterThan(10)
    expect(control.target.x).toBeCloseTo(300, 4)
    expect(control.target.z).toBeCloseTo(0, 4)
    expect(camera.zoom).toBeCloseTo(sizes.wide, 4)
    expect(travel.heading).toBeNull()
  })

  test("the map's trip does not pull out; a cut lands in one step", () => {
    const camera = new PerspectiveCamera()
    camera.position.set(100, 100, 100)
    const control = { target: new Vector3(0, 1, 0) }
    const trip = planTrip(ask("map"), archipelago, control.target, 150, false, sizes)
    expect(trip.pull).toBe(0)
    expect(trip.sizeTo).toBe(sizes.mapDistance)
    const flight = new Flight()
    flight.begin(control.target, trip, "map", { cut: true, fade: false })
    expect(flight.step(1 / 60, camera, control, false, 0, new Vector3(1, 1, 1))).toBe(true)
    expect(flight.flying).toBe(false)
    expect(camera.position.distanceTo(control.target)).toBeCloseTo(sizes.mapDistance, 3)
  })

  test("with reduced motion it holds for the fade's dark, then cuts", () => {
    const camera = new OrthographicCamera()
    camera.position.set(100, 100, 100)
    const control = { target: new Vector3(0, 1, 0) }
    const flight = new Flight()
    flight.begin(control.target, planTrip(ask(2), archipelago, control.target, 6, true, sizes), 2, {
      cut: false,
      fade: true,
    })
    flight.step(FADE_CUT_S / 2, camera, control, true, 500, new Vector3(1, 1, 1))
    expect(control.target.x).toBe(0)
    flight.step(FADE_CUT_S, camera, control, true, 500, new Vector3(1, 1, 1))
    flight.step(1 / 60, camera, control, true, 500, new Vector3(1, 1, 1))
    expect(control.target.x).toBeCloseTo(-300, 4)
    expect(flight.flying).toBe(false)
  })

  test("to a spot (a followed adventurer's crossing) closes in and stays", () => {
    const control = { target: new Vector3(0, 1, 0) }
    const wide = planTrip(ask(0, [310, 20]), archipelago, control.target, 3, true, sizes)
    expect(wide.to.x).toBe(310)
    expect(wide.to.z).toBe(20)
    expect(wide.sizeTo).toBe(sizes.follow) // zoomed out: closes in
    const close = planTrip(ask(0, [310, 20]), archipelago, control.target, 20, true, sizes)
    expect(close.sizeTo).toBe(20) // already closer: stays
    const persp = planTrip(ask(0, [310, 20]), archipelago, control.target, 60, false, sizes)
    expect(persp.sizeTo).toBe(sizes.follow)
  })
})
