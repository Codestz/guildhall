/**
 * The seasons (decisions 2026-10-14 "Seasons + regions"): the year as one continuous value, 0 … 4 —
 * 0 the heart of spring, 1 of summer, 2 of autumn, 3 of winter, round to spring again at 4 — read from a
 * date's day of the year (`seasonOfDate`), so a history played through its years cycles them without a
 * pop. Each season holds its look round its heart and hands over to the next across the month between
 * (`seasonWeights`: two neighbours share it, never more, and their weights add to 1).
 *
 * What a season changes is a few shader factors (`SEASON`, read by `patchSeason` in the palette, batch
 * and ground materials; the frost floor in snowCover.ts; the ice on still water in water.ts) and some
 * particles a studio mount emits (leaves, petals, chimney smoke: workfx). Summer is today's picture,
 * exactly: at summer every factor is 0 and each patched program takes the branch that changes nothing.
 *
 *   spring   fresh light greens, blossom on some trees, more flowers in the grass
 *   summer   today
 *   autumn   gold, orange and red foliage, varied per tree; fields gone gold; the grass drier; warm light
 *   winter   a lasting snow on what faces up, bare-ish (dark, grey) canopies with the pines kept green,
 *            frozen ponds, cooler light
 */
import type { BufferGeometry, Object3D, WebGLProgramParametersWithUniforms } from "three"
import { batchGeometry } from "./batchGeometry.ts"
import { SNOW_COVER } from "./events/snowCover.ts"
import type { Stage } from "./stage.ts"

export type SeasonName = "spring" | "summer" | "autumn" | "winter"
export const SEASON_NAMES: readonly SeasonName[] = ["spring", "summer", "autumn", "winter"]

/** Where each season's heart is on the 0 … 4 wheel. */
export const SEASON_AT: Readonly<Record<SeasonName, number>> = { spring: 0, summer: 1, autumn: 2, winter: 3 }

/** The heart of spring, as a day of the year from 1 January (0-based): 20 April. Summer's is 20 July. */
export const SPRING_DAY = 109
/** A season's length in days. */
export const SEASON_DAYS = 365.2425 / 4

const DAY_MS = 86_400_000

/** The wheel, wrapped into [0, 4). */
export const wrapSeason = (s: number): number => (Number.isFinite(s) ? ((s % 4) + 4) % 4 : SEASON_AT.summer)

/** The day of the year of an epoch-ms date (UTC), 0-based and fractional: 1 January 00:00 is 0. */
export function dayOfYear(ms: number): number {
  const d = new Date(ms)
  return (ms - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY_MS
}

/**
 * The season of a date on the wheel (northern hemisphere): `(dayOfYear − SPRING_DAY) / SEASON_DAYS`,
 * wrapped. Continuous across the turn of the year (31 December runs into 1 January within a day's
 * step, give or take the leap day's quarter).
 */
export function seasonOfDate(ms: number): number {
  return wrapSeason((dayOfYear(ms) - SPRING_DAY) / SEASON_DAYS)
}

export interface SeasonWeights {
  spring: number
  summer: number
  autumn: number
  winter: number
}

/** How far from its heart a season holds whole (a quarter-season: ~23 days either side). */
const HOLD = 0.25

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * Each season's share at `s`: whole within `HOLD` of its heart, handed to the next across the half-season
 * between (a smoothstep, so the blend starts and ends with no kink). Two neighbours at most, adding to 1.
 */
export function seasonWeights(s: number): SeasonWeights {
  const at = wrapSeason(s)
  const w = (heart: number) => {
    const d = Math.abs(at - heart)
    return 1 - smooth(HOLD, 1 - HOLD, Math.min(d, 4 - d))
  }
  return { spring: w(0), summer: w(1), autumn: w(2), winter: w(3) }
}

/** The season whose heart is nearest `s`. */
export function seasonName(s: number): SeasonName {
  return SEASON_NAMES[Math.round(wrapSeason(s)) % 4] as SeasonName
}

/** What a Settings pick or a link names: a season, or "auto" (follow the date); null when unknown. */
export type SeasonPick = SeasonName | "auto"

/**
 * A Settings pick or a `?season=` value: `auto`, a season's name (or `fall`), a wheel value `0 … 4`, or
 * a date (`2024-12-20`). Returns the wheel value, "auto", or null for anything else.
 */
export function seasonPinOf(raw: string | null | undefined): number | "auto" | null {
  if (raw === null || raw === undefined) return null
  const v = raw.trim().toLowerCase()
  if (v === "" || v === "auto") return "auto"
  if (v === "fall") return SEASON_AT.autumn
  if (v in SEASON_AT) return SEASON_AT[v as SeasonName]
  if (/^-?\d+(\.\d+)?$/.test(v)) return wrapSeason(Number(v))
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) {
    const ms = Date.parse(v)
    return Number.isFinite(ms) ? seasonOfDate(ms) : null
  }
  return null
}

