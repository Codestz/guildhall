/**
 * The REGION TINT (world regions.ts, decisions.md "Seasons + regions"): the island's regions read in
 * the shader from one small texture (regionField.ts) over the island, so a region costs no draw and no
 * work a frame. Every program that opts in (`patchRegionTint`: the palette and batch materials and the
 * ground) shares one set of uniforms.
 *
 * - On the ground only (`kind: "ground"`), its green turns with the country: grey rock and thin moss on
 *   the highlands, straw and ochre in the dry south, dark wet moss in the marsh (its water's bed too, so
 *   the lake's edge reads darker), a fresher green in the meadows (whose flower drifts the ground's
 *   speckle thickens, vmesh.ts). Only green: sand, soil, paving and stone keep their colours.
 * - On everything: snow on what faces up above the highlands' snow line, and a low mist lying over the
 *   marsh's water; the marsh's water itself (`kind: "water"`) dark and peaty.
 *
 * Self-contained: no other chunk reads its uniforms, and with no field (`uRegionOn` 0) a program draws
 * exactly as it did. Pieces take their region's foliage as palette re-tints (world nature.ts
 * `dressRegion`), not here.
 */
import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  RGBAFormat,
  type Texture,
  UnsignedByteType,
  Vector4,
  type WebGLProgramParametersWithUniforms,
} from "three"
import type { RegionFieldData } from "./regionField.ts"

const empty = new DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, RGBAFormat)
empty.needsUpdate = true

/** The region tint's uniforms, one object shared by every program that reads them. */
export const REGION_TINT = {
  /** RGBA: the highlands', the dry south's, the marsh's and the meadows' weights (regionField.ts). */
  uRegionMap: { value: empty as Texture },
  /** The field's world window: x0, z0, 1 / width, 1 / depth. */
  uRegionWindow: { value: new Vector4(0, 0, 0, 0) },
  /** 1 with a field, 0 without (then nothing changes). */
  uRegionOn: { value: 0 },
  /** The highlands' snow line (world y); far up with none. */
  uRegionSnowY: { value: 1e4 },
  /** The marsh's water level (world y), its mist lying just over it. */
  uRegionMistY: { value: -1e4 },
  /** The fine ground's small hex (centre to corner, metres): the meadows bloom a whole one at a time. */
  uRegionCell: { value: 1 },
}

let current: DataTexture | null = null

/** Lays the island's region field into the shared uniforms (null clears it: every program as before). */
export function setRegionField(field: RegionFieldData | null): void {
  current?.dispose()
  current = null
  if (!field) {
    REGION_TINT.uRegionMap.value = empty
    REGION_TINT.uRegionOn.value = 0
    REGION_TINT.uRegionSnowY.value = 1e4
    REGION_TINT.uRegionMistY.value = -1e4
    return
  }
  const texture = new DataTexture(field.data, field.res, field.res, RGBAFormat, UnsignedByteType)
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  texture.wrapS = ClampToEdgeWrapping
  texture.wrapT = ClampToEdgeWrapping
  texture.needsUpdate = true
  current = texture
  REGION_TINT.uRegionMap.value = texture
  REGION_TINT.uRegionWindow.value.set(field.min[0], field.min[1], 1 / field.size, 1 / field.size)
  REGION_TINT.uRegionOn.value = 1
  REGION_TINT.uRegionSnowY.value = field.snowY ?? 1e4
  REGION_TINT.uRegionMistY.value = field.mistY ?? -1e4
  REGION_TINT.uRegionCell.value = field.cell
}

const PARS = /* glsl */ `
#define REGION_TINT
uniform sampler2D uRegionMap;
uniform vec4 uRegionWindow;
uniform float uRegionOn;
uniform float uRegionSnowY;
uniform float uRegionMistY;
uniform float uRegionCell;
vec4 regionAt( vec3 p ) {
	if ( uRegionOn <= 0.0 ) return vec4( 0.0 );
	return texture2D( uRegionMap, ( p.xz - uRegionWindow.xy ) * uRegionWindow.zw );
}
`

