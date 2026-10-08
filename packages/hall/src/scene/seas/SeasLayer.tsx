import { useGLTF } from "@react-three/drei"
import { useFrame } from "@react-three/fiber"
import { useEffect, useMemo } from "react"
import {
  AdditiveBlending,
  Color,
  ConeGeometry,
  DynamicDrawUsage,
  Euler,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  OctahedronGeometry,
  Quaternion,
  SphereGeometry,
  Vector3,
} from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import { useGuildStore } from "../../guild/useGuild.ts"
import { LANDS_URL, SHIPS_URL } from "../../world/cast.ts"
import { HEX_SCALE } from "../../world/lands.ts"
import { useWorld } from "../../world/source.ts"
import { bakeNode, hash01 } from "../events/common.ts"
import { FRAME } from "../frame.ts"
import { useOwnedMeshes } from "../owned.ts"
import { SEA_Y, watersOf } from "../Ships.tsx"
import {
  FLOURISH_MS,
  type Harbour,
  type Hull,
  harbourOf,
  harbourSpotOf,
  lampOf,
  lighthouseSpot,
  MAX_CRATES,
  MAX_SHIPS,
  seaAt,
  toWorld,
  type Voyage,
} from "./fleet.ts"

/** The sea's own pieces (scripts/assets.ts `seas`): loaded with this module, only when a guild has a sea. */
export const SEAS_URL = `${import.meta.env.BASE_URL}assets/seas.glb`

/** Each hull: its Kenney ship, scale and how deep it sits (model units, as scene/Ships.tsx). */
const HULLS: Record<Hull, { piece: string; scale: number; draft: number }> = {
  cargo: { piece: "ship-small", scale: 0.95, draft: 1.0 },
  pr: { piece: "ship-medium", scale: 1, draft: 1.0 },
  galleon: { piece: "ship-large", scale: 1.25, draft: 1.1 },
}
/** Deck height in the ships' own units, and where the crates stand on it (x, z). */
const DECK_Y = 2.3
const CRATE_SPOTS: readonly (readonly [number, number])[] = [
  [-0.75, 1.6],
  [0.75, 1.6],
  [-0.75, -0.2],
  [0.75, -0.2],
  [-0.75, -2],
  [0.75, -2],
]
const CRATE_SCALE = 1.1
/** The lighthouse: the hex pack's tower at the island's scale, its lamp a beacon on the roof's point. */
const LAMP_Y = 11.8
const BEAM_LENGTH = 70
const SPARKS = 48

const dummy = {
  position: new Vector3(),
  quaternion: new Quaternion(),
  scale: new Vector3(),
  euler: new Euler(),
  matrix: new Matrix4(),
  local: new Matrix4(),
  out: new Matrix4(),
  color: new Color(),
}

/**
 * The GitHub sea (scene/seas/fleet.ts says what sails when): a few instanced layers, so a busy
 * repo costs no more than a quiet one. Draw calls: one per hull kind on the water, one for all the
 * crates, the galleon's gold, the lighthouse (tower, lamp, beam) and the release's sparks — at most
 * nine, usually three or four. Everything moves on the story's clock (`store.time`), so a paused
 * probe shot and a seek show exactly the same water. Nothing here casts into the static shadow
 * map but the lighthouse, which stands still.
 */
