/**
 * People's shadows: a soft dark disc on the ground under each one (plan §5: NPCs are not cascade
 * casters, whose maps re-render only when the camera moves). One instanced draw for everyone, heroes
 * included, so a person handed between hero and crowd keeps the same shadow.
 */
import { InstancedMesh, Matrix4, PlaneGeometry, ShaderMaterial } from "three"

/** Disc radius per metre of height scale, and how dark its centre is. */
const RADIUS = 0.42
const STRENGTH = 0.42
/** Over the ground overlays (+1–3 cm) and under the feet. */
const LIFT = 0.035

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv * 2.0 - 1.0;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`

const FRAGMENT = /* glsl */ `
uniform float uStrength;
varying vec2 vUv;
void main() {
  float d = dot(vUv, vUv);
  float a = uStrength * (1.0 - smoothstep(0.15, 1.0, d));
  if (a < 0.003) discard;
  gl_FragColor = vec4(0.0, 0.0, 0.0, a);
}`

export interface Blobs {
  mesh: InstancedMesh
  /** Puts blob `i` under feet at (x, y, z) for a person `scale` tall (1 = the body's own size). */
  place(i: number, x: number, y: number, z: number, scale: number): void
  /** Draws the first `n` blobs. */
  setCount(n: number): void
  dispose(): void
}

export function createBlobs(capacity: number): Blobs {
  const geometry = new PlaneGeometry(2, 2).rotateX(-Math.PI / 2)
  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: { uStrength: { value: STRENGTH } },
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })
  const mesh = new InstancedMesh(geometry, material, Math.max(1, capacity))
  mesh.name = "crowd:blobs"
  mesh.count = 0
  mesh.frustumCulled = false
  mesh.castShadow = false
  mesh.receiveShadow = false
  // Drawn after the opaque ground it darkens.
  mesh.renderOrder = 1
  const m = new Matrix4()
  return {
    mesh,
    place(i, x, y, z, scale) {
      const r = RADIUS * scale
      m.makeScale(r, 1, r).setPosition(x, y + LIFT, z)
      mesh.setMatrixAt(i, m)
      mesh.instanceMatrix.needsUpdate = true
    },
    setCount(n) {
      mesh.count = Math.min(n, mesh.instanceMatrix.count)
    },
    dispose() {
      mesh.removeFromParent()
      geometry.dispose()
      material.dispose()
    },
  }
}
