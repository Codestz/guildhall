/**
 * The collision layer drawn over the scene (`?collide=1`, `?spots=1` too), within REACH of the camera's
 * target so it stays cheap:
 *
 *   red      the solids' outlines (buildings, walls, fences, props; authored blockers dashed);
 *   ramp     the walkable height as dots, dark low to light high (a flight of stairs reads as a ramp of
 *            shades, a bridge's deck as a band over the water);
 *   blue     every person's round, live, where they are drawn;
 *   amber    the spots, a tick the way each faces, and the line from the walk node it is reached from.
 */
import { type Stage, toScreen } from "@guildhall/render"
import type { HexCollide, HexWalk, TileFurniture } from "@guildhall/world"

const REACH = 40
/** The height dots: this far apart, out to this far from the target, metres. */
const DOT = 0.7
const DOT_REACH = 22

export interface CollideView {
  draw(people: { x: Float32Array; z: Float32Array; r: Float32Array; hidden(id: number): boolean }): void
  dispose(): void
}

export function collideView(
  stage: Stage,
  host: HTMLElement,
  layer: { collide: HexCollide; furniture: TileFurniture; walk: HexWalk; nodeOf(spot: number): number },
): CollideView {
  const canvas = document.createElement("canvas")
  canvas.style.cssText = "position:absolute;inset:0;z-index:1;pointer-events:none;width:100%;height:100%"
  host.append(canvas)
  const { collide, furniture, walk } = layer
  const ring = (g: CanvasRenderingContext2D, x: number, z: number, r: number, y: number) => {
    g.beginPath()
    for (let k = 0; k <= 16; k++) {
      const a = (k / 16) * Math.PI * 2
      const p = toScreen(stage, [x + Math.cos(a) * r, y, z + Math.sin(a) * r])
      if (!p) return
      if (k === 0) g.moveTo(p[0], p[1])
      else g.lineTo(p[0], p[1])
    }
    g.stroke()
  }
  return {
    draw(people) {
      const w = host.clientWidth
      const h = host.clientHeight
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      const g = canvas.getContext("2d")
      if (!g) return
      g.clearRect(0, 0, w, h)
      const t = stage.getCamera().target
      const close = (x: number, z: number, r = REACH) => Math.hypot(x - t[0], z - t[2]) < r
      // the walkable height: a ramp of shades round the target's own height
      const base = collide.heightAt(t[0], t[2])
      for (let x = t[0] - DOT_REACH; x <= t[0] + DOT_REACH; x += DOT)
        for (let z = t[2] - DOT_REACH; z <= t[2] + DOT_REACH; z += DOT) {
          if (!close(x, z, DOT_REACH)) continue
          const y = collide.heightAt(x, z)
          const p = toScreen(stage, [x, y + 0.03, z])
          if (!p) continue
          const f = Math.max(0, Math.min(1, (y - base + 2.4) / 4.8))
          const on = collide.walkwayAt(x, z) !== null
          g.fillStyle = on
            ? `hsl(${190 - f * 150} 95% ${35 + f * 40}%)`
            : `hsla(${260 - f * 200} 70% ${25 + f * 55}% / 0.7)`
          g.fillRect(p[0] - (on ? 2 : 1.5), p[1] - (on ? 2 : 1.5), on ? 4 : 3, on ? 4 : 3)
        }
      // the solids
      g.lineWidth = 1.5
      for (const s of collide.solidsNear(t[0], t[2], REACH)) {
        if (s.soft) continue
        g.strokeStyle = s.kind === "blocker" ? "rgba(255,120,120,0.75)" : "rgba(255,40,40,0.95)"
        g.setLineDash(s.kind === "blocker" ? [4, 3] : [])
        const y = s.base + 0.05
        g.beginPath()
        for (let k = 0; k <= s.pts.length / 2; k++) {
          const j = (k % (s.pts.length / 2)) * 2
          const p = toScreen(stage, [s.pts[j]!, y, s.pts[j + 1]!])
          if (!p) continue
          if (k === 0) g.moveTo(p[0], p[1])
          else g.lineTo(p[0], p[1])
        }
        g.stroke()
      }
      g.setLineDash([])
      // the spots and the way in to each
      g.lineWidth = 1.5
      for (const [k, s] of furniture.spots.entries()) {
        if (!close(s.x, s.z)) continue
        const y = collide.heightAt(s.x, s.z) + 0.05
        const p = toScreen(stage, [s.x, y, s.z])
        const q = toScreen(stage, [s.x + Math.sin(s.facing) * 0.5, y, s.z + Math.cos(s.facing) * 0.5])
        if (!p || !q) continue
        const n = layer.nodeOf(k)
        if (n >= 0) {
          const node = walk.nodes[n]!
          const a = toScreen(stage, [node.x, collide.heightAt(node.x, node.z) + 0.05, node.z])
          if (a) {
            g.strokeStyle = "rgba(255,190,60,0.45)"
            g.beginPath()
            g.moveTo(a[0], a[1])
            g.lineTo(p[0], p[1])
            g.stroke()
          }
        }
        g.fillStyle = "#ffb43c"
        g.strokeStyle = "#ffb43c"
        g.beginPath()
        g.arc(p[0], p[1], 4, 0, Math.PI * 2)
        g.fill()
        g.beginPath()
        g.moveTo(p[0], p[1])
        g.lineTo(q[0], q[1])
        g.stroke()
      }
      // everyone's round
      g.strokeStyle = "rgba(70,150,255,0.95)"
      g.lineWidth = 2
      for (let id = 0; id < people.x.length; id++) {
        const x = people.x[id]!
        const z = people.z[id]!
        if (people.hidden(id) || !close(x, z)) continue
        ring(g, x, z, people.r[id]!, collide.heightAt(x, z) + 0.06)
      }
    },
    dispose: () => canvas.remove(),
  }
}
