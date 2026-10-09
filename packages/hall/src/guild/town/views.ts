import { ARCHETYPES } from "@guildhall/roster"
import { placeOf, seedOf } from "../../world/behaviours.ts"
import { districtById, districtPlaceOf, siteOfDistrict, tradeOf } from "../../world/districtWork.ts"
import type { Post, Spot } from "../../world/layout.ts"
import { spread } from "../../world/sharers.ts"
import { HARBOUR, type Resident } from "../../world/town/townsfolk.ts"
import type { World } from "../../world/world.ts"
import { initials, type Names } from "../casting.ts"
import type { AdventurerView } from "../views.ts"

/**
 * The townsfolk as the cast draws them (ADR 0013): each resident (world/town/townsfolk.ts) as an
 * AdventurerView, so the hall's own figures, crowd, chips and routines carry them unchanged.
 *
 *   busy      at work at one of their district's posts (a hash of their login picks which), running
 *             its trade's loop; more of them than posts stand in the sharers' rows round it
 *   quiet     resting round the harbour's square, on the open ground past its workers' rows
 *   leaving   walking down to the quay, where they dissolve aboard the ferry
 *   arriving  (just come) they step off the ferry at the quay and walk to wherever they belong
 */

/** The party every resident is in: never an agent party's id. */
export const TOWN_PARTY = "town"
/** Quiet residents take the harbour's sharer laps from here on, past any of its own workers'. */
const RESTING_FROM = 12
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
  /** Quiet ones round each harbour berth so far. */
  const resting = new Map<number, number>()
  return residents.map((r) => {
    const view = viewOf(r, world, names, enter, landing, leaving, resting)
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
  resting: Map<number, number>,
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
    if (work) return { ...base, phase: "working", craft: "edit" as const, ...work }
  }
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
 * A quiet resident's spot round the harbour: a berth by their login, then the next lap of its
 * sharers' open ground (world/sharers.ts) past RESTING_FROM, facing the square.
 */
function restingSpot(r: Resident, world: World, resting: Map<number, number>): Post {
  const harbour = districtById(HARBOUR, world)
  const posts = harbour?.posts ?? []
  if (!harbour || posts.length === 0) return landingOf(world)
  const berth = seedOf(r.id) % posts.length
  const post = posts[berth] as Post
  const site = siteOfDistrict(HARBOUR, world)
  const place = site ? placeOf(site, undefined, post, world) : districtPlaceOf(HARBOUR, post, world)
  const lap = RESTING_FROM + (resting.get(berth) ?? 0)
  resting.set(berth, lap - RESTING_FROM + 1)
  const [dx, dz] = place ? spread(place, lap) : ([0, 0] as Spot)
  const x = round(post[0] + dx)
  const z = round(post[1] + dz)
  return [x, z, Math.atan2(harbour.at[0] - x, harbour.at[1] - z)]
}

const round = (value: number): number => Math.round(value * 100) / 100

/** Two views that draw the same figure (a level or two down: the target, the entrance). */
function same(a: AdventurerView, b: AdventurerView): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
