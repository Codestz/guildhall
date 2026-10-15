/**
 * LIVING WORK on the island (sim story/living.ts): a place being read glows with a soft warm light, a
 * failing one is blighted (its light drained of colour, a sickly olive cast). Both are read in the shader
 * from one small texture keyed by hex, a texel per tile at its axial coordinates (q + radius, r +
 * radius), so a place lit or blighted costs no draw, no program and no work a frame; the texture is
 * filtered between tile centres (in axial space), so a lit place's edge is a soft half-tile falloff
 * rather than a hard hex rim. Every program that opts in (`patchLivingTint`: the palette and batch
 * materials and the ground) shares one set of uniforms.
 *
 *   r   the read glow: `diffuse × warm × r` added as emissive light (so the night's grade leaves it
 *       warm, as it leaves a lamp's light), low-key by day, a warm pool by night
 *   g   the blight: the lit colour mixed toward its own grey under an olive cast, `g × BLIGHT_MIX`
 *
 * Only where it can show: the chunks are compiled in while an island has a field laid (a hall, the home:
 * where a session plays), and the programs of an island with none (`/town`) are as they were, at no cost
 * (each material's program key says which: `livingMaterial`; laying or dropping the field flips them,
 * once per screen). With a field and nothing in it (`uLivingGrid.w` 0) a program draws exactly as it did
 * (the lookup is skipped, the blight mixes by an exact zero), so an island at rest is the same picture
 * to the byte.
 */
import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  type Material,
  RGBAFormat,
  type Texture,
  UnsignedByteType,
  Vector4,
  type WebGLProgramParametersWithUniforms,
} from "three"
import { NIGHT_GRADE } from "./night/glow.ts"

const empty = new DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, RGBAFormat)
empty.needsUpdate = true

/** The read glow's light (linear RGB, × the diffuse colour): a lamp's warmth, kept low. */
export const LIVING_WARM: readonly [number, number, number] = [0.85, 0.53, 0.2]
/** By night the glow is this much of the day's: in the dark a little warm light goes a long way. */
export const LIVING_NIGHT = 0.15
/** The blight's cast over the lit grey (linear RGB): olive, a little dim. */
export const LIVING_SICK: readonly [number, number, number] = [0.86, 0.9, 0.62]
/** How far a full blight takes the colour toward its sick grey. */
export const BLIGHT_MIX = 0.62

/** The living tint's uniforms, one object shared by every program that reads them. */
export const LIVING_TINT = {
  uLivingMap: { value: empty as Texture },
  /**
   * The grid's radius, 1 / the texture's side, 1 / the tile size (metres), and in w 1 while anything is
   * lit or blighted, 0 otherwise (then nothing changes). One vector: a program at rest uploads little.
   */
  uLivingGrid: { value: new Vector4(0, 1, 1, 0) },
  /** The night grade (night/glow.ts), shared: the glow eases down as the dark comes. */
  uLivingNight: NIGHT_GRADE,
}

export interface LivingField {
  /** The grid's radius (tiles), as laid. */
  readonly radius: number
  /** Sets one tile (its axial coordinates): glow and blight, 0 … 1. Seen at the next `commit`. */
  set(q: number, r: number, glow: number, blight: number): void
  /** Every tile back to nothing. */
  clear(): void
  /** Uploads what changed since the last commit (nothing changed: nothing uploaded); whether anything is lit. */
  commit(): boolean
  dispose(): void
}

let current: LivingField | null = null
/** Whether the programs compile the chunks in (a field is laid). */
let wanted = false
/** The shared materials that patch them in: told to rebuild their programs when `wanted` flips. */
const kept = new Set<Material>()

function want(on: boolean): void {
  if (wanted === on) return
  wanted = on
  for (const m of kept) m.needsUpdate = true
}

/**
 * Keys `material`'s program by whether the living tint is compiled in (its `onBeforeCompile` calls
 * `patchLivingTint`). `shared`: a material that outlives an island (the palette's, the batch's, the
 * ground's), rebuilt when a field is laid or dropped; a per-island one (the road strips) is not kept.
 */
export function livingMaterial<M extends Material>(material: M, shared = true): M {
  const base = material.customProgramCacheKey.bind(material)
  material.customProgramCacheKey = () => (wanted ? `${base()}-living` : base())
  if (shared) kept.add(material)
  return material
}

/**
 * Lays an island's grid (`radius` rings) into the shared uniforms: an empty field, nothing lit. `tile` is
 * a tile's size, centre to corner (metres). Laying another disposes the last; `null` clears it.
 */
