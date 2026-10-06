/**
 * The villagers' daily rounds (Life): a door to come out of at dawn and go back into at dusk, and
 * a loop of stops along the village streets, each with how long they stay and what they do there.
 * Points are picked by eye on open ground and road (world units).
 */
export interface Stop {
  x: number
  z: number
  /** Seconds to stay. */
  wait?: number
  clip?: string
  /** Heading while standing (rotation-y). */
  facing?: number
}

export interface Round {
  id: string
  /** Character model key (world/cast.ts MODELS). */
  model: string
  door: Stop
  stops: readonly Stop[]
}

/** Smaller and slower than adventurers (who walk at 3.4): an amble, with the stride slowed to match. */
export const VILLAGER = { scale: 0.82, speed: 1.6, stride: 0.6 } as const

const EAST = Math.PI / 2

export const ROUNDS: readonly Round[] = [
  {
    // The farmer: tends the east fields, a strip at a time.
    id: "farmer",
    model: "barbarian",
    door: { x: 36.5, z: -8.9 },
    stops: [
      { x: 43.3, z: -6 },
      { x: 47.4, z: -5.5, wait: 14, clip: "Working_A", facing: EAST },
      { x: 47.4, z: -12, wait: 12, clip: "Working_A", facing: EAST },
      { x: 47.4, z: -17.5, wait: 14, clip: "Working_A", facing: EAST },
      { x: 43.3, z: -15 },
      { x: 38.5, z: -11, wait: 4, clip: "Idle_B" },
    ],
  },
  {
    // West of the avenue: water from the well, a look round the blue market, home.
    id: "well",
    model: "rogue",
    door: { x: -15.4, z: 28.9 },
    stops: [
      { x: -11.5, z: 26.5 },
      { x: -4.4, z: 28.4, wait: 5, clip: "Interact", facing: -2.3 },
      { x: -3.2, z: 31.2 },
      { x: -4.6, z: 33.4, wait: 7, clip: "Idle_A", facing: -1.0 },
      { x: -2, z: 29 },
      { x: -8.66, z: 25 },
      { x: -15.4, z: 28.9, wait: 6, clip: "Idle_B" },
    ],
  },
  {
    // East of the avenue: down the road to the red market and back.
    id: "market",
    model: "ranger",
    door: { x: 25.98, z: 18.8 },
    stops: [
      { x: 17.3, z: 20 },
      { x: 8.66, z: 25 },
      { x: 4.6, z: 31.3, wait: 8, clip: "Idle_A", facing: 1.3 },
      { x: 8.66, z: 25 },
      { x: 17.3, z: 20, wait: 3, clip: "Idle_B" },
      { x: 25.98, z: 18.8, wait: 5, clip: "Idle_A" },
    ],
  },
]
