/**
 * What the event FX draw with: the palette material's light (vertex colours, the cascades' shadows,
 * the clouds' shade) for instanced meshes, plus two things per instance. `instanceSeen` (0 … 1) fades
 * an instance in or out with a screen-space dither, so nothing ever pops at any distance; and the
 * vertices a geometry marks with `tint` 1 take the instance's colour (a ship's pennant), the rest keep
 * their own. And a box builder for the FX's own stylised parts, in palette colours.
 */

import { PALETTE } from "@guildhall/assets"
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  MeshStandardMaterial,
  type WebGLProgramParametersWithUniforms,
} from "three"
import { patchCloudShade } from "../atmosphere/shade.ts"
import { patchCascades } from "../sun/patch.ts"

const VERTEX_PARS = /* glsl */ `
attribute float tint;
attribute float instanceSeen;
varying float vSeen;
`
const COLOUR_VERTEX = /* glsl */ `
vColor = vec4( 1.0 );
#if defined( USE_COLOR )
  vColor.rgb *= color.rgb;
#endif
#ifdef USE_INSTANCING_COLOR
  vColor.rgb = mix( vColor.rgb, instanceColor.rgb, tint );
#endif
vSeen = instanceSeen;
`
const FRAGMENT_PARS = /* glsl */ `
varying float vSeen;
`
const DISCARD = /* glsl */ `
#include <clipping_planes_fragment>
if ( vSeen < 0.999 ) {
  float n = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
  if ( vSeen <= n ) discard;
}
`

/**
 * A geometry fitted per instance (`anchored`): each vertex's `anchor` (x, y, z multipliers) says how
 * far it moves as the instance's `instanceSize` differs from the size the geometry was built at, so a
 * frame stretches round a bigger building and its members keep their thickness.
 */
const anchoredVertex = ([x, y, z]: readonly [number, number, number]) => /* glsl */ `
vec3 transformed = vec3( position ) + anchor * ( instanceSize - vec3( ${x.toFixed(4)}, ${y.toFixed(4)}, ${z.toFixed(4)} ) );
`

export interface FxMaterialOpts {
  /** The size the geometry was built at: it takes `anchor` and `instanceSize` (a scaffold's frame). */
  anchored?: readonly [number, number, number]
  /** Extra vertex and fragment patches (a ship's flare): GLSL chunks replaced, after the FX's own. */
  patch?: (shader: WebGLProgramParametersWithUniforms) => void
}

/** The FX's instanced palette material (one per kind, `key` names its program). */
export function fxMaterial(key: string, opts: FxMaterialOpts = {}): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 })
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    patchCascades(shader)
    patchCloudShade(shader)
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>\n${VERTEX_PARS}${opts.anchored ? "attribute vec3 anchor;\nattribute vec3 instanceSize;\n" : ""}`,
      )
      .replace("#include <color_vertex>", COLOUR_VERTEX)
    if (opts.anchored)
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        anchoredVertex(opts.anchored),
      )
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${FRAGMENT_PARS}`)
      .replace("#include <clipping_planes_fragment>", DISCARD)
    opts.patch?.(shader)
  }
  material.customProgramCacheKey = () => `guildhall-fx-${key}`
  return material
}

/** A palette swatch's colour, linear (as vertex colours are). */
export function swatch(name: string): [number, number, number] {
  const s = PALETTE.swatches.find((w) => w.name === name)
  if (!s) throw new Error(`fx: no swatch "${name}"`)
  // three's colour management reads the hex as sRGB and keeps it linear
  const c = new Color(s.hex)
  return [c.r, c.g, c.b]
}

const CORNERS = [
  [-1, -1, -1],
  [1, -1, -1],
  [1, 1, -1],
  [-1, 1, -1],
  [-1, -1, 1],
  [1, -1, 1],
  [1, 1, 1],
  [-1, 1, 1],
] as const
const FACES = [
  [0, 3, 2, 1],
  [4, 5, 6, 7],
  [0, 1, 5, 4],
  [3, 7, 6, 2],
  [0, 4, 7, 3],
  [1, 2, 6, 5],
] as const
const NORMALS = [
  [0, 0, -1],
  [0, 0, 1],
  [0, -1, 0],
  [0, 1, 0],
  [-1, 0, 0],
  [1, 0, 0],
] as const

/**
 * Collects boxes (flat-shaded, palette-coloured) into one geometry with `tint` 0: each box a half
 * size, a centre and a turn about y, or two ends and a thickness (a beam between two points).
 */
export class Boxes {
  private pos: number[] = []
  private nor: number[] = []
  private col: number[] = []

  box(
    half: [number, number, number],
    at: [number, number, number],
    colour: [number, number, number],
    yaw = 0,
  ): this {
    const c = Math.cos(yaw)
    const s = Math.sin(yaw)
    FACES.forEach((face, f) => {
      const n = NORMALS[f] as readonly number[]
      const nx = (n[0] as number) * c + (n[2] as number) * s
      const nz = -(n[0] as number) * s + (n[2] as number) * c
      for (const k of [0, 1, 2, 0, 2, 3]) {
        const p = CORNERS[face[k] as number] as readonly number[]
        const x = (p[0] as number) * half[0]
        const y = (p[1] as number) * half[1]
        const z = (p[2] as number) * half[2]
        this.pos.push(at[0] + x * c + z * s, at[1] + y, at[2] - x * s + z * c)
        this.nor.push(nx, n[1] as number, nz)
        this.col.push(...colour)
      }
    })
    return this
  }

  /** A square beam `thick` metres across from `a` to `b`. */
  beam(
    a: [number, number, number],
    b: [number, number, number],
    thick: number,
    colour: [number, number, number],
  ): this {
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const dz = b[2] - a[2]
    const length = Math.hypot(dx, dy, dz)
    const flat = Math.hypot(dx, dz)
    const start = this.pos.length
    // a box along +y, tipped to the beam's slope, turned to its heading
    this.box([thick / 2, length / 2, thick / 2], [0, 0, 0], colour)
    const tilt = Math.atan2(flat, dy)
    const yaw = Math.atan2(dx, dz)
    const ct = Math.cos(tilt)
    const st = Math.sin(tilt)
    const cy = Math.cos(yaw)
    const sy = Math.sin(yaw)
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
    for (let i = start; i < this.pos.length; i += 3) {
      for (const [arr, offset] of [
        [this.pos, true],
        [this.nor, false],
      ] as const) {
        const x = arr[i] as number
        const y = arr[i + 1] as number
        const z = arr[i + 2] as number
        // tilt about x (y toward z), then yaw about y
        const y1 = y * ct - z * st
        const z1 = y * st + z * ct
        const x2 = x * cy + z1 * sy
        const z2 = -x * sy + z1 * cy
        arr[i] = x2 + (offset ? (mid[0] as number) : 0)
        arr[i + 1] = y1 + (offset ? (mid[1] as number) : 0)
        arr[i + 2] = z2 + (offset ? (mid[2] as number) : 0)
      }
    }
    return this
  }

  get vertices(): number {
    return this.pos.length / 3
  }

  geometry(): BufferGeometry {
    const g = new BufferGeometry()
    g.setAttribute("position", new BufferAttribute(new Float32Array(this.pos), 3))
    g.setAttribute("normal", new BufferAttribute(new Float32Array(this.nor), 3))
    g.setAttribute("color", new BufferAttribute(new Float32Array(this.col), 3))
    g.setAttribute("tint", new BufferAttribute(new Float32Array(this.vertices), 1))
    return g
  }
}
