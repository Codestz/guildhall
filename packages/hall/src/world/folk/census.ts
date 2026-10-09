import type { World } from "../world.ts"
import { populationOf, shown } from "./plan.ts"
import { ROLES, type Role, SPECIES, type Species } from "./types.ts"

/**
 * How many folk and animals an island shows at a quality tier, by role and species (the HUD's
 * "Life" line). Counts what the scene would draw, from the same plan, so the two never disagree.
 */
export interface Census {
  folk: number
  animals: number
  roles: Readonly<Record<Role, number>>
  species: Readonly<Record<Species, number>>
}

export function folkShown<T>(list: readonly T[], quality: 0 | 1 | 2 | 3): readonly T[] {
  return list.slice(0, shown(list.length, quality))
}

export function censusOf(world: World, quality: 0 | 1 | 2 | 3): Census {
  const population = populationOf(world)
  const folk = folkShown(population.folk, quality)
  const critters = folkShown(population.critters, quality)
  const roles = Object.fromEntries(ROLES.map((role) => [role, 0])) as Record<Role, number>
  const species = Object.fromEntries(SPECIES.map((kind) => [kind, 0])) as Record<Species, number>
  for (const person of folk) roles[person.role]++
  for (const critter of critters) species[critter.species]++
  return { folk: folk.length, animals: critters.length, roles, species }
}
