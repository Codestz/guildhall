import { describe, expect, test } from "bun:test"
import { ISLAND_DEFAULTS, normalizeIslandSpec, validateIslandSpec } from "../src/island/spec.ts"
import { POI_KINDS } from "../src/island/types.ts"
import { normalizeSpec } from "../src/town/spec.ts"
import { ACTIVITIES, STATION_ACTIVITY, STATION_KINDS, TIERS } from "../src/town/types.ts"

/** world island: defaults per main tier, filling them in, preset validation, and the station → activity link. */

const city = { seed: 7, town: { seed: 11, tier: "city" as const } }

describe("ISLAND_DEFAULTS", () => {
  test("the island is 2.2 town radii at every tier", () => {
    for (const tier of TIERS) expect(ISLAND_DEFAULTS[tier].scale).toBe(2.2)
  })

  test("satellites by main tier: town fishing + farming, city and capital add the mining camp as a hamlet", () => {
    expect(ISLAND_DEFAULTS.hamlet.satellites).toEqual([])
    expect(ISLAND_DEFAULTS.village.satellites.length).toBeLessThanOrEqual(1)
    expect(ISLAND_DEFAULTS.town.satellites.map((s) => s.role)).toEqual(["fishing", "farming"])
    for (const tier of ["city", "capital"] as const) {
      expect(ISLAND_DEFAULTS[tier].satellites.map((s) => s.role)).toEqual(["fishing", "farming", "mining"])
      expect(ISLAND_DEFAULTS[tier].satellites.find((s) => s.role === "mining")?.tier).toBe("hamlet")
    }
  })

  test("6–10 POIs per tier; city and capital include the mining pair; one lake, two from city up", () => {
    for (const tier of TIERS) {
      const d = ISLAND_DEFAULTS[tier]
      expect(d.pois.length).toBeGreaterThanOrEqual(6)
      expect(d.pois.length).toBeLessThanOrEqual(10)
      expect(d.lakes).toBe(tier === "city" || tier === "capital" ? 2 : 1)
    }
    expect(ISLAND_DEFAULTS.city.pois).toContain("quarry")
    expect(ISLAND_DEFAULTS.city.pois).toContain("mine")
  })

  test("every tier's defaults pass the validator", () => {
    for (const tier of TIERS) expect(validateIslandSpec({ seed: 1, town: { seed: 1, tier } })).toEqual([])
  })
})

describe("normalizeIslandSpec", () => {
  test("fills every field from the main tier and forces the town's harbour on", () => {
    const s = normalizeIslandSpec({ seed: 7, town: { seed: 11, tier: "city", harbour: null } })
    const d = ISLAND_DEFAULTS.city
    expect(s.town.harbour).not.toBeNull()
    expect(s.town.districts).toContain("harbour")
    expect(s).toMatchObject({ seed: 7, scale: 2.2, lakes: 2, rough: 1, wildlife: true, pois: [...d.pois] })
    expect(s.satellites.map(({ role, tier }) => ({ role, tier }))).toEqual([...d.satellites])
  })

  test("a harbour left out takes the bearing the town itself would roll", () => {
    const rolled = Array.from({ length: 40 }, (_, seed) => normalizeSpec({ seed, tier: "town" }))
    const withHarbour = rolled.find((t) => t.harbour)
    if (!withHarbour?.harbour) throw new Error("no seed in 0..39 rolls a harbour")
    const s = normalizeIslandSpec({ seed: 1, town: { seed: withHarbour.seed, tier: "town" } })
    expect(s.town.harbour).toEqual(withHarbour.harbour)
  })

  test("keeps what the spec gives, the town's harbour bearing included", () => {
    const s = normalizeIslandSpec({
      seed: 3,
      town: { seed: 4, tier: "town", harbour: { bearing: 1.25 } },
      scale: 2.4,
      satellites: [{ role: "farming", tier: "hamlet", seed: 99 }],
      pois: ["shrine"],
      lakes: 0,
      rough: 2,
      wildlife: false,
    })
    expect(s).toMatchObject({
      scale: 2.4,
      satellites: [{ role: "farming", tier: "hamlet", seed: 99 }],
      pois: ["shrine"],
      lakes: 0,
      rough: 2,
      wildlife: false,
    })
    expect(s.town.harbour).toEqual({ bearing: 1.25 })
  })

  test("is idempotent and deterministic", () => {
    const once = normalizeIslandSpec(city)
    expect(normalizeIslandSpec(once)).toEqual(once)
    expect(normalizeIslandSpec(city)).toEqual(once)
  })

  test("satellite seeds are salted by role and index: adding a role never reseeds another", () => {
    const two = normalizeIslandSpec({
      ...city,
      satellites: [
        { role: "fishing", tier: "village" },
        { role: "fishing", tier: "hamlet" },
      ],
    }).satellites
    const three = normalizeIslandSpec({
      ...city,
      satellites: [
        { role: "farming", tier: "village" },
        { role: "fishing", tier: "village" },
        { role: "fishing", tier: "hamlet" },
      ],
    }).satellites
    expect(three.slice(1).map((s) => s.seed)).toEqual(two.map((s) => s.seed))
    expect(new Set(three.map((s) => s.seed)).size).toBe(3)
  })
})

