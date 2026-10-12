import type { DirectionalLight } from "three"

/**
 * The WebGL cascade lights, nearest first (CascadeKey.tsx), for the TSL materials that read their
 * maps (`?tsl=1`: grassNodes.ts `keyShadow`). Empty when the key is one box, and on WebGPU, whose
 * cascades are one light's own shadow node (cascadeShadowNode.ts).
 */
export const cascadeKey: { lights: DirectionalLight[] } = { lights: [] }