/** The shortest way round the wheel from `from` to `to`: the signed step, −2 … 2. */
export function seasonStep(from: number, to: number): number {
  const d = wrapSeason(to) - wrapSeason(from)
  return d > 2 ? d - 4 : d < -2 ? d + 4 : d
}

// ---- the GPU side ----

/**
 * The season factors every patched program shares (written once a frame by the drive, when they move):
 * the three non-summer seasons' weights, and the light's tint. All 0 (and the tint white) is summer.
 */
export const SEASON = {
  uSpring: { value: 0 },
  uAutumn: { value: 0 },
  uWinter: { value: 0 },
}

/** The ice on still inland water, 0 … 1 (water.ts reads it). */
export const ICE = { uIce: { value: 0 } }

/** How much lasting snow a whole winter lays (the frost floor, snowCover.ts). */
export const WINTER_SNOW = 0.82

/** Writes a wheel value to the shared factors (and the frost floor, the ice). */
export function applySeason(s: number): SeasonWeights {
  const w = seasonWeights(s)
  SEASON.uSpring.value = w.spring
  SEASON.uAutumn.value = w.autumn
  SEASON.uWinter.value = w.winter
  // the snow settles once winter has truly come and lies till it is going (patchy as it comes and goes)
  SNOW_COVER.uSnowFloor.value = WINTER_SNOW * smooth(0.15, 0.85, w.winter)
  ICE.uIce.value = smooth(0.35, 0.9, w.winter)
  return w
}

/** A tree's (a batch instance's) own number in [0, 1): an integer hash of where it stands, to 0.25 m. */
export function treeHash(x: number, z: number): number {
  const cx = (Math.floor(x * 4 + 0.5) + 65536) >>> 0
  const cz = (Math.floor(z * 4 + 0.5) + 65536) >>> 0
  let h = (Math.imul(cx, 0x8da6b343) ^ Math.imul(cz, 0xd8163841)) >>> 0
  h = (h ^ (h >>> 13)) >>> 0
  h = Math.imul(h, 0x5bd1e995) >>> 0
  h = (h ^ (h >>> 15)) >>> 0
  return (h & 0xffff) / 65535
}

/** A tree flowers in spring when its hash is past this (about one tree in seven). */
export const BLOSSOM_FROM = 0.86

const HASH_GLSL = /* glsl */ `
float seasonHash( vec2 xz ) {
	uvec2 c = uvec2( ivec2( floor( xz * 4.0 + 0.5 ) ) + 65536 );
	uint h = ( c.x * 0x8da6b343u ) ^ ( c.y * 0xd8163841u );
	h ^= h >> 13u;
	h *= 0x5bd1e995u;
	h ^= h >> 15u;
	return float( h & 0xffffu ) / 65535.0;
}`

