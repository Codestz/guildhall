import type { Archipelago } from "./archipelagoSource.ts"
import { DMath } from "./dmath.ts"
import { type LinkNet, netOf } from "./linkNet.ts"
import { BRIDGE_MAX, berthSideOf, type LinkSet, linkSetOf, PIER, type Quay } from "./linkStub.ts"
import type { World } from "./world.ts"

/**
 * The links an archipelago draws. A repo split into packages (`?repo=…&split`) brings its own
 * (world/repoArchipelago.ts: which islands are joined, bridge or ferry, and the quay of each on
 * its coast); the plain `?archipelago` has none, and they are derived from its neighbours
 * (world/linkStub.ts). Either way: the shapes of `LinkSet`.
 */
export function linksOf(archipelago: Archipelago, home: World, bridgeMax = BRIDGE_MAX): LinkSet {
  return archipelago.links.length > 0
    ? splitLinkSet(archipelago, home)
    : linkSetOf(archipelago, home, bridgeMax)
}

/** A split archipelago's own links, with each quay made concrete (its pier, the ground, the side a boat berths). */
export function splitLinkSet(archipelago: Archipelago, home: World): LinkSet {
  const sources = [
    { info: archipelago.home, world: home },
    ...archipelago.islands.map((island) => ({
      info: island as typeof archipelago.home,
      world: island.world,
    })),
  ]
  const quaysOf = (info: (typeof sources)[number]["info"], world: World): Record<string, Quay> =>
    Object.fromEntries(
      info.quays.map((quay) => {
        const facing = DMath.atan2(quay.facing[0], quay.facing[1])
        const end: Quay["end"] = [
          quay.local[0] + quay.facing[0] * PIER,
          quay.local[1] + quay.facing[1] * PIER,
        ]
        return [
          quay.partner,
          {
            land: quay.at,
            end: [quay.at[0] + quay.facing[0] * PIER, quay.at[1] + quay.facing[1] * PIER],
            facing,
            height: world.ground.heightAt(quay.local[0], quay.local[1]),
            berthSide: berthSideOf(world, end, facing),
          } satisfies Quay,
        ]
      }),
    )
  return {
    islands: sources.map(({ info, world }) => ({
      id: info.id,
      center: info.at,
      reach: info.reach,
      quays: quaysOf(info, world),
    })),
    links: archipelago.links,
  }
}

const nets = new WeakMap<Archipelago, { bridgeMax: number; net: LinkNet }>()

/** The links made concrete (world/linkNet.ts), once per archipelago: the scene's bridges, docks, ferries and ships all read this one. */
export function netFor(archipelago: Archipelago, home: World, bridgeMax = BRIDGE_MAX): LinkNet {
  const known = nets.get(archipelago)
  if (known && known.bridgeMax === bridgeMax) return known.net
  const net = netOf(linksOf(archipelago, home, bridgeMax))
  nets.set(archipelago, { bridgeMax, net })
  return net
}
