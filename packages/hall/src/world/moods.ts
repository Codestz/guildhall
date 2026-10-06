/**
 * The four directions from the art-direction board, as data (ADR 0005). A mood is a palette plus a
 * *grade*: it tints the light and the image on top of the time of day (ADR 0007), it never fixes
 * an absolute light level — so any mood at midnight is still night, and any mood at noon is day.
 * The hall swaps them live until one is chosen.
 */
export interface Mood {
  id: "keep" | "hearth" | "moonstone" | "arcane"
  name: string
  /** The swatch in the HUD's mood picker (with `fire`). */
  ground: string
  floor: string
  wall: string
  wood: string
  stone: string
  trim: string
  /** Hearth / forge fire and lamp flames. */
  fire: string
  fireIntensity: number
  /** Effects that read as magic: portals, spells. */
  magic: string
  plea: string
  /** The sea round the island, and the dirt of its roads. */
  sea: string
  road: string
  /** Light grade: the colour the sun, moon and sky light lean towards, and how far (0–1). */
  tint: string
  tintAmount: number
  /** Multipliers on the time of day's ambient fill and key light (sun or moon). */
  ambient: number
  key: number
  /** Image grade: split-tone colours for shadows and highlights, saturation and contrast. */
  shadows: string
  highlights: string
  saturation: number
  contrast: number
  /** Post-processing: only what is brighter than this glows; vignette strength. */
  bloomThreshold: number
  vignette: number
}

export const MOODS: Record<Mood["id"], Mood> = {
  keep: {
    id: "keep",
    name: "Morning Keep",
    ground: "#cfdcee",
    floor: "#b7c2d2",
    wall: "#8c9ab0",
    wood: "#b08257",
    stone: "#9ba8bb",
    trim: "#f6f0e2",
    fire: "#ffa94a",
    fireIntensity: 8,
    magic: "#2fb4e8",
    plea: "#ffb020",
    sea: "#6fb0d6",
    road: "#c9a27a",
    tint: "#ffffff",
    tintAmount: 0,
    ambient: 1,
    key: 1,
    shadows: "#ffffff",
    highlights: "#ffffff",
    saturation: 1,
    contrast: 1,
    bloomThreshold: 1,
    vignette: 0.28,
  },
  hearth: {
    id: "hearth",
    name: "Candlelit Hearth",
    ground: "#1b130e",
    floor: "#5a3d28",
    wall: "#3b2a1f",
    wood: "#8a5d36",
    stone: "#8a7a6a",
    trim: "#e8d4a8",
    fire: "#ff9a3c",
    fireIntensity: 14,
    magic: "#7fd3c4",
    plea: "#ffd166",
    sea: "#4f86a0",
    road: "#a98058",
    tint: "#ffcf96",
    tintAmount: 0.28,
    ambient: 0.9,
    key: 0.95,
    shadows: "#c8b0ac",
    highlights: "#ffe2b8",
    saturation: 1.0,
    contrast: 1.06,
    bloomThreshold: 0.9,
    vignette: 0.5,
  },
  moonstone: {
    id: "moonstone",
    name: "Moonlit Stone",
    ground: "#0f131c",
    floor: "#3b4352",
    wall: "#262d3b",
    wood: "#6b5a4c",
    stone: "#8590a3",
    trim: "#c9d3e6",
    fire: "#ffb04a",
    fireIntensity: 14,
    magic: "#9fe3ff",
    plea: "#ffd166",
    sea: "#4b7aa8",
    road: "#98918a",
    tint: "#b4c8ff",
    tintAmount: 0.3,
    ambient: 0.9,
    key: 0.92,
    shadows: "#9aaedc",
    highlights: "#e8f0ff",
    saturation: 0.82,
    contrast: 1.07,
    bloomThreshold: 0.9,
    vignette: 0.48,
  },
  arcane: {
    id: "arcane",
    name: "Arcane Workshop",
    ground: "#110e1b",
    floor: "#2f2742",
    wall: "#211b31",
    wood: "#5a4a6e",
    stone: "#857ea6",
    trim: "#ffcf6b",
    fire: "#3fd0c9",
    fireIntensity: 14,
    magic: "#3fd0c9",
    plea: "#ffcf6b",
    sea: "#5a69a8",
    road: "#94849e",
    tint: "#c8b4ff",
    tintAmount: 0.25,
    ambient: 0.92,
    key: 0.9,
    shadows: "#b4a6d6",
    highlights: "#d8fff8",
    saturation: 1.02,
    contrast: 1.07,
    bloomThreshold: 0.85,
    vignette: 0.5,
  },
}