describe("validateIslandSpec", () => {
  test("accepts a minimal and a full preset", () => {
    expect(validateIslandSpec(city)).toEqual([])
    expect(
      validateIslandSpec({
        ...city,
        scale: 2.4,
        satellites: [{ role: "mining", tier: "hamlet", seed: 5 }],
        pois: [...POI_KINDS],
        lakes: 2,
        rough: 2,
        wildlife: false,
      }),
    ).toEqual([])
  })

  test("rejects a non-object and passes the town's problems through", () => {
    expect(validateIslandSpec([])).toEqual(["island: expected an object"])
    expect(validateIslandSpec({ seed: 1, town: { seed: -1, tier: "metropolis" } })).toEqual([
      "town.seed: expected a non-negative integer, got -1",
      'town.tier: expected one of hamlet, village, town, city, capital, got "metropolis"',
    ])
  })

  test("rejects a main town without a harbour", () => {
    expect(validateIslandSpec({ ...city, town: { ...city.town, harbour: null } })).toEqual([
      "town.harbour: the main town is the harbour town; leave it out or give a bearing",
    ])
  })

  test("rejects bad fields, naming each", () => {
    expect(
      validateIslandSpec({
        seed: 1.5,
        town: city.town,
        scale: 5,
        lakes: 3,
        rough: -1,
        wildlife: "yes",
        pois: ["castle"],
      }),
    ).toEqual([
      "seed: expected a non-negative integer, got 1.5",
      "scale: expected town radii in 1.8..3.5, got 5",
      "lakes: expected 0, 1 or 2, got 3",
      "rough: expected 0, 1 or 2, got -1",
      "wildlife: expected a boolean",
      'pois[0]: unknown POI "castle"',
    ])
  })

  test("scale bounds are inclusive", () => {
    expect(validateIslandSpec({ ...city, scale: 1.8 })).toEqual([])
    expect(validateIslandSpec({ ...city, scale: 3.5 })).toEqual([])
    expect(validateIslandSpec({ ...city, scale: 1.79 })).toHaveLength(1)
  })

  test("rejects bad satellites: unknown role, main role, a tier not below the main town, a mining village", () => {
    const problems = validateIslandSpec({
      seed: 1,
      town: { seed: 1, tier: "village" },
      satellites: [
        { role: "pirate", tier: "hamlet" },
        { role: "main", tier: "village", seed: -2 },
        { role: "fishing", tier: "town" },
        "farming",
      ],
    })
    expect(problems).toEqual([
      'satellites[0].role: expected one of fishing, farming, mining, got "pirate"',
      'satellites[1].role: expected one of fishing, farming, mining, got "main"',
      "satellites[1].tier: a satellite must be smaller than the main village",
      "satellites[1].seed: expected a non-negative integer, got -2",
      'satellites[2].tier: expected one of hamlet, village, got "town"',
      "satellites[3]: expected { role, tier, seed? }",
    ])
    expect(validateIslandSpec({ ...city, satellites: [{ role: "mining", tier: "village" }] })).toEqual([
      "satellites[0].tier: the mining camp is a hamlet",
    ])
  })

  test("rejects more satellites than an island can hold", () => {
    const sat = { role: "farming", tier: "hamlet" }
    expect(validateIslandSpec({ ...city, satellites: Array(5).fill(sat) })).toEqual([
      "satellites: at most 4, got 5",
    ])
  })

  test("rejects what the land cannot give: a lake-pier with no lake, a mine or mining camp with no rough", () => {
    expect(validateIslandSpec({ ...city, lakes: 0 })).toEqual(["pois: a lake-pier needs lakes >= 1"])
    expect(validateIslandSpec({ ...city, rough: 0 })).toEqual([
      "pois: a quarry needs rough >= 1",
      "pois: a mine needs rough >= 1",
      "satellites: the mining camp needs rough >= 1",
    ])
    expect(validateIslandSpec({ ...city, rough: 0, pois: ["shrine"], satellites: [] })).toEqual([])
  })
})

describe("STATION_ACTIVITY", () => {
  test("every station kind has at least one activity, and every activity has a station", () => {
    for (const kind of STATION_KINDS) expect(STATION_ACTIVITY[kind].length).toBeGreaterThan(0)
    const covered = new Set(STATION_KINDS.flatMap((kind) => STATION_ACTIVITY[kind]))
    expect([...ACTIVITIES].filter((a) => !covered.has(a))).toEqual([])
  })

  test("the town's 8 kinds come first, unchanged", () => {
    expect(STATION_KINDS.slice(0, 8)).toEqual([
      "market",
      "forge",
      "tavern",
      "dock",
      "field",
      "hall",
      "well",
      "gate",
    ])
  })
})
