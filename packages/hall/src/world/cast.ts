/**
 * The character models the hall draws (an archetype's `model`, roster archetypes.ts, picks one).
 * The six adventurers are preloaded; what each holds is the archetype's `gear` (kit.glb pieces in
 * the rig's hand slots, scene/grips.ts).
 */
export const MODELS = ["knight", "barbarian", "mage", "rogue", "rogue-hooded", "ranger"] as const
export type Model = (typeof MODELS)[number]

export const modelUrl = (model: Model): string => `${import.meta.env.BASE_URL}assets/characters/${model}.glb`
export const ANIMS_URL = `${import.meta.env.BASE_URL}assets/anims.glb`
export const KIT_URL = `${import.meta.env.BASE_URL}assets/kit.glb`
export const LANDS_URL = `${import.meta.env.BASE_URL}assets/lands.glb`
/** The graveyard's props: always-visible scenery, loaded with the world. */
export const GRAVEYARD_URL = `${import.meta.env.BASE_URL}assets/graveyard.glb`
export const SHIPS_URL = `${import.meta.env.BASE_URL}assets/ships.glb`

/**
 * The undead (roadmap G1/G4): skeleton models and their own clips. Never preloaded: fetched the
 * first time the graveyard needs them (scene/Undead.tsx), outside the always-loaded budget.
 */
export const UNDEAD = ["warrior", "rogue", "mage", "minion"] as const
export type UndeadKind = (typeof UNDEAD)[number]
export const undeadUrl = (kind: UndeadKind): string =>
  `${import.meta.env.BASE_URL}assets/characters/skeleton-${kind}.glb`
export const UNDEAD_ANIMS_URL = `${import.meta.env.BASE_URL}assets/anims-undead.glb`

export function isModel(value: string): value is Model {
  return (MODELS as readonly string[]).includes(value)
}

/**
 * The Automaton's body (ADR 0010): KayKit's Skeleton_Minion on the adventurers' own rig (it plays
 * anims.glb as is), re-cast in bronze by scene/automaton.ts. Loaded on first need, like the undead:
 * the first bot on stage fetches it.
 */
export const AUTOMATON = "automaton"
export type Figure = Model | typeof AUTOMATON

/** The figure for an archetype's model key: anything unknown is drawn as a Wanderer. */
export function figureOf(model: string): Figure {
  return isModel(model) || model === AUTOMATON ? model : "rogue-hooded"
}

export const figureUrl = (figure: Figure): string =>
  figure === AUTOMATON ? undeadUrl("minion") : modelUrl(figure)
