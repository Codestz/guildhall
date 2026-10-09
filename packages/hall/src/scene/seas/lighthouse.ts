import {
  AdditiveBlending,
  ConeGeometry,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  SphereGeometry,
} from "three"
import { HEX_SCALE } from "../../world/lands.ts"
import { bakeNode } from "../events/common.ts"
import type { Harbour } from "./fleet.ts"

/** The lamp's height on the tower: the hex pack's tower at the island's scale, its lamp a beacon on the roof's point. */
const LAMP_Y = 11.8
const BEAM_LENGTH = 70

/** The tower (it stands still: it casts), its lamp, and the beam (a long open cone, additive). */
export function lighthouse(
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