export default function SeasLayer() {
  const store = useGuildStore()
  const world = useWorld()
  const seas = useGLTF(SEAS_URL) as unknown as { nodes: Record<string, Object3D> }
  const ships = useGLTF(SHIPS_URL) as unknown as { nodes: Record<string, Object3D> }
  const lands = useGLTF(LANDS_URL) as unknown as { nodes: Record<string, Object3D> }
  const harbour = useMemo(() => harbourOf(watersOf(world).quay), [world])
  const lighthouse = useMemo(() => lighthouseSpot(world.island, harbour), [world, harbour])
  const layer = useOwnedMeshes(
    () => build(ships.nodes, seas.nodes, lands.nodes, lighthouse, harbour),
    [ships.nodes, seas.nodes, lands.nodes, lighthouse, harbour],
    "textures",
  )

  // The Bard looks: at the quay for a merge, the anchorage for a release, the lighthouse for red CI.
  useEffect(
    () =>
      store.moments.on((moment) => {
        const spot = harbourSpotOf(moment.kind)
        const place = spot
          ? toWorld(harbour, spot.side, spot.out)
          : moment.kind === "sea-red"
            ? lighthouse
            : undefined
        if (!place) return
        store.director.hint({ key: `sea:${moment.kind}`, x: place.x, z: place.z, radius: 16 }, 7, 12_000)
      }),
    [store, harbour, lighthouse],
  )

  useFrame(() => {
    if (!layer) return
    const time = store.time
    const view = seaAt(store.sea, time)
    const t = time / 1000
    const counts: Record<Hull, number> = { cargo: 0, pr: 0, galleon: 0 }
    let crates = 0
    layer.gold.visible = false
    for (const voyage of view.voyages) {
      if (voyage.shown <= 0.01) continue
      shipMatrix(voyage, harbour, t)
      const mesh = layer.hulls[voyage.hull]
      if (voyage.hull === "galleon") {
        mesh.matrix.copy(dummy.matrix)
        mesh.visible = true
        counts.galleon = 1
        dummy.local.makeTranslation(0, DECK_Y + 0.15, 0.8)
        layer.gold.matrix.multiplyMatrices(dummy.matrix, dummy.local)
        layer.gold.visible = true
        continue
      }
      ;(mesh as InstancedMesh).setMatrixAt(counts[voyage.hull]++, dummy.matrix)
      for (let i = 0; i < voyage.crates; i++) {
        const [x, z] = CRATE_SPOTS[i] as readonly [number, number]
        dummy.local.makeRotationY((hash01(i * 7 + voyage.key.length) - 0.5) * 0.5)
        dummy.local.setPosition(x, DECK_Y, z)
        dummy.out.multiplyMatrices(dummy.matrix, dummy.local)
        dummy.out.scale(dummy.scale.setScalar(CRATE_SCALE))
        layer.crates.setMatrixAt(crates++, dummy.out)
      }
    }
    if (counts.galleon === 0) layer.hulls.galleon.visible = false
    for (const hull of ["cargo", "pr"] as const) {
      const mesh = layer.hulls[hull] as InstancedMesh
      mesh.count = counts[hull]
      mesh.instanceMatrix.needsUpdate = true
    }
    layer.crates.count = crates
    layer.crates.instanceMatrix.needsUpdate = true

    // The lighthouse: dark until the first CI run, then its state's colour and motion.
    if (layer.lighthouse) {
      const { lamp, beam, beamMaterial, lampMaterial, seaward } = layer.lighthouse
      const look = lampOf(view.light, time)
      const lit = view.light.state !== undefined
      lamp.visible = true
      lampMaterial.color.setHex(lit ? look.color : 0x3a3a44)
      lampMaterial.color.multiplyScalar(lit ? 0.5 + look.glow * 0.9 : 1)
      beam.visible = lit
      if (lit) {
        const night = 1 - store.environment.daylight
        beamMaterial.color.setHex(look.color)
        beamMaterial.opacity = look.glow * (0.1 + 0.35 * night)
        beam.rotation.y = look.spin ? look.beam : seaward
      }
    }

    // The release's flourish: bursts of sparks over the galleon as it drops anchor.
    const sparks = layer.sparks
    if (view.flourish !== undefined && view.galleon) {
      const g = toWorld(harbour, view.galleon.side, view.galleon.out)
      flourish(sparks, g.x, g.z, view.flourish)
    } else sparks.count = 0
  }, FRAME.WORLD)

  if (!layer) return null
  return (
    <group name="seas">
      {layer.meshes.map((mesh) => (
        <primitive key={mesh.uuid} object={mesh} />
      ))}
    </group>
  )
}

