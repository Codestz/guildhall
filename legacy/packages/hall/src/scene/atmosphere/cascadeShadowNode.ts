import { DirectionalLight, Object3D } from "three"
import {
  BasicShadowFilter,
  Fn,
  float,
  If,
  lightShadowMatrix,
  min,
  reference,
  renderGroup,
  select,
  shadow,
  shadowPositionWorld,
  smoothstep,
  vec4,
} from "three/tsl"
import { type NodeBuilder, ShadowBaseNode, type Node as TNode } from "three/webgpu"
import { FADE } from "./cascadeChunk.ts"
import type { CascadeLight } from "./cascadeDrive.ts"
import { CharacterShadowNode } from "./characterShadowNode.ts"

/**
 * The node half of cascaded shadows (cascades.ts), where cascadeChunk.ts is the GLSL half: one
 * shadow lookup that takes the tightest map holding the pixel and blends into the next over the
 * outer `FADE` of its width, node for node as `getCascadedShadow()` does. It serves both node
 * paths: WebGPU, where `CascadeShadowNode` is the key light's own shadow node over `Caster`s that
 * draw their maps, and `?tsl=1` on WebGL, where grassNodes.ts feeds `cascadeLookup` the maps the
 * WebGLRenderer already draws.
 *
 * Why a shadow node and not one directional light per cascade (as WebGL has): every light the
 * lighting loop sees runs its shadow lookup for every pixel, intensity 0 or not, so three lights
 * would cost three five-tap lookups everywhere. Here the lookup is one node: the cascades after
 * the first are sampled only where the pixel is near an outer edge, and they take one tap.
 * three's own CSMShadowNode splits the camera's view by depth, redraws all its maps every frame
 * and cannot be fitted; these are fitted, static boxes with the cache of cascadeDrive.ts.
 */

/** A cascade as the lookup reads it: its shadow, and the matrix that takes a world position to its map. */
export interface CascadeMap {
  /** Its shadow (0 shadowed, 1 lit) at the shadow position, already scaled by the shadow's intensity. */
  shadow: TNode<"float">
  /** World → the map's uv and depth (an orthographic light camera: w is 1). */
  matrix: TNode<"mat4">
  /** Builds the shadow position (a ShadowBaseNode has the way to). */
  position: Pick<ShadowBaseNode, "setupShadowPosition">
}

/** The characters' map as the lookup reads it: a map like any, and whether anyone is drawn in it. */
export interface HeldMap extends CascadeMap {
  on: TNode<"bool">
}

/**
 * The tightest cascade that holds the pixel, blended into the next at its outer edge. With `held`
 * (the characters' map, characterShadows.ts) the darker of that and the cascades inside its box,
 * faded at the box's edge: GLSL's `held` in cascadeChunk.ts `getCascadedShadow`.
 */
export function cascadeLookup(cascades: CascadeMap[], held?: HeldMap): TNode<"float"> {
  return Fn((builder: NodeBuilder) => {
    const first = cascades[0]
    if (!first) return float(1)
    first.position.setupShadowPosition(builder)
    const at = vec4(shadowPositionWorld as unknown as TNode<"vec3">, 1)
    const weightIn = (map: CascadeMap) => {
      const coord = map.matrix.mul(at).xyz.toVar()
      const edge = min(min(coord.x, coord.x.oneMinus()), min(coord.y, coord.y.oneMinus()))
      const inside = coord.z.greaterThanEqual(0).and(coord.z.lessThanEqual(1))
      return select(inside, smoothstep(0, FADE, edge), float(0)).toVar()
    }
    const lit = float(0).toVar()
    const rest = float(1).toVar()
    for (const cascade of cascades) {
      If(rest.greaterThan(0.001), () => {
        const weight = weightIn(cascade)
        If(weight.greaterThan(0), () => {
          lit.addAssign(rest.mul(weight).mul(cascade.shadow))
          rest.mulAssign(weight.oneMinus())
        })
      })
    }
    const cascaded = lit.add(rest)
    if (!held) return cascaded
    // Sampled only inside the box and only while someone is drawn in it.
    const darker = float(1).toVar()
    If(held.on, () => {
      const weight = weightIn(held)
      If(weight.greaterThan(0), () => {
        darker.assign(weight.oneMinus().add(weight.mul(held.shadow)))
      })
    })
    return min(cascaded, darker)
  })() as unknown as TNode<"float">
}

/**
 * A far cascade's texels are coarse already: one hardware-filtered tap (four texels) is enough, and
 * costs a fifth of the stock five-tap disc the near cascade keeps (cascadeChunk.ts `getFarShadow`).
 */
export function farFilter(shadowOf: object): void {
  ;(shadowOf as { filterNode?: unknown }).filterNode = BasicShadowFilter
}

/**
 * A cascade's bare caster: the light camera of a cascade and the place it stands, with no light in
 * the scene (the key light is the one that lights). cascadeDrive.ts fits it; its shadow node draws
 * its map.
 */
export class Caster extends Object3D implements CascadeLight {
  readonly target = new Object3D()
  override readonly castShadow = true
  readonly shadow: DirectionalLight["shadow"]

  constructor(map: number, far: boolean) {
    super()
    this.shadow = new DirectionalLight().shadow
    this.shadow.mapSize.set(map, map)
    if (far) farFilter(this.shadow)
  }
}

/**
 * The key light's shadow on WebGPU: set as `light.shadow.shadowNode`, so every lit material (and
 * the island's own node materials, grassNodes.ts `keyShadow`) takes the cascaded term. The light is
 * the one that lights; the casters are `Caster`s the node owns the maps of.
 */
export class CascadeShadowNode extends ShadowBaseNode {
  private readonly maps: CascadeMap[]
  private readonly drawn: ReturnType<typeof shadow>[]
  private readonly held: HeldMap | undefined

  /** `held`: the characters' caster, when the tier has them cast (characterShadows.ts). */
  constructor(
    light: DirectionalLight,
    readonly casters: Caster[],
    readonly characters?: Caster,
  ) {
    super(light)
    this.drawn = casters.map((caster) => shadow(caster as never, caster.shadow))
    this.maps = casters.map((caster, k) => ({
      shadow: this.drawn[k] as unknown as TNode<"float">,
      matrix: lightShadowMatrix(caster as never) as unknown as TNode<"mat4">,
      position: this,
    }))
    if (characters) {
      const own = new CharacterShadowNode(characters as never, characters.shadow)
      this.drawn.push(own)
      this.held = {
        shadow: own as unknown as TNode<"float">,
        matrix: lightShadowMatrix(characters as never) as unknown as TNode<"mat4">,
        position: this,
        // Off (intensity 0) when no one is in the box: nothing is drawn, nothing is read.
        on: (
          reference("intensity", "float", characters.shadow) as unknown as {
            setGroup(group: unknown): TNode<"float">
          }
        )
          .setGroup(renderGroup)
          .greaterThan(0),
      }
    }
  }

  override setup(): TNode<"float"> {
    return cascadeLookup(this.maps, this.held)
  }

  /** The maps are drawn by their own nodes; this one only has to exist in the graph. */
  override updateBefore(): undefined {
    return undefined
  }

  override dispose(): void {
    for (const node of this.drawn) node.dispose()
    for (const caster of [...this.casters, ...(this.characters ? [this.characters] : [])])
      caster.shadow.dispose()
    super.dispose()
  }
}
