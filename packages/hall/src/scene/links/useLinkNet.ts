import { useMemo } from "react"
import { PROBE } from "../../guild/mode.ts"
import { type Archipelago, useArchipelago } from "../../world/archipelagoSource.ts"
import { type Wall, wallFrom } from "../../world/bridgeWalls.ts"
import type { LinkNet } from "../../world/linkNet.ts"
import { BRIDGE_MAX } from "../../world/linkStub.ts"
import { useWorld, worldSource } from "../../world/source.ts"
import { netFor } from "../../world/splitLinks.ts"

/** Probe builds only: `?bridgemax=150` bridges islands whose quays are that close (the stub's BRIDGE_MAX, world/linkStub.ts). */
export function bridgeMaxOf(): number {
  if (!PROBE || typeof location === "undefined") return BRIDGE_MAX
  const asked = Number(new URLSearchParams(location.search).get("bridgemax"))
  return asked > 0 ? asked : BRIDGE_MAX
}

/** The archipelago's links, made concrete once (world/splitLinks.ts `netFor`). */
export function useLinkNet(archipelago: Archipelago): LinkNet {
  return useMemo(() => netFor(archipelago, worldSource.world, bridgeMaxOf()), [archipelago])
}

const NONE: readonly Wall[] = []

/**
 * The bridges, as walls in the coordinates of the island being drawn (its own `WorldScope`, else the
 * home island): where its ships must not sail (world/bridgeWalls.ts). None outside an archipelago.
 */
export function useBridgeWalls(): readonly Wall[] {
  const archipelago = useArchipelago()
  const world = useWorld()
  return useMemo(() => {
    if (!archipelago) return NONE
    const net = netFor(archipelago, worldSource.world, bridgeMaxOf())
    const centre = archipelago.islands.find((island) => island.world === world)?.at ?? archipelago.home.at
    return net.walls.map((wall) => wallFrom(wall, centre))
  }, [archipelago, world])
}
