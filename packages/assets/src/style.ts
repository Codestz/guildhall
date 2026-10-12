/**
 * The house style (decisions.md "Clean restart on hex"): chunky, playful low-poly. Only these packs
 * build the world and show in the Studio; the rest stay imported (the old screens still read them)
 * but are out of the style. KayKit Medieval Hexagon leads.
 */
export const STYLE_PACKS: readonly string[] = [
  "kaykit-hexagon",
  "kaykit-forest",
  "kaykit-builder",
  "kaykit-resources",
  "kaykit-tools",
  "kaykit-furniture",
  "kaykit-adventurers",
  "kaykit-weapons",
  "kaykit-skeletons",
  "kaykit-dungeon",
  "kaykit-halloween",
  "kaykit-animations",
  "kenney-nature",
  "kenney-castle",
  "kenney-town",
  "kenney-graveyard",
  "kenney-survival",
  "kenney-pirate",
]

const IN_STYLE = new Set(STYLE_PACKS)

/** Whether a pack is in the house style. */
export const inStyle = (pack: string): boolean => IN_STYLE.has(pack)