/**
 * The vertex side, for the batch: what each vertex is to the seasons, by its palette swatch (`_swatch`,
 * the piece's own before any re-tint): 1 a canopy (KayKit's leaf greens: grass-dark, grass, grass-light,
 * leaf), 2 a pine, 3 a crop or a meadow plant (moss), 0 anything else; and the tree's own hash from
 * where its instance stands.
 */
const VERTEX_PARS = /* glsl */ `
attribute float _swatch;
// (not flat: on Metal, ANGLE emulates GL's provoking vertex for a flat varying by rewriting the index
// buffers, which stalled the static batch's multi-draw for minutes; every vertex of a face carries the same)
varying vec2 vSeason;
${HASH_GLSL}`

const VERTEX = /* glsl */ `
{
	float sw = _swatch;
	float kind = ( sw < 2.5 || abs( sw - 34.0 ) < 0.5 ) ? 1.0 : abs( sw - 33.0 ) < 0.5 ? 2.0 : abs( sw - 35.0 ) < 0.5 ? 3.0 : 0.0;
	vec3 seasonOrigin = vec3( 0.0 );
	#ifdef USE_BATCHING
	seasonOrigin = batchingMatrix[ 3 ].xyz;
	#endif
	#ifdef USE_INSTANCING
	seasonOrigin = instanceMatrix[ 3 ].xyz;
	#endif
	seasonOrigin = ( modelMatrix * vec4( seasonOrigin, 1.0 ) ).xyz;
	vSeason = vec2( kind, seasonHash( seasonOrigin.xz ) );
}`

/** How much snow a bare winter canopy carries (0: bare brown crowns; 1: white with snow). */
export const WINTER_LADEN = 0.8

/** Colours (linear) the foliage turns to, and the reference green they are scaled from. */
const FRAGMENT_PARS = /* glsl */ `
uniform float uSpring;
uniform float uAutumn;
uniform float uWinter;
float seasonLum( vec3 c ) { return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); }
// a colour with the brightness of c (its shading kept), toward the hue of tint
vec3 seasonHue( vec3 c, vec3 tint ) { return tint * ( seasonLum( c ) / seasonLum( tint ) ); }
`

const FOLIAGE = /* glsl */ `
if ( uSpring + uAutumn + uWinter > 0.0 && vSeason.x > 0.5 ) {
	vec3 c = diffuseColor.rgb;
	float h = vSeason.y;
	float lum = seasonLum( c );
	vec3 grey = vec3( lum );
	if ( vSeason.x < 1.5 ) {
		// a canopy
		// spring: fresher and lighter (a region's own tone kept under it); a tree in seven flowers
		vec3 spring = c * vec3( 1.04, 1.16, 0.82 );
		if ( h > ${BLOSSOM_FROM.toFixed(2)} ) {
			vec3 petal = fract( h * 37.0 ) < 0.5 ? vec3( 0.93, 0.42, 0.5 ) : vec3( 0.95, 0.72, 0.78 );
			spring = petal * ( 0.55 + 0.9 * lum / 0.16 ) * 0.5;
		}
		// autumn: gold, orange, red, the odd one still green, each tree its own
		vec3 tint = h < 0.16 ? vec3( 0.24, 0.3, 0.045 ) : h < 0.46 ? vec3( 0.86, 0.6, 0.07 ) : h < 0.78 ? vec3( 0.8, 0.3, 0.04 ) : vec3( 0.56, 0.085, 0.03 );
		vec3 autumn = seasonHue( c, tint ) * ( 0.98 + 0.2 * fract( h * 13.0 ) );
		// winter: bare-ish, a grey-brown of the leaf's own brightness, laden with snow on all but its underside
		vec3 winter = grey * vec3( 1.0, 0.8, 0.62 ) * 0.8;
		#ifndef FLAT_SHADED
		float laden = smoothstep( -0.35, 0.45, inverseTransformDirection( normalize( vNormal ), viewMatrix ).y ) * ( 0.6 + 0.4 * fract( h * 7.0 ) );
		winter = mix( winter, vec3( 0.86, 0.9, 0.95 ), ${WINTER_LADEN.toFixed(2)} * laden * smoothstep( 0.3, 1.0, uWinter ) );
		#endif
		c = mix( c, spring, uSpring );
		c = mix( c, autumn, uAutumn );
		c = mix( c, winter, uWinter );
	} else if ( vSeason.x < 2.5 ) {
		// a pine keeps its needles: fresher in spring, darker and greyer in the cold
		c = mix( c, c * vec3( 1.04, 1.12, 0.9 ), uSpring );
		c = mix( c, mix( c, grey, 0.35 ) * 0.85, uWinter );
	} else {
		// a crop or a meadow plant: fresh in spring, ripe gold in autumn, dead straw in winter
		c = mix( c, c * vec3( 1.02, 1.14, 0.85 ), uSpring );
		c = mix( c, seasonHue( c, vec3( 0.62, 0.42, 0.08 ) ) * 1.1, uAutumn );
		c = mix( c, grey * vec3( 1.0, 0.84, 0.66 ) * 0.8, uWinter );
	}
	diffuseColor.rgb = c;
}`

