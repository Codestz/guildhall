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
  type DoorPass,
  DRILLS,
  type DrillAt,
  doorPasses,
  drillClips,
  drillFrame,
  type HexIsland,
  type HexWorld,
  type HexZones,
  hexCollide,
  hexWalk,
  type LifePose,
  type LifeStep,
  lifePlaces,
  lifePose,
  planFolk,
  solidDistance,
  workTiles,
} from "@guildhall/world"
import { libraryUrl, loadCatalog } from "../catalog.ts"
import * as data from "../data.ts"
import { collideView } from "./collideView.ts"
import { DEMO_AGENTS } from "./lifeAgents.ts"
import { createSpace } from "./space.ts"

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
  /** The fine ground under a point, as the worker built it (job.ts `heightsAt`), metres. */
  groundAt(x: number, z: number): number
  /** The screen's clock, hours. */
  hour(): number
  seed: number
  /** Draw the collision layer over the scene (`?collide=1`, `?spots=1`: collideView.ts). */
  overlay?: boolean
  /** Seconds into the agents' script at the start (`?lifeT=` for shots). */
  agentT?: number
}

export interface Life {
  /** Resolves once everyone is drawn (heroes loaded). */
  ready: Promise<void>
  /** The day's clock life runs on, hours (it follows the screen's clock). */
  clock(): number
  /** Whether anyone outdoors is within r metres of (x, z), as last drawn. */
  near(x: number, z: number, r: number): boolean
  /** Every townsfolk's passes through a door over the day (world `doorPasses`), in time order. */
  passes(): readonly DoorPass[]
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
  for (const steps of loops)
    for (const s of steps) {
      if (s.kind !== "stay") continue
      if (s.clip) out.add(s.clip)
      // a routine's every clip (its solo's too: a duellist alone)
      if (s.drill) for (const c of drillClips(s.drill.id)) out.add(c)
    }
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

export function createLife(stage: Stage, opts: LifeOpts): Life {
  const { island: h, zones: z, world: w } = opts
  let disposed = false
  let crowd: Crowd | null = null
  let unFrame = () => {}
  const banners: HTMLElement[] = []
  const cleanup: (() => void)[] = []
  let passes: DoorPass[] = []
  let clockNow = opts.hour()
  let nearAt: (x: number, z: number, r: number) => boolean = () => false

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
    // the collision layer: the furniture's solids, the walkways, and the fine ground as the worker built
    // it (its heights data: the numbers the ground mesh is built from)
    const collide = hexCollide({
      solids: places.furniture.solids,
      walkways: [...w.stairs, ...w.bridges.flatMap((b) => b.legs), ...w.decks],
      ground: opts.groundAt,
    })
    passes = folk.flatMap((f) => doorPasses(f.day)).sort((a, b) => a.t - b.t)
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
    // personal space on the collision layer (space.ts): rounds as wide as each body is drawn, walkers
    // queueing behind each other, nobody inside a wall, off a step or a flight of stairs
    const n = looks.length
    const radii = new Float32Array(n)
    for (const [id, look] of looks.entries()) {
      const size = catalog.get(look.body)?.size
      // the body's depth (the mage's hat brim reaches furthest), at its scale
      radii[id] = Math.min(0.5, Math.max(0.26, ((size?.[2] ?? 1.2) * look.scale) / 2))
    }
    const space = createSpace(radii, {
      heightAt: collide.heightAt,
      solidsNear: collide.solidsNear,
      solidDistance,
    })
    const poses: LifePose[] = new Array(n)
    /** Where person id's way has them now: their clock, less how late queueing has made them. */
    const pose = (id: number): LifePose => {
      const l = loops[id]!
      const late = space.delay[id]!
      return lifePose(l.steps, l.real ? secs - late : day - (late * SPEEDUP) / 3600, l.period)
    }
    /** People at each duel now, by pair (drills.ts): a side alone plays its routine's solo. */
    const duelling = new Map<number, number>()
    const place = (step: number) => {
      duelling.clear()
      for (let id = 0; id < n; id++) {
        const p = pose(id)
        poses[id] = p
        const pair = p.act !== "walk" ? p.drill?.pair : undefined
        if (pair !== undefined) duelling.set(pair, (duelling.get(pair) ?? 0) + 1)
      }
      space.step(poses, step)
    }
    /** A drilling person's clip and how far into it, on the shared clock (the agents' seconds). */
    const drilled = (d: DrillAt): { clip: string; phase: number } => {
      const alone = d.pair !== undefined && (duelling.get(d.pair) ?? 0) < 2
      const solo = DRILLS[d.id]?.solo
      return alone && solo ? drillFrame(solo, 0, secs + d.at) : drillFrame(d.id, d.side, secs + d.at)
    }
    /** Where feet stand: a stair's tread, a deck's planks, the ground (a dock's deck: the way's own height). */
    const footAt = (x: number, zz: number, p: LifePose) =>
      collide.walkwayAt(x, zz) ?? (p.ground ? collide.heightAt(x, zz) : p.at[1])
    const sample = (id: number): ActorSample => {
      const p = poses[id] ?? pose(id)
      const look = looks[id]!
      const x = space.x[id]!
      const zz = space.z[id]!
      const y = footAt(x, zz, p) + (p.lift ?? 0)
      const prev = last[id]!
      const moved = Number.isNaN(prev[0]) ? 0 : Math.hypot(x - prev[0], zz - prev[1])
      prev[0] = x
      prev[1] = zz
      // at a spot, its routine (a duel's side, a drill line: on the shared clock) or its clip; walking,
      // always the walk
      if (p.act !== "walk" && p.drill) {
        const f = drilled(p.drill)
        return { position: [x, y, zz], heading: p.facing, clip: f.clip, phase: f.phase, hidden: p.indoors }
      }
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
      place(step)
      clockNow = day
      crowd?.update(step, sample)
      // banners over their agents, nudged up off each other where they would overlap
      const placed: [number, number][] = []
      const shown = banners
        .map((el, k) => {
          const id = agentIds[k]!
          const x = space.x[id]!
          const zz = space.z[id]!
          const y = footAt(x, zz, poses[id] ?? pose(id))
          return { el, at: toScreen(stage, [x, y + BANNER_UP, zz]) }
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
      overlay?.draw(drawn)
    }
    // `?collide=1` (or `?spots=1`): the collision layer drawn over the scene, to check it against what stands there
    const overlay = opts.overlay
      ? collideView(stage, opts.host, { collide, furniture: places.furniture, walk, nodeOf: places.nodeOf })
      : null
    if (overlay) cleanup.push(overlay.dispose)
    const drawn = { x: space.x, z: space.z, r: radii, hidden: (id: number) => !!poses[id]?.indoors }
    nearAt = (x, zz, r) => {
      for (let id = 0; id < n; id++) {
        if (poses[id]?.indoors) continue
        if (Math.hypot(space.x[id]! - x, space.z[id]! - zz) < r) return true
      }
      return false
    }
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
    clock: () => clockNow,
    near: (x, zz, r) => nearAt(x, zz, r),
    passes: () => passes,
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