/** A voyage's ship matrix (into `dummy.matrix`): placed, bobbing, leaning, shrinking as it goes. */
function shipMatrix(voyage: Voyage, harbour: Harbour, t: number): void {
  const hull = HULLS[voyage.hull]
  const at = toWorld(harbour, voyage.side, voyage.out, voyage.heading)
  const phase = voyage.key.length * 1.7 + voyage.side * 0.1
  const sway = voyage.sailing ? 1.4 : 0.7
  const sink = (1 - voyage.shown) * 3
  dummy.position.set(at.x, SEA_Y - hull.draft * hull.scale + Math.sin(t * 0.9 + phase) * 0.12 - sink, at.z)
  dummy.euler.set(
    Math.sin(t * 0.6 + phase) * 0.025 * sway,
    at.heading,
    Math.sin(t * 0.8 + phase) * 0.04 * sway,
  )
  dummy.quaternion.setFromEuler(dummy.euler)
  dummy.scale.setScalar(hull.scale * (0.4 + 0.6 * voyage.shown))
  dummy.matrix.compose(dummy.position, dummy.quaternion, dummy.scale)
}

/** Three bursts, a second apart, of sparks thrown up over (x, z), falling and fading. */
function flourish(sparks: InstancedMesh, x: number, z: number, age: number): void {
  const bursts = 3
  const each = SPARKS / bursts
  let n = 0
  for (let b = 0; b < bursts; b++) {
    const s = (age - b * 1400) / 1000
    const life = (FLOURISH_MS - bursts * 1400) / 1000
    if (s < 0 || s > life) continue
    const cx = x + (hash01(b * 31) - 0.5) * 8
    const cz = z + (hash01(b * 57) - 0.5) * 8
    const fade = 1 - s / life
    for (let i = 0; i < each; i++) {
      const k = b * each + i
      const a = hash01(k * 3) * Math.PI * 2
      const up = 0.4 + hash01(k * 5) * 0.6
      const speed = 9 + hash01(k * 11) * 6
      const r = speed * Math.min(s, 1.2) * Math.sqrt(1 - up * up + 0.2)
      dummy.position.set(cx + Math.cos(a) * r, 12 + speed * up * s - 2.2 * s * s, cz + Math.sin(a) * r)
      dummy.quaternion.identity()
      dummy.scale.setScalar(0.7 * fade + 0.1)
      dummy.matrix.compose(dummy.position, dummy.quaternion, dummy.scale)
      sparks.setMatrixAt(n++, dummy.matrix)
    }
  }
  sparks.count = n
  sparks.instanceMatrix.needsUpdate = true
}

const FESTIVE = [0xffd34d, 0xff5a5a, 0x5ad1ff, 0x9dff6a, 0xff8ae2, 0xffffff]

function build(
  ships: Record<string, Object3D>,
  seas: Record<string, Object3D>,
  lands: Record<string, Object3D>,
  spot: { x: number; z: number } | undefined,
  harbour: Harbour,
) {
  const meshes: Mesh[] = []
  const keep = <T extends Mesh>(mesh: T): T => {
    mesh.castShadow = false
    mesh.receiveShadow = true
    mesh.frustumCulled = false
    meshes.push(mesh)
    return mesh
  }
  const instanced = (node: Object3D | undefined, count: number): InstancedMesh => {
    const baked = node ? bakeNode(node) : null
    const geometry = baked?.geometry ?? new SphereGeometry(0.01)
    const material = new MeshStandardMaterial({ map: baked?.material.map ?? null, roughness: 0.85 })
    const mesh = new InstancedMesh(geometry, material, count)
    mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    mesh.count = 0
    return keep(mesh)
  }

  // The galleon flies a pennant from its stern: baked into its hull (the same palette), one draw.
  const galleonBake = ships["ship-large"] ? bakeNode(ships["ship-large"]) : null
  const flagBake = seas["flag-high-pennant"] ? bakeNode(seas["flag-high-pennant"]) : null
  let galleonGeometry = galleonBake?.geometry ?? new SphereGeometry(0.01)
  if (galleonBake && flagBake) {
    flagBake.geometry.applyMatrix4(new Matrix4().makeScale(1.6, 1.6, 1.6).setPosition(0, 3.3, -5.4))
    const merged = mergeGeometries([galleonBake.geometry, flagBake.geometry])
    if (merged) {
      galleonBake.geometry.dispose()
      galleonGeometry = merged
    }
    flagBake.geometry.dispose()
  }
  const galleon = keep(
    new Mesh(
      galleonGeometry,
      new MeshStandardMaterial({ map: galleonBake?.material.map ?? null, roughness: 0.85 }),
    ),
  )
  galleon.matrixAutoUpdate = false
  galleon.visible = false

  const hulls: Record<Hull, Mesh> = {
    cargo: instanced(ships[HULLS.cargo.piece], MAX_SHIPS),
    pr: instanced(ships[HULLS.pr.piece], MAX_SHIPS),
    galleon,
  }
  const crates = instanced(seas.Wood_Planks_Stack_Small, MAX_SHIPS * MAX_CRATES)

  const goldBake = seas.Gold_Bars_Stack_Small ? bakeNode(seas.Gold_Bars_Stack_Small) : null
  const gold = keep(
    new Mesh(
      goldBake?.geometry ?? new SphereGeometry(0.01),
      new MeshStandardMaterial({ map: goldBake?.material.map ?? null, roughness: 0.4, metalness: 0.3 }),
    ),
  )
  gold.matrixAutoUpdate = false
  gold.visible = false

  const sparks = keep(
    new InstancedMesh(new OctahedronGeometry(1, 0), new MeshBasicMaterial({ toneMapped: false }), SPARKS),
  )
  sparks.castShadow = false
  sparks.receiveShadow = false
  sparks.instanceMatrix.setUsage(DynamicDrawUsage)
  for (let i = 0; i < SPARKS; i++)
    sparks.setColorAt(i, dummy.color.setHex(FESTIVE[i % FESTIVE.length] as number).multiplyScalar(2))
  sparks.count = 0

  return { meshes, hulls, crates, gold, sparks, lighthouse: lighthouse(lands, spot, harbour, meshes) }
}

