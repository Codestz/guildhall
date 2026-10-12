/**
 * Render's three-free parts, for a worker to prepare what the main thread then only uploads
 * (`@guildhall/render/worker`): the shore field's bytes and a vertex mesh's colours and normals.
 */
export { type ShoreWindow, shoreBytes, shoreDistances } from "./shoreDistance.ts"
export { srgbToLinear, type VertexMeshData, vertexMeshData } from "./vmeshData.ts"
