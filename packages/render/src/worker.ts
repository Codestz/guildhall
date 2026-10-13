/**
 * Render's three-free parts, for a worker to prepare what the main thread then only uploads
 * (`@guildhall/render/worker`): the shore field's bytes, a vertex mesh's colours and normals, and where
 * the event FX happen on an island.
 */
export { type Berth, type EventSites, eventSites, type HarbourSite, type PlaceSite } from "./events/sites.ts"
export { type ShoreWindow, shoreBytes, shoreDistances } from "./shoreDistance.ts"
export { srgbToLinear, type VertexMeshData, vertexMeshData } from "./vmeshData.ts"
