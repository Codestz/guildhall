import { key } from "../hex.ts"
import type { IslandRivers } from "../rivers/index.ts"

/**
 * Rivers on the hex-native mountains (relief style e). The water layer grades a river over a massif
 * down the slope of a smooth height field; the columns (columns.ts) have no slope to run down, so
 * the part of each river that runs over them is left out and the river rises at the range's foot,
 * where the lowland's hex-tiled reaches (rivers/dress.ts) begin. Falls that touch the range go with it.
 */
export function lowlandRivers(rivers: IslandRivers, massif: ReadonlySet<string>): IslandRivers | undefined {
  const over = (cell: readonly [number, number]): boolean => massif.has(key(cell))
  const reaches = rivers.waters.rivers.filter((reach) => !reach.hexes.some(({ cell }) => over(cell)))
  if (reaches.length === 0) return undefined
  const hexes = new Set(reaches.flatMap((reach) => reach.hexes.map(({ cell }) => key(cell))))
  return {
    waters: {
      ...rivers.waters,
      rivers: reaches,
      falls: rivers.waters.falls.filter((fall) => !over(fall.from) && !over(fall.to)),
    },
    hexes,
    bridges: new Map([...rivers.bridges].filter(([id]) => hexes.has(id))),
  }
}
