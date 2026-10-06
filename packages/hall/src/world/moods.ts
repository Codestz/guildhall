/**
 * The three directions from the art-direction board, as data. A mood is a palette plus a lighting
 * preset; the hall swaps them live until one is chosen (ADR 0005).
 */
export interface Mood {
  id: "keep" | "hearth" | "moonstone" | "arcane"
  name: string
  ground: string
  floor: string
  wall: string
  wood: string
  stone: string
  trim: string
  /** Main fill: hemisphere sky / ground colours and strength. */
  sky: string
  bounce: string
  ambient: number
  /** Key light (window or moon). */
  key: string
  keyIntensity: number
  /** Hearth / forge point lights. */
  fire: string
  fireIntensity: number
  /** Effects that read as magic: portals, spells. */
  magic: string
  plea: string
  /** The sea round the island, and the dirt of its roads. */
  sea: string
  road: string
  /** Post-processing: only what is brighter than this glows; vignette strength. */
  bloomThreshold: number
  vignette: number
}

export const MOODS: Record<Mood["id"], Mood> = {
  keep: {
    id: "keep",
    sea: "#6fb0d6",
    road: "#c9a27a",
    name: "Morning Keep",
    ground: "#cfdcee",
    floor: "#b7c2d2",
    wall: "#8c9ab0",
    wood: "#b08257",
    stone: "#9ba8bb",
    trim: "#f6f0e2",
    sky: "#e3efff",
    bounce: "#7c8aa0",
    ambient: 1.25,
    key: "#fff1d6",
    keyIntensity: 2.8,
    fire: "#ffa94a",
    fireIntensity: 8,
    magic: "#2fb4e8",
    plea: "#ffb020",
    bloomThreshold: 1.05,
    vignette: 0.3,
  },
  hearth: {
    id: "hearth",
    sea: "#2b3a44",
    road: "#6e5238",
    name: "Candlelit Hearth",
    ground: "#1b130e",
    floor: "#5a3d28",
    wall: "#3b2a1f",
    wood: "#8a5d36",
    stone: "#7a6b5c",
    trim: "#e8d4a8",
    sky: "#ffe2b0",
    bounce: "#2a1d14",
    ambient: 0.55,
    key: "#ffd28a",
    keyIntensity: 1.1,
    fire: "#ff9a3c",
    fireIntensity: 26,
    magic: "#7fd3c4",
    plea: "#ffd166",
    bloomThreshold: 0.85,
    vignette: 0.65,
  },
  moonstone: {
    id: "moonstone",
    sea: "#1c2a40",
    road: "#4f4a48",
    name: "Moonlit Stone",
    ground: "#0f131c",
    floor: "#3b4352",
    wall: "#262d3b",
    wood: "#6b5a4c",
    stone: "#7a8496",
    trim: "#c9d3e6",
    sky: "#a9c1ee",
    bounce: "#141a26",
    ambient: 0.4,
    key: "#a9c1ee",
    keyIntensity: 1.3,
    fire: "#ffb04a",
    fireIntensity: 30,
    magic: "#9fe3ff",
    plea: "#ffd166",
    bloomThreshold: 0.85,
    vignette: 0.65,
  },
  arcane: {
    id: "arcane",
    sea: "#251d3d",
    road: "#4a3f5e",
    name: "Arcane Workshop",
    ground: "#110e1b",
    floor: "#2f2742",
    wall: "#211b31",
    wood: "#5a4a6e",
    stone: "#6c6390",
    trim: "#ffcf6b",
    sky: "#b8a4ff",
    bounce: "#120e1e",
    ambient: 0.45,
    key: "#3fd0c9",
    keyIntensity: 0.9,
    fire: "#3fd0c9",
    fireIntensity: 30,
    magic: "#3fd0c9",
    plea: "#ffcf6b",
    bloomThreshold: 0.8,
    vignette: 0.6,
  },
}
