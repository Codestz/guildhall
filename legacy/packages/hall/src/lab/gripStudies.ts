import { CARRY_WALK } from "../scene/activity.ts"
import type { HeldPiece } from "../scene/grips.ts"
import type { Held, Tool } from "../world/behaviours.ts"
import type { Model } from "../world/cast.ts"

/**
 * The grip lab's studies (lab/gripLab.ts): one character, the items in its hands, and the clips
 * (and how far into each) it is frozen in, one column each.
 */

export type Item = { piece: HeldPiece } | { prop: Held | Tool }
export interface Study {
  model: Model
  items: Item[]
  /** [clip, fraction of its length] per column. */
  poses: [string, number][]
  axes?: boolean
  /** Frame the hands (close) or the whole figure. */
  close?: boolean
}

const walk: [string, number][] = [
  ["Walking_A", 0.25],
  ["Walking_A", 0.75],
]
const carry: [string, number][] = [
  [CARRY_WALK, 0.25],
  [CARRY_WALK, 0.75],
]

export const STUDIES: Record<string, Study> = {
  axes: {
    model: "knight",
    items: [],
    axes: true,
    close: true,
    poses: [
      ["Idle_A", 0],
      ["Pickaxing", 0.3],
      ["Sit_Chair_Idle", 0.2],
      [CARRY_WALK, 0.3],
      ["Use_Item", 0.4],
      ["Working_B", 0.4],
    ],
  },
  pickaxe: {
    model: "barbarian",
    items: [{ piece: "pickaxe" }],
    poses: [
      ["Pickaxing", 0.1],
      ["Pickaxing", 0.35],
      ["Pickaxing", 0.55],
      ["Pickaxing", 0.8],
      ["Idle_A", 0.3],
      ...walk.slice(0, 1),
    ],
  },
  axe: {
    model: "barbarian",
    items: [{ piece: "axe" }],
    poses: [
      ["Chopping", 0.1],
      ["Chopping", 0.3],
      ["Chopping", 0.5],
      ["Chopping", 0.8],
      ["Idle_A", 0.3],
      ...walk.slice(0, 1),
    ],
  },
  mug: {
    model: "rogue",
    items: [{ piece: "mug_full" }],
    poses: [
      ["Sit_Chair_Idle", 0.1],
      ["Sit_Chair_Idle", 0.5],
      ["Sit_Floor_Idle", 0.2],
      ["Sit_Floor_Idle", 0.6],
      ["Sit_Chair_Down", 1],
    ],
    close: true,
  },
  lantern: {
    model: "knight",
    items: [{ piece: "lantern" }],
    poses: [...walk, ["Running_A", 0.3], ["Idle_A", 0.3], ["Idle_B", 0.5], ["Interact", 0.5]],
  },
  hammer: {
    model: "knight",
    items: [{ piece: "hammer_A" }],
    poses: [["Hammering", 0.1], ["Hammering", 0.4], ["Hammering", 0.7], ["Idle_A", 0.3], ...walk],
  },
  staff: {
    model: "mage",
    items: [{ piece: "staff" }],
    poses: [
      ["Idle_A", 0.3],
      ["Ranged_Magic_Summon", 0.5],
      ["Ranged_Magic_Spellcasting", 0.3],
      ["Waving", 0.4],
      ...walk,
    ],
  },
  wand: {
    model: "mage",
    items: [{ piece: "wand" }],
    poses: [
      ["Idle_A", 0.3],
      ["Ranged_Magic_Spellcasting", 0.3],
      ["Ranged_Magic_Raise", 0.6],
      ["Working_B", 0.4],
      ...walk,
    ],
  },
  dagger: {
    model: "rogue",
    items: [{ piece: "dagger" }],
    poses: [["Idle_A", 0.3], ["Lockpicking", 0.4], ["Interact", 0.5], ["Working_A", 0.4], ...walk],
  },
  crossbow: {
    model: "ranger",
    items: [{ piece: "crossbow_1handed" }],
    poses: [["Idle_A", 0.3], ["Idle_B", 0.5], ["Interact", 0.5], ["Working_B", 0.4], ...walk],
  },
  map: {
    model: "rogue-hooded",
    items: [{ piece: "map_rolled" }],
    poses: [["Idle_A", 0.3], ["Interact", 0.5], ["Working_B", 0.4], ["Ranged_Magic_Summon", 0.5], ...walk],
  },
  spellbooks: {
    model: "mage",
    items: [{ piece: "spellbook_open" }],
    poses: [
      ["Idle_A", 0.3],
      ["Idle_B", 0.5],
      ["Working_B", 0.4],
      ["Ranged_Magic_Spellcasting", 0.3],
      ...walk,
    ],
  },
  spellbook_closed: {
    model: "mage",
    items: [{ piece: "spellbook_closed" }],
    poses: [["Idle_A", 0.3], ["Idle_B", 0.5], ["Working_B", 0.4], ["Interact", 0.5], ...walk],
  },
  shield: {
    model: "knight",
    items: [{ piece: "shield_badge_color" }],
    poses: [["Idle_A", 0.3], ["Idle_B", 0.5], ["Working_A", 0.4], ["Interact", 0.5], ...walk],
  },
  book: {
    model: "mage",
    items: [{ prop: "book" }],
    poses: [
      ["Working_B", 0.15],
      ["Working_B", 0.5],
      ["Working_A", 0.4],
      ["Idle_B", 0.5],
      ["Interact", 0.6],
      carry[0] as [string, number],
    ],
  },
  note: {
    model: "rogue",
    items: [{ prop: "note" }],
    poses: [["Working_B", 0.2], ["Working_B", 0.6], ["Idle_B", 0.5], ["Interact", 0.6], ...carry],
  },
  loads: {
    model: "barbarian",
    items: [{ prop: "log" }],
    poses: [...carry, ["PickUp", 0.6], ["Holding_A", 0.3]],
  },
  stone: { model: "barbarian", items: [{ prop: "stone" }], poses: [...carry, ["PickUp", 0.6]] },
  plank: { model: "knight", items: [{ prop: "plank" }], poses: [...carry, ["PickUp", 0.6]] },
  produce: { model: "rogue", items: [{ prop: "produce" }], poses: [...carry, ["PickUp", 0.6]] },
  crate: { model: "rogue", items: [{ prop: "crate" }], poses: [...carry, ["PickUp", 0.6]] },
  fish: {
    model: "ranger",
    items: [{ prop: "fish" }],
    poses: [["Fishing_Catch", 0.6], ["Fishing_Catch", 0.9], ...carry, ["PickUp", 0.6]],
  },
  rod: {
    model: "ranger",
    items: [{ prop: "rod" }],
    poses: [
      ["Fishing_Cast", 0.2],
      ["Fishing_Cast", 0.7],
      ["Fishing_Idle", 0.4],
      ["Fishing_Reeling", 0.4],
      ["Fishing_Catch", 0.3],
      walk[0] as [string, number],
    ],
  },
  bow: {
    model: "ranger",
    items: [{ prop: "bow" }],
    poses: [
      ["Ranged_Bow_Draw", 0.7],
      ["Ranged_Bow_Aiming_Idle", 0.4],
      ["Ranged_Bow_Release", 0.2],
      ["Idle_B", 0.5],
      ["Interact", 0.5],
      walk[0] as [string, number],
    ],
  },
  hoe: {
    model: "barbarian",
    items: [{ prop: "hoe" }],
    poses: [
      ["Digging", 0.1],
      ["Digging", 0.35],
      ["Digging", 0.6],
      ["Digging", 0.85],
      ["Idle_A", 0.3],
      walk[0] as [string, number],
    ],
  },
  bucket: {
    model: "rogue",
    items: [{ prop: "bucket" }],
    poses: [
      ["Use_Item", 0.2],
      ["Use_Item", 0.5],
      ["Use_Item", 0.8],
      ["Idle_A", 0.3],
      ["Interact", 0.5],
      walk[0] as [string, number],
    ],
  },
  spear: {
    model: "knight",
    items: [{ prop: "spear" }],
    poses: [["Idle_A", 0.2], ["Idle_A", 0.7], ["Idle_B", 0.5], ["Waving", 0.4], ...walk],
  },
  broom: {
    model: "mage",
    items: [{ prop: "broom" }],
    poses: [["Working_A", 0.2], ["Working_A", 0.6], ["Interact", 0.5], ["Idle_B", 0.5], ...walk],
  },
  // A master's finer tools (roster archetypes.ts `master`), on the archetype's own model.
  masterHammer: {
    model: "barbarian",
    items: [{ piece: "hammer" }],
    poses: [["Hammering", 0.1], ["Hammering", 0.4], ["Idle_A", 0.3], ...walk],
  },
  masterSword: {
    model: "rogue",
    items: [{ piece: "sword_1handed" }],
    poses: [["Idle_A", 0.3], ["Melee_1H_Attack_Chop", 0.4], ...walk],
  },
  masterShield: {
    model: "ranger",
    items: [{ piece: "crossbow_1handed" }, { piece: "shield_A" }],
    poses: [["Idle_A", 0.3], ["Interact", 0.5], ...walk],
  },
  masterGlass: {
    model: "rogue-hooded",
    items: [{ piece: "wand" }, { piece: "magnifying_glass" }],
    poses: [["Idle_A", 0.3], ["Interact", 0.5], ...walk],
  },
  masterCompass: {
    model: "knight",
    items: [{ piece: "drafting_compass" }, { piece: "spellbook_open" }],
    poses: [["Idle_A", 0.3], ["Working_A", 0.4], ...walk],
  },
  masterCandle: {
    model: "mage",
    items: [{ piece: "candle_lit" }, { piece: "spellbook_closed" }],
    poses: [["Idle_A", 0.3], ["Interact", 0.5], ...walk],
  },
  masterJournal: {
    model: "knight",
    items: [{ piece: "map_rolled" }, { piece: "journal_open" }],
    poses: [["Idle_A", 0.3], ["Interact", 0.5], ...walk],
  },
}
