import { Effect } from "postprocessing"
import { Data3DTexture, LinearFilter, RGBAFormat, Uniform } from "three"
import type { Mood } from "../../world/moods.ts"
import { bakeLut, copyLook, createLook, lookDistance, lookFor } from "./lut.ts"
import type { SkyState } from "./sky.ts"

/** Table size: 16³ RGBA8 = 16 KB, re-baked in ~0.3 ms when the look has moved. */
const SIZE = 16
/** Re-bake once the blended look has moved this far (in its own numbers). */
const REBAKE = 0.004

/**
 * The mood LUT (lut.ts) as a post effect: one 3D-texture tap per pixel, merged into the same
 * effect pass as the grade, tone mapping and vignette (no extra pass). Sits after tone mapping,
 * where colours are display-referred 0–1, as a LUT expects.
 */
export class MoodLutEffect extends Effect {
  private readonly texture: Data3DTexture
  private readonly data = new Uint8Array(SIZE * SIZE * SIZE * 4)
  private readonly wanted = createLook()
  private readonly baked = createLook()
  private first = true

  constructor() {
    const texture = new Data3DTexture(new Uint8Array(SIZE * SIZE * SIZE * 4), SIZE, SIZE, SIZE)
    super("MoodLutEffect", FRAGMENT, {
      uniforms: new Map<string, Uniform>([
        ["lut", new Uniform(texture)],
        ["lutScale", new Uniform((SIZE - 1) / SIZE)],
        ["lutOffset", new Uniform(0.5 / SIZE)],
      ]),
    })
    texture.format = RGBAFormat
    texture.minFilter = LinearFilter
    texture.magFilter = LinearFilter
    texture.unpackAlignment = 1
    this.texture = texture
  }

  /** Blend this moment's look and re-bake the table if it has moved enough to see. */
  apply(sky: SkyState, mood: Mood["id"]): void {
    lookFor(this.wanted, mood, { golden: sky.golden, night: sky.night, storm: sky.storm })
    if (!this.first && lookDistance(this.wanted, this.baked) < REBAKE) return
    this.first = false
    copyLook(this.baked, this.wanted)
    bakeLut(this.baked, SIZE, this.data)
    ;(this.texture.image as { data: Uint8Array }).data.set(this.data)
    this.texture.needsUpdate = true
  }

  override dispose(): void {
    this.texture.dispose()
    super.dispose()
  }
}

const FRAGMENT = /* glsl */ `
uniform highp sampler3D lut;
uniform float lutScale;
uniform float lutOffset;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = sqrt(clamp(inputColor.rgb, 0.0, 1.0));
  vec3 g = texture(lut, c * lutScale + lutOffset).rgb;
  outputColor = vec4(g * g, inputColor.a);
}
`
