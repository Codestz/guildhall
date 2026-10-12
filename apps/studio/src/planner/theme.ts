/**
 * The map's two looks: "colour" (a painted fantasy map in the shared palette's warm greens, cobble and
 * roof ramps, matching the 3D town) and "parchment" (sepia ink on old paper). Every colour the map draws
 * comes from here.
 */
import type { DistrictKind } from "@guildhall/world"
import type { Tones } from "./derive.ts"
import type { Look } from "./query.ts"

export interface Theme {
  look: Look
  table: string
  sheetShadow: string
  land: { base: string; light: string; dark: string; dry: string; lush: string }
  water: {
    deep: string
    mid: string
    shallow: string
    foam: string
    sand: string
    ripple: string
    ink: string
  }
  road: { fill: string; edge: string }
  street: { fill: string; edge: string; speck: [string, string] }
  plaza: { fill: string; joint: string }
  yard: Record<DistrictKind | "green" | "plaza", string>
  hedge: { base: string; light: string }
  fence: string
  lots: { line: string; garden: string }
  wall: { fill: string; top: string; edge: string; crenel: string; towerTop: string }
  keep: { stone: string; roof: Tones }
  shadow: string
  outline: string
  timber: Tones
  field: { soil: string; edge: string }
  /** When set, roofs ignore the palette and are drawn in these inks (parchment). */
  roofInk: Tones | null
  /** When set, trees are drawn as these inks (parchment). */
  treeInk: Tones | null
  /** Hatching over town blocks (parchment). */
  hatch: string | null
  ink: string
  halo: string
  frame: { band: string; line: string; tickA: string; tickB: string }
  vignette: string
  walk: { line: string; node: string }
  poi: { bg: string; fg: string; ring: string }
}

export const COLOUR: Theme = {
  look: "colour",
  table: "#120e0a",
  sheetShadow: "rgba(0, 0, 0, 0.6)",
  land: { base: "#92b54a", light: "#a8c75b", dark: "#7c9f3c", dry: "#b7b65c", lush: "#6c9638" },
  water: {
    deep: "#2b5a86",
    mid: "#3a7fa4",
    shallow: "#69b7c3",
    foam: "#eef8f3",
    sand: "#e3d199",
    ripple: "rgba(225, 244, 244, 0.32)",
    ink: "#e8f4f6",
  },
  road: { fill: "#c7a774", edge: "#8e7048" },
  street: { fill: "#d6cdbb", edge: "#7d7466", speck: ["#c4baa6", "#e4dccd"] },
  plaza: { fill: "#e0d6c2", joint: "#bdb29c" },
  yard: {
    residential: "#a6c45c",
    market: "#b3c262",
    craft: "#aab95a",
    harbour: "#cdbd8d",
    castle: "#b9b2a1",
    farm: "#a1c35a",
    green: "#88b04a",
    plaza: "#e0d6c2",
  },
  hedge: { base: "#3d6c2b", light: "#5d8d38" },
  fence: "#7a5634",
  lots: { line: "rgba(62, 48, 28, 0.38)", garden: "#94b84f" },
  wall: { fill: "#8c857a", top: "#b8b0a1", edge: "#38332d", crenel: "#5e574e", towerTop: "#a29b8e" },
  keep: { stone: "#9a958c", roof: ["#246099", "#2581bf", "#658ed7"] },
  shadow: "rgba(26, 34, 14, 0.32)",
  outline: "rgba(38, 24, 12, 0.62)",
  timber: ["#5d3827", "#814f3c", "#a86751"],
  field: { soil: "#9d7b4b", edge: "#6f5434" },
  roofInk: null,
  treeInk: null,
  hatch: null,
  ink: "#2c2114",
  halo: "rgba(250, 244, 226, 0.86)",
  frame: { band: "#e7d8b2", line: "#2c2114", tickA: "#2c2114", tickB: "#f4ead2" },
  vignette: "rgba(48, 32, 10, 0.22)",
  walk: { line: "rgba(196, 52, 38, 0.85)", node: "#c43426" },
  poi: { bg: "rgba(250, 244, 226, 0.94)", fg: "#2c2114", ring: "#8a6a2c" },
}

