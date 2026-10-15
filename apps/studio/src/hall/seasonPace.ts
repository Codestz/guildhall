/**
 * The date whose season a playing history shows. Watch it grow runs years in seconds, so following the
 * day would flick the island through a season every second or so; while it plays, each chapter (era)
 * keeps one season, the season of the chapter's last day (as Legends' era pictures show it), and the
 * season drive eases between them. At rest, or while scrubbing, the bar's own day is shown as it is.
 */
export function playingSeasonDate(
  date: number,
  range: { start: number; end: number; markers: readonly { at: number; kind: string }[] },
): number {
  // the chapters' bounds: where each era opens, then the history's end
  const opens = range.markers
    .filter((m) => m.kind === "era" && m.at > range.start && m.at < range.end)
    .map((m) => m.at)
    .sort((a, b) => a - b)
  const next = opens.find((at) => at > date)
  return next ?? range.end
}
