/**
 * Life on the hex island (track B, `?life=0` turns it off): the townsfolk of every place living their
 * day (world `planFolk`) and the agents, wherever their source puts them (an `AgentSource`,
 * lifeAgents.ts: a guild's events planned on the walk graph, sim life), all on the island's walk
 * graph, drawn by the R5 crowd in one go (the nearest few as full heroes, everyone else the baked
 * crowd: three draws), at CHARACTER_SCALE with their feet on the ground. Each agent has its name on a
 * coloured banner above its head, readable from the map view.
 *
 * Time: the day moves on SPEEDUP times faster than real time and people walk slower per day-hour by as
 * much, so they walk at a natural pace while their routine visibly moves on. When the screen's clock is
 * moved (dragged or played) the day follows it. Agents run on real seconds (`?lifeT=` starts them on).
 *
 * The plan itself (everyone's day, the agents' itineraries, the solids: lifePlan.ts) is made in the
 * build worker and arrives as data; this thread builds the collision layer on it and draws.
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
import { RUN_CLIP } from "@guildhall/sim"
import {
  CHARACTER_SCALE,
  type DoorPass,
  DRILLS,
  type DrillAt,
  doorPasses,
  drillClips,
  drillFrame,
  type HexDoorway,
  type HexIsland,
  type HexWorld,
  type HexZones,
  hexCollide,
  hexWalk,
  type LifePose,
  type LifeStep,
  lifePlaces,
  lifePose,
  solidDistance,
  workTiles,
} from "@guildhall/world"
import { libraryUrl, loadCatalog } from "../catalog.ts"
import * as data from "../data.ts"
import { collideView } from "./collideView.ts"
import { type AgentSource, recipeOf } from "./lifeAgents.ts"
import { type LifePlan, SPEEDUP } from "./lifePlan.ts"
import { createSpace } from "./space.ts"

export { LIFE_MPS, SPEEDUP } from "./lifePlan.ts"

const logger = log("studio:hexworld:life")
/** Metres one walk-clip cycle covers at look scale 1 (crowd/sim STRIDE). */
const STRIDE = 1.3
/** Metres one run-clip cycle covers at look scale 1 (a hero running a long way). */
const RUN_STRIDE = 2.4
/** A banner floats this far over an agent's feet, metres. */
const BANNER_UP = 1.35
/** A banner's footprint on screen for keeping them apart, CSS px. */
const BANNER_W = 84
const BANNER_H = 24
/** Where an agent not on the island yet is kept (undrawn) before its first pose. */
const OFF_ISLAND: LifePose = { at: [0, 0, 0], facing: 0, act: "idle", indoors: true, ground: true }

export interface LifeOpts {
  host: HTMLElement
  /** The plan the build worker made (job.ts's `life` stage). */
  plan: Promise<LifePlan>
  /**
   * The map built again on this thread, for the collision overlay only (`?collide=1`, `?spots=1`: it
   * draws the walk graph and the spots, which the plan does not carry).
   */
  debug?: () => { island: HexIsland; zones: HexZones; world: HexWorld }
  /** The fine ground under a point, as the worker built it (job.ts `heightsAt`), metres. */
  groundAt(x: number, z: number): number
  /** The screen's clock, hours. */
  hour(): number
  seed: number
  /** Draw the collision layer over the scene (`?collide=1`, `?spots=1`: collideView.ts). */
  overlay?: boolean
  /** Mark the heroes' spots (`?heroSpots=1`, world heroes.ts) instead of the collision layer. */
  heroSpots?: boolean
  /** Seconds into the agents' source at the start (`?lifeT=` for shots). */
  agentT?: number
  /**
   * Who the agents are and where each is (lifeAgents.ts `AgentSource`, on life's agent seconds). Its
   * heroes when everyone is drawn get figures of their own; a source that grows (`version`) is drawn on
   * the spare figures `agentPool` keeps. None: no agents (until `setAgents`).
   */
  agents?: AgentSource | Promise<AgentSource | null> | null
  /** Keep spare hero figures, `AGENT_POOL` of each body, for heroes a source adds later (a hall's session). */
  agentPool?: boolean
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
  /** Keeps anyone standing where `at` says out of the draw (a history replay: the tiles not yet revealed). */
  hide(at: ((x: number, z: number) => boolean) | null): void
  /** Where each building's door is (the plan's), once `ready`. */
  doorways(): readonly HexDoorway[]
  /** Draws the agents of another source from now on (a hall's session): on the figures life has. */
  setAgents(source: AgentSource | null): void
  /** Where hero `id` is drawn now (its feet, metres), or null when it is not on the island. */
  heroAt(id: string): [number, number, number] | null
  dispose(): void
}

