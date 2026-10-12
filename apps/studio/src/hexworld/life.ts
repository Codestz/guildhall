/**
 * Life on the hex island (track B, `?life=0` turns it off): the townsfolk of every place living their
 * day (world `planFolk`) and the agents walking their errands (world `agentLoop`), all on the island's
 * walk graph, drawn by the R5 crowd in one go (the nearest few as full heroes, everyone else the baked
 * crowd: three draws), at CHARACTER_SCALE with their feet on the ground. Each agent has its name on a
 * coloured banner above its head, readable from the map view.
 *
 * Time: the day moves on SPEEDUP times faster than real time and people walk slower per day-hour by as
 * much, so they walk at a natural pace while their routine visibly moves on. When the screen's clock is
 * moved (dragged or played) the day follows it. Agents run on real seconds.
 */
import {
  applyOverlay,
  type Catalog,
  createCatalog,
  type NpcLook,
  type NpcRecipe,
  resolveNpc,
  validateNpc,
} from "@guildhall/assets"
import { hash, log } from "@guildhall/core"
import {
  type ActorSample,
  type Crowd,
  createCrowd,
  loadCharacter,
  type Stage,
  toScreen,
} from "@guildhall/render"
import {
  agentLoop,
  CHARACTER_SCALE,
  type HexIsland,
  type HexWorld,
  type HexZones,
  hexWalk,
  type LifePose,
  type LifeStep,
  lifePlaces,
  lifePose,
  planFolk,
  type TileFurniture,
  workTiles,
} from "@guildhall/world"
import { libraryUrl, loadCatalog } from "../catalog.ts"
import * as data from "../data.ts"
import { DEMO_AGENTS } from "./lifeAgents.ts"

const logger = log("studio:hexworld:life")

/** Day-hours per real hour. */
export const SPEEDUP = 20
/** Walking pace, metres a second: a toy-scale person's natural walk. */
export const LIFE_MPS = 0.8
/** Metres one walk-clip cycle covers at look scale 1 (crowd/sim STRIDE). */
const STRIDE = 1.3
/** A banner floats this far over an agent's feet, metres. */
const BANNER_UP = 1.35
/** A banner's footprint on screen for keeping them apart, CSS px. */
const BANNER_W = 84
const BANNER_H = 24

export interface LifeOpts {
  host: HTMLElement
  island: HexIsland
  zones: HexZones
  world: HexWorld
  /** The ground under a point (the fine ground), metres. */
  groundAt(x: number, z: number): number
  /** The screen's clock, hours. */
  hour(): number
  seed: number
  /** Seconds into the agents' script at the start (`?lifeT=` for shots). */
  agentT?: number
}

export interface Life {
  /** Resolves once everyone is drawn (heroes loaded). */
  ready: Promise<void>
  dispose(): void
}

/** The catalog with `data/mounts.json` laid over it, so props carry their authored mounts. */
async function mountedCatalog(): Promise<Catalog | null> {
  const [catalog, overlay] = await Promise.all([loadCatalog(), data.loadOverlay().catch(() => ({}))])
  return catalog && createCatalog(catalog.index, [applyOverlay(catalog.all(), overlay)])
}

async function npcRecipes(): Promise<Map<string, NpcRecipe>> {
  const ids = await data.list("npcs").catch((): string[] => [])
  const all = await Promise.all(ids.map((id) => data.load("npcs", id)))
  const ok = all.filter((json): json is NpcRecipe => json !== null && validateNpc(json).length === 0)
  return new Map(ok.map((r) => [r.id, r]))
}

/**
 * A recipe with only the props this library has (the curated hex library dropped some packs a few
 * recipes still name, e.g. quaternius-props/bag): a hand left with no option goes empty.
 */
function usable(r: NpcRecipe, catalog: Catalog): NpcRecipe {
  const known = (list: readonly string[] | undefined) =>
    list?.filter((id) => id === "" || catalog.get(id)?.compose.mount)
  const r2 = known(r.hands?.r)
  const l2 = known(r.hands?.l)
  const head = known(r.head?.pieces)
  return {
    ...r,
    hands: { ...(r2?.length ? { r: r2 } : {}), ...(l2?.length ? { l: l2 } : {}) },
    ...(r.head && head?.length ? { head: { ...r.head, pieces: head } } : { head: undefined }),
  }
}

