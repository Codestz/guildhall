import { ARCHETYPES } from "@guildhall/roster"
import { seedOf } from "../../world/behaviours.ts"
import { districtById, siteOfDistrict, tradeOf } from "../../world/districtWork.ts"
import { facing, Ground } from "../../world/folk/spots.ts"
import { hikes, lookoutPost } from "../../world/hikes.ts"
import { GATE, type Post, type Spot } from "../../world/layout.ts"
import { HARBOUR, type Resident } from "../../world/town/townsfolk.ts"
import { venuesIn } from "../../world/venues.ts"
import type { World } from "../../world/world.ts"
import { initials, type Names } from "../casting.ts"
import type { AdventurerView } from "../views.ts"
import { type Visit, Visits } from "../visits.ts"

/**
 * The townsfolk as the cast draws them (ADR 0022): each resident (world/town/townsfolk.ts) as an
 * AdventurerView, so the hall's own figures, crowd, chips and routines carry them unchanged.
 *
 *   busy      at work at one of their district's posts (a hash of their login picks which), running
 *             its trade's loop; more of them than posts stand in the sharers' rows round it; and on
 *             a gen 2 island they call in at their district's venue now and then (scene/visit.ts)
 *   quiet     resting about their own district's square (the harbour's, then the gate's, when it is full)
 *   leaving   walking down to the quay, where they dissolve aboard the ferry
 *   arriving  (just come) they step off the ferry at the quay and walk to wherever they belong
 */

/** The party every resident is in: never an agent party's id. */
export const TOWN_PARTY = "town"
/** Rings of standing room round a square for the resting, and how far apart they stand. */
const REST_RINGS = Array.from({ length: 9 }, (_, n) => 3.6 + n * 1.6)
const REST_APART = 2
const GATE_AT: Spot = [GATE[0], GATE[1]]
/** Of the quiet ones, this share sit on the ground; the rest stand about. */
const SITTING = 0.6

/** Where someone steps off the ferry: the quay's planks, a little in from its end, facing inland. */
export function landingOf(world: World): Post {
  const dock = world.island.landmarks.find((mark) => mark.kind === "dock")
  const [x, z] = dock ? [dock.x, dock.z - 2] : [0, 0]
  return [x, z, Math.PI]
}

/** Each resident's view (`previous`: the last ones, kept by identity where nothing changed). */
export function townViewsOf(
  residents: readonly Resident[],
  world: World,
  names: Names,
  enter: boolean,
  previous: ReadonlyMap<string, AdventurerView> = new Map(),
): AdventurerView[] {
  const landing = landingOf(world)
  const leaving: Post = [landing[0], landing[1] + 1.5, 0]
  /** Who rests where: each their own spot. */
  const resting = new Ground(world)
  const venues = new Visits(venuesIn(world))
  const venueOf = new Map(venuesIn(world).map((venue) => [venue.district, venue]))
  return residents.map((r) => {
    const venue = venueOf.get(r.district)
    const view = viewOf(r, world, names, enter, landing, leaving, resting, venue && venues.to(venue).visit)
    const before = previous.get(r.id)
    return before && same(before, view) ? before : view
  })
}

function viewOf(
  r: Resident,
  world: World,
  names: Names,
  enter: boolean,
  landing: Post,
  leaving: Post,
  resting: Ground,
  visit?: Visit,
): AdventurerView {
  const archetype = ARCHETYPES[r.archetype]
  const named = names === "world"
  const base = {
    id: r.id,
    agent: r.login,
    title: named ? `${archetype.name} · ${r.login}` : r.login,
    role: named ? archetype.name : r.login,
    subtitle: named ? r.login : "",
    glyph: named ? archetype.glyph : initials(r.login),
    plural: named ? archetype.plural : r.login,
    archetype: r.archetype,
    rank: r.rank,
    ordinal: 1,
    color: archetype.color,
    character: archetype.model,
    master: false,
    thinking: false,
    doing: r.home ? `${r.home === HARBOUR ? "" : r.home}/` : "",
    stung: false,
    party: TOWN_PARTY,
    banner: archetype.color,
    ...(enter && r.arriving && r.presence !== "leaving"
      ? { enter: { kind: "gate" as const, at: landing } }
      : {}),
  }
  if (r.presence === "leaving") return { ...base, phase: "leaving", target: leaving }
  if (r.presence === "busy") {
    const work = workPost(r, world)
    if (work)
      return { ...base, phase: "working", craft: "edit" as const, ...work, ...(visit ? { visit } : {}) }
  }
  // Some of the Scouts, when not at work, climb to a lookout on the island's trails and take the view (world/hikes.ts).
  const hike = r.archetype === "scout" && hikes(r.id) ? lookoutPost(world, r.id) : undefined
  if (hike) return { ...base, phase: "idle", target: hike }
  const sit = (seedOf(r.id) % 1000) / 1000 < SITTING
  return {
    ...base,
    phase: sit ? "resting" : "idle",
    target: restingSpot(r, world, resting),
    ...(sit ? { seat: "floor" as const } : {}),
  }
}

/** A busy resident's post in their district: the story site's place when one stands there. */
function workPost(
  r: Resident,
  world: World,
): Pick<AdventurerView, "target" | "site" | "district"> | undefined {
  const district = districtById(r.district, world)
  if (!district || district.posts.length === 0) return undefined
  const target = district.posts[seedOf(r.id) % district.posts.length] as Post
  const site = siteOfDistrict(r.district, world)
  if (site) return { target, site }
  return { target, site: tradeOf(district), district: r.district }
}

/**
 * A quiet resident's spot: on the rings round their own district's square, a body and a half from
 * the next; when those are full, round the harbour's, the keep's gate, then any other district's. Facing the square.
 */
function restingSpot(r: Resident, world: World, ground: Ground): Post {
  const turn = (seedOf(r.id) % 628) / 100
  const others = (world.repo?.districts ?? []).map((district) => district.at)
  const centres = [districtById(r.district, world)?.at, districtById(HARBOUR, world)?.at, GATE_AT, ...others]
  for (const centre of centres) {
    if (!centre) continue
    const square: Spot = [centre[0], centre[1]]
    const at = ground.near(square, REST_RINGS, turn, REST_APART)
    if (at) return [at[0], at[1], facing(at, square)]
  }
  return landingOf(world)
}

const round = (value: number): number => Math.round(value * 100) / 100

/** Two views that draw the same figure (a level or two down: the target, the entrance). */
function same(a: AdventurerView, b: AdventurerView): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
