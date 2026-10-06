/**
 * Asset pipeline (ADR 0004): KayKit packs in assets/src → web-ready .glb in packages/hall/public/assets.
 *
 *   bun scripts/assets.ts
 *
 * - characters/<name>.glb — one per character model, pruned.
 * - anims.glb             — only the clips the hall plays, from Rig_Medium, meshes stripped. Every
 *                           character shares the rig, so one file animates everyone.
 * - kit.glb               — every environment piece and prop as a named top-level node, one shared
 *                           palette texture per pack, meshopt-compressed.
 * - packages/hall/src/world/kit.json — each kit piece's bounding box, for layout code.
 *
 * Unzip the packs first (assets/raw/*.zip → assets/src/<zip name>/). Both folders are git-ignored;
 * only the outputs are committed. All packs are CC0 (Kay Lousberg, kaylousberg.com).
 */
import { readdirSync, statSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { basename, join } from "node:path"
import { Document, type Node as GNode, getBounds, NodeIO } from "@gltf-transform/core"
import { ALL_EXTENSIONS } from "@gltf-transform/extensions"
import { dedup, mergeDocuments, meshopt, prune, resample, unpartition } from "@gltf-transform/functions"
import { MeshoptEncoder } from "meshoptimizer"

const ROOT = join(import.meta.dir, "..")
const SRC = join(ROOT, "assets/src")
const OUT = join(ROOT, "packages/hall/public/assets")

const CHARACTERS = ["Knight", "Barbarian", "Mage", "Rogue", "Rogue_Hooded", "Ranger"]

/** Rig_Medium file → the clips we keep from it. */
const CLIPS: Record<string, string[]> = {
  General: [
    "Idle_A",
    "Idle_B",
    "Interact",
    "Use_Item",
    "Hit_A",
    "PickUp",
    "Throw",
    "Spawn_Ground",
    "Death_A",
  ],
  MovementBasic: ["Walking_A", "Running_A"],
  Simulation: [
    "Cheering",
    "Waving",
    "Sit_Chair_Down",
    "Sit_Chair_Idle",
    "Sit_Chair_StandUp",
    "Sit_Floor_Idle",
    "Lie_Down",
    "Lie_Idle",
    "Lie_StandUp",
  ],
  Tools: ["Hammering", "Lockpicking", "Working_A", "Working_B", "Holding_A", "Sawing"],
  CombatRanged: [
    "Ranged_Magic_Spellcasting",
    "Ranged_Magic_Raise",
    "Ranged_Magic_Summon",
    "Ranged_Bow_Aiming_Idle",
  ],
}

/** Pack folder → pieces taken into kit.glb (by file name, without extension). */
const KIT: Record<string, string[]> = {
  KayKit_Dungeon_Pack_1: [
    "floor_tile_large",
    "floor_wood_large",
    "wall",
    "wall_doorway",
    "wall_window_open",
    "wall_archedwindow_open",
    "wall_corner",
    "wall_shelves",
    "wall_half",
    "pillar",
    "pillar_decorated",
    "torch_mounted",
    "banner_patternA_blue",
    "banner_shield_blue",
    "banner_thin_yellow",
    "barrel_large",
    "barrel_small_stack",
    "keg_decorated",
    "table_long",
    "table_long_tablecloth_decorated_A",
    "table_medium",
    "table_small_decorated_A",
    "chair",
    "stool",
    "bed_frame",
    "bed_decorated",
    "shelf_large",
    "shelves",
    "candle_lit",
    "candle_triple",
    "chest_gold",
    "crates_stacked",
    "box_stacked",
    "plate_food_A",
    "coin_stack_medium",
  ],
  KayKit_Furniture_Bits: [
    "shelf_B_large_decorated",
    "book_set",
    "armchair",
    "rug_rectangle_stripes_A",
    "rug_oval_A",
    "lamp_standing",
    "cabinet_medium_decorated",
    "table_medium_long",
    "couch_pillows",
    "pictureframe_large_A",
  ],
  KayKit_RPGToolsBits: [
    "anvil",
    "grindstone",
    "blueprint",
    "blueprint_stacked",
    "drafting_compass",
    "map",
    "map_rolled",
    "compass_base",
    "magnifying_glass",
    "journal_open",
    "lantern",
    "hammer",
    "tongs",
    "bucket_metal",
  ],
  KayKit_FantasyWeaponsBits: ["staff_A", "sword_A", "shield_A", "hammer_A"],
  KayKit_Adventurers_2: [
    "staff",
    "wand",
    "spellbook_open",
    "spellbook_closed",
    "dagger",
    "quiver",
    "crossbow_1handed",
    "shield_badge_color",
    "axe_2handed",
    "sword_1handed",
    "mug_full",
  ],
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "meshopt.encoder": MeshoptEncoder,
})

/** Every file under `dir`, recursively. */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

const files = walk(SRC)