/** The ground: the green (its grass) goes fresh in spring, drier in autumn, dull under winter's snow. */
const GROUND = /* glsl */ `
if ( uSpring + uAutumn + uWinter > 0.0 ) {
	vec3 c = diffuseColor.rgb;
	float green = smoothstep( 1.0, 1.25, c.g / max( c.r, 1e-4 ) ) * step( c.b * 1.4, c.g );
	vec3 grey = vec3( seasonLum( c ) );
	vec3 g = c;
	g = mix( g, g * vec3( 1.0, 1.08, 0.86 ), uSpring );
	g = mix( g, seasonHue( g, vec3( 0.36, 0.38, 0.06 ) ), 0.55 * uAutumn );
	g = mix( g, mix( g, grey * vec3( 0.95, 0.92, 0.82 ), 0.6 ) * 0.85, uWinter );
	diffuseColor.rgb = mix( c, g, green );
}`

/** The light: a touch warmer in autumn, cooler in winter. */
const LIGHT = /* glsl */ `
if ( uAutumn + uWinter > 0.0 ) {
	outgoingLight *= mix( vec3( 1.0 ), vec3( 1.035, 1.0, 0.93 ), uAutumn ) * mix( vec3( 1.0 ), vec3( 0.93, 0.98, 1.07 ), uWinter );
}`

const COLOUR = "#include <alphamap_fragment>"
const OPAQUE = "#include <opaque_fragment>"

/**
 * `onBeforeCompile` for a lit material: the season's tint. `batch`: the static batch (its vertices
 * carry `_swatch`): foliage, pines and crops by swatch, each tree by its own hash. `ground`: the ground
 * mesh's green. `light`: only the light's warmth (the plain palette material: walls, roofs, the
 * frontier's skirt). At summer every branch is skipped: the program draws as before.
 */
export function patchSeason(
  shader: WebGLProgramParametersWithUniforms,
  kind: "batch" | "ground" | "light",
): void {
  if (!shader.fragmentShader.includes(COLOUR) || !shader.fragmentShader.includes(OPAQUE)) return
  Object.assign(shader.uniforms, SEASON)
  const tint = kind === "batch" ? FOLIAGE : kind === "ground" ? GROUND : ""
  shader.fragmentShader = shader.fragmentShader
    .replace(
      "void main() {",
      () => `${FRAGMENT_PARS}${kind === "batch" ? "varying vec2 vSeason;\n" : ""}\nvoid main() {`,
    )
    .replace(COLOUR, () => `${tint}\n${COLOUR}`)
    .replace(OPAQUE, () => `${LIGHT}\n${OPAQUE}`)
  if (kind === "batch")
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", () => `${VERTEX_PARS}\nvoid main() {`)
      .replace("#include <begin_vertex>", () => `#include <begin_vertex>\n${VERTEX}`)
}