export function setLivingField(grid: { radius: number; tile: number } | null): LivingField | null {
  current?.dispose()
  current = null
  want(grid !== null)
  if (!grid) return null
  const side = 2 * grid.radius + 1
  const data = new Uint8Array(side * side * 4)
  const texture = new DataTexture(data, side, side, RGBAFormat, UnsignedByteType)
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  texture.wrapS = ClampToEdgeWrapping
  texture.wrapT = ClampToEdgeWrapping
  texture.generateMipmaps = false
  texture.needsUpdate = true
  let dirty = false
  let lit = 0
  const byte = (v: number) => (v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255))
  const field: LivingField = {
    radius: grid.radius,
    set(q, r, glow, blight) {
      const x = q + grid.radius
      const y = r + grid.radius
      if (x < 0 || y < 0 || x >= side || y >= side) return
      const at = (y * side + x) * 4
      const g = byte(glow)
      const b = byte(blight)
      const was = (data[at] as number) + (data[at + 1] as number)
      if (data[at] === g && data[at + 1] === b) return
      data[at] = g
      data[at + 1] = b
      lit += (g + b > 0 ? 1 : 0) - (was > 0 ? 1 : 0)
      dirty = true
    },
    clear() {
      if (lit === 0) return
      data.fill(0)
      lit = 0
      dirty = true
    },
    commit() {
      if (dirty) {
        texture.needsUpdate = true
        dirty = false
      }
      LIVING_TINT.uLivingGrid.value.w = lit > 0 ? 1 : 0
      return lit > 0
    },
    dispose() {
      texture.dispose()
      if (current !== field) return
      current = null
      want(false)
      LIVING_TINT.uLivingMap.value = empty
      LIVING_TINT.uLivingGrid.value.w = 0
    },
  }
  current = field
  LIVING_TINT.uLivingMap.value = texture
  LIVING_TINT.uLivingGrid.value.set(grid.radius, 1 / side, 1 / grid.tile, 0)
  return field
}

const PARS = /* glsl */ `
#define LIVING_TINT
uniform sampler2D uLivingMap;
uniform vec4 uLivingGrid;
uniform float uLivingNight;
const vec3 LIVING_WARM = vec3( ${LIVING_WARM.map((v) => v.toFixed(3)).join(", ")} );
const vec3 LIVING_SICK = vec3( ${LIVING_SICK.map((v) => v.toFixed(3)).join(", ")} );
`

/**
 * With the emissive light, gated by the uniform (at rest a fragment skips the lookup whole): the tile
 * under this fragment (a hair inside the surface along its normal, so a tile's side reads as that tile,
 * not its neighbour), filtered between tile centres; the glow added.
 */
const GLOW = /* glsl */ `
vec2 livingW = vec2( 0.0 );
if ( uLivingGrid.w > 0.0 ) {
	vec3 lN = inverseTransformDirection( normal, viewMatrix );
	vec2 lp = ( vCloudWorld.xz - lN.xz * 0.15 ) * uLivingGrid.z;
	vec2 la = vec2( 0.57735027 * lp.x - lp.y / 3.0, lp.y / 1.5 );
	livingW = textureLod( uLivingMap, ( la + uLivingGrid.x + 0.5 ) * uLivingGrid.y, 0.0 ).rg;
	totalEmissiveRadiance += diffuseColor.rgb * LIVING_WARM * ( livingW.x * mix( 1.0, ${LIVING_NIGHT.toFixed(3)}, uLivingNight ) );
}
`

/** Before the output, the blight; branchless: at rest it mixes by an exact zero (the same to the byte). */
const BLIGHT = /* glsl */ `
outgoingLight = mix( outgoingLight, vec3( dot( outgoingLight, vec3( 0.2126, 0.7152, 0.0722 ) ) ) * LIVING_SICK, livingW.y * ${BLIGHT_MIX.toFixed(3)} );
`

const EMISSIVE = "#include <emissivemap_fragment>"
const OPAQUE = "#include <opaque_fragment>"

/**
 * `onBeforeCompile` for a lit material (keyed by `livingMaterial`), while a field is laid: after `patchCloudShade` it reads the world position that passes
 * (`vCloudWorld`); on a material without it (the road strips) it passes its own.
 */
export function patchLivingTint(shader: WebGLProgramParametersWithUniforms): void {
  if (!wanted) return
  let f = shader.fragmentShader
  if (!f.includes(EMISSIVE) || !f.includes(OPAQUE)) return
  if (!f.includes("vCloudWorld")) {
    const v = shader.vertexShader
    if (!v.includes("#include <project_vertex>")) return
    shader.vertexShader = v
      .replace("#include <common>", "#include <common>\nvarying vec3 vLivingWorld;")
      .replace(
        "#include <project_vertex>",
        "#include <project_vertex>\nvLivingWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;",
      )
    f = f.replace(
      "#include <common>",
      "#include <common>\nvarying vec3 vLivingWorld;\n#define vCloudWorld vLivingWorld",
    )
  }
  Object.assign(shader.uniforms, LIVING_TINT)
  shader.fragmentShader = f
    .replace("void main() {", () => `${PARS}\nvoid main() {`)
    .replace(EMISSIVE, () => `${EMISSIVE}\n${GLOW}`)
    .replace(OPAQUE, () => `${BLIGHT}\n${OPAQUE}`)
}