/** The tower (it stands still: it casts), its lamp, and the beam (a long open cone, additive). */
function lighthouse(
  lands: Record<string, Object3D>,
  spot: { x: number; z: number } | undefined,
  harbour: Harbour,
  meshes: Mesh[],
) {
  const towerBake = lands.building_tower_A_blue ? bakeNode(lands.building_tower_A_blue) : null
  if (!spot || !towerBake) return undefined
  const tower = new Mesh(
    towerBake.geometry,
    new MeshStandardMaterial({ map: towerBake.material.map, roughness: 0.9 }),
  )
  tower.position.set(spot.x, 0, spot.z)
  tower.scale.setScalar(HEX_SCALE)
  // Its door to the island.
  tower.rotation.y = Math.atan2(-harbour.outX, -harbour.outZ)
  tower.castShadow = true
  tower.receiveShadow = true
  meshes.push(tower)

  const lampMaterial = new MeshBasicMaterial({ color: 0x3a3a44, toneMapped: false })
  const lamp = new Mesh(new SphereGeometry(0.9, 12, 8), lampMaterial)
  lamp.position.set(spot.x, LAMP_Y, spot.z)
  meshes.push(lamp)

  // The cone lies along +z from its tip at the lamp, widening out to sea, dipping a little.
  const cone = new ConeGeometry(7, BEAM_LENGTH, 20, 6, true)
  cone.translate(0, -BEAM_LENGTH / 2, 0)
  // Bright at the lamp, gone at the far end: additive, so a black vertex adds nothing.
  const along = cone.getAttribute("position")
  const fade = new Float32Array(along.count * 3)
  for (let i = 0; i < along.count; i++) fade.fill((1 + along.getY(i) / BEAM_LENGTH) ** 2, i * 3, i * 3 + 3)
  cone.setAttribute("color", new Float32BufferAttribute(fade, 3))
  cone.rotateX(-Math.PI / 2 + 0.06)
  const beamMaterial = new MeshBasicMaterial({
    color: 0xffd9a0,
    transparent: true,
    opacity: 0.2,
    blending: AdditiveBlending,
    vertexColors: true,
    depthWrite: false,
    toneMapped: false,
  })
  const beam = new Mesh(cone, beamMaterial)
  beam.position.copy(lamp.position)
  beam.renderOrder = 2
  beam.frustumCulled = false
  meshes.push(beam)
  // A steady beam looks out to sea: away from the island's centre, through the tower.
  const seaward = Math.atan2(spot.x, spot.z)
  return { lamp, lampMaterial, beam, beamMaterial, seaward }
}