/** Conifers (KayKit's pointed tree-4, the world's "pine" family): their needles keep through the year. */
export const isEvergreen = (piece: string): boolean => /^kaykit-forest\/tree-4-/.test(piece)

/** The canopy swatches a conifer's batch geometry reads as pine (only `_swatch`: its colours are untouched). */
const NEEDLES = new Set([0, 1, 2, 34])

/** Marks a conifer's batch geometry: its leaf swatches read as pine (33), so the season keeps it green. */
export function markEvergreen(geometry: BufferGeometry): void {
  const swatch = geometry.getAttribute("_swatch")
  if (!swatch) return
  const bytes = swatch.array as Uint8Array
  for (let v = 0; v < bytes.length; v++) if (NEEDLES.has(bytes[v] as number)) bytes[v] = 33
  swatch.needsUpdate = true
}

/**
 * A loaded piece's vertices in its own space: positions and palette swatches, every mesh merged with its
 * node's transform (what a chimney is found on, studio hexworld/seasonFx.ts).
 */
export function pieceVertices(root: Object3D): { position: Float32Array; swatch: Uint8Array }[] {
  const g = batchGeometry(root)
  const out = {
    position: g.getAttribute("position").array as Float32Array,
    swatch: g.getAttribute("_swatch").array as Uint8Array,
  }
  g.dispose()
  return [out]
}

// ---- the drive ----

/** Seconds a jump of the season takes (a pick in Settings, a seek of the history). */
export const SEASON_EASE_S = 1.6
/** A step bigger than this in one frame is a jump: eased, not followed. */
export const SEASON_JUMP = 0.08

export interface SeasonDrive {
  /** Where the wheel is now (0 … 4). */
  at(): number
  weights(): SeasonWeights
  /**
   * Toward `s`: a small step (a playing history, a day going by) is followed at once; a jump eases round
   * the shortest way over `SEASON_EASE_S`. `now`: land at once (shots, the first frame).
   */
  set(s: number, now?: boolean): void
  stats(): { season: number; name: SeasonName; easing: boolean; ms: number }
  dispose(): void
}

/** The season on the GPU, moved a frame at a time. Starts at `start` (default summer) at once. */
export function createSeasonDrive(
  stage: Pick<Stage, "onFrame">,
  start: number = SEASON_AT.summer,
): SeasonDrive {
  let at = wrapSeason(start)
  let goal = at
  let from = at
  let t = 0
  let easing = false
  let costs = 0
  let frames = 0
  let w = applySeason(at)
  const off = stage.onFrame((dt) => {
    if (!easing) return
    const t0 = performance.now()
    t += dt
    const k = Math.min(1, t / SEASON_EASE_S)
    const e = k * k * (3 - 2 * k)
    at = wrapSeason(from + seasonStep(from, goal) * e)
    if (k >= 1) {
      at = goal
      easing = false
    }
    w = applySeason(at)
    costs += performance.now() - t0
    frames++
  })
  return {
    at: () => at,
    weights: () => w,
    set(s, now = false) {
      const next = wrapSeason(s)
      if (next === goal && !now) return
      const moved = Math.abs(seasonStep(goal, next))
      goal = next
      if (now || (!easing && Math.abs(seasonStep(at, next)) <= SEASON_JUMP)) {
        at = next
        easing = false
        w = applySeason(at)
        return
      }
      // a goal that only creeps on while an ease is under way (a history playing after a seek) is
      // simply where the ease now lands; a new jump starts the ease again from here
      if (easing && moved <= SEASON_JUMP) return
      from = at
      t = 0
      easing = true
    },
    stats: () => ({ season: at, name: seasonName(at), easing, ms: frames ? costs / frames : 0 }),
    dispose() {
      off()
    },
  }
}