export const PARCHMENT: Theme = {
  look: "parchment",
  table: "#17110c",
  sheetShadow: "rgba(0, 0, 0, 0.6)",
  land: { base: "#e9dab3", light: "#f2e6c7", dark: "#dccb9d", dry: "#e2cf9c", lush: "#ddd2a4" },
  water: {
    deep: "#b3c4bd",
    mid: "#bfcfc6",
    shallow: "#cfdacd",
    foam: "#5d6f68",
    sand: "#e3d3a5",
    ripple: "rgba(70, 90, 84, 0.5)",
    ink: "#3e5550",
  },
  road: { fill: "#efe1bd", edge: "#7d6141" },
  street: { fill: "#f7efdc", edge: "#5c4630", speck: ["#efe5cd", "#fbf6e9"] },
  plaza: { fill: "#f4ead2", joint: "#cdbb94" },
  yard: {
    residential: "#e2d1a2",
    market: "#e5d3a1",
    craft: "#dfcd9c",
    harbour: "#e6d6a8",
    castle: "#dccaa0",
    farm: "#e2d3a6",
    green: "#d8cf9f",
    plaza: "#f4ead2",
  },
  hedge: { base: "#5c5a33", light: "#7d7a4a" },
  fence: "#6b5236",
  lots: { line: "rgba(80, 58, 32, 0.45)", garden: "#ddcf9f" },
  wall: { fill: "#5a4632", top: "#8a7254", edge: "#2e2216", crenel: "#2e2216", towerTop: "#7a6448" },
  keep: { stone: "#8a7254", roof: ["#3e2c1c", "#5a4632", "#7a6448"] },
  shadow: "rgba(92, 64, 30, 0.2)",
  outline: "rgba(46, 34, 22, 0.85)",
  timber: ["#4a3826", "#6b5236", "#8a7254"],
  field: { soil: "#e3d2a2", edge: "#7d6141" },
  roofInk: ["#4b3420", "#6e5034", "#8f704c"],
  treeInk: ["#5a4a2c", "#c9c38d", "#ddd8a8"],
  hatch: "rgba(110, 82, 46, 0.22)",
  ink: "#2e2216",
  halo: "rgba(244, 234, 210, 0.9)",
  frame: { band: "#e9dab3", line: "#2e2216", tickA: "#2e2216", tickB: "#f4ead2" },
  vignette: "rgba(96, 60, 20, 0.34)",
  walk: { line: "rgba(150, 40, 30, 0.85)", node: "#962819" },
  poi: { bg: "rgba(244, 234, 210, 0.95)", fg: "#2e2216", ring: "#6b5236" },
}

export const themeOf = (look: Look): Theme => (look === "parchment" ? PARCHMENT : COLOUR)

/** A crop's field colours (base, row stripe) by its id: wheat gold, corn straw, greens for the rest. */
export function cropTones(crop: string, theme: Theme): [string, string] {
  if (theme.look === "parchment") return ["#e8d8a8", "rgba(110, 82, 46, 0.45)"]
  if (/wheat|barley|grain/.test(crop)) return ["#d8bd5f", "#b39a43"]
  if (/corn|maize/.test(crop)) return ["#cbbf55", "#8f9a3c"]
  if (/pumpkin/.test(crop)) return ["#9c8a4a", "#d58a35"]
  if (/carrot/.test(crop)) return ["#9d7b4b", "#86ad45"]
  if (/tomato/.test(crop)) return ["#9d7b4b", "#6f9b3e"]
  if (/lettuce|cabbage/.test(crop)) return ["#9d7b4b", "#9cc85a"]
  return ["#a8a256", "#7d8a3e"]
}
