import { useFrame } from "@react-three/fiber"
import { useMemo } from "react"
import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  InstancedMesh,
  MathUtils,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from "three"
import { hash } from "../../guild/traces.ts"
import { useGuildStore } from "../../guild/useGuild.ts"
import { HEX_SCALE, island, type LandPiece } from "../../world/lands.ts"
import { useOwnedMeshes } from "../owned.ts"

/**
 * Lit windows (ADR 0007, Life): at dusk the village's windows glow, warm and HDR so bloom carries
 * them; through the night some go dark as people sleep, and the last few go out before dawn.
 * Each window is a pane on the façade plus a soft camera-facing halo, so a lit house reads from
 * the Diorama overview at midnight, not just up close. Two InstancedMeshes, unlit, no shadows.
 */
interface Pane {
  x: number
  y: number
  z: number
  w: number
  h: number
}

/**
 * Window glass in each house's own units: centre x, y, the wall's z, and size — measured from the
 * models (the triangles textured with the palette's glass texel; scripts can re-derive them).
 * Each is an arched pane: a 0.074 × 0.041 rectangle under a half-round top.
 */
const PANES: Partial<Record<LandPiece, readonly Pane[]>> = {}
const HOME_A: readonly Pane[] = [{ x: 0, y: 0.5185, z: 0.324, w: 0.076, h: 0.081 }]
const HOME_B: readonly Pane[] = [
  { x: -0.14, y: 0.4035, z: 0.241, w: 0.076, h: 0.081 },
  { x: 0, y: 0.9885, z: 0.241, w: 0.076, h: 0.081 },
]
for (const colour of ["blue", "red", "yellow", "green"]) {
  PANES[`building_home_A_${colour}` as LandPiece] = HOME_A
  PANES[`building_home_B_${colour}` as LandPiece] = HOME_B
}

interface Window {
  position: Vector3
  rotation: Quaternion
  w: number
  h: number
  /** Lights go out in this order through the night. */
  bedtime: number
  warmth: number
  glow: number
}

/** World units: big enough to read as a lit house from the Diorama overview. */
const HALO_SIZE = 5.5

export function Windows() {
  const store = useGuildStore()
  const windows = useMemo(() => {
    const out: Window[] = []
    for (const mark of island().landmarks) {
      if (mark.kind !== "home" || !mark.piece) continue
      const panes = PANES[mark.piece]
      if (!panes) continue
      const rot = mark.rot ?? 0
      const turn = new Quaternion().setFromAxisAngle(UP, rot)
      for (const pane of panes) {
        const local = new Vector3(pane.x, pane.y, pane.z + 0.004).multiplyScalar(HEX_SCALE)
        out.push({
          position: local.applyQuaternion(turn).add(new Vector3(mark.x, mark.y ?? 0, mark.z)),
          rotation: turn.clone(),
          w: pane.w * HEX_SCALE,
          h: pane.h * HEX_SCALE,
          bedtime: hash(out.length * 13 + 3),
          warmth: hash(out.length * 13 + 4),
          glow: 0,
        })
      }
    }
    return out
  }, [])
  // Panes and halos share one plane geometry (scene/owned.ts frees it once).
  const built = useOwnedMeshes(() => {
    const geometry = new PlaneGeometry(1, 1)
    const panes = new InstancedMesh(
      geometry,
      new MeshBasicMaterial({ toneMapped: false, fog: false }),
      windows.length,
    )
    const haloMaterial = new MeshBasicMaterial({
      map: halo(),
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      toneMapped: false,
      fog: false,
    })
    const halos = new InstancedMesh(geometry, haloMaterial, windows.length)
    panes.frustumCulled = false
    halos.frustumCulled = false
    halos.renderOrder = 10
    return { meshes: [panes, halos] }
  }, [windows])

  useFrame(({ camera }, delta) => {
    const glass = built?.meshes[0]
    const glows = built?.meshes[1]
    if (!glass || !glows) return
    const env = store.environment
    const dt = Math.min(delta, 0.1)
    const dark = 1 - MathUtils.smoothstep(env.daylight, 0.12, 0.55)
    // Share of households still up: nearly all in the evening, a few after midnight.
    const hour = env.hour
    const awake = hour >= 16 ? 0.95 - Math.max(0, hour - 22) * 0.1 : hour < 5 ? 0.75 - hour * 0.1 : 0.9
    camera.getWorldQuaternion(facing)
    let lit = 0
    for (let i = 0; i < windows.length; i++) {
      const win = windows[i] as Window
      const goal = dark > 0.02 && win.bedtime < awake ? dark : 0
      win.glow = MathUtils.damp(win.glow, goal, 1.2, dt)
      if (win.glow > 0.01) lit++
      scale.set(win.w, win.h, 1)
      glass.setMatrixAt(i, matrix.compose(win.position, win.rotation, scale))
      warm.copy(EMBER).lerp(CANDLE, win.warmth)
      tint
        .copy(DAY)
        .lerp(warm, Math.min(1, win.glow * 1.4))
        .multiplyScalar(1 + win.glow * 2.2)
      glass.setColorAt(i, tint)
      const size = HALO_SIZE * (0.6 + 0.4 * win.glow)
      glows.setMatrixAt(i, matrix.compose(win.position, facing, scale.set(size, size, size)))
      glows.setColorAt(i, tint.copy(warm).multiplyScalar(win.glow * 1.25))
    }
    glass.instanceMatrix.needsUpdate = true
    glows.instanceMatrix.needsUpdate = true
    if (glass.instanceColor) glass.instanceColor.needsUpdate = true
    if (glows.instanceColor) glows.instanceColor.needsUpdate = true
    // By day the models' own windows show: nothing of this is drawn.
    glass.visible = lit > 0
    glows.visible = lit > 0
  })

  return (
    <>
      {built?.meshes.map((mesh) => (
        <primitive key={mesh.uuid} object={mesh} />
      ))}
    </>
  )
}

const UP = new Vector3(0, 1, 0)
/** Dark glass by day; ember to candle at night. */
const DAY = new Color("#2c3640")
const EMBER = new Color("#ff9a3c")
const CANDLE = new Color("#ffd27a")
const warm = new Color()
const tint = new Color()
const facing = new Quaternion()
const matrix = new Matrix4()
const scale = new Vector3()

/** A soft round falloff, drawn once (the same light-in-the-air look as the hall's lamps; the venues' glow too). */
export function halo(): CanvasTexture {
  const size = 64
  const canvas = document.createElement("canvas")
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext("2d")
  if (context) {
    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    gradient.addColorStop(0, "rgba(255,255,255,0.9)")
    gradient.addColorStop(0.12, "rgba(255,255,255,0.45)")
    gradient.addColorStop(0.35, "rgba(255,255,255,0.12)")
    gradient.addColorStop(1, "rgba(255,255,255,0)")
    context.fillStyle = gradient
    context.fillRect(0, 0, size, size)
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}
