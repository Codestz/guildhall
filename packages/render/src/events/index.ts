/**
 * The world's event FX (plan-hud-events §2 "Events in the world", task F1): CI as weather
 * (`createSkyDrive`), pull requests as ships at the harbour (`createHarbourShips`), work as scaffolds
 * at the busy places (`createScaffolds`), and where they happen on an island (`eventSites`). Each is
 * off until made; made and at rest (a clear sky, no ships, nothing busy) it draws nothing and writes
 * nothing, so the picture is the island's own.
 */
export { boltPath, flashAt, nextStrike, STRIKE_S } from "./bolt.ts"
export { clamp01, easeIn, easeOut, random, smooth01, type Transition, transition } from "./ease.ts"
export {
  afloat,
  FLEET,
  type HarbourReading,
  harbourChanges,
  planFleet,
  prKey,
  type ShipEnd,
  type ShipLog,
  type Voyage,
  type VoyagePose,
  voyagePose,
} from "./fleet.ts"
export { RAIN_FAR, RAIN_STREAKS } from "./rain.ts"
export {
  BUILD_W,
  BUSY_PROGRESS,
  builtAt,
  createScaffolds,
  FLAG_ORDER,
  flagColour,
  PROGRESS_S,
  SCAFFOLD_NOMINAL,
  SCAFFOLD_S,
  type ScaffoldOpts,
  type ScaffoldPlace,
  type Scaffolds,
  scaffoldGeometry,
  scaffoldSize,
  scaffoldStage,
} from "./scaffold.ts"
export {
  createHarbourShips,
  type HarbourShips,
  type HarbourShipsOpts,
  pennantOf,
  SHIP_PIECE,
  type ShipView,
} from "./ships.ts"
export {
  type Berth,
  type EventSites,
  eventSites,
  type Footing,
  footing,
  type HarbourSite,
  HEART_REACH,
  type PlaceSite,
  type SiteOpts,
} from "./sites.ts"
export {
  createSkyDrive,
  type SkyDrive,
  type SkyDriveOpts,
  type SkyDriveStats,
  WEATHER_EASE_S,
} from "./skyDrive.ts"
export { patchSnowCover, SNOW_COVER } from "./snowCover.ts"
export {
  FROST_EASE_S,
  isClear,
  mixOf,
  pinOf,
  WEATHER_KINDS,
  type WeatherKind,
  type WeatherLook,
  type WeatherMix,
  weathered,
  weatherLook,
} from "./weather.ts"
