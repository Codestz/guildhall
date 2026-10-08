import { MathUtils, Vector2, Vector3 } from "three"
import { EASE } from "../weather/shared.ts"

/**
 * The one wind every layer reads (ADR 0007): which way it blows — from the west-south-west, so
 * clouds cross the overview diagonally — and how hard, eased once per frame from
 * `environment.wind` by the Weathervane at FRAME.SKY (scene/frame.ts). Materials that sway attach
 * `wind.uniforms` by reference (the GLSL is nature/shaders.ts `WIND_SWAY`; node materials read the
 * same objects through nature/grassNodes.ts `swayPlant` / `swayGrass`), so nothing copies it per frame.
 */
export const WIND_DIRECTION = new Vector3(1, 0, 0.35).normalize()

export const wind = {
  /** 0 calm … 1 storm, eased towards the environment's (about 1.5 s to settle). */
  strength: 0.2,
  uniforms: {
    /** Seconds since the page started (the render clock). */
    uTime: { value: 0 },
    uWind: { value: 0.2 },
    uWindDir: { value: new Vector2(WIND_DIRECTION.x, WIND_DIRECTION.z) },
  },
}

/** One frame of wind: ease towards `target`, and publish it with the clock to the shaders. */
export function stepWind(target: number, elapsed: number, delta: number): void {
  wind.strength = MathUtils.damp(wind.strength, target, EASE, delta)
  wind.uniforms.uTime.value = elapsed
  wind.uniforms.uWind.value = wind.strength
}
