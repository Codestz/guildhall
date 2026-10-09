/**
 * Island batches every placement whose piece its models have, and skips the rest. A skipped piece
 * is a hole in the island with no error anywhere (a far island of a generator whose kit was never
 * loaded, a piece renamed in the catalogue only): in dev it is told, once per piece.
 */

/** The distinct pieces of `placements` that `nodes` has no model for. */
export function missingPieces(
  nodes: Readonly<Record<string, unknown>>,
  placements: readonly { piece: string }[],
): string[] {
  return [...new Set(placements.map((p) => p.piece))].filter((piece) => !(piece in nodes))
}

const told = new Set<string>()

/** Dev only: warn of pieces that have no model, once each. Returns those newly told. */
export function reportMissing(
  pieces: readonly string[],
  dev: boolean = import.meta.env?.DEV === true,
  warn: (text: string) => void = console.warn,
): string[] {
  if (!dev) return []
  const fresh = pieces.filter((piece) => !told.has(piece))
  for (const piece of fresh) told.add(piece)
  if (fresh.length > 0) warn(`Island: no model for ${fresh.join(", ")}; its placements are not drawn`)
  return fresh
}
