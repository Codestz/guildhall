/**
 * Where each hex building's door is (decisions.md "doors are dynamic"), in the piece's own space
 * as the library imports it: the middle of the door's foot on its face, its width and height (metres),
 * and the way it looks (radians about +y, 0 = +z). Written by `bun tools/import/src/doors.ts <pack>` from
 * the meshes; do not edit by hand.
 */
export interface Doorway {
  x: number
  y: number
  z: number
  w: number
  h: number
  facing: number
}

/** By piece id without its colour. */
export const DOORWAYS: Readonly<Record<string, Doorway>> = {
  "kaykit-hexagon/building-archeryrange": { x: 2.71, y: 0.4, z: 2.424, w: 1.232, h: 2.352, facing: 0 },
  "kaykit-hexagon/building-barracks": { x: 0, y: 0.4, z: 5.33, w: 2.294, h: 3.457, facing: 0 },
  "kaykit-hexagon/building-blacksmith": { x: -2.91, y: 0.041, z: 0.116, w: 1.232, h: 2.352, facing: 0 },
  "kaykit-hexagon/building-castle": { x: 0, y: 0.4, z: 6.61, w: 2.293, h: 3.457, facing: 0 },
  "kaykit-hexagon/building-church": { x: 0, y: 0, z: 4.116, w: 1.232, h: 2.352, facing: 0 },
  "kaykit-hexagon/building-home-a": { x: 0, y: 0, z: 2.911, w: 1.232, h: 2.352, facing: 0 },
  "kaykit-hexagon/building-home-b": { x: 1.13, y: 1.68, z: 1.651, w: 1.232, h: 2.352, facing: 0 },
  "kaykit-hexagon/building-lumbermill": { x: -1.099, y: 1.708, z: -0.467, w: 1.232, h: 2.352, facing: 0 },
  "kaykit-hexagon/building-market": { x: 1.133, y: 0.045, z: 0.353, w: 1.232, h: 2.352, facing: 0 },
  "kaykit-hexagon/building-tavern": { x: -1.047, y: 1.68, z: 2.585, w: 1.232, h: 2.352, facing: 0 },
  "kaykit-hexagon/building-tower-a": { x: 0, y: 0.4, z: 4.013, w: 1.232, h: 2.352, facing: 0 },
  "kaykit-hexagon/building-tower-b": { x: 0, y: 0.4, z: 4.039, w: 1.232, h: 2.352, facing: 0 },
  "kaykit-hexagon/building-tower-base": { x: 0, y: 0.4, z: 3.844, w: 1.232, h: 2.352, facing: 0 },
  "kaykit-hexagon/building-tower-catapult": { x: 0, y: 0.4, z: 4.612, w: 1.232, h: 2.352, facing: 0 },
  "kaykit-hexagon/building-watermill": { x: -0.896, y: 1.68, z: 3.76, w: 1.232, h: 2.352, facing: -1.571 },
  "kaykit-hexagon/building-windmill": { x: -0.04, y: 0, z: 2.861, w: 1.232, h: 2.352, facing: 0 },
}

/** A building piece's door (any colour), or undefined for one with none found. */
export const doorwayOf = (piece: string): Doorway | undefined =>
  DOORWAYS[piece] ?? DOORWAYS[piece.replace(/-(red|blue|green|yellow)$/, "")]
