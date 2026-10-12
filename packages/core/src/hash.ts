/** FNV-1a, 32 bits: the stable hash behind every "random" choice. */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** FNV-1a of the parts joined by `:`, so `hash(seed, cell, salt)` is the archive's `` hash(`${seed}:${cell}:${salt}`) ``. */
export const hash = (...parts: readonly (string | number)[]): number => fnv1a(parts.join(":"))

/**
 * A number in [0, 1) from a seed and what is being drawn (each choice has its own salt). FNV mixes the
 * last characters poorly: salts that differ only at the END (`tree:0` .. `tree:19`) come out in two
 * plateaus, so put the varying part FIRST and never reuse a salt string.
 */
export const roll = (seed: number, salt: string): number => hash(seed, salt) / 4294967296
