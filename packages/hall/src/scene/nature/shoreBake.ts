import {
  Box3,
  Color,
  DataTexture,
  DoubleSide,
  LinearFilter,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  OrthographicCamera,
  Quaternion,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  type Texture,
  Vector3,
  Vector4,
  type WebGLRenderer,
  WebGLRenderTarget,
} from "three"
import { isWebGPU } from "../../render/backend.ts"
import { type Cell, cellToWorld, HEX_SCALE, type LandPlacement } from "../../world/lands.ts"
import type { Spot } from "../../world/layout.ts"
import { tiltQuaternion } from "../../world/tilt.ts"
import { reachOf, type World } from "../../world/world.ts"
import { HEX_RADIUS } from "./scatter.ts"
import { distanceToLand, riverCells, type ShoreLayout, shoreTexels, smooth } from "./shore.ts"
import { LAND_ABOVE, RIVER_Y, STANDS_BELOW } from "./waterline.ts"

/**
 * The water's shore bake (nature/Water.tsx): the island's tiles rendered from straight above into
 * a land mask, and its decor from below into a mask of what stands in the water, both read back
 * and measured on the CPU into one texture over the layout's square. WebGL: GLSL masks, read back
 * synchronously. WebGPU: node-material masks (waterNodes.ts), read back once, asynchronously.
 */

/**
 * A baked shore: the texture, and where the mill wheel's water rejoins the river (xyz) with the
 * wheel's radius (w; 0: no wheel, no wake).
 */
export interface Shore {
  texture: DataTexture
  wheel: Vector4
}

/** Foam rings reach this far from what stands in the water (world units; the texture's alpha). */
export const RING_MAX = 4
/** Pieces that sit on the water but shouldn't ring it (they float, they don't stand). */
const AFLOAT = /^(waterlily|waterplant)/
/** A piece further than this past a bake's square can't reach into it (world units). */
const REACH = 3 * HEX_RADIUS

const scratch = new Vector3()
const size3 = new Vector3()

/**
 * The river's hexes, source first. Only the hand map has one (shore.ts reads its course from the
 * hand map's river links); a repo's island has no river, so no river hexes and no flow.
 */
export function riverOf(world: World): Cell[] {
  return world.kind === "hand" ? riverCells() : []
}

/** What the shore bake draws, either backend: the two scenes, their cameras, and what they're read for. */
export interface ShoreSetup {
  /** The island's tiles, seen from above (`top`): land where they rise above the sea. */
  land: Scene
  top: OrthographicCamera
  /** The decor, seen from below (`up`): the lowest surfaces at the waterline. */
  below: Scene
  up: OrthographicCamera
  /** The pack's palette (the land mask tells its blue water apart), or null. */
  palette: Texture | null
  half: number
  size: number
  at: Spot
  line: Spot[]
  wheel: Vector4
}

