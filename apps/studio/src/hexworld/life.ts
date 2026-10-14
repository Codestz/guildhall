/**
 * Life on the hex island (track B, `?life=0` turns it off): the townsfolk of every place living their
 * day (world `planFolk`) and the agents, wherever their source puts them (an `AgentSource`,
 * lifeAgents.ts: a guild's events planned on the walk graph, sim life), all on the island's walk
 * graph, drawn by the R5 crowd in one go (the nearest few as full heroes, everyone else the baked
 * crowd: three draws), at CHARACTER_SCALE with their feet on the ground. Each agent wears V1's chip over
 * its head (chips.ts): its name and rank, what it is doing, its deed's sigil, what it says, decluttered.
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
  CARRY_WALK,
  type Crowd,
  createCrowd,
  loadCharacter,
  loadPiece,
  measure,
  type Stage,
  strideStep,
  type WorkFx,
} from "@guildhall/render"
import {
  type AgentPose,
  BEAT_FX,
  BRISK_WALK,
  gaitMps,
  HERO_CLIPS,
  HERO_PROP_STANDIN,
  HERO_PROPS,
  type Itinerary,
  isRun,
  RUN_CLIP,
  SPRINT_CLIP,
  walkFor,
} from "@guildhall/sim"
import { PHONE_MAX } from "@guildhall/ui"
import {
  CHARACTER_SCALE,
  CHEER_CLIP,
  type DoorPass,
  DRILLS,
  type DrillAt,
  type DrillFrame,
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
  type LifeSample,
  type LifeStep,
  lifePlaces,
  lifePose,
  PETITION_FIGURES,
  type PetitionLane,
  PROPS,
  routineClips,
  routineClock,
  routineSample,
  solidDistance,
  spotFrame,
  stockAt,
  workTiles,
} from "@guildhall/world"
import { libraryUrl, loadCatalog } from "../catalog.ts"
import * as data from "../data.ts"
import { type ChipMode, type Chips, chipViews, createChips } from "./chips.ts"
import { collideView } from "./collideView.ts"
import { createFolkTalk, FOLK_SAY_M, type FolkTalk } from "./folkTalk.ts"
import { type AgentSource, recipeOf } from "./lifeAgents.ts"
import { AGENT_OPTS, LIFE_MPS, type LifePlan, SEC_PER_HOUR, SPEEDUP } from "./lifePlan.ts"
import { createSpace } from "./space.ts"
import {
  CARRIED,
  carryId,
  createWork,
  drawnAs,
  easeAngle,
  type Fisher,
  propMask,
  type Work,
  type WorkLook,
  workEntries,
  workLook,
} from "./work.ts"

export { LIFE_MPS, SPEEDUP } from "./lifePlan.ts"

const logger = log("studio:hexworld:life")
/** A chip stands this far over an agent's feet, metres: just over its head. */
const CHIP_UP = 1.3
/** Townsfolk this near the notice board (metres) come to read a quest just pinned, at most one per reader spot. */
const READ_REACH = 20
/** Seconds they read it (and a few more by their seed), their pace there and back (m/s), between gatherings. */
const READ_S = 11
const READ_MPS = 0.85
const READ_AGAIN_S = 40

/** A townsfolk's words stand this far over their feet, metres: just over the head (seated: lower). */
const SAY_UP = 1.15
const SAY_SAT = 0.85
/** How often the chips' words are read again from the source's world when it has not changed, ms. */
const WORDS_MS = 250
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
  /** Where the heroes' chips go (the Viewer's labels layer); none: no chips. */
  chips?: HTMLElement
  /**
   * A hero's work beat as it falls (sim life's sample `beat`: a hammer landing, a spell cast…), where and
   * with what it plays and holds: the work FX's `beat`.
   */
  beat?: (
    beat: string,
    at: [number, number, number],
    sample: { clip: string; props: readonly string[] },
  ) => void
  /** The work FX the townsfolk's beats burst through (fx.ts `mountWorkFx`); none: no bursts. */
  workfx?: WorkFx | null
  /** The sea's level, metres (a fisher's float rides it). */
  sea?: number
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
  /**
   * Stands the petitioners where `poses` says each frame (docket.ts: world `petitionerPoses`, one per
   * figure, null: indoors at the quay's door); null puts them all back indoors.
   */
  setPetitioners(poses: (() => readonly (LifePose | null)[]) | null): void
  /** Where the petitioners queue (the plan's), once `ready`; null with no quay. */
  petitionLane(): PetitionLane | null
  /** Where hero `id` is drawn now (its feet, metres), or null when it is not on the island. */
  heroAt(id: string): [number, number, number] | null
  /** Hero `id`'s itinerary as planned (its steps and acts), when its source keeps one (the graveyard reads a fixer's blow). */
  itinerary(id: string): Itinerary | undefined
  /**
   * How hero `id` is drawn (its figure's look, at scale 1, holding its role's own props) and the catalog
   * it is dressed from: what its HUD portrait shows. Null while it has no figure.
   */
  heroLook(id: string): { look: NpcLook; catalog: Catalog } | null
  /** The heroes' chips (chips.ts), once everyone is drawn; null without them. */
  chips(): Chips | null
  dispose(): void
}

/** The notice board's piece, and how tall it stands (metres: a little over a hero's head). */
const NOTICE_BOARD = "kenney-nature/sign"
const NOTICE_BOARD_M = 1.35