/** After the vertex colour: the weights here, and (on the ground) its green turned with the country. */
const TINT = /* glsl */ `
vec4 regionW = regionAt( vCloudWorld );
#ifdef REGION_GROUND
if ( regionW.r + regionW.g + regionW.b + regionW.a > 0.0 ) {
	vec3 rc = diffuseColor.rgb;
	float rLum = dot( rc, vec3( 0.2126, 0.7152, 0.0722 ) );
	float rGreen = smoothstep( 0.0, 0.06, rc.g - max( rc.r, rc.b ) );
	// highlands: grey rock and thin moss
	rc = mix( rc, vec3( rLum ) * vec3( 1.05, 1.0, 0.93 ) * 1.22, rGreen * regionW.r * 0.72 );
	// dry: straw and ochre, as light as the green it replaces
	rc = mix( rc, vec3( 0.56, 0.4, 0.11 ) * ( rLum / 0.27 ), rGreen * regionW.g * 0.78 );
	// marsh: dark wet moss, olive and peat
	rc = mix( rc, rc * vec3( 0.56, 0.7, 0.44 ), regionW.b * ( 0.6 + 0.4 * rGreen ) );
	// meadow: a fresher green, and whole small hexes of it in bloom (the fine ground's own cells, so a
	// flower bed is a facet of the low-poly ground), in drifts of one colour
	rc = mix( rc, rc * vec3( 1.03, 1.1, 0.84 ), rGreen * regionW.a * 0.6 );
	if ( regionW.a > 0.04 && rGreen > 0.3 ) {
		vec2 rp = vCloudWorld.xz / uRegionCell;
		float rqf = 0.57735027 * rp.x - rp.y / 3.0;
		float rrf = rp.y / 1.5;
		vec3 rCube = vec3( rqf, rrf, -rqf - rrf );
		vec3 rHex = floor( rCube + 0.5 );
		vec3 rOff = abs( rHex - rCube );
		if ( rOff.x > rOff.y && rOff.x > rOff.z ) rHex.x = -rHex.y - rHex.z;
		else if ( rOff.y > rOff.z ) rHex.y = -rHex.x - rHex.z;
		float rCell = fract( sin( dot( rHex.xy, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
		vec2 rw = vCloudWorld.xz;
		float rDrift = 0.5 + 0.5 * sin( rw.x * 0.21 + sin( rw.y * 0.17 ) * 1.3 ) * sin( rw.y * 0.23 + 1.7 );
		float rBloom = step( rCell, 0.4 * regionW.a * smoothstep( 0.25, 0.55, rDrift ) );
		vec3 rPetal = rDrift < 0.5 ? vec3( 0.86, 0.6, 0.06 ) : rDrift < 0.62 ? vec3( 0.85, 0.84, 0.76 ) : rDrift < 0.8 ? vec3( 0.78, 0.25, 0.38 ) : vec3( 0.36, 0.22, 0.7 );
		rc = mix( rc, rPetal, rBloom * rGreen * 0.5 );
	}
	diffuseColor.rgb = rc;
}
#endif
`

/** With the normal: snow on what faces up above the highlands' snow line, patchy as the weather's. */
const SNOW = /* glsl */ `
if ( regionW.r > 0.0 && vCloudWorld.y > uRegionSnowY ) {
	vec3 rn = inverseTransformDirection( normal, viewMatrix );
	float rUp = smoothstep( 0.55, 0.85, rn.y );
	float rHigh = smoothstep( uRegionSnowY, uRegionSnowY + 0.9, vCloudWorld.y );
	vec2 rs = vCloudWorld.xz;
	float rPatch = 0.78 + 0.22 * sin( rs.x * 0.7 + sin( rs.y * 0.45 ) ) * sin( rs.y * 0.8 + 1.1 );
	diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.88, 0.92, 0.97 ), rUp * rHigh * regionW.r * rPatch * 0.94 );
}
`

/** With the light: a low mist over the marsh, as bright as the light it lies in (dark by night). */
const MIST = /* glsl */ `
if ( regionW.b > 0.0 ) {
#ifdef REGION_WATER
	// the marsh's water: dark and peaty, a little green
	outgoingLight *= mix( vec3( 1.0 ), vec3( 0.62, 0.7, 0.62 ), regionW.b );
#endif
	float rLow = smoothstep( uRegionMistY - 1.2, uRegionMistY - 0.2, vCloudWorld.y ) * ( 1.0 - smoothstep( uRegionMistY + 0.1, uRegionMistY + 1.7, vCloudWorld.y ) );
	float rDrift = 0.72 + 0.28 * sin( vCloudWorld.x * 0.11 + vCloudWorld.z * 0.07 ) * sin( vCloudWorld.z * 0.13 - 0.6 );
	float rMist = regionW.b * rLow * rDrift * 0.38;
	float rL = dot( outgoingLight, vec3( 0.3333 ) );
	outgoingLight = mix( outgoingLight, vec3( rL * 1.3 ) * vec3( 0.95, 1.0, 1.04 ), rMist );
}
`

const COLOUR = "#include <color_fragment>"
const NORMAL = "#include <normal_fragment_maps>"
const OPAQUE = "#include <opaque_fragment>"

/** What a program is to the region tint: the ground (its green turned), the inland water (darkened in the marsh), a piece. */
export type RegionTintKind = "ground" | "water" | "piece"

/**
 * `onBeforeCompile` for a lit material, after `patchCloudShade` (which passes the world position).
 * Every kind takes the snow and the mist; the ground's green turns with its region, the water darkens
 * in the marsh.
 */
export function patchRegionTint(
  shader: WebGLProgramParametersWithUniforms,
  kind: RegionTintKind = "piece",
): void {
  const f = shader.fragmentShader
  if (!f.includes(COLOUR) || !f.includes(NORMAL) || !f.includes(OPAQUE) || !f.includes("vCloudWorld")) return
  Object.assign(shader.uniforms, REGION_TINT)
  shader.fragmentShader = f
    .replace(
      "void main() {",
      () =>
        `${kind === "ground" ? "#define REGION_GROUND\n" : kind === "water" ? "#define REGION_WATER\n" : ""}${PARS}\nvoid main() {`,
    )
    .replace(COLOUR, () => `${COLOUR}\n${TINT}`)
    .replace(NORMAL, () => `${NORMAL}\n${SNOW}`)
    .replace(OPAQUE, () => `${MIST}\n${OPAQUE}`)
}
