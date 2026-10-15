/**
 * A file's language by extension, and a folder's dominant one: V1's world/gen/biomes.ts reduced to
 * the names a chronicle stores (`Unit.language`, `RepoMeta.languages`). The colours and building kits
 * stayed with V1's island; the names and the dominance rule are the same, so a rebuilt chronicle is
 * the same chronicle.
 */

export interface Language {
  name: string
}

const KNOWN: Record<string, string> = {}
const lang = (language: string, extensions: string): void => {
  for (const ext of extensions.split(" ")) KNOWN[ext] = language
}
lang("TypeScript", "ts tsx mts cts")
lang("JavaScript", "js jsx mjs cjs")
lang("Python", "py pyi ipynb")
lang("Rust", "rs")
lang("Go", "go")
lang("Java", "java")
lang("Kotlin", "kt kts")
lang("C", "c h")
lang("C++", "cc cpp cxx hpp hh")
lang("C#", "cs")
lang("Ruby", "rb")
lang("PHP", "php")
lang("Swift", "swift")
lang("Shell", "sh bash zsh")
lang("HTML", "html htm")
lang("CSS", "css scss sass less")
lang("Vue", "vue")
lang("Svelte", "svelte")
lang("Markdown", "md mdx")
lang("JSON", "json jsonc")
lang("YAML", "yml yaml")
lang("Dart", "dart")
lang("Lua", "lua")
lang("Zig", "zig")
lang("Elixir", "ex exs")
lang("Haskell", "hs")
lang("Scala", "scala")
lang("glTF", "glb gltf")
lang("Image", "png jpg jpeg webp gif svg ico")

const OTHER: Language = { name: "Other" }

/** A file's language, by extension; an unknown extension is named after itself (".foo"). */
export function languageOf(path: string): Language {
  const file = path.slice(path.lastIndexOf("/") + 1)
  const dot = file.lastIndexOf(".")
  if (dot <= 0) return OTHER
  const ext = file.slice(dot + 1).toLowerCase()
  const known = KNOWN[ext]
  return known ? { name: known } : { name: `.${ext}` }
}

/** Data and prose, not code: they win a folder only when it holds no code at all. */
const DATA = new Set(["Other", "JSON", "YAML", "Image", "glTF", "Markdown"])
const isData = (language: Language): boolean => DATA.has(language.name) || language.name.startsWith(".")

/**
 * A folder's language: the one with the most bytes, code before data and prose (a lockfile, images
 * or snapshots never outweigh the code beside them); names break ties.
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
