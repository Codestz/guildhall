import { useFrame } from "@react-three/fiber"
import { useMemo } from "react"
import {
  AdditiveBlending,
  Color,
  IcosahedronGeometry,
  InstancedMesh,
  MathUtils,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from "three"
import type { Tier } from "../../guild/quality.ts"
import { useGuildStore } from "../../guild/useGuild.ts"
import type { Venue } from "../../world/venues.ts"
import { WIND_DIRECTION, wind } from "../atmosphere/wind.ts"
import { useOwnedMeshes } from "../owned.ts"
import { occupants } from "./occupancy.ts"
import { halo } from "./Windows.tsx"

/**
 * An occupied venue shows it (world-gen v2 §3.5, phase 1: nobody is drawn inside): its windows glow
 * and its chimneys smoke while anyone is in it, and go quiet when the last one comes out. Two
 * InstancedMeshes for the whole island — soft additive halos at the windows, and low-poly smoke
 * like the village's (scene/life/Smoke.tsx) — no lights, no shadows, nothing per frame but their
 * matrices. A venue nobody is in costs its instances and nothing else.
 */

const PUFFS: Record<Tier, number> = { 0: 3, 1: 4, 2: 5, 3: 6 }
const RISE = 5.2
const PERIOD_S = 6
/** How fast a venue lights and goes dark (a time constant's reciprocal, per second). */
const EASE = 2.2
/** The halo, world units across, at full glow. */
const HALO = 3.4

interface Lamp {
  at: Vector3
  venue: string
  /** 0 dark … 1 lit. */
  glow: number
  warmth: number
}
interface Flue {
  at: Vector3
  venue: string
  phase: number
  presence: number
}

export function Venues({ venues, tier }: { venues: readonly Venue[]; tier: Tier }) {
  const store = useGuildStore()
  const puffs = PUFFS[tier]
  const { lamps, flues } = useMemo(() => {
    const lamps: Lamp[] = []
    const flues: Flue[] = []
    venues.forEach((venue, v) => {
      venue.windows.forEach((w, n) => {
        lamps.push({
          at: new Vector3(w.x, w.y, w.z),
          venue: venue.id,
          glow: 0,
          warmth: ((v * 7 + n * 3) % 10) / 10,
        })
      })
      venue.chimneys.forEach((c, n) => {
        flues.push({
          at: new Vector3(c.x, c.y, c.z),
          venue: venue.id,
          phase: ((v * 5 + n * 2) % 10) / 10,
          presence: 0,
        })
      })
    })
    return { lamps, flues }
  }, [venues])

  const built = useOwnedMeshes(() => {
    const haloMaterial = new MeshBasicMaterial({
      map: halo(),
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      toneMapped: false,
      fog: false,
    })
    const halos = new InstancedMesh(new PlaneGeometry(1, 1), haloMaterial, Math.max(1, lamps.length))
    const smoke = new InstancedMesh(
      new IcosahedronGeometry(0.5, 1),
      new MeshStandardMaterial({
        color: "#d9dde3",
        roughness: 1,
        flatShading: true,
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
      }),
      Math.max(1, flues.length * puffs),
    )
    for (const mesh of [halos, smoke]) {
      mesh.frustumCulled = false
      mesh.castShadow = false
      mesh.receiveShadow = false
    }
    halos.renderOrder = 10
    halos.count = lamps.length
    smoke.count = flues.length * puffs
    return { meshes: [halos, smoke] }
  }, [lamps, flues, puffs])

  useFrame(({ camera, clock }, delta) => {
    const halos = built?.meshes[0] as InstancedMesh | undefined
    const smoke = built?.meshes[1] as InstancedMesh | undefined
    if (!halos || !smoke) return
    const dt = Math.min(delta, 0.1)
    const now = performance.now() / 1000
    const dark = 1 - MathUtils.smoothstep(store.environment.daylight, 0.12, 0.55)
    camera.getWorldQuaternion(facing)
    for (let i = 0; i < lamps.length; i++) {
      const lamp = lamps[i] as Lamp
      lamp.glow = MathUtils.damp(lamp.glow, occupants(lamp.venue, now) > 0 ? 1 : 0, EASE, dt)
      const size = HALO * (0.7 + 0.3 * lamp.glow)
      halos.setMatrixAt(i, matrix.compose(lamp.at, facing, scale.set(size, size, size)))
      warm
        .copy(EMBER)
        .lerp(CANDLE, lamp.warmth)
        .multiplyScalar(lamp.glow * (0.55 + 0.7 * dark))
      halos.setColorAt(i, warm)
    }
    halos.instanceMatrix.needsUpdate = true
    if (halos.instanceColor) halos.instanceColor.needsUpdate = true

    let k = 0
    const time = clock.elapsedTime
    for (const flue of flues) {
      flue.presence = MathUtils.damp(flue.presence, occupants(flue.venue, now) > 0 ? 1 : 0, 0.8, dt)
      for (let p = 0; p < puffs; p++) {
        const age = (time / PERIOD_S + flue.phase + p / puffs) % 1
        const bend = wind.strength * 4.5 * age ** 1.5
        position.set(
          flue.at.x + WIND_DIRECTION.x * bend + Math.sin(age * 9 + p) * 0.12,
          flue.at.y + 0.2 + age * RISE,
          flue.at.z + WIND_DIRECTION.z * bend,
        )
        const s =
          (0.9 + 0.3 * dark) *
          flue.presence *
          (0.35 + 1.4 * age) *
          Math.sin(Math.PI * Math.min(1, age * 1.15)) ** 0.6
        rotation.setFromAxisAngle(AXIS, age * 2 + p)
        smoke.setMatrixAt(k++, matrix.compose(position, rotation, scale.setScalar(Math.max(s, 0.0001))))
      }
    }
    smoke.instanceMatrix.needsUpdate = true
  })

  return (
    <>
      {built?.meshes.map((mesh) => (
        <primitive key={mesh.uuid} object={mesh} />
      ))}
    </>
  )
}

const EMBER = new Color("#ff9a3c")
const CANDLE = new Color("#ffd27a")
const warm = new Color()
const facing = new Quaternion()
const rotation = new Quaternion()
const matrix = new Matrix4()
const scale = new Vector3()
const position = new Vector3()
const AXIS = new Vector3(0.3, 1, 0.2).normalize()