/**
 * A look that holds `prop` (its work spot's) in the hand the prop's mount names, in place of what the
 * recipe put there; unchanged when the prop has no mount in this library.
 */
function holding(look: NpcLook, prop: string | undefined, catalog: Catalog): NpcLook {
  const mount = prop ? catalog.get(prop)?.compose.mount : undefined
  if (!prop || !mount) return look
  const mounts = [...look.mounts.filter((m) => m.slot !== mount.slot), { piece: prop, slot: mount.slot }]
  return { ...look, mounts }
}

/** The clips spots ask for (sitting, sawing…), for the crowd to bake besides the looks' own. */
function spotClips(loops: readonly (readonly LifeStep[])[]): string[] {
  const out = new Set<string>()
  for (const steps of loops) for (const s of steps) if (s.kind === "stay" && s.clip) out.add(s.clip)
  return [...out].sort()
}

/** A look at the hex world's scale. */
const scaled = (look: NpcLook): NpcLook => ({ ...look, scale: look.scale * CHARACTER_SCALE })

/** An agent's look: its role's props and clips on its class's body. */
function heroLook(recipe: NpcRecipe, body: string, seed: number, catalog: Catalog): NpcLook {
  const look = resolveNpc(recipe, seed, catalog)
  const parts = catalog.get(body)?.character?.parts
  const hide = (recipe.hide ?? []).filter((p) => !parts || parts.includes(p))
  return scaled({ ...look, body, hide, scale: 1.06 })
}

const BANNER_STYLE = [
  "position:absolute",
  "left:0",
  "top:0",
  "z-index:1",
  "pointer-events:none",
  "display:flex",
  "flex-direction:column",
  "align-items:center",
  "will-change:transform",
].join(";")

function banner(name: string, colour: string): HTMLElement {
  const el = document.createElement("div")
  el.style.cssText = BANNER_STYLE
  const flag = document.createElement("div")
  flag.textContent = name
  flag.style.cssText = [
    `background:${colour}`,
    "color:#fff8ec",
    "font:600 12px/1.2 ui-sans-serif,system-ui,sans-serif",
    "letter-spacing:0.02em",
    "padding:3px 9px 4px",
    "border-radius:3px 3px 0 0",
    "box-shadow:0 1px 3px rgba(0,0,0,0.35)",
    "text-shadow:0 1px 1px rgba(0,0,0,0.35)",
    "white-space:nowrap",
  ].join(";")
  // the banner's swallow-tail and its pole down to the head
  const tail = document.createElement("div")
  tail.style.cssText = `width:0;height:0;border-left:8px solid ${colour};border-right:8px solid ${colour};border-bottom:5px solid transparent`
  const pole = document.createElement("div")
  pole.style.cssText = "width:2px;height:10px;background:rgba(40,28,18,0.8)"
  el.append(flag, tail, pole)
  return el
}

/**
 * A debug overlay (`?spots=1`): spots as dots with a tick the way they face (green work, blue sit,
 * yellow stand / talk), blockers as red rings, within 30 m of the camera's target.
 */
function spotsOverlay(
  stage: Stage,
  host: HTMLElement,
  furniture: TileFurniture,
  groundAt: (x: number, z: number) => number,
): { draw(): void; dispose(): void } {
  const canvas = document.createElement("canvas")
  canvas.style.cssText = "position:absolute;inset:0;z-index:1;pointer-events:none;width:100%;height:100%"
  host.append(canvas)
  const colour = { work: "#3fd16b", sit: "#4aa3ff", sleep: "#b07cff", stand: "#ffd34a", talk: "#ffd34a" }
  return {
    draw() {
      const w = host.clientWidth
      const h = host.clientHeight
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      const g = canvas.getContext("2d")
      if (!g) return
      g.clearRect(0, 0, w, h)
      const target = stage.getCamera().target
      const close = (x: number, z: number) => Math.hypot(x - target[0], z - target[2]) < 30
      g.lineWidth = 2
      for (const b of furniture.blockers) {
        if (!close(b.x, b.z)) continue
        const y = groundAt(b.x, b.z) + 0.05
        g.strokeStyle = "rgba(255,60,60,0.9)"
        g.beginPath()
        for (let k = 0; k <= 16; k++) {
          const a = (k / 16) * Math.PI * 2
          const p = toScreen(stage, [b.x + Math.cos(a) * b.r, y, b.z + Math.sin(a) * b.r])
          if (!p) continue
          if (k === 0) g.moveTo(p[0], p[1])
          else g.lineTo(p[0], p[1])
        }
        g.stroke()
      }
      for (const s of furniture.spots) {
        if (!close(s.x, s.z)) continue
        const y = groundAt(s.x, s.z) + 0.05
        const p = toScreen(stage, [s.x, y, s.z])
        const q = toScreen(stage, [s.x + Math.sin(s.facing) * 0.6, y, s.z + Math.cos(s.facing) * 0.6])
        if (!p || !q) continue
        g.strokeStyle = colour[s.kind]
        g.fillStyle = colour[s.kind]
        g.beginPath()
        g.arc(p[0], p[1], 5, 0, Math.PI * 2)
        g.fill()
        g.beginPath()
        g.moveTo(p[0], p[1])
        g.lineTo(q[0], q[1])
        g.stroke()
      }
    },
    dispose: () => canvas.remove(),
  }
}