/** The bake's scenes and cameras, and the mill wheel's tailrace (no GPU work). */
function shoreSetup(nodes: Record<string, Object3D>, world: World, layout: ShoreLayout): ShoreSetup {
  const { half, size } = layout
  const at = layout.at ?? [0, 0]
  // The bake sees ±half round `at`: land past it would be open sea to the foam. Generated islands
  // fit the one bake or are tiled (shoreTiles.ts); say so if one ever grows past it rather than lose its coast.
  const reach = reachOf(world) + HEX_RADIUS
  if (!layout.at && reach > half)
    console.warn(`water: the island reaches ${reach.toFixed(0)}, the shore bake only ±${half}`)
  const inside = (piece: LandPlacement): boolean =>
    Math.abs(piece.x - at[0]) < half + REACH && Math.abs(piece.z - at[1]) < half + REACH
  const line = world.kind === "hand" ? smooth(riverOf(world).map(cellToWorld), 3) : []
  const wheel = new Vector4()
  const land = new Scene()
  let palette: Texture | null = null
  for (const tile of world.island.tiles) {
    const source = nodes[tile.piece]
    if (!source || !inside(tile)) continue
    const copy = source.clone(true)
    copy.position.set(tile.x, tile.y ?? 0, tile.z)
    copy.rotation.set(0, tile.rot ?? 0, 0)
    copy.scale.setScalar(HEX_SCALE * (tile.scale ?? 1))
    copy.traverse((child) => {
      const mesh = child as Mesh
      if (mesh.isMesh && !palette) palette = (mesh.material as MeshStandardMaterial).map
    })
    land.add(copy)
  }
  const top = new OrthographicCamera(-half, half, half, -half, 1, 200)
  top.position.set(at[0], 100, at[1])
  top.up.set(0, 0, -1)
  top.lookAt(at[0], 0, at[1])
  top.updateMatrixWorld()

  // What stands in the water: the decor seen from *below*, where the lowest surface shows — a
  // post, a rock's foot, a wheel's rim at the waterline marks the mask; a bridge deck or a roof
  // overhead doesn't. Its distance goes in the alpha, for foam rings.
  const below = new Scene()
  for (const piece of world.island.decor) {
    const source = nodes[piece.piece]
    if (!source || AFLOAT.test(piece.piece) || !inside(piece)) continue
    const copy = source.clone(true)
    copy.position.set(piece.x, piece.y ?? 0, piece.z)
    copy.rotation.set(0, piece.rot ?? 0, 0)
    if (piece.tilt) copy.quaternion.premultiply(new Quaternion().fromArray(tiltQuaternion(piece.tilt)))
    copy.scale.setScalar(HEX_SCALE * (piece.scale ?? 1))
    below.add(copy)
  }
  below.updateMatrixWorld(true)
  const axle = below.getObjectByName("building_watermill_wheel_blue")
  if (axle) {
    axle.getWorldPosition(scratch)
    const radius = new Box3().setFromObject(axle).getSize(size3).y / 2
    // The wheel turns beside the river, not in it: its water rejoins at the nearest bit of river.
    let best = Number.POSITIVE_INFINITY
    for (const [x, z] of line) {
      const d = Math.hypot(x - scratch.x, z - scratch.z)
      if (d < best) {
        best = d
        wheel.set(x, RIVER_Y, z, radius)
      }
    }
    if (best > 12) wheel.set(0, 0, 0, 0)
  }
  // Looking up: left and right swap so the image reads back in the same layout as the top view.
  const up = new OrthographicCamera(half, -half, half, -half, 1, 200)
  up.position.set(at[0], -100, at[1])
  up.up.set(0, 0, -1)
  up.lookAt(at[0], 0, at[1])
  up.updateMatrixWorld()
  return { land, top, below, up, palette, half, size, at, line, wheel }
}

/**
 * The shore texture from the two masks read back (RGBA, red > 127 marks; row 0 at z = +half, as
 * WebGL's readPixels lays them out): distance to land and the river's flow (shoreTexels), and the
 * distance to whatever stands in the water in the alpha.
 */
function shoreOf(setup: ShoreSetup, landPixels: Uint8Array, postPixels: Uint8Array): Shore {
  const { half, size } = setup
  const land = new Uint8Array(size * size)
  for (let i = 0; i < land.length; i++) land[i] = (landPixels[i * 4] as number) > 127 ? 1 : 0
  const texels = shoreTexels(land, setup.line, setup)
  const posts = new Uint8Array(size * size)
  for (let i = 0; i < posts.length; i++) posts[i] = (postPixels[i * 4] as number) > 127 ? 1 : 0
  const cell = (half * 2) / size
  const ring = distanceToLand(posts, size, size)
  for (let i = 0; i < posts.length; i++)
    texels[i * 4 + 3] = Math.round(Math.min(1, ((ring[i] as number) * cell) / RING_MAX) * 255)

  const texture = new DataTexture(texels, size, size, RGBAFormat)
  texture.magFilter = LinearFilter
  texture.minFilter = LinearFilter
  texture.needsUpdate = true
  return { texture, wheel: setup.wheel }
}

