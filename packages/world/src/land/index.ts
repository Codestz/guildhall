/** The landform, below the town and the island (ADR 011): coast, lakes, rough ground and the ground raster. M4's relief lands here. */
export { type Coast, type CoastBay, type CoastTown, islandCoast } from "./coast.ts"
export {
  GROUND_KINDS,
  type GroundGrid,
  type GroundKind,
  groundAt,
  groundGrid,
  type Landform,
  SHORE_BAND,
} from "./ground.ts"
export { lakes } from "./lakes.ts"
export { rough } from "./rough.ts"
