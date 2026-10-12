import { type Camera, MathUtils, Vector2, Vector3, Vector4 } from "three"
import { blocked, type ReliefHeight } from "./sight.ts"

/**
 * The see-through cut (terrain v2 §5): a figure the relief hides from the camera shows through it
 * as a soft hole in the mountain, dithered on a Bayer pattern. It lives in the relief's material
 * (snow.ts and its twin snowNodes.ts patch it in), so it costs no draw call, and hex tiles and
 * buildings, which have no such material, are never cut.
 *
 * CPU: `Cutaway.update` finds the figures that relief hides (a ray from the camera, sight.ts),
 * keeps the MAX_CUTS nearest the middle of the screen, and writes each one's screen position, hole
 * size and depth into `dots`. GPU: a fragment inside a dot's circle and nearer the camera than the
 * figure is discarded where the dither says so. Holes ease open and shut (FADE_S).
 */

export const MAX_CUTS = 8
/** Seconds a hole takes to open or close. */
const FADE_S = 0.25
/** Seconds between looks for who is hidden; the holes follow their figures every frame. */
const SCAN_S = 0.1
/** A figure's head and chest above its feet: what is looked for, and where the hole is deep. */
const HEAD = 1.8
const CHEST = 1.1
/** Hole radius as a multiple of the figure's height on screen, and its bounds (NDC, up the screen). */
const SPREAD = 1.5
const RADIUS: readonly [number, number] = [0.07, 0.4]
/** Fragments within this much of the figure's depth stay: the ground it stands on. */
export const CUT_DEPTH = 1
/** Where the hole's circle starts to fade from solid, as a share of its radius. */
export const CUT_SOFT = 0.55

/** A figure's hole, opening or closing. */
interface Hole {
  at: Vector3
  /** 0 shut .. 1 open. */
  open: number
  wanted: boolean
}

/** The uniforms (shared by every relief material) and the state behind them. */
export class Cutaway {
  /** Per hole: x, y centre in NDC, z radius in NDC-up units, w the figure's depth in front of the camera. */
  readonly dots = Array.from({ length: MAX_CUTS }, () => new Vector4())
  /** x: the screen's aspect (width over height), y: how many holes are open. */
  readonly view = new Vector2(1, 0)
  private holes: Hole[] = []
  private scanIn = 0
  private readonly feet = new Vector3()
  private readonly head = new Vector3()
  private readonly tmp = new Vector3()

  /**
   * One frame. `figures` are positions on the ground; `heightAt` and `peak` are the relief's
   * (without relief nothing is cut).
   */
  update(
    dt: number,
    camera: Camera,
    aspect: number,
    figures: Iterable<Vector3>,
    heightAt: ReliefHeight | undefined,
    peak: number,
  ): void {
    this.view.x = aspect
    this.scanIn -= dt
    if (!heightAt) this.holes.length = 0
    else if (this.scanIn <= 0) {
      this.scanIn = SCAN_S
      this.scan(camera, figures, heightAt, peak)
    }
    this.write(dt, camera)
  }

  /** Marks who is hidden and nearest the middle of the screen (at most MAX_CUTS) as wanted. */
  private scan(camera: Camera, figures: Iterable<Vector3>, heightAt: ReliefHeight, peak: number): void {
    const found: { at: Vector3; near: number }[] = []
    for (const at of figures) {
      const head = this.head.set(at.x, at.y + HEAD, at.z)
      const centre = this.tmp.copy(head).project(camera)
      if (Math.abs(centre.x) > 1.05 || Math.abs(centre.y) > 1.05) continue
      if (blocked(heightAt, peak, head, camera.position))
        found.push({ at, near: Math.hypot(centre.x, centre.y) })
    }
    found.sort((a, b) => a.near - b.near)
    for (const hole of this.holes) hole.wanted = false
    for (const { at } of found.slice(0, MAX_CUTS)) {
      const hole = this.holes.find((h) => h.at === at)
      if (hole) hole.wanted = true
      else this.holes.push({ at, open: 0, wanted: true })
    }
    // Over capacity: the ones closing give way first.
    this.holes.sort((a, b) => Number(b.wanted) - Number(a.wanted))
    this.holes.length = Math.min(this.holes.length, MAX_CUTS)
  }

  /** Opens and closes the holes, and writes the open ones where their figures are on screen now. */
  private write(dt: number, camera: Camera): void {
    camera.updateMatrixWorld()
    const { feet, head, tmp, holes } = this
    let kept = 0
    let count = 0
    for (const hole of holes) {
      hole.open = MathUtils.clamp(hole.open + (hole.wanted ? dt : -dt) / FADE_S, 0, 1)
      if (!hole.wanted && hole.open <= 0) continue
      holes[kept++] = hole
      if (hole.open <= 0) continue
      const { x, y, z } = hole.at
      const depth = -tmp.set(x, y + CHEST, z).applyMatrix4(camera.matrixWorldInverse).z
      feet.set(x, y, z).project(camera)
      head.set(x, y + HEAD, z).project(camera)
      const eased = hole.open * hole.open * (3 - 2 * hole.open)
      const tall = MathUtils.clamp(Math.abs(head.y - feet.y) * SPREAD, RADIUS[0], RADIUS[1])
      this.dots[count++]?.set(feet.x, (feet.y + head.y) / 2, tall * eased, depth)
    }
    holes.length = kept
    this.view.y = count
  }
}

/** The one cut every relief material reads (scene/terrain/useCutaway.ts feeds it). */
export const cutaway = new Cutaway()

/** The 4×4 Bayer threshold of a pixel, in (0, 1): what GLSL `reliefBayer` below computes (for tests). */
export function bayer4(x: number, y: number): number {
  const xs = x & 3
  const ys = y & 3
  const lo = (xs & 1) ^ (ys & 1)
  const hi = (xs >> 1) ^ (ys >> 1)
  return (lo * 8 + (ys & 1) * 4 + hi * 2 + (ys >> 1) + 0.5) / 16
}

/** GLSL, patched into the relief's material by snow.ts (WebGL). The node twin is cutawayNodes.ts. */
export const CUT_VERTEX_PARS = /* glsl */ `varying vec4 vCutClip;`
export const CUT_VERTEX = /* glsl */ `vCutClip = vec4( ( projectionMatrix * mvPosition ).xyw, - mvPosition.z );`
export const CUT_FRAGMENT_PARS = /* glsl */ `
varying vec4 vCutClip;
uniform vec4 uCutDots[ ${MAX_CUTS} ];
uniform vec2 uCutView;
float reliefBayer( vec2 p ) {
	vec2 q = mod( floor( p ), 4.0 );
	vec2 lo = mod( q, 2.0 );
	vec2 hi = floor( q * 0.5 );
	return ( abs( lo.x - lo.y ) * 8.0 + lo.y * 4.0 + abs( hi.x - hi.y ) * 2.0 + hi.y + 0.5 ) / 16.0;
}
`
export const CUT_FRAGMENT = /* glsl */ `
vec2 reliefNdc = vCutClip.xy / vCutClip.z;
float reliefDither = reliefBayer( gl_FragCoord.xy );
for ( int i = 0; i < ${MAX_CUTS}; i ++ ) {
	if ( float( i ) >= uCutView.y ) break;
	vec4 hole = uCutDots[ i ];
	float inside = 1.0 - smoothstep( ${CUT_SOFT.toFixed(2)}, 1.0, length( ( reliefNdc - hole.xy ) * vec2( uCutView.x, 1.0 ) ) / hole.z );
	if ( inside > reliefDither && vCutClip.w < hole.w - ${CUT_DEPTH.toFixed(1)} ) discard;
}
`