/** The world's shore over `layout`'s square, on whichever backend `gl` is. Once per world and square. */
export function bakeShore(
  gl: object,
  nodes: Record<string, Object3D>,
  world: World,
  layout: ShoreLayout,
): Shore | Promise<Shore> {
  return isWebGPU(gl)
    ? bakeShoreGPU(gl, nodes, world, layout)
    : bakeShoreGL(gl as WebGLRenderer, nodes, world, layout)
}

/**
 * Renders the island's tiles from straight above into a mask (land = above the water it borders
 * and not the pack's blue), reads it back and turns it into the shore texture.
 * WebGL: GLSL masks, read back synchronously.
 */
function bakeShoreGL(
  gl: WebGLRenderer,
  nodes: Record<string, Object3D>,
  world: World,
  layout: ShoreLayout,
): Shore {
  const setup = shoreSetup(nodes, world, layout)
  const { size } = setup
  const mask = new ShaderMaterial({
    uniforms: { map: { value: setup.palette } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying float vY;
      void main() {
        vUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vY = world.y;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      varying vec2 vUv;
      varying float vY;
      void main() {
        vec3 c = texture2D(map, vUv).rgb;
        bool blue = c.b > c.r + 0.1 && c.b > c.g;
        // Sea-level land below the sea surface (a wet strip of sand) is under the water too.
        float land = (!blue && vY > ${LAND_ABOVE.toFixed(3)}) ? 1.0 : 0.0;
        gl_FragColor = vec4(land, 0.0, 0.0, 1.0);
      }`,
  })
  setup.land.overrideMaterial = mask
  const target = new WebGLRenderTarget(size, size)
  const previous = gl.getRenderTarget()
  const clear = gl.getClearColor(new Color())
  const alpha = gl.getClearAlpha()
  const shadows = gl.shadowMap.autoUpdate
  gl.shadowMap.autoUpdate = false
  gl.setRenderTarget(target)
  gl.setClearColor(0x000000, 1)
  gl.clear()
  gl.render(setup.land, setup.top)
  const landPixels = new Uint8Array(size * size * 4)
  gl.readRenderTargetPixels(target, 0, 0, size, size, landPixels)
  gl.setRenderTarget(previous)
  target.dispose()
  mask.dispose()

  const standing = new ShaderMaterial({
    side: DoubleSide,
    vertexShader: /* glsl */ `
      varying float vY;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vY = world.y;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */ `
      varying float vY;
      void main() {
        gl_FragColor = vec4(vY < ${STANDS_BELOW.toFixed(3)} ? 1.0 : 0.0, 0.0, 0.0, 1.0);
      }`,
  })
  setup.below.overrideMaterial = standing
  const target2 = new WebGLRenderTarget(size, size)
  gl.setRenderTarget(target2)
  gl.setClearColor(0x000000, 1)
  gl.clear()
  gl.render(setup.below, setup.up)
  const postPixels = new Uint8Array(size * size * 4)
  gl.readRenderTargetPixels(target2, 0, 0, size, size, postPixels)
  gl.setRenderTarget(previous)
  gl.setClearColor(clear, alpha)
  gl.shadowMap.autoUpdate = shadows
  target2.dispose()
  standing.dispose()
  return shoreOf(setup, landPixels, postPixels)
}

/** The same bake on WebGPU: node-material masks (waterNodes.ts), each read back once, asynchronously. */
async function bakeShoreGPU(
  gl: object,
  nodes: Record<string, Object3D>,
  world: World,
  layout: ShoreLayout,
): Promise<Shore> {
  const setup = shoreSetup(nodes, world, layout)
  const { shoreMasks } = await import("./waterNodes.ts")
  const { land, posts } = await shoreMasks(gl, setup)
  return shoreOf(setup, land, posts)
}
