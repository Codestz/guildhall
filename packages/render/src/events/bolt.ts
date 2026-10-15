/**
 * Lightning: a strike's brightness over time (pure, V1's: a sharp flash, then a weaker flicker) and
 * its bolt, a jagged ribbon from the cloud base down to what it strikes, with a branch or two. The
 * ribbon is rebuilt at each strike (a few dozen vertices) and drawn only while it flashes: one draw,
 * a fraction of a second every several seconds, none otherwise.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from "three"
import type { Stage } from "../stage.ts"
import { warmPrograms } from "../warm.ts"
import { random } from "./ease.ts"

/** How long a strike lasts, seconds. */
export const STRIKE_S = 0.42

function pulse(ms: number, from: number, to: number): number {
  if (ms < from || ms > to) return 0
  return Math.sin(((ms - from) / (to - from)) * Math.PI)
}

/** A strike's brightness `s` seconds after it (0 … 1): a flash, then a weaker after-flicker. */
export function flashAt(s: number): number {
  const ms = s * 1000
  return Math.min(1, pulse(ms, 0, 90) + 0.55 * pulse(ms, 160, 260) + 0.3 * pulse(ms, 300, 420))
}

/** The seconds until the next strike: 4 to 11, from the stream `next`. */
export function nextStrike(next: () => number): number {
  return 4 + 7 * next()
}

/**
 * A bolt's points from `top` down to `bottom`: `segments` steps with sideways jags that shrink toward
 * the ground (so it lands on its mark), plus branches (each a short fork off a joint). Pure.
 */
export function boltPath(
  top: readonly [number, number, number],
  bottom: readonly [number, number, number],
  seed: number,
  segments = 18,
): { main: [number, number, number][]; branches: [number, number, number][][] } {
  const next = random(seed)
  const height = top[1] - bottom[1]
  const jag = height * 0.09
  const main: [number, number, number][] = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const spread = i === 0 || i === segments ? 0 : jag * (1 - 0.7 * t)
    main.push([
      top[0] + (bottom[0] - top[0]) * t + (next() - 0.5) * 2 * spread,
      top[1] + (bottom[1] - top[1]) * t,
      top[2] + (bottom[2] - top[2]) * t + (next() - 0.5) * 2 * spread,
    ])
  }
  const branches: [number, number, number][][] = []
  const count = 1 + Math.floor(next() * 2)
  for (let b = 0; b < count; b++) {
    const from = main[2 + Math.floor(next() * (segments * 0.5))] as [number, number, number]
    const heading = next() * Math.PI * 2
    const fork: [number, number, number][] = [from]
    let [x, y, z] = from
    for (let k = 0; k < 4; k++) {
      x += Math.cos(heading) * jag * (0.6 + next() * 0.5)
      z += Math.sin(heading) * jag * (0.6 + next() * 0.5)
      y -= (height / segments) * (0.8 + next() * 0.4)
      fork.push([x, y, z])
    }
    branches.push(fork)
  }
  return { main, branches }
}

export interface Bolt {
  /** Strikes from `top` to `bottom` now (`seed` shapes it). */
  strike(
    top: readonly [number, number, number],
    bottom: readonly [number, number, number],
    seed: number,
  ): void
  /** Shows it at this brightness (0 hides it). */
  show(brightness: number): void
  dispose(): void
}

/** Ribbon width, m, for the trunk and the branches. */
const WIDTH = 0.4
const MAX_POINTS = 64

export function createBolt(stage: Stage): Bolt {
  const position = new Float32Array(MAX_POINTS * 2 * 3 * 3)
  const geometry = new BufferGeometry()
  geometry.setAttribute("position", new BufferAttribute(position, 3))
  const colour = new Color(2.2, 2.4, 3.0)
  const material = new MeshBasicMaterial({
    color: colour,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    fog: false,
    toneMapped: false,
  })
  const mesh = new Mesh(geometry, material)
  mesh.name = "lightning"
  mesh.frustumCulled = false
  mesh.visible = false
  mesh.renderOrder = 11
  stage.scene.add(mesh)
  stage.timing.gpu.tag(mesh, "sky")
  // its program links in the background now (warm.ts), not in the first flash's frame
  void warmPrograms(stage, mesh)

  const side = new Vector3()
  const along = new Vector3()
  const toEye = new Vector3()
  /** Writes a polyline as camera-facing quads (two triangles a segment); returns the floats written. */
  const ribbon = (points: [number, number, number][], width: number, at: number): number => {
    const eye = stage.camera.position
    let o = at
    for (let i = 0; i + 1 < points.length && o + 18 <= position.length; i++) {
      const a = points[i] as [number, number, number]
      const b = points[i + 1] as [number, number, number]
      along.set(b[0] - a[0], b[1] - a[1], b[2] - a[2])
      toEye.set(eye.x - a[0], eye.y - a[1], eye.z - a[2])
      side.crossVectors(along, toEye).normalize()
      const w0 = width * (1 - (0.6 * i) / points.length)
      const w1 = width * (1 - (0.6 * (i + 1)) / points.length)
      const q = [
        [a[0] - side.x * w0, a[1] - side.y * w0, a[2] - side.z * w0],
        [a[0] + side.x * w0, a[1] + side.y * w0, a[2] + side.z * w0],
        [b[0] + side.x * w1, b[1] + side.y * w1, b[2] + side.z * w1],
        [b[0] - side.x * w1, b[1] - side.y * w1, b[2] - side.z * w1],
      ] as const
      for (const k of [0, 1, 2, 0, 2, 3]) {
        position.set(q[k] as readonly number[], o)
        o += 3
      }
    }
    return o
  }

  return {
    strike(top, bottom, seed) {
      const path = boltPath(top, bottom, seed)
      let o = ribbon(path.main, WIDTH, 0)
      for (const branch of path.branches) o = ribbon(branch, WIDTH * 0.5, o)
      geometry.setDrawRange(0, o / 3)
      ;(geometry.getAttribute("position") as BufferAttribute).needsUpdate = true
    },
    show(brightness) {
      mesh.visible = brightness > 0.02
      material.color.copy(colour).multiplyScalar(brightness)
    },
    dispose() {
      mesh.removeFromParent()
      geometry.dispose()
      material.dispose()
    },
  }
}
