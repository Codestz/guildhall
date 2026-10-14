/**
 * The sea's life (world events, Task D): merchants on their laps, a push's cargo ship, a release's
 * galleon, the ghost ship and the pirate raid as shows, and the lighthouse's lamp for CI. Where they
 * sail (`seaSites`, worker-safe), when and how (plan.ts, pure), drawn in at most four draws (life.ts).
 */
export {
  createSeaLife,
  SEA_PIECES,
  type SeaLife,
  type SeaLifeOpts,
  type SeaView,
} from "./life.ts"
export {
  anchorage,
  cargoPose,
  cargoStarts,
  galleonPose,
  ghostPose,
  type Hull as SeaHull,
  type Lamp,
  lampOf,
  merchants,
  mooredBoat,
  type Path as SeaPath,
  type PrHull,
  type Push,
  pathOf,
  pointAt,
  prHull,
  raidPose,
  SEA,
  type SeaShow,
  type ShipPose,
} from "./plan.ts"
export { LAP_CLEAR, type Mooring, type SeaSites, seaSites } from "./sites.ts"