/** The bodies a petitioner is drawn with: hooded travellers. */
const PETITIONER_BODIES = ["kaykit-adventurers/rogue-hooded", "kaykit-adventurers/rogue"]

/** Spare figures of each body a growing source may use (`agentPool`). */
export const AGENT_POOL = 4
/** The bodies a hero is drawn with (sim `Body`), as catalog ids. */
const BODIES = ["mage", "knight", "ranger", "barbarian", "rogue"].map((b) => `kaykit-adventurers/${b}`)

/** The catalog with `data/mounts.json` laid over it, so props carry their authored mounts. */
async function mountedCatalog(): Promise<Catalog | null> {
  const [catalog, overlay] = await Promise.all([loadCatalog(), data.loadOverlay().catch(() => ({}))])
  if (!catalog) return null
  const all = applyOverlay(catalog.all(), overlay)
  // the props built in code and the loads carried on the chest (work.ts)
  const template = catalog.get("kaykit-tools/axe") ?? all.find((e) => e.kind === "static")
  const byId = new Map(all.map((e) => [e.id, e]))
  const extra = template ? workEntries({ get: (id) => byId.get(id) }, template) : []
  return createCatalog(catalog.index, [all, extra])
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
export function usable(r: NpcRecipe, catalog: Catalog): NpcRecipe {
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
      // a work routine's every clip
      if (s.routine) for (const c of routineClips(s.routine.id)) out.add(c)
    }
  return [...out].sort()
}

/** A look at the hex world's scale. */
const scaled = (look: NpcLook): NpcLook => ({ ...look, scale: look.scale * CHARACTER_SCALE })

/** An agent's look: its role's props and clips on its class's body. */
export function heroLook(recipe: NpcRecipe, body: string, seed: number, catalog: Catalog): NpcLook {
  const look = resolveNpc(recipe, seed, catalog)
  const parts = catalog.get(body)?.character?.parts
  const hide = (recipe.hide ?? []).filter((p) => !parts || parts.includes(p))
  return scaled({ ...look, body, hide, scale: 1.06 })
}

/**
 * The piece drawn for a hero's prop (sim `HERO_PROPS`): itself when the library mounts it, else its
 * stand-in (sim `HERO_PROP_STANDIN`) when that is mounted; "" for none.
 */
function shownProp(id: string, catalog: Catalog): string {
  if (catalog.get(id)?.compose.mount) return id
  const stand = HERO_PROP_STANDIN[id]
  return stand && catalog.get(stand)?.compose.mount ? stand : ""
}

/**
 * A hero's look holding every prop its work may call for besides its role's own (the game-feel plan,
 * task D): each frame its sample says which show (crowd `ActorSample.props`).
 */
function withHeroProps(look: NpcLook, catalog: Catalog): NpcLook {
  const mounts = [...look.mounts]
  for (const id of Object.values(HERO_PROPS)) {
    const piece = shownProp(id, catalog)
    const mount = piece ? catalog.get(piece)?.compose.mount : undefined
    if (!mount || mounts.some((m) => m.piece === piece)) continue
    mounts.push({ piece, slot: mount.slot })
  }
  return { ...look, mounts }
}

/** The HUD's mode and whether the view is a phone, off the Viewer's root (attributes: no layout). */
function chipField(host: HTMLElement, width: number): { mode: ChipMode; phone: boolean } {
  const root = host.closest<HTMLElement>(".ui-viewer")
  const set = root?.dataset.hud === "on" ? root.dataset.hudMode : undefined
  const mode: ChipMode = set === "detailed" || set === "hidden" ? set : "minimal"
  return { mode, phone: root?.dataset.phone !== undefined || width <= PHONE_MAX }
}

