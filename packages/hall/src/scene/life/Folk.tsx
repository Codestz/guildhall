import { useFrame } from "@react-three/fiber"
import { Suspense, useEffect, useMemo, useRef, useState } from "react"
import { PROBE } from "../../guild/mode.ts"
import type { Tier } from "../../guild/quality.ts"
import { useGuildStore } from "../../guild/useGuild.ts"
import { seedOf } from "../../world/behaviours.ts"
import { folkShown } from "../../world/folk/census.ts"
import { windowLit } from "../../world/folk/day.ts"
import { populationOf } from "../../world/folk/plan.ts"
import type { Population } from "../../world/folk/types.ts"
import { route } from "../../world/paths.ts"
import { useWorld } from "../../world/source.ts"
import type { Venue } from "../../world/venues.ts"
import type { World } from "../../world/world.ts"
import { castedCrowd } from "../crowd/cast.ts"
import { FRAME } from "../frame.ts"
import { Barrows } from "./Barrows.tsx"
import { Critters } from "./Critters.tsx"
import type { Around } from "./folkWalk.ts"
import { occupants, occupy } from "./occupancy.ts"
import { raining } from "./rounds.ts"
import { Troupe } from "./troupe.ts"

/**
 * The folk of a gen 2 island (world/folk): the townsfolk who live in its houses and keep the world
 * clock's hours (out of the door at dawn, at work by day, in the square and the inn at dusk, home
 * at night with a window lit), and the animals beside them. Pure plan, no React per person: one
 * Troupe walks them all as members of the cast's baked crowd (Scene.tsx makes the crowd and gives
 * each member the mesh level its distance calls for), their barrows and the animals are one
 * instanced draw each. How many show is the quality tier's share of the island's plan.
 *
 * Draw calls: the crowd's own (shared with the cast), barrows 2, animals 1 per kind showing.
 */
export function Folk({ tier }: { tier: Tier }) {
  // `?folk=0`: nobody (a measurement's A/B, docs/perf-budget.md).
  return OFF ? null : <Townspeople tier={tier} />
}

const OFF = typeof location !== "undefined" && new URLSearchParams(location.search).get("folk") === "0"

function Townspeople({ tier }: { tier: Tier }) {
  const world = useWorld()
  const store = useGuildStore()
  const plan = usePlan(world)
  const folk = useMemo(() => folkShown(plan.folk, tier), [plan, tier])
  const critters = useMemo(() => folkShown(plan.critters, tier), [plan, tier])
  const troupe = useMemo(() => new Troupe(folk, aroundOf(world)), [folk, world])
  const lit = useMemo(
    () => (world.homes ?? []).map((home) => ({ id: home.id, unit: unit(home.id) })),
    [world],
  )
  useEffect(() => () => troupe.release(), [troupe])
  // Probes: `folk.troupe.walkers` (where each is, what it does), `folk.plan` (scripts/probe.ts eval).
  useEffect(() => {
    if (PROBE || import.meta.env.DEV) Object.assign(window, { folk: { troupe, plan, critters } })
  }, [troupe, plan, critters])

  const since = useRef(0)
  useFrame((_, delta) => {
    const now = performance.now() / 1000
    const hour = store.environment.hour
    troupe.frame(castedCrowd(), Math.min(delta, 0.1), hour, now, raining(store.environment.weather))
    // The houses nobody here lives in keep a window lit of an evening, as a town does.
    if (now - since.current < 0.25) return
    since.current = now
    for (const home of lit) if (windowLit(home.unit, hour)) occupy(home.id, "ambient", now)
  }, FRAME.WORLD)

  return (
    <group name="folk">
      <Barrows troupe={troupe} />
      <Suspense fallback={null}>
        <Critters critters={critters} />
      </Suspense>
    </group>
  )
}

const NOBODY: Population = { folk: [], critters: [] }

/**
 * The island's population, made a moment after it is on screen: working out where everyone stands
 * (once per island, ~0.1 s on top of the obstacles' own 0.3) is not worth a late first frame.
 */
function usePlan(world: World): Population {
  const [made, setMade] = useState<{ world: World; plan: Population } | null>(null)
  useEffect(() => {
    const wait = setTimeout(() => setMade({ world, plan: populationOf(world) }), 60)
    return () => clearTimeout(wait)
  }, [world])
  return made?.world === world ? made.plan : NOBODY
}

/** The roads, the venues' room and the ground, for the walkers. */
function aroundOf(world: World): Around {
  return {
    route: (from, to) => route(from, to, world.roads),
    crowded: (venue, cap) => occupants(venue, performance.now() / 1000) >= cap,
    ground: (x, z) => world.ground.heightAt(x, z),
  }
}

/** 0…1, stable per name. */
const unit = (id: string): number => (seedOf(id) % 1000) / 1000

/**
 * The homes as things that light: Venues.tsx glows a window while anyone is counted inside, so a
 * home is a venue with a window and no chimney (world/homes.ts).
 */
export function homeLamps(world: World): Pick<Venue, "id" | "windows" | "chimneys">[] {
  return (world.homes ?? []).map((home) => ({ id: home.id, windows: [home.window], chimneys: [] }))
}
