import { hash } from "./hex.ts"

/**
 * How a repo reads as land: each top-level folder is a district of one biome, each language a
 * colour. Known folder names get the biome their job suggests; any other name gets a stable biome
 * from its hash, so the same folder always grows the same land.
 */

export type Biome = "harbour" | "village" | "proving" | "library" | "quarry" | "forest" | "farms" | "wilds"

const NAMED: Record<string, Biome> = {}
const name = (biome: Biome, folders: string): void => {
  for (const folder of folders.split(" ")) NAMED[folder] = biome
}
name(
  "village",
  "src source lib libs app apps packages pkg pkgs cmd internal core server client components crates modules",
)
name("proving", "test tests spec specs __tests__ e2e bench benches benchmarks fixtures testing testdata")
name("library", "docs doc documentation wiki guides guide examples example website site book")
name("quarry", "assets public static media images img fonts resources res data")
name("forest", "vendor third_party third-party external extern deps node_modules")
name("farms", "scripts script tools bin ci .github .circleci config configs build infra deploy ops")

/** Where an unknown folder name may land: anything but the harbour (the root's) and the wilds. */
const UNKNOWN: readonly Biome[] = ["village", "forest", "farms", "library", "quarry", "proving"]

export function biomeOf(folder: string): Biome {
  return NAMED[folder.toLowerCase()] ?? UNKNOWN[hash(folder) % UNKNOWN.length] ?? "village"
}

/** The pack's building colours: a language's accent picks the nearest. */
export type KitColour = "blue" | "red" | "yellow" | "green"

export interface Language {
  name: string
  /** Its accent, #rrggbb (GitHub linguist's colour where it has one). */
  colour: string
  kit: KitColour
}

const KNOWN: Record<string, readonly [string, string]> = {}
const lang = (language: string, colour: string, extensions: string): void => {
  for (const ext of extensions.split(" ")) KNOWN[ext] = [language, colour]
}
lang("TypeScript", "#3178c6", "ts tsx mts cts")
lang("JavaScript", "#f1e05a", "js jsx mjs cjs")
lang("Python", "#3572a5", "py pyi ipynb")
lang("Rust", "#dea584", "rs")
lang("Go", "#00add8", "go")
lang("Java", "#b07219", "java")
lang("Kotlin", "#a97bff", "kt kts")
lang("C", "#555555", "c h")
lang("C++", "#f34b7d", "cc cpp cxx hpp hh")
lang("C#", "#178600", "cs")
lang("Ruby", "#701516", "rb")
lang("PHP", "#4f5d95", "php")
lang("Swift", "#f05138", "swift")
lang("Shell", "#89e051", "sh bash zsh")
lang("HTML", "#e34c26", "html htm")
lang("CSS", "#563d7c", "css scss sass less")
lang("Vue", "#41b883", "vue")
lang("Svelte", "#ff3e00", "svelte")
lang("Markdown", "#083fa1", "md mdx")
lang("JSON", "#292929", "json jsonc")
lang("YAML", "#cb171e", "yml yaml")
lang("Dart", "#00b4ab", "dart")
lang("Lua", "#000080", "lua")
lang("Zig", "#ec915c", "zig")
lang("Elixir", "#6e4a7e", "ex exs")
lang("Haskell", "#5e5086", "hs")
lang("Scala", "#c22d40", "scala")
lang("glTF", "#7a8f4b", "glb gltf")
lang("Image", "#a0a0a0", "png jpg jpeg webp gif svg ico")

const OTHER: Language = { name: "Other", colour: "#8a8a8a", kit: "blue" }

/** The pack colour nearest an accent's hue; greys default to blue. */
export function kitOf(colour: string): KitColour {
  const value = Number.parseInt(colour.slice(1), 16)
  const r = ((value >> 16) & 255) / 255
  const g = ((value >> 8) & 255) / 255
  const b = (value & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max - min < 0.15) return "blue"
  const d = max - min
  const hue =
    max === r ? (((g - b) / d + 6) % 6) * 60 : max === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60
  if (hue < 30 || hue >= 300) return "red"
  if (hue < 90) return "yellow"
  if (hue < 170) return "green"
  return "blue"
}

/** A file's language, by extension. Unknown extensions get a stable colour of their own. */
export function languageOf(path: string): Language {
  const file = path.slice(path.lastIndexOf("/") + 1)
  const dot = file.lastIndexOf(".")
  if (dot <= 0) return OTHER
  const ext = file.slice(dot + 1).toLowerCase()
  const known = KNOWN[ext]
  if (known) return { name: known[0], colour: known[1], kit: kitOf(known[1]) }
  const hue = hash(ext) % 360
  const colour = hsl(hue, 0.45, 0.5)
  return { name: `.${ext}`, colour, kit: kitOf(colour) }
}

function hsl(hue: number, s: number, l: number): string {
  const f = (n: number): string => {
    const k = (n + hue / 30) % 12
    const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, "0")
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

/** Data and prose, not code: they colour a folder only when it holds no code at all. */
const DATA = new Set(["Other", "JSON", "YAML", "Image", "glTF", "Markdown"])
const isData = (language: Language): boolean => DATA.has(language.name) || language.name.startsWith(".")

/**
 * A folder's accent: its language with the most bytes, code before data and prose (a lockfile,
 * images or snapshots never outweigh the code beside them); names break ties.
 */
export function dominant(
  bytesByLanguage: ReadonlyMap<string, { language: Language; bytes: number }>,
): Language {
  const entries = [...bytesByLanguage.values()].sort((a, b) => (a.language.name < b.language.name ? -1 : 1))
  const most = (list: typeof entries) =>
    list.reduce<(typeof entries)[number] | undefined>(
      (best, e) => (!best || e.bytes > best.bytes ? e : best),
      undefined,
    )
  const code = most(entries.filter((e) => !isData(e.language)))
  const known = most(entries.filter((e) => DATA.has(e.language.name) && e.language.name !== OTHER.name))
  const unknown = most(entries.filter((e) => e.language.name.startsWith(".")))
  return (code ?? known ?? unknown)?.language ?? OTHER
}
