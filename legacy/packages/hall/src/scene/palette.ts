import type { Texture } from "three"

/**
 * The hexagon pack's grass is a loud lime. It used to be tamed by multiplying the whole land
 * material by a grey-green, but every house, wall and roof shares that one palette texture, so
 * white plaster went dull teal and wood went muddy (the user: "textures are really low quality").
 * This calms only the lime swatches in the palette itself — yellow-green hues lose some saturation
 * and lean a little greener and darker — and leaves every other colour exactly as KayKit drew it.
 * Once per texture, on load (~10 ms for a 1024² atlas).
 */
const tamed = new WeakSet<Texture>()

export function tameLime(map: Texture | null | undefined): void {
  if (!map || tamed.has(map)) return
  const image = map.image as (CanvasImageSource & { width: number; height: number }) | undefined
  if (!image?.width || typeof document === "undefined") return
  tamed.add(map)
  const canvas = document.createElement("canvas")
  canvas.width = image.width
  canvas.height = image.height
  const g = canvas.getContext("2d", { willReadFrequently: true })
  if (!g) return
  g.drawImage(image, 0, 0)
  const pixels = g.getImageData(0, 0, canvas.width, canvas.height)
  const d = pixels.data
  for (let i = 0; i < d.length; i += 4) {
    const r = (d[i] ?? 0) / 255
    const gr = (d[i + 1] ?? 0) / 255
    const b = (d[i + 2] ?? 0) / 255
    const max = Math.max(r, gr, b)
    const min = Math.min(r, gr, b)
    const c = max - min
    if (c < 0.08 || max !== gr) continue
    // Hue in degrees (green is the max channel here: 60°–180°).
    let h = 60 * ((b - r) / c + 2)
    // Only lime and yellow-green: full effect 62°–96°, fading out by 52° and 110°.
    const w = Math.min(smooth(52, 62, h), 1 - smooth(96, 110, h))
    if (w <= 0) continue
    let s = c / max
    let v = max
    h += 9 * w
    s *= 1 - 0.28 * w
    v *= 1 - 0.07 * w
    const [nr, ng, nb] = hsv(h, s, v)
    d[i] = nr * 255
    d[i + 1] = ng * 255
    d[i + 2] = nb * 255
  }
  g.putImageData(pixels, 0, 0)
  map.image = canvas
  map.needsUpdate = true
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

function hsv(h: number, s: number, v: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h / 60) % 6
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1))
  }
  return [f(5), f(3), f(1)]
}
