/**
 * The demo agents on the hex island (track B; real repo events drive them in track D): three heroes,
 * a class each (decisions.md "Hex plan go": Claude = mage, others knight / ranger), with a banner colour
 * and a little scripted round of errands from the Guildhall square to the places their work touches
 * (docs → monastery, tests → camp, assets → harbour, infra → mine, app → market).
 */
import type { AgentErrand, AgentSpec } from "@guildhall/world"

export interface DemoAgent extends AgentSpec {
  /** The NPC recipe its props and clips come from (data/npcs). */
  recipe: string
  errands: AgentErrand[]
}

export const DEMO_AGENTS: readonly DemoAgent[] = [
  {
    id: "claude",
    name: "Claude",
    hero: "kaykit-adventurers/mage",
    recipe: "mage",
    colour: "#d97757",
    errands: [
      { place: "market", work: 40, idle: 6 },
      { place: "monastery", work: 35, idle: 12 },
    ],
  },
  {
    id: "warden",
    name: "Warden",
    hero: "kaykit-adventurers/knight",
    recipe: "guard",
    colour: "#4f7cc9",
    // tests → the camp; a knight spars at the training arena (wherever it landed), else works the camp
    errands: [{ place: "camp", scene: "training-arena", work: 45, idle: 10 }],
  },
  {
    id: "scout",
    name: "Scout",
    hero: "kaykit-adventurers/ranger",
    recipe: "archer",
    colour: "#5f9e4a",
    errands: [
      { place: "harbour", work: 30, idle: 4 },
      { place: "mine", work: 30, idle: 8 },
    ],
  },
]
