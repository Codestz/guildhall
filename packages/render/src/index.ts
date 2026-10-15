export {
  ATMOSPHERE,
  type Atmosphere,
  type AtmosphereOpts,
  type AtmosphereParams,
  cloudLook,
  createAtmosphere,
  createHorizon,
  DEFAULT_ATMOSPHERE,
  type DeckOpts,
  deckHeight,
  type Horizon,
  patchCloudShade,
} from "./atmosphere/index.ts"
export {
  type BatchCluster,
  type BatchInstance,
  createStaticBatch,
  instanceMatrix,
  type StaticBatch,
  warmBatchPrograms,
} from "./batch.ts"
export { setLod } from "./batchMesh.ts"
export { cameraToPose, poseToCamera } from "./camera.ts"
export { armTrack, CARRY_WALK, carryClip, withCarry } from "./character/carry.ts"
export { type Character, createCharacter, loadCharacter, loadClips, type PlayOpts } from "./character/load.ts"
export { attachMount, detachMount, type Mounted, mountClip, mountPose } from "./character/mount.ts"
export { createNpc, dressNpc, type Npc, type NpcActivity, type NpcProp } from "./character/npc.ts"
export { keepUpright } from "./character/upright.ts"
export {
  type ActorSample,
  type Crowd,
  type CrowdActor,
  type CrowdLibrary,
  type CrowdOpts,
  type CrowdStats,
  createCrowd,
  propShown,
  RATE_MAX,
  strideRate,
  strideStep,
  warmCrowdPrograms,
} from "./crowd/index.ts"
export {
  createDoorways,
  createGates,
  type DoorwayRect,
  type Doorways,
  FRAME,
  GATE_PIECES,
  GATE_SWING,
  type Gates,
  gateFrame,
} from "./doors.ts"
export * from "./events/index.ts"
export { createGizmo, type Gizmo, type GizmoMode, type GizmoOpts, type GizmoPose } from "./gizmo.ts"
export { QUALITY_DPR, type QualityPick, qualityDpr, qualityOf } from "./governor.ts"
export { divisorFor, PACE_PICKS, type PacePick, paceOf } from "./pace.ts"
export { disposeObject, heroSilhouette, testBox } from "./hero.ts"
export {
  applyLight,
  type DayLight,
  GOLDEN_HOUR,
  keyLight,
  lightAt,
  moonAt,
  sunAt,
} from "./light.ts"
export type { LodCounts } from "./lod.ts"
export { discMarker, hexOutline, spotMarker } from "./markers.ts"
export { paletteMaterial } from "./material.ts"
export { group, loadModel, type Measure, measure, poseModel } from "./model.ts"
export {
  createNight,
  GLOW_SWATCHES,
  type LampLit,
  litLevel,
  MAX_LIGHTS,
  type Night,
  type NightOpts,
  type NightStats,
  setGlow,
  setNightGrade,
  windowsDark,
} from "./night/index.ts"
export { loadPiece } from "./pieces.ts"
export {
  bustCamera,
  createPortraits,
  type PortraitOpts,
  type PortraitSpec,
  type PortraitStats,
  type Portraits,
  portraitKey,
} from "./portrait.ts"
export {
  createPost,
  DEFAULT_POST_LOOK,
  type MoodId,
  type Post,
  type PostAa,
  type PostLook,
  type PostOpts,
  STILL_SUPERSAMPLE,
} from "./post/index.ts"
export * from "./props/index.ts"
export {
  REGION_CHANNELS,
  type RegionChannel,
  type RegionFieldData,
  regionBytes,
} from "./regionField.ts"
export { patchRegionTint, REGION_TINT, setRegionField } from "./regionTint.ts"
export {
  createReveal,
  DEFAULT_SPAN as REVEAL_SPAN,
  NEVER as REVEAL_NEVER,
  type PlaceAt,
  placesTexture,
  type Reveal,
  type RevealLook,
  type RevealMesh,
  RISE_METRES,
} from "./reveal.ts"
export { framedTarget } from "./rig/frame.ts"
export { blendPose, type FreeState, lookVector, type Rig, type RigMode, type RigMove } from "./rig/index.ts"
export {
  clampEye,
  clampOrbit,
  distanceRange,
  elevationRange,
  floorAt,
  LIMITS as RIG_LIMITS,
  restingTilt,
  type World,
  zoomFraction,
  zoomTilt,
} from "./rig/world.ts"
export * from "./sea/index.ts"
export {
  applySeason,
  BLOSSOM_FROM,
  createSeasonDrive,
  dayOfYear,
  harvestShow,
  pieceVertices,
  SEASON_AT,
  SEASON_NAMES,
  type SeasonDrive,
  type SeasonName,
  type SeasonPick,
  type SeasonWeights,
  seasonName,
  seasonOfDate,
  seasonPinOf,
  seasonStep,
  seasonWeights,
  treeHash,
  wrapSeason,
} from "./season.ts"
export { createShadows, fitShadowCamera, type ShadowBox } from "./shadow.ts"
export {
  bakeShoreField,
  type ShoreField,
  type ShoreFieldData,
  type ShoreFieldOpts,
  type ShoreWindow,
  shoreBytes,
  shoreDistances,
  shoreFieldTexture,
} from "./shoreField.ts"
export * from "./shows/index.ts"
export { createSky, type Sky, type SkyPreset } from "./sky.ts"
export { createSlicer, NO_SLICE, type Slicer } from "./slice.ts"
export { createStage, type Disposable, type Stage, toScreen } from "./stage.ts"
export { createStills, flipRows, type StillShot, type StillStats, type Stills } from "./still.ts"
export {
  type Box,
  type CascadeFit,
  createSun,
  fitCascades,
  type Sun,
  type SunOpts,
  type SunStats,
} from "./sun/index.ts"
export {
  createHexGround,
  createSurface,
  type HexPrism,
  surfaceMaterial,
  type TerrainMesh,
} from "./terrain.ts"
export { boundingSphere, fitSphere, renderThumbnail, type ThumbnailOpts } from "./thumbnail.ts"
export type { Split, Timing, TimingSample } from "./timing.ts"
export { recolour, recolourPiece, swatchMapKey } from "./tint.ts"
export * from "./undead/index.ts"
export {
  createViewer,
  type Overlay,
  type ShowItem,
  type Viewer,
  type ViewerOpts,
  type ViewerStats,
} from "./viewer.ts"
export { createVertexMesh, groundMaterial } from "./vmesh.ts"
export { srgbToLinear, type VertexMeshData, vertexMeshData } from "./vmeshData.ts"
export {
  depthMaterialFor,
  prefetchPrograms,
  type WarmOptions,
  type WarmStage,
  warmPrograms,
  warmScene,
} from "./warm.ts"
export {
  createFieldWater,
  type FieldWaterOpts,
  MAX_WAKES,
  mergeWakes,
  type Wake,
  type Water,
  type WaterPool,
  type WaterReveal,
  wakeStrength,
} from "./water.ts"
export * from "./workfx/index.ts"
