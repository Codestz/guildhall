/** Data as the writer stores it: keys sorted at every depth, 2-space indent, final newline (biome-clean). */
export function formatData(value: unknown): string {
  const sorted = (_key: string, v: unknown): unknown =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v
  return `${JSON.stringify(value, sorted, 2)}\n`
}