export function createLife(stage: Stage, opts: LifeOpts): Life {
  const { island: h, zones: z, world: w, groundAt } = opts
  let disposed = false
  let crowd: Crowd | null = null
  let unFrame = () => {}
  const banners: HTMLElement[] = []
  const cleanup: (() => void)[] = []

  const ready = (async () => {
    const t0 = performance.now()
    const walk = hexWalk(h, z, w, { reach: workTiles(h, z) })
    // one reservation book: the agents take their spots and slots first, then the townsfolk
    const places = lifePlaces(h, z, w, walk)
    const agents = DEMO_AGENTS.map((a, slot) => ({
      spec: a,
      ...agentLoop(walk, z, a.errands, { slot: slot * 2, mps: LIFE_MPS * 1.15, role: a.recipe, places }),
    }))
    const folk = planFolk(h, z, w, walk, { seed: opts.seed, pace: (LIFE_MPS * 3600) / SPEEDUP, places })
    const planned = performance.now() - t0
    const [catalog, recipes] = await Promise.all([mountedCatalog(), npcRecipes()])
    if (disposed || !catalog || recipes.size === 0) {
      if (!disposed) logger.warn("no library or no NPC recipes: nobody to draw")
      return
    }
    const fixed = new Map<string, NpcRecipe | undefined>()
    const usableOf = (id: string) => {
      if (!fixed.has(id)) {
        const r = recipes.get(id)
        fixed.set(id, r && usable(r, catalog))
      }
      return fixed.get(id)
    }
    const looks: NpcLook[] = []
    const loops: { steps: LifeStep[]; period: number; real: boolean }[] = []
    for (const f of folk) {
      const recipe = usableOf(f.role)
      if (!recipe) continue
      const look = resolveNpc(recipe, hash(`hexfolk:${opts.seed}:${f.id}`), catalog)
      looks.push(scaled(holding(look, f.prop, catalog)))
      loops.push({ steps: f.day, period: 24, real: false })
    }
    const agentIds: number[] = []
    for (const a of agents) {
      const recipe = usableOf(a.spec.recipe)
      if (!recipe || !catalog.get(a.spec.hero)) continue
      agentIds.push(looks.length)
      looks.push(heroLook(recipe, a.spec.hero, hash(`agent:${a.spec.id}`), catalog))
      loops.push({ steps: a.steps, period: a.period, real: true })
      const el = banner(a.spec.name, a.spec.colour)
      opts.host.append(el)
      banners.push(el)
    }
    const made = await createCrowd(
      stage,
      looks.map((look, id) => ({ id, look })),
      { catalog, url: libraryUrl },
      { heroes: 12, clips: spotClips([...folk.map((f) => f.day), ...agents.map((a) => a.steps)]) },
    )
    if (disposed) {
      made.dispose()
      return
    }
    crowd = made
    crowd.setHeroes(agentIds)

    // the day's clock: follows the screen's when it moves, else runs SPEEDUP× real time
    let seen = opts.hour()
    let day = seen
    let secs = opts.agentT ?? 0
    let dt = 0
    const last = looks.map(() => [Number.NaN, 0] as [number, number])
    const phase = looks.map((l) => l.phase)
    // clip lengths, from the rig every body shares
    const body = catalog.get(looks[0]?.body ?? "")
    const rig = body?.character && catalog.rig(body.character.rig)
    const durations = new Map<string, number>(
      body && rig ? (await loadCharacter(body, rig, libraryUrl)).clips.map((c) => [c.name, c.duration]) : [],
    )
    if (disposed) return
    const pose = (id: number): LifePose => {
      const l = loops[id]!
      return lifePose(l.steps, l.real ? secs : day, l.period)
    }
    // personal space: walkers keep to the right of their way, and everyone near someone else is nudged
    // apart (a smoothed offset per person, so nobody jumps), so two people never stand inside each other
    const n = looks.length
    const offX = new Float32Array(n)
    const offZ = new Float32Array(n)
    const baseX = new Float32Array(n)
    const baseZ = new Float32Array(n)
    const poses: LifePose[] = []
    const SPACE = 0.8
    /** A walker's half-width against blockers, metres. */
    const BODY = 0.22
    /** How much of a pair's push `a` takes from `b`: a stayer leaves it to a walker. */
    const yields = (a: number, b: number) => {
      const wa = poses[a]!.act === "walk"
      const wb = poses[b]!.act === "walk"
      return wa === wb ? 1 : wa ? 1.8 : 0.2
    }
    const separate = () => {
      const grid = new Map<number, number[]>()
      for (let id = 0; id < n; id++) {
        const p = pose(id)
        poses[id] = p
        let x = p.at[0]
        let zz = p.at[2]
        if (p.act === "walk") {
          // keep right: a lane half a shoulder off the way's middle
          x += Math.cos(p.facing) * 0.32
          zz -= Math.sin(p.facing) * 0.32
        }
        baseX[id] = x
        baseZ[id] = zz
        if (p.indoors) continue
        const key = (Math.floor(x) * 73856093) ^ (Math.floor(zz) * 19349663)
        let cell = grid.get(key)
        if (!cell) {
          cell = []
          grid.set(key, cell)
        }
        cell.push(id)
      }
      const pushX = new Float32Array(n)
      const pushZ = new Float32Array(n)
      for (let id = 0; id < n; id++) {
        if (poses[id]!.indoors) continue
        const x = baseX[id]! + offX[id]!
        const zz = baseZ[id]! + offZ[id]!
        const cx = Math.floor(baseX[id]!)
        const cz = Math.floor(baseZ[id]!)
        for (let dx = -1; dx <= 1; dx++)
          for (let dz = -1; dz <= 1; dz++)
            for (const o of grid.get(((cx + dx) * 73856093) ^ ((cz + dz) * 19349663)) ?? []) {
              if (o <= id) continue
              let ex = x - (baseX[o]! + offX[o]!)
              let ez = zz - (baseZ[o]! + offZ[o]!)
              let d = Math.hypot(ex, ez)
              if (d >= SPACE) continue
              if (d < 1e-3) {
                // exactly together: part them along a fixed per-pair direction
                const a = ((id * 92821 + o * 68917) % 628) / 100
                ex = Math.cos(a)
                ez = Math.sin(a)
                d = 1e-3
              }
              // walkers step round whoever stands at a spot (it is theirs): a stayer barely gives
              const k = (SPACE - d) / 2 / d
              const ki = k * yields(id, o)
              const ko = k * yields(o, id)
              pushX[id] = pushX[id]! + ex * ki
              pushZ[id] = pushZ[id]! + ez * ki
              pushX[o] = pushX[o]! - ex * ko
              pushZ[o] = pushZ[o]! - ez * ko
            }
      }
      for (let id = 0; id < n; id++) {
        // ease toward the push, let it relax back when alone, never more than a stride off the way
        // (a stayer only a little: it stays at its spot)
        offX[id] = offX[id]! * 0.9 + pushX[id]! * 0.6
        offZ[id] = offZ[id]! * 0.9 + pushZ[id]! * 0.6
        const cap = poses[id]!.act === "walk" ? 1.6 : 0.3
        const m = Math.hypot(offX[id]!, offZ[id]!)
        if (m > cap) {
          offX[id] = (offX[id]! / m) * cap
          offZ[id] = (offZ[id]! / m) * cap
        }
        // and never into a cart, a stall or a house: a walker pushed in is set back on the disc's edge
        if (poses[id]!.act !== "walk" || poses[id]!.indoors) continue
        const x = baseX[id]! + offX[id]!
        const zz = baseZ[id]! + offZ[id]!
        for (const b of places.furniture.near(x, zz, BODY)) {
          const ex = x - b.x
          const ez = zz - b.z
          const d = Math.hypot(ex, ez) || 1e-3
          const out = b.r + BODY - d
          if (out <= 0) continue
          offX[id] = offX[id]! + (ex / d) * out
          offZ[id] = offZ[id]! + (ez / d) * out
        }
      }
    }
    const sample = (id: number): ActorSample => {
      const p = poses[id] ?? pose(id)
      const look = looks[id]!
      const x = (poses[id] ? baseX[id]! : p.at[0]) + offX[id]!
      const zz = (poses[id] ? baseZ[id]! : p.at[2]) + offZ[id]!
      const y = (p.ground ? groundAt(x, zz) : p.at[1]) + (p.lift ?? 0)
      const prev = last[id]!
      const moved = Number.isNaN(prev[0]) ? 0 : Math.hypot(x - prev[0], zz - prev[1])
      prev[0] = x
      prev[1] = zz
      // at a spot, its clip; walking, always the walk
      const clip = (p.act !== "walk" && p.clip) || look.clips[p.act]
      // walking: the feet keep pace with the ground covered; standing: the clip's own time
      phase[id] =
        phase[id]! + (p.act === "walk" ? moved / (STRIDE * look.scale) : dt / (durations.get(clip) ?? 1.5))
      return {
        position: [x, y, zz],
        heading: p.facing,
        clip,
        phase: phase[id]! - Math.floor(phase[id]!),
        hidden: p.indoors,
      }
    }
    // the CPU a frame of life costs (sampling, the crowd's update, the banners), smoothed
    let cpuMs = 0
    const tick = (step: number) => {
      const t1 = performance.now()
      dt = step
      const clock = opts.hour()
      if (Math.abs(clock - seen) > 1e-6) {
        seen = clock
        day = clock
      } else day = (day + (step * SPEEDUP) / 3600) % 24
      secs += step
      separate()
      separate()
      crowd?.update(step, sample)
      // banners over their agents, nudged up off each other where they would overlap
      const placed: [number, number][] = []
      const shown = banners
        .map((el, k) => {
          const p = pose(agentIds[k]!)
          const y = p.ground ? groundAt(p.at[0], p.at[2]) : p.at[1]
          return { el, at: toScreen(stage, [p.at[0], y + BANNER_UP, p.at[2]]) }
        })
        .sort((a, b) => (b.at?.[1] ?? 0) - (a.at?.[1] ?? 0))
      for (const { el, at } of shown) {
        el.style.display = at ? "flex" : "none"
        if (!at) continue
        let [x, y] = at
        while (placed.some(([px, py]) => Math.abs(px - x) < BANNER_W && Math.abs(py - y) < BANNER_H))
          y -= BANNER_H
        placed.push([x, y])
        el.style.transform = `translate(${x}px,${y}px) translate(-50%,-100%)`
      }
      cpuMs += (performance.now() - t1 - cpuMs) * 0.05
      overlay?.draw()
    }
    // `?spots=1`: every spot and blocker drawn over the scene, to check them against what stands there
    const showSpots = new URLSearchParams(location.search).get("spots") === "1"
    const overlay = showSpots ? spotsOverlay(stage, opts.host, places.furniture, groundAt) : null
    if (overlay) cleanup.push(overlay.dispose)
    unFrame = stage.onFrame(tick)
    tick(0)
    // heroes load as the crowd first updates: let them settle before `ready` resolves
    for (let i = 0; i < 100 && crowd.stats().pending > 0; i++)
      await new Promise((done) => setTimeout(done, 50))
    const ext = window.guildhall?.ext
    if (ext)
      ext.life = {
        stats: () => ({ folk: folk.length, agents: agentIds.length, cpuMs, ...crowd?.stats() }),
        walk: { nodes: walk.nodes.length, edges: walk.edges.length },
      }
    logger.info("life", {
      folk: folk.length,
      agents: agentIds.length,
      nodes: walk.nodes.length,
      planMs: Math.round(planned),
      ms: Math.round(performance.now() - t0),
    })
  })()

  return {
    ready: ready.catch((error: unknown) => {
      logger.error("life failed", { error: (error as Error).stack ?? String(error) })
    }),
    dispose() {
      disposed = true
      unFrame()
      crowd?.dispose()
      for (const el of banners) el.remove()
      for (const done of cleanup) done()
      const ext = window.guildhall?.ext
      if (ext) delete ext.life
    },
  }
}