/** Spare figures of each body a growing source may use (`agentPool`). */
export const AGENT_POOL = 4
/** The bodies a hero is drawn with (sim `Body`), as catalog ids. */
const BODIES = ["mage", "knight", "ranger", "barbarian", "rogue"].map((b) => `kaykit-adventurers/${b}`)

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
  el.dataset.heroBanner = ""
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
  let disposed = false
  let crowd: Crowd | null = null
  let unFrame = () => {}
  const cleanup: (() => void)[] = []
  let passes: DoorPass[] = []
  let doorways: HexDoorway[] = []
  let clockNow = opts.hour()
  let nearAt: (x: number, z: number, r: number) => boolean = () => false
  let hiddenAt: ((x: number, z: number) => boolean) | null = null
  /** The agents' source, and the figures that draw its heroes (set once everyone is drawn). */
  let source: AgentSource | null = null
  let swapped = true
  let heroAt: (id: string) => [number, number, number] | null = () => null

  const ready = (async () => {
    const t0 = performance.now()
    // the plan, made in the worker: the catalog and the recipes load meanwhile
    const [plan, catalog, recipes, first] = await Promise.all([
      opts.plan,
      mountedCatalog(),
      npcRecipes(),
      opts.agents ?? null,
    ])
    if (disposed) return
    const { folk } = plan
    if (swapped) source = first
    const agents = source?.list() ?? []
    doorways = plan.doorways
    const t1 = performance.now()
    // the collision layer: the plan's solids and walkways on the fine ground as the worker built it
    // (its heights data: the numbers the ground mesh is built from)
    const collide = hexCollide({ solids: plan.solids, walkways: plan.walkways, ground: opts.groundAt })
    passes = folk.flatMap((f) => doorPasses(f.day)).sort((a, b) => a.t - b.t)
    const layerMs = performance.now() - t1
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
    /** A townsfolk's day, or a hero figure (`figures[figure]`). */
    const loops: ({ steps: LifeStep[]; figure?: undefined } | { figure: number })[] = []
    for (const f of folk) {
      const recipe = usableOf(f.role)
      if (!recipe) continue
      const look = resolveNpc(recipe, hash(`hexfolk:${opts.seed}:${f.id}`), catalog)
      looks.push(scaled(holding(look, f.prop, catalog)))
      loops.push({ steps: f.day })
    }
    /**
     * The heroes' figures: one for each hero the source has now (its look), and with `agentPool` spares
     * of every body for those it adds; `agent` is the hero a figure draws, and its banner says who.
     */
    const figures: { crowd: number; hero: string; agent: string | null; el: HTMLElement | null }[] = []
    const figure = (hero: string, recipeId: string, seed: string, agent: string | null) => {
      const recipe = usableOf(recipeId)
      if (!recipe || !catalog.get(hero)) return
      figures.push({ crowd: looks.length, hero, agent, el: null })
      looks.push(heroLook(recipe, hero, hash(seed), catalog))
      loops.push({ figure: figures.length - 1 })
    }
    for (const a of agents) figure(a.hero, a.recipe, `agent:${a.id}`, a.id)
    if (opts.agentPool)
      for (const hero of BODIES)
        for (let k = 0; k < AGENT_POOL; k++)
          figure(hero, recipeOf(hero.split("/").pop() ?? ""), `agent:spare:${hero}:${k}`, null)
    const agentIds = figures.map((f) => f.crowd)
    /** The source's version the figures were given out for. */
    let given = Number.NaN
    /** Gives the source's heroes figures: each keeps its own; a new one takes a free one of its body. */
    const assign = () => {
      const list = source?.list() ?? []
      const version = source?.version?.() ?? 0
      if (!swapped && version === given) return
      swapped = false
      given = version
      const wanted = new Map(list.map((a) => [a.id, a]))
      for (const f of figures)
        if (f.agent !== null && !wanted.has(f.agent)) {
          f.agent = null
          f.el?.remove()
          f.el = null
        }
      for (const a of list) {
        let f = figures.find((g) => g.agent === a.id)
        f ??= figures.find((g) => g.agent === null && g.hero === a.hero)
        if (!f) continue
        if (f.agent !== a.id || !f.el) {
          f.el?.remove()
          f.agent = a.id
          f.el = banner(a.name, a.colour)
          opts.host.append(f.el)
        }
      }
    }
    const made = await createCrowd(
      stage,
      looks.map((look, id) => ({ id, look })),
      { catalog, url: libraryUrl },
      { heroes: 12, clips: [...spotClips(folk.map((f) => f.day)), ...(figures.length ? [RUN_CLIP] : [])] },
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
    /** This frame's ms in the agents' source. */
    let agentMs = 0
    /** Where person id's way has them now: their clock, less how late queueing has made them. */
    const pose = (id: number): LifePose => {
      const l = loops[id]!
      const late = space.delay[id]!
      if (l.figure === undefined) return lifePose(l.steps, day - (late * SPEEDUP) / 3600, 24)
      const t1 = performance.now()
      // an agent not on the island (not yet come, or gone), or a spare figure, is drawn nowhere: as
      // someone indoors
      const agent = figures[l.figure]?.agent
      const p = (agent != null ? source?.poseAt(agent, secs - late) : null) ?? {
        ...(poses[id] ?? OFF_ISLAND),
        indoors: true,
      }
      agentMs += performance.now() - t1
      return p
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
        return {
          position: [x, y, zz],
          heading: p.facing,
          clip: f.clip,
          phase: f.phase,
          hidden: p.indoors || (hiddenAt !== null && hiddenAt(x, zz)),
        }
      }
      // walking: the walk, or the run a hero takes on a long way (sim RUN_CLIP); at a spot, its clip
      const clip = p.clip && (p.act !== "walk" || p.clip === RUN_CLIP) ? p.clip : look.clips[p.act]
      // walking: the feet keep pace with the ground covered; standing: the clip's own time
      phase[id] =
        phase[id]! +
        (p.act === "walk"
          ? moved / ((clip === RUN_CLIP ? RUN_STRIDE : STRIDE) * look.scale)
          : dt / (durations.get(clip) ?? 1.5))
      return {
        position: [x, y, zz],
        heading: p.facing,
        clip,
        phase: phase[id]! - Math.floor(phase[id]!),
        hidden: p.indoors || (hiddenAt !== null && hiddenAt(x, zz)),
      }
    }
    // the CPU a frame of life costs (sampling, the crowd's update, the banners), smoothed
    let cpuMs = 0
    // of which the agents' poses (their source's samples), smoothed
    let agentCpu = 0
    const tick = (step: number) => {
      const t1 = performance.now()
      agentMs = 0
      source?.tick?.()
      assign()
      dt = step
      const clock = opts.hour()
      if (Math.abs(clock - seen) > 1e-6) {
        seen = clock
        day = clock
      } else day = (day + (step * SPEEDUP) / 3600) % 24
      secs += step
      place(step)
      clockNow = day
      const t2 = performance.now()
      stage.timing.cpu.add("life", t2 - t1)
      agentCpu += (agentMs - agentCpu) * 0.05
      crowd?.update(step, sample)
      const t3 = performance.now()
      stage.timing.cpu.add("crowd", t3 - t2)
      // banners over their agents, nudged up off each other where they would overlap
      const placed: [number, number][] = []
      const shown = figures
        .flatMap((f) => (f.el ? [{ el: f.el, id: f.crowd }] : []))
        .map(({ el, id }) => {
          const x = space.x[id]!
          const zz = space.z[id]!
          const p = poses[id] ?? pose(id)
          const y = footAt(x, zz, p)
          // an agent not on the island, or on land not yet there (a history replay), has no banner either
          if (p.indoors || hiddenAt?.(x, zz)) return { el, at: null }
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
      stage.timing.cpu.add("banners", performance.now() - t3)
      cpuMs += (performance.now() - t1 - cpuMs) * 0.05
      overlay?.draw(drawn)
    }
    // `?collide=1` (or `?spots=1`): the collision layer drawn over the scene, to check it against what
    // stands there. Its walk graph and spots are built again here (a debug view: it may take its time).
    let overlay: ReturnType<typeof collideView> | null = null
    if (opts.overlay && opts.debug) {
      const { island: h, zones: z, world: w } = opts.debug()
      const walk = hexWalk(h, z, w, { reach: workTiles(h, z) })
      const places = lifePlaces(h, z, w, walk, { heroSpots: opts.heroSpots ? 3 : 0 })
      overlay = collideView(stage, opts.host, {
        collide,
        furniture: places.furniture,
        walk,
        nodeOf: places.nodeOf,
        ...(opts.heroSpots ? { heroes: z.zones.flatMap((_, zi) => places.heroSpots(zi)) } : {}),
      })
      cleanup.push(overlay.dispose)
    }
    const drawn = { x: space.x, z: space.z, r: radii, hidden: (id: number) => !!poses[id]?.indoors }
    nearAt = (x, zz, r) => {
      for (let id = 0; id < n; id++) {
        if (poses[id]?.indoors) continue
        if (Math.hypot(space.x[id]! - x, space.z[id]! - zz) < r) return true
      }
      return false
    }
    heroAt = (id) => {
      const f = figures.find((g) => g.agent === id)
      const p = f && poses[f.crowd]
      if (!f || !p || p.indoors) return null
      const x = space.x[f.crowd]!
      const zz = space.z[f.crowd]!
      return [x, footAt(x, zz, p), zz]
    }
    unFrame = stage.onFrame(tick)
    tick(0)
    // heroes load as the crowd first updates: let them settle before `ready` resolves
    for (let i = 0; i < 100 && crowd.stats().pending > 0; i++)
      await new Promise((done) => setTimeout(done, 50))
    const ext = window.guildhall?.ext
    if (ext)
      ext.life = {
        stats: () => ({
          folk: folk.length,
          agents: agentIds.length,
          cpuMs,
          agentMs: agentCpu,
          ...crowd?.stats(),
        }),
        // for shots and tests: where each agent is now (null: not on the island)
        agents: () =>
          figures.flatMap((f) =>
            f.agent === null
              ? []
              : [
                  {
                    id: f.agent,
                    name: source?.list().find((a) => a.id === f.agent)?.name,
                    at: poses[f.crowd]?.indoors ? null : [space.x[f.crowd], space.z[f.crowd]],
                    act: poses[f.crowd]?.act,
                  },
                ],
          ),
        heroAt: (id: string) => heroAt(id),
        walk: { nodes: plan.stats.nodes, edges: plan.stats.edges },
      }
    logger.info("life", {
      folk: folk.length,
      agents: agentIds.length,
      nodes: plan.stats.nodes,
      // the worker's planning, this thread's collision layer, and the whole from the start to everyone drawn
      planMs: plan.stats.planMs,
      layerMs: Math.round(layerMs),
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
    hide(at) {
      hiddenAt = at
    },
    doorways: () => doorways,
    setAgents(next) {
      source = next
      swapped = true
    },
    heroAt: (id) => heroAt(id),
    dispose() {
      disposed = true
      unFrame()
      crowd?.dispose()
      for (const el of opts.host.querySelectorAll("[data-hero-banner]")) el.remove()
      for (const done of cleanup) done()
      const ext = window.guildhall?.ext
      if (ext) delete ext.life
    },
  }
}
