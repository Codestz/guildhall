/** Composition metadata (Look bar #2): how a piece sits in a street, a wall run or a roofline. */

/** A side of the piece, in piece space. */
export const FACINGS = ["+z", "-z", "+x", "-x"] as const
export type Facing = (typeof FACINGS)[number]

/** What a piece attaches to when composed. */
export const ATTACH_ROLES = [
  "free",
  "wall-segment",
  "corner",
  "gate",
  "roof",
  "edge-dressing",
  "floor",
  "ground",
  "held",
] as const
export type AttachRole = (typeof ATTACH_ROLES)[number]

/** What kind of boundary an edge-dressing piece draws. */
export const EDGE_KINDS = ["fence", "hedge", "wall", "cliff-face"] as const
export type EdgeKind = (typeof EDGE_KINDS)[number]

export const ANCHOR_KINDS = ["door", "window", "chimney", "sign", "socket", "station"] as const
export type AnchorKind = (typeof ANCHOR_KINDS)[number]

/** A named point on a piece: metres in piece space, facing in radians about +y. */
export interface Anchor {
  id: string
  kind: AnchorKind
  at: [x: number, y: number, z: number]
  facing: number
}

/** Where the compose meta came from; M1 fills it from rules and overrides, otherwise a placeholder. */
export const COMPOSE_SOURCES = ["placeholder", "rule", "manual", "vision"] as const
export type ComposeSource = (typeof COMPOSE_SOURCES)[number]

export interface ComposeMeta {
  front: Facing | null
  streetEdge: Facing | null
  attach: AttachRole
  edgeKind?: EdgeKind
  anchors: Anchor[]
  source: ComposeSource
}