/** The glTF source for `name` in the pack whose folder starts with `pack` (skips FBX/OBJ folders). */
function find(pack: string, name: string): string | undefined {
  const candidates = files.filter(
    (path) =>
      path.includes(`/${pack}`) &&
      !/\/(fbx|obj)\//i.test(path) &&
      [`${name}.gltf`, `${name}.glb`, `${name}.gltf.glb`].includes(basename(path)),
  )
  return candidates.find((path) => path.endsWith(".gltf")) ?? candidates[0]
}

async function characters(): Promise<void> {
  await mkdir(join(OUT, "characters"), { recursive: true })
  for (const name of CHARACTERS) {
    const path = find("KayKit_Adventurers_2", name)
    if (!path) throw new Error(`character ${name} not found`)
    const doc = await io.read(path)
    await doc.transform(dedup(), prune())
    const out = join(OUT, "characters", `${name.toLowerCase().replace("_", "-")}.glb`)
    await io.write(out, doc)
    console.log(`character ${name} → ${kb(out)}`)
  }
}

async function animations(): Promise<void> {
  const target = new Document()
  for (const [file, keep] of Object.entries(CLIPS)) {
    const path = find("KayKit_Character_Animations", `Rig_Medium_${file}`)
    if (!path) throw new Error(`animation file ${file} not found`)
    const doc = await io.read(path)
    const root = doc.getRoot()
    const names = new Set(root.listAnimations().map((a) => a.getName()))
    for (const clip of keep) if (!names.has(clip)) console.warn(`  ! clip ${clip} missing from ${file}`)
    for (const animation of root.listAnimations())
      if (!keep.includes(animation.getName())) animation.dispose()
    for (const node of root.listNodes()) node.setMesh(null).setSkin(null)
    await doc.transform(prune())
    mergeDocuments(target, doc)
  }
  // Each source file brought its own copy of the rig. Point every clip at the first copy (by bone
  // name), then drop the rest: three.js renames duplicate node names on load (hips → hips_1), so
  // clips bound to a copy would silently animate nothing.
  const root = target.getRoot()
  const [keep, ...extra] = root.listScenes()
  if (!keep) throw new Error("no animation scenes merged")
  const bones = new Map<string, GNode>()
  keep.traverse((node) => {
    bones.set(node.getName(), node)
  })
  for (const animation of root.listAnimations()) {
    for (const channel of animation.listChannels()) {
      const node = channel.getTargetNode()
      const bone = node && bones.get(node.getName())
      if (!bone) throw new Error(`clip ${animation.getName()}: no bone ${node?.getName()}`)
      channel.setTargetNode(bone)
    }
  }
  const doomed: GNode[] = []
  for (const scene of extra) scene.traverse((node) => doomed.push(node))
  for (const node of doomed) node.dispose()
  for (const scene of extra) scene.dispose()
  root.setDefaultScene(keep)

  await target.transform(
    unpartition(),
    resample(),
    dedup(),
    prune({ keepLeaves: true }),
    meshopt({ encoder: MeshoptEncoder, level: "medium" }),
  )
  const out = join(OUT, "anims.glb")
  await io.write(out, target)
  console.log(`anims: ${target.getRoot().listAnimations().length} clips → ${kb(out)}`)
}

async function kit(): Promise<void> {
  const target = new Document()
  const scene = target.createScene("kit")
  const bounds: Record<string, { size: number[]; min: number[]; max: number[] }> = {}

  for (const [pack, pieces] of Object.entries(KIT)) {
    for (const piece of pieces) {
      const path = find(pack, piece)
      if (!path) {
        console.warn(`  ! ${pack}/${piece} not found — skipped`)
        continue
      }
      const doc = await io.read(path)
      const sourceScene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]
      if (!sourceScene) continue
      const map = mergeDocuments(target, doc)
      const merged = map.get(sourceScene) as ReturnType<typeof target.createScene>
      const group = target.createNode(piece)
      for (const child of merged.listChildren()) group.addChild(child as GNode)
      merged.dispose()
      scene.addChild(group)
      const box = getBounds(group)
      bounds[piece] = {
        min: box.min.map(round),
        max: box.max.map(round),
        size: box.max.map((v, i) => round(v - (box.min[i] ?? 0))),
      }
    }
  }
  target.getRoot().setDefaultScene(scene)
  await target.transform(
    unpartition(),
    dedup(),
    prune({ keepLeaves: true }),
    meshopt({ encoder: MeshoptEncoder, level: "medium" }),
  )
  const out = join(OUT, "kit.glb")
  await io.write(out, target)
  await writeFile(join(ROOT, "packages/hall/src/world/kit.json"), `${JSON.stringify(bounds, null, 2)}\n`)
  console.log(`kit: ${Object.keys(bounds).length} pieces → ${kb(out)}`)
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

function kb(path: string): string {
  return `${(statSync(path).size / 1024).toFixed(0)} KB`
}

await MeshoptEncoder.ready
await characters()
await animations()
await kit()
