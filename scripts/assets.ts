/**
 * Asset pipeline (ADR 0004): KayKit packs in assets/src → web-ready .glb in packages/hall/public/assets.
 *
 *   bun scripts/assets.ts               (everything)
 *   bun scripts/assets.ts forest lands  (only those outputs)
 *
 * - characters/<name>.glb — one per character model, pruned.
 * - anims.glb             — only the clips the hall plays, from Rig_Medium, meshes stripped. Every
 *                           character shares the rig, so one file animates everyone.
 * - kit.glb               — every environment piece and prop as a named top-level node, one shared
 *                           palette texture per pack, meshopt-compressed.
 * - packages/hall/src/world/kit.json — each kit piece's bounding box, for layout code.
 * - lands.glb / lands.json — the island's hex tiles and dressing (ADR 0006), the same way.
 * - forest.glb / forest.json — character-scale trees, bushes, rocks and grass from the Forest
 *                           Nature Pack (one palette, one material), placed by world/wilds.ts.
 *
 * Unzip the packs first (assets/raw/*.zip → assets/src/<zip name>/). Both folders are git-ignored;
 * only the outputs are committed. All packs are CC0 (Kay Lousberg, kaylousberg.com).
 */
import { readdirSync, statSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { basename, join } from "node:path"
import { Document, type Node as GNode, getBounds, NodeIO } from "@gltf-transform/core"
import { ALL_EXTENSIONS } from "@gltf-transform/extensions"
import {
  dedup,
  mergeDocuments,
  meshopt,
  prune,
  resample,
  simplify,
  unpartition,
  weld,
} from "@gltf-transform/functions"
import { MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer"

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
  Tools: [
    "Hammering",
    "Lockpicking",
    "Working_A",
    "Working_B",
    "Holding_A",
    "Sawing",
    "Chopping",
    "Pickaxing",
    "Digging",
    "Fishing_Idle",
    "Fishing_Cast",
    "Fishing_Reeling",
  ],
  CombatMelee: ["Melee_1H_Attack_Chop", "Melee_2H_Attack_Chop"],
  CombatRanged: [
    "Ranged_Magic_Spellcasting",
    "Ranged_Magic_Raise",
    "Ranged_Magic_Summon",
    "Ranged_Bow_Aiming_Idle",
  ],
}

/** Triangle share kept for pieces planted by the hundred (scene/nature/Fields.tsx). */
const SIMPLIFY: Record<string, number> = {
  food_ingredient_lettuce: 0.12,
  food_ingredient_carrot: 0.3,
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
    "torch",
    "hammer",
    "axe",
    "pickaxe",
    "tongs",
    "bucket_metal",
  ],
  KayKit_FantasyWeaponsBits: ["staff_A", "sword_A", "shield_A", "hammer_A"],
  // The farms' crops and harvest (scene/nature/Fields.tsx): whole vegetables planted in rows.
  KayKit_Restaurant_Bits: ["food_ingredient_lettuce", "food_ingredient_carrot"],
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

/** The island (ADR 0006): Medieval Hexagon pack pieces, drawn at 5× in the hall. */
const HEX = "KayKit_Medieval_Hexagon"
const LANDS: Record<string, string[]> = {
  [HEX]: [
    "hex_grass",
    "hex_grass_sloped_low",
    "hex_grass_sloped_high",
    "hex_water",
    "hex_coast_A",
    "hex_coast_B",
    "hex_coast_C",
    "hex_coast_D",
    "hex_river_A",
    "hex_river_A_curvy",
    "hex_river_B",
    "hex_river_C",
    "hex_river_D",
    "hex_river_E",
    "hex_river_F",
    "hex_river_G",
    "hex_river_H",
    "hex_river_I",
    "hex_river_J",
    "hex_river_K",
    "hex_river_L",
    "hex_river_crossing_A",
    "hex_river_crossing_B",
    "hex_road_A",
    "hex_road_B",
    "hex_road_C",
    "hex_road_D",
    "hex_road_E",
    "hex_road_F",
    "hex_road_G",
    "hex_road_H",
    "hex_road_I",
    "hex_road_J",
    "hex_road_K",
    "hex_road_L",
    "hex_road_M",
    "trees_A_large",
    "trees_A_medium",
    "trees_A_small",
    "trees_B_large",
    "trees_B_medium",
    "trees_B_small",
    "trees_A_cut",
    "trees_B_cut",
    "tree_single_A",
    "tree_single_B",
    "tree_single_A_cut",
    "tree_single_B_cut",
    "hills_A",
    "hills_A_trees",
    "hills_B",
    "hills_B_trees",
    "hills_C",
    "hills_C_trees",
    "hill_single_A",
    "hill_single_B",
    "hill_single_C",
    "mountain_A",
    "mountain_A_grass",
    "mountain_A_grass_trees",
    "mountain_B",
    "mountain_B_grass",
    "mountain_B_grass_trees",
    "mountain_C",
    "mountain_C_grass",
    "mountain_C_grass_trees",
    "rock_single_A",
    "rock_single_B",
    "rock_single_C",
    "rock_single_D",
    "rock_single_E",
    "cloud_big",
    "cloud_small",
    "waterlily_A",
    "waterlily_B",
    "waterplant_A",
    "waterplant_B",
    "waterplant_C",
    "building_lumbermill_blue",
    "building_mine_blue",
    "building_watermill_blue",
    "building_tower_A_blue",
    "building_archeryrange_blue",
    "building_home_A_blue",
    "building_home_B_blue",
    "building_home_A_red",
    "building_home_B_red",
    "building_home_A_yellow",
    "building_home_B_yellow",
    "building_home_A_green",
    "building_home_B_green",
    "building_windmill_blue",
    "building_well_blue",
    "building_market_blue",
    "building_market_red",
    "building_tavern_blue",
    "building_church_blue",
    "building_blacksmith_blue",
    "building_barracks_blue",
    "building_grain",
    "building_dirt",
    "building_scaffolding",
    "building_stage_A",
    "building_stage_B",
    "building_stage_C",
    "building_bridge_A",
    "building_bridge_B",
    "fence_wood_straight",
    "fence_wood_straight_gate",
    "fence_stone_straight",
    "target",
    "tent",
    "weaponrack",
    "resource_lumber",
    "resource_stone",
    "crate_A_big",
    "crate_A_small",
    "crate_B_big",
    "crate_long_A",
    "crate_open",
    "wheelbarrow",
    "pallet",
    "flag_blue",
    "flag_red",
    "flag_yellow",
    "sack",
    "barrel",
    "bucket_water",
    "bucket_arrows",
    "ladder",
  ],
  // The docks: plank floor from the dungeon pack, rope from the tools pack.
  KayKit_Dungeon_Pack_1: ["floor_wood_large"],
  KayKit_RPGToolsBits: ["rope_bundle_A"],
}

/**
 * The wilds (world/wilds.ts): a curated slice of the Forest Nature Pack, drawn at 1× so it stands
 * at character scale beside the 5× hex canopy. Picked for variety at a low triangle count: every
 * piece shares the pack's one palette texture (`forest_texture.png`, gradient swatches like the
 * hex pack's), so the hall draws them all with one material. Node names drop the `_Color1` suffix.
 */
const FOREST: Record<string, string[]> = {
  KayKit_Forest_Nature_Pack: [
    "Tree_1_A_Color1",
    "Tree_2_B_Color1",
    "Tree_3_A_Color1",
    "Tree_4_A_Color1",
    "Tree_4_B_Color1",
    "Tree_Bare_2_A_Color1",
    "Bush_1_B_Color1",
    "Bush_1_C_Color1",
    "Bush_1_E_Color1",
    "Bush_2_B_Color1",
    "Bush_3_A_Color1",
    "Bush_4_D_Color1",
    "Rock_1_A_Color1",
    "Rock_1_D_Color1",
    "Rock_2_B_Color1",
    "Rock_2_C_Color1",
    "Rock_3_E_Color1",
    "Grass_1_B_Color1",
    "Grass_2_B_Color1",
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
    mergeSkinned(doc, (mesh) => (/Cape|Hat|Hood/i.test(mesh) ? `${name}_Tinted` : `${name}_Body`))
    await doc.transform(dedup(), prune())
    const out = join(OUT, "characters", `${name.toLowerCase().replace("_", "-")}.glb`)
    await io.write(out, doc)
    console.log(`character ${name} → ${kb(out)}`)
  }
}

/**
 * KayKit characters are 8–9 skinned meshes (arms, legs, body, cape…) — 8–9 draw calls each, twice
 * with shadows. gltf-transform's join() skips skinned meshes, but skinned vertices live in bind
 * space (glTF ignores a skinned mesh node's transform), so parts that share a skin and material
 * can be concatenated as they are. `group` names the merged mesh each part goes into: the hall
 * keeps cape and hat apart so it can tint them per role (2 draw calls per character).
 */
function mergeSkinned(doc: Document, group: (meshName: string) => string): void {
  const root = doc.getRoot()
  const buffer = root.listBuffers()[0] ?? doc.createBuffer()
  const nodes = root.listNodes().filter((node) => node.getMesh() && node.getSkin())
  const groups = new Map<string, GNode[]>()
  for (const node of nodes) {
    const key = group(node.getMesh()?.getName() ?? node.getName())
    groups.set(key, [...(groups.get(key) ?? []), node])
  }
  for (const [name, members] of groups) {
    const first = members[0]
    const parent = first?.getParentNode()
    const skin = first?.getSkin()
    const primitives = members.flatMap((node) => node.getMesh()?.listPrimitives() ?? [])
    const material = primitives[0]?.getMaterial()
    if (!first || !skin || !material || primitives.some((p) => p.getMaterial() !== material)) continue

    const semantics = primitives[0]?.listSemantics() ?? []
    const merged = doc.createPrimitive().setMaterial(material)
    for (const semantic of semantics) {
      const parts = primitives.map((p) => p.getAttribute(semantic))
      const template = parts[0]
      if (!template || parts.some((a) => !a)) throw new Error(`${name}: ${semantic} missing on a part`)
      const size = template.getElementSize()
      const total = parts.reduce((sum, a) => sum + (a?.getCount() ?? 0), 0)
      const ArrayType = semantic.startsWith("JOINTS") ? Uint16Array : Float32Array
      const out = new ArrayType(total * size)
      let at = 0
      for (const part of parts) {
        if (!part) continue
        const element: number[] = []
        for (let i = 0; i < part.getCount(); i++) {
          part.getElement(i, element)
          out.set(element, at)
          at += size
        }
      }
      const accessor = doc
        .createAccessor()
        .setType(template.getType())
        .setArray(out)
        .setBuffer(buffer)
        .setNormalized(
          semantic.startsWith("WEIGHTS") ? false : template.getNormalized() && ArrayType !== Float32Array,
        )
      merged.setAttribute(semantic, accessor)
    }
    const indices: number[] = []
    let offset = 0
    for (const p of primitives) {
      const index = p.getIndices()
      const count = p.getAttribute("POSITION")?.getCount() ?? 0
      if (index) for (let i = 0; i < index.getCount(); i++) indices.push(index.getScalar(i) + offset)
      else for (let i = 0; i < count; i++) indices.push(i + offset)
      offset += count
    }
    merged.setIndices(
      doc.createAccessor().setType("SCALAR").setArray(new Uint32Array(indices)).setBuffer(buffer),
    )

    const node = doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(merged)).setSkin(skin)
    parent?.addChild(node)
    for (const member of members) {
      member.getMesh()?.dispose()
      member.dispose()
    }
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

async function kit(name: string, sources: Record<string, string[]>): Promise<void> {
  const target = new Document()
  const scene = target.createScene("kit")
  const bounds: Record<string, { size: number[]; min: number[]; max: number[] }> = {}

  for (const [pack, pieces] of Object.entries(sources)) {
    for (const piece of pieces) {
      const path = find(pack, piece)
      if (!path) {
        console.warn(`  ! ${pack}/${piece} not found — skipped`)
        continue
      }
      const doc = await io.read(path)
      // Pieces drawn by the hundred, small on screen, get fewer triangles (the farms' crops).
      const ratio = SIMPLIFY[piece]
      if (ratio) await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.08 }))
      const sourceScene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]
      if (!sourceScene) continue
      const map = mergeDocuments(target, doc)
      const merged = map.get(sourceScene) as ReturnType<typeof target.createScene>
      const named = piece.replace(/_Color1$/, "")
      const group = target.createNode(named)
      for (const child of merged.listChildren()) group.addChild(child as GNode)
      merged.dispose()
      scene.addChild(group)
      const box = getBounds(group)
      bounds[named] = {
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
  const out = join(OUT, `${name}.glb`)
  await io.write(out, target)
  const json = join(ROOT, `packages/hall/src/world/${name}.json`)
  await writeFile(json, `${JSON.stringify(bounds, null, 2)}\n`)
  // In the repo's own format, so `biome check .` stays clean after a regeneration.
  const format = Bun.spawnSync([process.execPath, "x", "biome", "format", "--write", json], { cwd: ROOT })
  if (format.exitCode !== 0) throw new Error(`biome could not format ${json}: ${format.stderr.toString()}`)
  console.log(`${name}: ${Object.keys(bounds).length} pieces → ${kb(out)}`)
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

function kb(path: string): string {
  return `${(statSync(path).size / 1024).toFixed(0)} KB`
}

const STEPS: Record<string, () => Promise<void>> = {
  characters,
  anims: animations,
  kit: () => kit("kit", KIT),
  lands: () => kit("lands", LANDS),
  forest: () => kit("forest", FOREST),
}
const wanted = process.argv.slice(2)
for (const name of wanted) if (!STEPS[name]) throw new Error(`unknown output ${name}: ${Object.keys(STEPS)}`)

await MeshoptEncoder.ready
await MeshoptSimplifier.ready
for (const [name, step] of Object.entries(STEPS))
  if (wanted.length === 0 || wanted.includes(name)) await step()
