/** The windowing math behind the thumbnail grid: only the rows in (or near) view are rendered. */

export interface GridSpec {
  /** Viewport size in CSS pixels. */
  width: number
  height: number
  scrollTop: number
  count: number
  /** Smallest tile width; tiles stretch to fill the row. */
  minTile: number
  /** Tile height (fixed, so every row is the same height). */
  tileHeight: number
  gap: number
  /** Rows rendered beyond each edge of the view. */
  overscan: number
}

export interface GridWindow {
  columns: number
  tileWidth: number
  /** Tile height plus the gap. */
  rowHeight: number
  /** Scroll height of every row. */
  totalHeight: number
  /** The rendered items, `[first, end)`. */
  first: number
  end: number
}

export function gridWindow(spec: GridSpec): GridWindow {
  const { width, height, scrollTop, count, minTile, tileHeight, gap, overscan } = spec
  const columns = Math.max(1, Math.floor((width + gap) / (minTile + gap)))
  const tileWidth = Math.max(minTile, (width - gap * (columns - 1)) / columns)
  const rowHeight = tileHeight + gap
  const rows = Math.ceil(count / columns)
  const firstRow = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const endRow = Math.min(rows, Math.ceil((scrollTop + height) / rowHeight) + overscan)
  return {
    columns,
    tileWidth,
    rowHeight,
    totalHeight: Math.max(0, rows * rowHeight - gap),
    first: Math.min(count, firstRow * columns),
    end: Math.min(count, endRow * columns),
  }
}

/** The scrollTop that brings item `index` into view, or null when it already is. */
export function scrollToShow(
  index: number,
  view: GridWindow,
  scrollTop: number,
  height: number,
): number | null {
  const top = Math.floor(index / view.columns) * view.rowHeight
  const bottom = top + view.rowHeight
  if (top < scrollTop) return top
  if (bottom > scrollTop + height) return bottom - height
  return null
}
