import { useFrame, useThree } from "@react-three/fiber"
import { useRef } from "react"
import { LinearFilter, type Material, type Mesh, type Texture } from "three"
import { maxAnisotropy } from "../render/backend.ts"
import { FRAME } from "./frame.ts"

/**
 * Crisp colours (the user: "textures are really low quality"). Every KayKit model is coloured by a
 * palette atlas: a grid of flat swatches, each triangle's UVs pinned inside one swatch. Mipmaps
 * average neighbouring swatches, so a distant roof or wall drifted towards its neighbours' colours
 * and every edge went soft. Sampling the atlases without mipmaps (and with full anisotropy) gives
 * each surface its exact swatch colour at any distance. Real images (the blueprint, the map) keep
 * their mipmaps. Runs whenever new textures reach the GPU (a model finished loading), not per frame.
 */
const PALETTE = /(_texture|^hexagons_medieval)$/

export function Crisp() {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const seen = useRef(-1)

  useFrame(() => {
    const textures = gl.info.memory.textures
    if (textures === seen.current) return
    seen.current = textures
    const anisotropy = maxAnisotropy(gl)
    scene.traverse((object) => {
      const material = (object as Mesh).material as Material | Material[] | undefined
      if (!material) return
      for (const m of Array.isArray(material) ? material : [material]) {
        const map = (m as Material & { map?: Texture | null }).map
        if (!map || map.userData.crisp || !PALETTE.test(map.name)) continue
        map.userData.crisp = true
        map.generateMipmaps = false
        map.minFilter = LinearFilter
        map.anisotropy = anisotropy
        map.needsUpdate = true
      }
    })
  }, FRAME.WORLD)

  return null
}
