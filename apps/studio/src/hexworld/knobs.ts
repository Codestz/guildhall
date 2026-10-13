/**
 * The hex island's knobs, as the Viewer's Inspector draws them: every query key the island reads at
 * build (index.ts header), so a rebuild applies them together. Defaults are what the island builds with
 * when the key is absent (the size, `HEX_ISLAND_DEFAULTS`' shape, `NATURE_CHOSEN`'s nature, 1 for the
 * nature families it leaves at today's size).
 */
import type { KnobSection } from "@guildhall/ui"
import { HEX_ISLAND_DEFAULTS, LEVEL_STEP, NATURE_CHOSEN } from "@guildhall/world"

const times = (v: number) => `×${v.toFixed(2)}`

export const nature = (key: keyof typeof NATURE_CHOSEN | "pine" | "rock", label: string) => ({
  kind: "range" as const,
  key,
  label,
  min: 0.1,
  max: 4,
  step: 0.05,
  default: (NATURE_CHOSEN as Record<string, number | undefined>)[key] ?? 1,
  format: times,
  apply: "reload" as const,
})

/** The nature families' sizes, multipliers on what the tile prefabs author (`?tree=` … `?flower=`). */
export const NATURE_SIZES = [
  nature("tree", "Leaf trees"),
  nature("pine", "Pines"),
  nature("bush", "Bushes"),
  nature("rock", "Rocks"),
  nature("grass", "Grass"),
  nature("flower", "Flowers"),
]

/** The island's sections; `seedKey` is `town` on `/town/<seed>` (the path) and `seed` on the lab path. */
export function islandKnobs(seedKey: string): KnobSection[] {
  return [
    {
      title: "Island",
      knobs: [
        { kind: "stepper", key: seedKey, label: "Seed", min: 1, default: 1, apply: "reload" },
        {
          kind: "range",
          key: "files",
          label: "Repo files",
          hint: "The island grows with the repo",
          min: 100,
          max: 30000,
          step: 100,
          default: 4000,
          apply: "reload",
        },
        {
          kind: "range",
          key: "coast",
          label: "Coast shape",
          min: 0,
          max: 2,
          step: 0.05,
          default: HEX_ISLAND_DEFAULTS.coast,
          apply: "reload",
        },
        {
          kind: "range",
          key: "hills",
          label: "Hill levels",
          min: 0,
          max: 9,
          step: 1,
          default: HEX_ISLAND_DEFAULTS.hills,
          apply: "reload",
        },
        {
          kind: "range",
          key: "rain",
          label: "Rivers",
          min: 0.3,
          max: 3,
          step: 0.05,
          default: HEX_ISLAND_DEFAULTS.rain,
          apply: "reload",
        },
        {
          kind: "range",
          key: "forest",
          label: "Forest",
          min: 0,
          max: 0.7,
          step: 0.01,
          default: HEX_ISLAND_DEFAULTS.forest,
          apply: "reload",
        },
      ],
    },
    {
      title: "Nature",
      open: false,
      knobs: [...NATURE_SIZES, nature("woods", "Woods density"), nature("wild", "Wild share")],
    },
    {
      title: "Ground",
      open: false,
      knobs: [
        {
          kind: "segment",
          key: "ground",
          label: "Ground",
          default: "fine",
          options: [
            { value: "fine", label: "Fine" },
            { value: "hex", label: "Hex" },
            { value: "soft", label: "Soft" },
          ],
          apply: "reload",
        },
        {
          kind: "range",
          key: "step",
          label: "Level height",
          min: 0.2,
          max: 3,
          step: 0.05,
          default: LEVEL_STEP,
          format: (v) => `${v.toFixed(2)} m`,
          apply: "reload",
        },
        {
          kind: "toggle",
          key: "detail",
          label: "Ground detail",
          hint: "Painted small hexes and speckle",
          default: true,
          apply: "reload",
        },
      ],
    },
    {
      title: "Look",
      open: false,
      knobs: [
        {
          kind: "toggle",
          key: "post",
          label: "Post pipeline",
          hint: "Bloom, grade, vignette",
          default: true,
          apply: "reload",
        },
        {
          kind: "segment",
          key: "aa",
          label: "Anti-aliasing",
          default: "smaa",
          options: [
            { value: "smaa", label: "SMAA" },
            { value: "msaa", label: "MSAA" },
            { value: "none", label: "None" },
          ],
          apply: "reload",
        },
        {
          kind: "range",
          key: "shadow",
          label: "Shadow",
          min: 0,
          max: 2,
          step: 0.05,
          default: 1,
          apply: "reload",
        },
        {
          kind: "range",
          key: "fill",
          label: "Fill light",
          min: 0,
          max: 2,
          step: 0.05,
          default: 0.75,
          apply: "reload",
        },
      ],
    },
    {
      // atmo.ts `atmoKnobs`: the sea mist, the warm haze and the cloud ring, each 0–2
      title: "Air",
      open: false,
      knobs: [
        { kind: "toggle", key: "atmo", label: "Mist, haze and clouds", default: true, apply: "reload" },
        {
          kind: "range",
          key: "mist",
          label: "Sea mist",
          min: 0,
          max: 2,
          step: 0.05,
          default: 1,
          format: times,
          apply: "reload",
        },
        {
          kind: "range",
          key: "haze",
          label: "Haze",
          min: 0,
          max: 2,
          step: 0.05,
          default: 1,
          format: times,
          apply: "reload",
        },
        {
          kind: "range",
          key: "clouds",
          label: "Clouds",
          min: 0,
          max: 2,
          step: 0.05,
          default: 1,
          format: times,
          apply: "reload",
        },
      ],
    },
    {
      title: "Life & overlays",
      knobs: [
        {
          kind: "toggle",
          key: "life",
          label: "Life",
          hint: "Townsfolk and agents",
          default: true,
          apply: "reload",
        },
        {
          kind: "toggle",
          key: "spots",
          label: "Activity spots",
          hint: "Every spot and blocker drawn",
          default: false,
          apply: "reload",
        },
        {
          kind: "toggle",
          key: "collide",
          label: "Collision layer",
          hint: "What walkers steer round",
          default: false,
          apply: "reload",
        },
      ],
    },
  ]
}

/** Hours as a clock reads them: 15.5 → "15:30". */
export const clock = (h: number): string => {
  const now = ((h % 24) + 24) % 24
  return `${String(Math.floor(now)).padStart(2, "0")}:${String(Math.floor((now % 1) * 60)).padStart(2, "0")}`
}
