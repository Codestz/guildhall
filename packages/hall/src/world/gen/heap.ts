/**
 * A binary min-heap ordered by `before` (true when `a` must come out ahead of `b`): the open set of
 * the generator's road search (plan/roads.ts) and of the walking graph's (world/paths.ts).
 */
export class Heap<T> {
  private items: T[] = []

  constructor(private readonly before: (a: T, b: T) => boolean) {}

  get size(): number {
    return this.items.length
  }

  push(item: T): void {
    const items = this.items
    items.push(item)
    let i = items.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      const above = items[parent] as T
      if (!this.before(item, above)) break
      items[i] = above
      i = parent
    }
    items[i] = item
  }

  /** The first item out, or undefined when empty. */
  pop(): T | undefined {
    const items = this.items
    const top = items[0]
    const last = items.pop()
    if (top === undefined || last === undefined || items.length === 0) return top
    let i = 0
    for (;;) {
      const at = (n: number): T => (n === i ? last : (items[n] as T))
      const left = 2 * i + 1
      const right = left + 1
      let first = i
      if (left < items.length && this.before(at(left), at(first))) first = left
      if (right < items.length && this.before(at(right), at(first))) first = right
      if (first === i) break
      items[i] = items[first] as T
      i = first
    }
    items[i] = last
    return top
  }
}
