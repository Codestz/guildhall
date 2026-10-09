/** Marks on an adventurer's name chip (scene/Adventurer.tsx): its rank's pips and its party's pennant. */

/** A rank's pips on the chip: small brass diamonds after the name, gilded for a master. */
export function Pips({ n }: { n: number }) {
  return (
    <span className="pips" data-n={n} aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: identical marks, fixed order
        <i key={i} />
      ))}
    </span>
  )
}

/** The chip's party mark: a small swallowtail banner hanging from the plate's top-left corner. */
export function Pennant({ color }: { color: string }) {
  return (
    <svg className="pennant" width="9" height="14" viewBox="0 0 9 14" aria-hidden="true">
      <path d="M0.5 0.5h8v12.6l-4-3.2-4 3.2z" fill={color} stroke="rgba(12,9,7,0.85)" strokeWidth="1" />
    </svg>
  )
}