export function createLife(stage: Stage, opts: LifeOpts): Life {
  let disposed = false
  let crowd: Crowd | null = null
  let chips: Chips | null = null
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
  let heroLookOf: Life["heroLook"] = () => null
  /** The petitioners' poses this frame (docket.ts), by figure, and where a figure not out waits (the quay's door). */
  let petitionSource: (() => readonly (LifePose | null)[]) | null = null
  let petitionNow: readonly (LifePose | null)[] | null = null
  let petitionDoor: LifePose | null = null
  let petitionLaneOf: PetitionLane | null = null
  const petitionIds: number[] = []

  /** Draws the notice board at the plan's place, NOTICE_BOARD_M tall, facing the gathering. */
  const placeBoard = async (board: { at: [number, number, number]; facing: number }) => {
    const catalog = await loadCatalog()
    const entry = catalog?.get(NOTICE_BOARD)
    if (!entry || disposed) return
    const piece = await loadPiece(libraryUrl(entry.files.glb))
    if (disposed) return
    const tall = measure(piece).size[1] || 1
    piece.scale.setScalar(NOTICE_BOARD_M / tall)
    piece.position.set(board.at[0], opts.groundAt(board.at[0], board.at[2]), board.at[2])
    piece.rotation.y = board.facing
    stage.scene.add(piece)
    cleanup.push(() => piece.removeFromParent())
  }

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
    petitionLaneOf = plan.petitions
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
    const loops: (
      | { steps: LifeStep[]; figure?: undefined; petition?: number }
      | { figure: number; petition?: undefined }
    )[] = []
    /** Each townsfolk's role, by crowd id (shots). */
    const roleOf: string[] = []
    /** Each townsfolk's mounts for the day's work (work.ts), by crowd id. */
    const worn: WorkLook[] = []
    const mountOf = (piece: string) => catalog.get(piece)?.compose.mount
    for (const f of folk) {
      const recipe = usableOf(f.role)
      if (!recipe) continue
      const look = resolveNpc(recipe, hash(`hexfolk:${opts.seed}:${f.id}`), catalog)
      const w = workLook(scaled(holding(look, f.prop, catalog)), f, mountOf)
      worn[looks.length] = w
      looks.push(w.look)
      loops.push({ steps: f.day })
      roleOf[looks.length - 1] = f.role
    }
    // the petitioners' figures (docket.ts): hooded travellers, indoors at the quay's door until the docket stands them out
    const lane = plan.petitions
    const base = lane ? (usableOf("monk") ?? usableOf("farmer")) : undefined
    const bodies = PETITIONER_BODIES.filter((b) => catalog.get(b))
    if (lane && base && bodies.length) {
      const { head: _, ...bare } = base
      const recipe: NpcRecipe = { ...bare, id: "petitioner", body: bodies, hands: {} }
      const door = lane.approach[0]!
      for (let k = 0; k < PETITION_FIGURES; k++) {
        petitionIds.push(looks.length)
        looks.push(scaled(resolveNpc(recipe, hash(`petitioner:${opts.seed}:${k}`), catalog)))
        loops.push({
          steps: [
            { kind: "stay", from: 0, to: 24, at: door, facing: 0, act: "idle", ground: true, indoors: true },
          ],
          petition: k,
        })
        roleOf[looks.length - 1] = "petitioner"
      }
      petitionDoor = { at: door, facing: 0, act: "idle", indoors: true, ground: true }
    }
    // a carry walk is baked when someone carries a load in both arms
    const carries = folk.some((f) =>
      f.day.some((s) => s.kind === "walk" && s.carry && CARRIED.has(drawnAs(s.carry))),
    )
    /**
     * The heroes' figures: one for each hero the source has now (its look), and with `agentPool` spares
     * of every body for those it adds; `agent` is the hero a figure draws, and its banner says who.
     */
    const figures: { crowd: number; hero: string; agent: string | null; own: string[]; look: NpcLook }[] = []
    const figure = (hero: string, recipeId: string, seed: string, agent: string | null) => {
      const recipe = usableOf(recipeId)
      if (!recipe || !catalog.get(hero)) return
      const look = heroLook(recipe, hero, hash(seed), catalog)
      // its role's own props show while nothing else is in hand (walking, resting)
      figures.push({
        crowd: looks.length,
        hero,
        agent,
        own: look.mounts.map((m) => m.piece),
        look: { ...look, scale: 1 },
      })
      looks.push(withHeroProps(look, catalog))
      loops.push({ figure: figures.length - 1 })
    }
    /** The pieces a hero's sample puts in its hands (`shownProp`), cached by the sample's list. */
    const handsOf = new Map<string, string[]>()
    const hands = (props: readonly string[]): string[] => {
      const key = props.join("|")
      let out = handsOf.get(key)
      if (!out) {
        out = props.map((p) => shownProp(p, catalog)).filter((p) => p !== "")
        handsOf.set(key, out)
      }
      return out
    }
    for (const a of agents) figure(a.hero, a.recipe, `agent:${a.id}`, a.id)
    if (opts.agentPool)
      for (const hero of BODIES)
        for (let k = 0; k < AGENT_POOL; k++)
          figure(hero, recipeOf(hero.split("/").pop() ?? ""), `agent:spare:${hero}:${k}`, null)
    const agentIds = figures.map((f) => f.crowd)
    heroLookOf = (id) => {
      const f = figures.find((g) => g.agent === id)
      return f ? { look: f.look, catalog } : null
    }
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
          chips?.place(f.agent, null)
          f.agent = null
        }
      for (const a of list) {
        let f = figures.find((g) => g.agent === a.id)
        f ??= figures.find((g) => g.agent === null && g.hero === a.hero)
        if (!f) continue
        if (f.agent !== a.id) f.agent = a.id
      }
    }
    const made = await createCrowd(
      stage,
      looks.map((look, id) => ({ id, look })),
      { catalog, url: libraryUrl },
      {
        heroes: 12,
        clips: [
          ...spotClips(folk.map((f) => f.day)),
          ...(figures.length ? [RUN_CLIP, SPRINT_CLIP, BRISK_WALK, ...HERO_CLIPS] : []),
          ...(carries ? [CARRY_WALK] : []),
          ...(petitionIds.length ? [CHEER_CLIP] : []),
        ],
      },
    )
    if (disposed) {
      made.dispose()
      return
    }
    crowd = made
    crowd.setHeroes(agentIds)
    // the Guildhall's notice board (where the Guildmaster pins quests: sim life), when the plan has one
    if (plan.board && figures.length) void placeBoard(plan.board)
    // the canvas's CSS size, kept by an observer (never read in a frame)
    const canvas = stage.renderer.domElement
    const view = { width: canvas.clientWidth, height: canvas.clientHeight }
    const sized = new ResizeObserver(() => {
      view.width = canvas.clientWidth
      view.height = canvas.clientHeight
    })
    sized.observe(canvas)
    cleanup.push(() => sized.disconnect())
    const chipHost = opts.chips
    if (figures.length && chipHost)
      chips = createChips(chipHost, () => ({ ...view, ...chipField(chipHost, view.width) }))
    // the townsfolk's words near the camera, under the heroes' speaker cap (folkTalk.ts)
    const talk: FolkTalk | null = chipHost ? createFolkTalk(chipHost) : null
    if (talk) cleanup.push(() => talk.dispose())
    /** This frame's camera, for the townsfolk's words: its matrices and where it is. */
    const eyeCam = stage.camera
    const sayAt = (id: number, text: string, x: number, y: number, z: number) => {
      const e = eyeCam.position
      if (!talk || Math.hypot(e.x - x, e.y - y, e.z - z) > FOLK_SAY_M) return
      const v = eyeCam.matrixWorldInverse.elements
      const pm = eyeCam.projectionMatrix.elements
      const vx = v[0]! * x + v[4]! * y + v[8]! * z + v[12]!
      const vy = v[1]! * x + v[5]! * y + v[9]! * z + v[13]!
      const vz = v[2]! * x + v[6]! * y + v[10]! * z + v[14]!
      if (-vz <= eyeCam.near) return
      const cx = pm[0]! * vx + pm[4]! * vy + pm[8]! * vz + pm[12]!
      const cy = pm[1]! * vx + pm[5]! * vy + pm[9]! * vz + pm[13]!
      const cw = pm[3]! * vx + pm[7]! * vy + pm[11]! * vz + pm[15]!
      const sx = ((cx / cw + 1) / 2) * view.width
      const sy = ((1 - cy / cw) / 2) * view.height
      if (sx < 0 || sx > view.width || sy < 0 || sy > view.height) return
      talk.say(id, text, sx, sy, -vz)
    }

    // the day's clock: follows the screen's when it moves, else runs SPEEDUP× real time (`held`: shots
    // hold it at an hour, ext.life.hold)
    let held: number | null = null
    let seen = opts.hour()
    let day = seen
    let secs = opts.agentT ?? 0
    let dt = 0
    const last = looks.map(() => [Number.NaN, 0] as [number, number])
    /** Each hero's beat as last drawn: a beat fires as it begins. */
    const beats: (string | undefined)[] = looks.map(() => undefined)
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
    /** The way each townsfolk faces as drawn: a routine's turns eased (work.ts), else the pose's. */
    const heading = new Float32Array(n).fill(Number.NaN)
    /** Per townsfolk, the mask a props list gives (lists are kept by the routine: one per part). */
    const masks = looks.map(() => new Map<readonly string[], number>())
    const maskOf = (id: number, shown: readonly string[], busy: boolean): number | undefined => {
      const w = worn[id]
      if (!w) return undefined
      const m = masks[id]!
      let mask = m.get(shown)
      if (mask === undefined) {
        mask = propMask(w, shown, busy)
        m.set(shown, mask)
      }
      return mask
    }
    const NOTHING: readonly string[] = []
    /** One list per piece (and per routine props list plus a carry), so the masks' cache keys stay the same. */
    const lists = new Map<string, readonly string[]>()
    const listOf = (key: string, make: () => readonly string[]) => {
      let l = lists.get(key)
      if (!l) {
        l = make()
        lists.set(key, l)
      }
      return l
    }
    /** The work drawn round the townsfolk: stocks, floats and lines, beats (work.ts). */
    let work: Work | null = null
    /** This frame's ms in the agents' source. */
    let agentMs = 0
    /**
     * The crowd round the notice board (plan `readers`): townsfolk standing near it when a quest is
     * pinned walk over, read and talk it over, and walk back to their stay; times are the agents' seconds.
     */
    interface Reader {
      from: [number, number, number]
      spot: { at: [number, number, number]; facing: number }
      go: number
      arrive: number
      leave: number
      back: number
      seed: number
    }
    const reading = new Map<number, Reader>()
    let gathered = Number.NEGATIVE_INFINITY
    /** Whether the straight way between two points keeps clear of walls and blockers (its ends aside: where one works). */
    const clearLine = (ax: number, az: number, bx: number, bz: number) => {
      const len = Math.hypot(bx - ax, bz - az)
      const n = Math.ceil(len / 0.35)
      for (let k = Math.ceil((0.7 / len) * n); k < n - 1; k++) {
        const x = ax + ((bx - ax) * k) / n
        const zz = az + ((bz - az) * k) / n
        for (const o of collide.solidsNear(x, zz, 0.5))
          if (o.kind !== "seat" && o.kind !== "prop" && solidDistance(o, x, zz) < 0.2) return false
      }
      return true
    }
    /** A quest pinned at `t`: the nearest few standing about come to the board. */
    const gather = (t: number) => {
      const spots = plan.readers
      if (!spots.length || t - gathered < READ_AGAIN_S) return
      gathered = t
      reading.clear()
      const cx = spots.reduce((m, r) => m + r.at[0], 0) / spots.length
      const cz = spots.reduce((m, r) => m + r.at[2], 0) / spots.length
      const near: { id: number; d: number }[] = []
      for (let id = 0; id < n; id++) {
        const l = loops[id]!
        const p = poses[id]
        // (not a duel, a tavern's table, a chat: those keep a clock with others)
        if (
          l.figure !== undefined ||
          l.petition !== undefined ||
          !p ||
          p.indoors ||
          p.act === "walk" ||
          p.drill
        )
          continue
        if (p.routine?.day !== undefined) continue
        const d = Math.hypot(space.x[id]! - cx, space.z[id]! - cz)
        if (d > READ_REACH) continue
        // still at the same stay when they would be back
        const away = READ_S + 6 + (2 * d) / READ_MPS + 4
        const later = lifePose(l.steps, (day + (away * SPEEDUP) / 3600) % 24, 24)
        if (later.act === "walk" || later.since !== p.since) continue
        near.push({ id, d })
      }
      near.sort((a, b) => a.d - b.d || a.id - b.id)
      const free = [...spots]
      for (const c of near) {
        if (!free.length) break
        const x = space.x[c.id]!
        const zz = space.z[c.id]!
        let k = 0
        for (let j = 1; j < free.length; j++)
          if (
            Math.hypot(free[j]!.at[0] - x, free[j]!.at[2] - zz) <
            Math.hypot(free[k]!.at[0] - x, free[k]!.at[2] - zz)
          )
            k = j
        const spot = free[k]!
        if (!clearLine(x, zz, spot.at[0], spot.at[2])) continue
        free.splice(k, 1)
        const go = t + 0.8 + reading.size * 0.7
        const arrive = go + Math.hypot(spot.at[0] - x, spot.at[2] - zz) / READ_MPS
        const seed = hash(`read:${opts.seed}:${c.id}:${Math.round(t)}`)
        const leave = arrive + READ_S + (seed % 5)
        reading.set(c.id, {
          from: [x, poses[c.id]!.at[1], zz],
          spot,
          go,
          arrive,
          leave,
          back: leave + (arrive - go),
          seed,
        })
      }
      // they read it together: everyone stays until the last has had a look, then they go a few apart
      const last = Math.max(...[...reading.values()].map((r) => r.arrive))
      for (const r of reading.values()) {
        r.leave = last + READ_S + (r.seed % 4)
        r.back = r.leave + (r.arrive - r.go)
      }
    }
    /** A reader's pose now, or null when they are at their own stay. */
    const readerPose = (id: number): LifePose | null => {
      const r = reading.get(id)
      if (!r) return null
      if (secs < gathered) {
        // the clock went back before the pin: nobody has gone
        reading.clear()
        return null
      }
      if (secs < r.go || secs >= r.back) {
        if (secs >= r.back) reading.delete(id)
        return null
      }
      const walking = (a: readonly number[], b: readonly number[], f: number): LifePose => ({
        at: [a[0]! + (b[0]! - a[0]!) * f, a[1]! + (b[1]! - a[1]!) * f, a[2]! + (b[2]! - a[2]!) * f],
        facing: Math.atan2(b[0]! - a[0]!, b[2]! - a[2]!),
        act: "walk",
        indoors: false,
        ground: true,
      })
      if (secs < r.arrive) return walking(r.from, r.spot.at, (secs - r.go) / (r.arrive - r.go))
      if (secs >= r.leave) return walking(r.spot.at, r.from, (secs - r.leave) / (r.back - r.leave))
      return {
        at: r.spot.at,
        facing: r.spot.facing,
        act: "idle",
        indoors: false,
        ground: true,
        routine: { id: "notice", seed: r.seed },
        since: day - (secs - r.arrive) / SEC_PER_HOUR,
      }
    }
    /** Where person id's way has them now: their clock, less how late queueing has made them. */
    const pose = (id: number): LifePose => {
      const l = loops[id]!
      const late = space.delay[id]!
      if (l.petition !== undefined) return petitionNow?.[l.petition] ?? petitionDoor ?? OFF_ISLAND
      if (l.figure === undefined)
        return (reading.size ? readerPose(id) : null) ?? lifePose(l.steps, day - (late * SPEEDUP) / 3600, 24)
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
    /**
     * A drilling person's frame on the shared clock: the day's, in screen seconds (so a set clock and a
     * played one agree, and the spectators' cheers meet the duels' hits); a duellist alone waits.
     */
    const drilled = (d: DrillAt): DrillFrame => {
      const alone = d.pair !== undefined && (duelling.get(d.pair) ?? 0) < 2
      const solo = DRILLS[d.id]?.solo
      const t = day * SEC_PER_HOUR + d.at
      return alone && solo ? drillFrame(solo, 0, t) : drillFrame(d.id, d.side, t)
    }
    /** A townsfolk's routine sample now: seconds into their stay on the day's clock (less their queueing). */
    const routined = (id: number, p: LifePose): LifeSample => {
      const now = day - (space.delay[id]! * SPEEDUP) / 3600
      const into = ((((now - (p.since ?? 0)) % 24) + 24) % 24) * SEC_PER_HOUR
      // (a tavern's tables, a chat's two sides, a haggle: on the day's own clock, so they keep together)
      return routineSample(p.routine!, routineClock(p.routine!, into, day, SEC_PER_HOUR))
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
      const moved = Number.isNaN(prev[0]) ? 0 : Math.sqrt((x - prev[0]) ** 2 + (zz - prev[1]) ** 2)
      prev[0] = x
      prev[1] = zz
      // at a spot, its routine (a duel's side, a drill line: on the shared clock) or its clip; walking,
      // always the walk
      if (p.act !== "walk" && p.drill) {
        const f = drilled(p.drill)
        // stepping in to fight, out after
        const [px, pz] = f.step ? spotFrame(x, zz, p.facing, 0, f.step) : [x, zz]
        return {
          position: [px, y, pz],
          heading: p.facing,
          clip: f.clip,
          phase: f.phase,
          hidden: p.indoors || (hiddenAt !== null && hiddenAt(x, zz)),
        }
      }
      // at work: its routine (world routines.ts), on the day's clock from when the stay began, so a
      // played clock and a set one give the same frame; standing a little off the spot when it says
      if (p.act !== "walk" && p.routine) {
        const f = routined(id, p)
        const [px, pz] = f.shift ? spotFrame(x, zz, p.facing, f.shift[0], f.shift[1]) : [x, zz]
        // a seat's lift only while seated (a patron stands for the toast)
        const lift = p.lift && f.clip.startsWith("Sit_Chair") ? p.lift : 0
        const py = (f.shift ? footAt(px, pz, p) : y - (p.lift ?? 0)) + lift
        // a part's turn (to the basket, the cart) eased rather than snapped
        heading[id] = easeAngle(heading[id]!, p.facing + (f.turn ?? 0), dt)
        const hidden = p.indoors || (hiddenAt !== null && hiddenAt(x, zz))
        // what is in the hands: the sample's props, and a crop carried down the row
        const carry = f.carry
        const shown = carry ? listOf(`${f.props.join()}+${carry}`, () => [...f.props, carry]) : f.props
        if (!hidden) work?.note(id, p, f, [px, py, pz], heading[id]!)
        if (f.say && !hidden) sayAt(id, f.say, px, py + (f.clip.startsWith("Sit") ? SAY_SAT : SAY_UP), pz)
        return {
          position: [px, py, pz],
          heading: heading[id]!,
          clip: f.clip,
          phase: f.phase,
          hidden,
          ...(worn[id] ? { mask: maskOf(id, shown, true) } : {}),
        }
      }
      const l = loops[id]!
      const fig = l.figure !== undefined ? figures[l.figure] : undefined
      // a hero: what its work or its moment plays (sim life's sample, a pure function of its clock), with
      // the props it holds for it; walking, the walk with its role's own props (or the loot it carries)
      const doing = fig ? (p as AgentPose).sample : undefined
      const props = fig ? (doing ? hands(doing.props) : fig.own) : undefined
      if (doing && p.act !== "walk") {
        phase[id] = doing.phase
        if (doing.beat !== beats[id] && doing.beat && !p.indoors) {
          opts.beat?.(doing.beat, [x, y + 0.6, zz], { clip: doing.clip, props: doing.props })
          // a quest pinned at the board: a few townsfolk come to read it
          if (doing.beat === BEAT_FX.pin && doing.clip === "Interact") gather(secs)
        }
        beats[id] = doing.beat
        return {
          position: [x, y, zz],
          heading: p.facing,
          clip: doing.clip,
          phase: doing.phase,
          hidden: p.indoors || (hiddenAt !== null && hiddenAt(x, zz)),
          ...(props ? { props } : {}),
        }
      }
      heading[id] = p.facing
      // a load in both arms (a log to the pile, a basket to market): the carrying walk, the load on the chest
      const carried = p.act === "walk" && p.carry && worn[id] ? drawnAs(p.carry) : undefined
      const chest = carried !== undefined && CARRIED.has(carried)
      // walking: the walk (one that keeps the pace: sim walkFor), or the run or sprint a hero takes on a
      // long way (sim gait.ts); at a spot, its clip
      const clip = chest
        ? CARRY_WALK
        : p.clip && (p.act !== "walk" || isRun(p.clip))
          ? p.clip
          : p.act === "walk"
            ? walkFor(look.clips.walk, fig ? AGENT_OPTS.mps : LIFE_MPS)
            : look.clips[p.act]
      // walking: stride-matched, the feet keep to the ground covered (render strideStep); standing: the
      // clip's own time
      const seconds = durations.get(clip) ?? 1.5
      phase[id] =
        phase[id]! +
        (p.act === "walk" ? strideStep(moved, dt, gaitMps(clip), seconds, look.scale) : dt / seconds)
      const mask = !worn[id]
        ? undefined
        : carried === undefined
          ? maskOf(id, NOTHING, false)
          : maskOf(
              id,
              listOf(chest ? carryId(carried) : carried, () => [chest ? carryId(carried) : carried]),
              chest,
            )
      return {
        position: [x, y, zz],
        heading: p.facing,
        clip,
        phase: phase[id]! - Math.floor(phase[id]!),
        hidden: p.indoors || (hiddenAt !== null && hiddenAt(x, zz)),
        ...(props ? { props } : {}),
        ...(mask !== undefined ? { mask } : {}),
      }
    }
    /** The chips' words: read again when the source's world changed, or every WORDS_MS (speech ends, walks end). */
    let wordsWorld: unknown = null
    let wordsAt = Number.NEGATIVE_INFINITY
    const walkingId = (id: string) => {
      const f = figures.find((g) => g.agent === id)
      return f !== undefined && poses[f.crowd]?.act === "walk"
    }
    /** One scratch for the chip's anchor: no allocation per figure per frame. */
    const anchor = { x: 0, y: 0, z: 0, perUnit: 0 }
    const placeChips = () => {
      if (!chips) return
      const now = performance.now()
      const w = source?.worldAt?.(secs) ?? null
      if (w && (w.world !== wordsWorld || now - wordsAt >= WORDS_MS)) {
        wordsWorld = w.world
        wordsAt = now
        const named = source?.ownNames ? new Map(source.list().map((l) => [l.id, l])) : null
        chips.set(chipViews(w.world, w.t, walkingId, named ? (id) => named.get(id) : undefined))
      }
      const cam = stage.camera
      cam.updateMatrixWorld()
      const v = cam.matrixWorldInverse.elements
      const pm = cam.projectionMatrix.elements
      for (const f of figures) {
        if (f.agent === null) continue
        const id = f.crowd
        const p = poses[id]
        const x = space.x[id]!
        const zz = space.z[id]!
        // an agent not on the island, or on land not yet there (a history replay), has no chip either
        if (!p || p.indoors || hiddenAt?.(x, zz)) {
          chips.place(f.agent, null)
          continue
        }
        const y = footAt(x, zz, p) + CHIP_UP
        // the anchor in view space, then on screen (the camera's own matrices: no Vector3, no layout)
        const vx = v[0]! * x + v[4]! * y + v[8]! * zz + v[12]!
        const vy = v[1]! * x + v[5]! * y + v[9]! * zz + v[13]!
        const vz = v[2]! * x + v[6]! * y + v[10]! * zz + v[14]!
        const depth = -vz
        if (depth <= cam.near) {
          chips.place(f.agent, null)
          continue
        }
        const cx = pm[0]! * vx + pm[4]! * vy + pm[8]! * vz + pm[12]!
        const cy = pm[1]! * vx + pm[5]! * vy + pm[9]! * vz + pm[13]!
        const cw = pm[3]! * vx + pm[7]! * vy + pm[11]! * vz + pm[15]!
        anchor.x = ((cx / cw + 1) / 2) * view.width
        anchor.y = ((1 - cy / cw) / 2) * view.height
        if (
          anchor.x < -300 ||
          anchor.x > view.width + 300 ||
          anchor.y < -300 ||
          anchor.y > view.height + 300
        ) {
          chips.place(f.agent, null)
          continue
        }
        anchor.z = depth
        anchor.perUnit = (pm[5]! * view.height * 0.5) / depth
        chips.place(f.agent, anchor)
      }
    }
    // the CPU a frame of life costs (sampling, the crowd's update, the chips), smoothed
    let cpuMs = 0
    // of which the agents' poses (their source's samples), smoothed
    let agentCpu = 0
    const tick = (step: number) => {
      const t1 = performance.now()
      agentMs = 0
      source?.tick?.()
      assign()
      dt = step
      petitionNow = petitionSource?.() ?? null
      const clock = opts.hour()
      const seek = Math.abs(clock - seen) > 1e-6
      if (held !== null) day = held
      else if (seek) {
        seen = clock
        day = clock
      } else day = (day + (step * SPEEDUP) / 3600) % 24
      secs += step
      place(step)
      clockNow = day
      const t2 = performance.now()
      stage.timing.cpu.add("life", t2 - t1)
      agentCpu += (agentMs - agentCpu) * 0.05
      talk?.begin()
      crowd?.update(step, sample)
      // the work round them, from what the crowd drew (rods' tips): floats, lines, beats, stocks
      work?.frame(day, step, seek || step > 0.5)
      const t3 = performance.now()
      stage.timing.cpu.add("crowd", t3 - t2)
      // the chips over their agents: placed every frame, their words and the declutter at most 10 times a second
      if (chips) {
        placeChips()
        chips.frame(t3)
      }
      if (talk) {
        // the heroes' bubbles first: the townsfolk take what the cap leaves, clear of theirs
        const taken: { x: number; y: number }[] = []
        for (const sl of chips?.declutter.slots ?? [])
          if (sl.speak) taken.push({ x: sl.x, y: sl.y - sl.lift - sl.height - 16 })
        const field = chipHost ? chipField(chipHost, view.width) : null
        talk.end(taken, taken.length, !field || field.mode === "hidden" || field.phone)
      }
      stage.timing.cpu.add("chips", performance.now() - t3)
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
        if ((space.x[id]! - x) ** 2 + (space.z[id]! - zz) ** 2 < r * r) return true
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
    // the stocks, floats and lines (one batch, one line draw), on the ground the walkers stand on
    const fishers: Fisher[] = []
    for (const [id, w] of worn.entries()) {
      const rod = w?.index.get(PROPS.rod)
      const l = loops[id]
      if (
        rod !== undefined &&
        l?.figure === undefined &&
        l?.steps.some((s) => s.kind === "stay" && s.routine?.id === "fish")
      )
        fishers.push({ id, rod })
    }
    work = await createWork({
      stage,
      crowd: made,
      catalog,
      url: libraryUrl,
      stocks: plan.stocks,
      ground: (x, zz) => collide.walkwayAt(x, zz) ?? collide.heightAt(x, zz),
      sea: opts.sea ?? 0,
      workfx: opts.workfx ?? null,
      secPerHour: SEC_PER_HOUR,
      fishers,
    })
    if (disposed) {
      work?.dispose()
      return
    }
    cleanup.push(() => work?.dispose())
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
                    // what its work or moment plays and holds (sim life's sample)
                    sample: (poses[f.crowd] as AgentPose | undefined)?.sample,
                  },
                ],
          ),
        heroAt: (id: string) => heroAt(id),
        // shots: the heroes' clock (screen seconds into their source), set when `s` is given
        agentSecs: (s?: number) => {
          if (s !== undefined) secs = s
          return secs
        },
        // shots: where a hero's source has it at second `s` (its walk's gait in `clip`), drawn or not
        agentPoseAt: (id: string, s: number) => source?.poseAt(id, s) ?? null,
        // a hero's itinerary as planned (its steps and acts), when the source keeps one
        itinerary: (id: string) => source?.itinerary?.(id),
        // the chips as the declutter left them (shots, the perf probe)
        chips: () => chips?.declutter.slots.map((s) => ({ ...s })) ?? [],
        // everyone drawn now (x, z, a hero's id or null), for the spacing probe
        people: () =>
          Array.from({ length: n }, (_, id) =>
            poses[id]?.indoors
              ? null
              : [space.x[id], space.z[id], figures.find((f) => f.crowd === id)?.agent ?? null],
          ).filter(Boolean),
        walk: { nodes: plan.stats.nodes, edges: plan.stats.edges },
        // for shots and tests: what each townsfolk at work plays now (their routine's sample), and
        // the stocks their work fills, at the day's clock
        work: () =>
          loops.flatMap((l, id) => {
            const p = poses[id]
            if (l.figure !== undefined || !p || p.indoors) return []
            const f = p.act !== "walk" && p.routine ? routined(id, p) : null
            return [
              {
                id,
                role: roleOf[id],
                at: [space.x[id], space.z[id]],
                y: footAt(space.x[id]!, space.z[id]!, p),
                act: p.act,
                facing: p.facing,
                heading: Number.isNaN(heading[id]!) ? p.facing : heading[id],
                routine: p.routine?.id ?? null,
                drill:
                  p.drill && p.act !== "walk"
                    ? { id: p.drill.id, side: p.drill.side, pair: p.drill.pair ?? null }
                    : null,
                clip: f?.clip ?? p.clip ?? null,
                cycle: f?.cycle ?? null,
                beat: f?.beat ?? null,
                props: f?.props ?? [],
                carry: p.carry ?? null,
              },
            ]
          }),
        stocks: () => plan.stocks.map((s) => ({ kind: s.kind, at: s.at, ...stockAt(s, day, SEC_PER_HOUR) })),
        // the notice board (sim life: where the Guildmaster pins quests), if the island has one
        board: plan.board,
        // the work drawn (work.ts): stocks laid out, floats and lines, beats sent, its CPU
        workStats: () => work?.stats() ?? null,
        // shots and tests: a townsfolk's mounts and which show now (bit k: mount k), its clip
        dress: (id: number) => {
          const s = sample(id)
          // where each mount's origin and a metre along its z were drawn (null: not drawn)
          const at = (k: number, local: [number, number, number]) => {
            const out = [0, 0, 0]
            return made.propPoint(id, k, local, out) ? out.map((v) => Math.round(v * 100) / 100) : null
          }
          return {
            mounts: looks[id]?.mounts.map((m) => `${m.piece}@${m.slot}`),
            mask: s.mask,
            clip: s.clip,
            feet: s.position,
            heading: s.heading,
            drawn: looks[id]?.mounts.map((_, k) => [at(k, [0, 0.36, 0]), at(k, [0, 0.36, 0.6])]),
          }
        },
        // shots and tests: a townsfolk's role and day as planned (world planFolk, social.ts)
        day: (id: number) => {
          const l = loops[id]
          return l && l.figure === undefined ? { role: roleOf[id], steps: l.steps } : null
        },
        // shots: who reads at the notice board now (the crowd a pin gathers), and a gathering by hand
        readers: () => [...reading.keys()],
        readerSpots: plan.readers,
        gather: () => {
          gathered = Number.NEGATIVE_INFINITY
          gather(secs)
          return [...reading.keys()]
        },
        // shots: hold the day's clock at an hour (null: let it run on from there)
        hold: (h: number | null) => {
          held = h
          if (h !== null) day = h
        },
        // shots: the first hour from `from` (scanning `secs` screen seconds) when townsfolk `id` plays
        // `clip` between phases `min` and `max` (null: not in that time)
        when: (id: number, from: number, clip: string, min = 0, max = 1, secs = 900): number | null => {
          const l = loops[id]
          if (!l || l.figure !== undefined) return null
          for (let t = 0; t < secs; t += 0.02) {
            const h = (from + t / SEC_PER_HOUR) % 24
            const p = lifePose(l.steps, h, 24)
            // "carry:<piece>": walking with it in the arms, `min`–`max` of the way
            if (clip.startsWith("carry:")) {
              if (p.act === "walk" && p.carry === clip.slice(6) && p.from && p.to) {
                const all = Math.hypot(p.to[0] - p.from[0], p.to[2] - p.from[2]) || 1
                const done = Math.hypot(p.at[0] - p.from[0], p.at[2] - p.from[2]) / all
                if (done >= min && done <= max) return h
              }
              continue
            }
            if (p.act === "walk" || !p.routine) continue
            const into = ((((h - (p.since ?? 0)) % 24) + 24) % 24) * SEC_PER_HOUR
            const f = routineSample(p.routine, routineClock(p.routine, into, h, SEC_PER_HOUR))
            if (f.clip === clip && f.phase >= min && f.phase <= max) return h
          }
          return null
        },
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
    setPetitioners(poses) {
      petitionSource = poses
    },
    petitionLane: () => petitionLaneOf,
    heroAt: (id) => heroAt(id),
    itinerary: (id) => source?.itinerary?.(id),
    heroLook: (id) => heroLookOf(id),
    chips: () => chips,
    dispose() {
      disposed = true
      unFrame()
      crowd?.dispose()
      chips?.dispose()
      for (const done of cleanup) done()
      const ext = window.guildhall?.ext
      if (ext) delete ext.life
    },
  }
}
