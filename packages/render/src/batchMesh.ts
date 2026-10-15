/**
 * A BatchedMesh that draws each instance at a level of detail (lod.ts). three r186's BatchedMesh has
 * no LOD of its own: before every pass it walks the instances, frustum-culls them and lists each one's
 * geometry range for the multi-draw. This replaces that walk with one that lists a tier's range
 * instead (the tiers are extra geometries in the same buffers, never assigned to an instance), and
 * swaps a cluster's parts for its shell when it is far. No switch pops: an instance between two levels
 * is listed twice, once per level, each with a fade code that keeps its share of a screen-space dither
 * (lodFade.ts), and a small piece leaving is listed shrunk. The walk runs anyway, so LOD costs a
 * distance and a few compares per visible instance. World bounding spheres are cached per instance,
 * not rebuilt from the matrix texture every pass.
 *
 * The same walk reveals the batch in an order (reveal.ts, a history replay): an instance past the
 * reveal's count is left out of every pass, and one on the frontier is listed with a fade code (grown
 * from its origin, or dithered in), so a scrub never rebuilds the batch and nothing snaps.
 *
 * The walk's cull goes through a grid: the instances binned by their spheres into cells over the
 * batch's own ground, each cell with the box that holds every member's sphere. A pass tests the cells'
 * boxes against its frustum and only the members of the cells it touches get the sphere test (none
 * where the cell is wholly inside and the pass does not size), in instance order, so the list is the
 * same list: a cell outside the frustum holds no sphere inside it. A shadow pass whose box holds the
 * whole batch (the town cascade, from any sun) keeps its list in buffers of its own until the
 * instances or the reveal change: the sun turning re-renders it without a walk or an upload.
 */
import {
  BatchedMesh,
  type BufferGeometry,
  type Camera,
  DataTexture,
  Frustum,
  type GeometryGroup,
  type Material,
  Matrix4,
  type Object3D,
  type PerspectiveCamera,
  RedIntegerFormat,
  type Scene,
  Sphere,
  UnsignedIntType,
  Vector2,
  Vector3,
  type WebGLRenderer,
} from "three"
import { DETAIL_FADE_PX, DETAIL_RADIUS, fadeWeight, type LodCounts, SHADOW_TIER, SWAP_PX } from "./lod.ts"
import { dithers, drawsNothing, FADE_STEPS, inCode, outCode, packDraw, shrinkCode } from "./lodFade.ts"

/** The BatchedMesh internals the walk fills (three keeps them private). */
interface Internals {
  _instanceInfo: { visible: boolean; active: boolean; geometryIndex: number }[]
  _geometryInfo: { start: number; count: number }[]
  _multiDrawStarts: Int32Array
  _multiDrawCounts: Int32Array
  _multiDrawCount: number
  _multiDrawBytesPerElement: number
  _visibilityChanged: boolean
  _indirectTexture: { image: { data: Uint32Array; width: number }; needsUpdate: boolean }
}

/** A cluster: its shell instance and its parts' instances. */
interface Cluster {
  shell: number
  parts: number[]
}

/** No cluster. */
const NONE = -1
/** A side pass's crossfade list: there is none (side passes carry no fade codes). */
const NO_FADE = {
  starts: new Int32Array(0),
  counts: new Int32Array(0),
  count: 0,
  ids: null as DataTexture | null,
}
const NO_IDS = new Uint32Array(0)

/** A multi-draw list: its buffers and how many draws it holds. */
interface List {
  starts: Int32Array
  counts: Int32Array
  count: number
  ids: DataTexture | null
}

/**
 * The cull grid (see the top): cells over the mesh's own x and z, each cell's members (CSR: cell c's
 * are `items[start[c]..start[c + 1])`) and the box that holds their spheres, and the union of them all.
 */
interface Grid {
  nx: number
  nz: number
  size: number
  x0: number
  z0: number
  start: Int32Array
  items: Int32Array
  /** Cell c's box: min x, y, z then max x, y, z at `c * 6`. */
  box: Float64Array
  /** Every cell's box together: the whole batch. */
  min: [number, number, number]
  max: [number, number, number]
}

/** Below this many instances the grid is not worth its build: every instance gets the sphere test. */
const GRID_MIN = 512
/** Cells a side (the longer of x and z): ~30 a side bins 19 k pieces at ~20 per cell on a 500 m island. */
const GRID_SIDE = 32
/** Instances moved since the grid was built are tested whatever their cell says; past this many it is rebuilt. */
const LOOSE_MAX = 64
/** The cull's mark on an instance: not in a cell the frustum touches, in one it touches, in one it holds whole. */
const OUT = 0
const TOUCHED = 1
const HELD = 2

/** What a shadow pass's whole-batch list was made from: the same again means the same list. */
interface ListKey {
  reveal: Int32Array | null
  count: number
  span: number
  bytes: number
  capacity: number
  width: number
}

/**
 * Where `box` (min xyz, max xyz at `at` in `boxes`) stands to the frustum: OUT past a plane, HELD
 * inside every plane, TOUCHED otherwise. A box inside a plane holds no point outside it, so the
 * members of a HELD cell all pass the sphere test; an OUT cell holds nothing the frustum meets.
 */
function classify(planes: Frustum["planes"], boxes: Float64Array, at: number): number {
  let held = HELD
  for (let p = 0; p < 6; p++) {
    const { normal, constant } = planes[p] as Frustum["planes"][number]
    const nx = normal.x
    const ny = normal.y
    const nz = normal.z
    const far =
      nx * (boxes[at + (nx > 0 ? 3 : 0)] as number) +
      ny * (boxes[at + (ny > 0 ? 4 : 1)] as number) +
      nz * (boxes[at + (nz > 0 ? 5 : 2)] as number) +
      constant
    if (far < 0) return OUT
    const near =
      nx * (boxes[at + (nx > 0 ? 0 : 3)] as number) +
      ny * (boxes[at + (ny > 0 ? 1 : 4)] as number) +
      nz * (boxes[at + (nz > 0 ? 2 : 5)] as number) +
      constant
    if (near < 0) held = TOUCHED
  }
  return held
}

const frustum = new Frustum()
/** The whole batch's box, for the shadow pass's test (min xyz, max xyz). */
const wholeBox = new Float64Array(6)
const toLocal = new Matrix4()
const viewer = new Vector3()
const sphere = new Sphere()
const matrix = new Matrix4()
const inverse = new Matrix4()
const buffer = new Vector2()

/** False draws every instance at full detail in the main view (no tiers, no shells, no culled detail): a reference for comparisons (`?lod=0`). */
let lodOn = true
export function setLod(on: boolean): void {
  lodOn = on
}

export class LodBatchedMesh extends BatchedMesh {
  /** Geometry id → its tiers' geometry ids, finest first (a geometry without tiers is its own only). */
  private readonly tierIds: number[][] = []
  /**
   * What the last main pass's list was made from: the camera's matrices, the buffer's size and DPR,
   * this mesh's matrix, the LOD switch and the reveal's state. A main pass whose key is the same and
   * whose instances have not changed (`dirty`) keeps the list it has: on a still camera the static
   * batch's walk (a sphere test and a tier pick per instance, 18 k of them, and the indirect texture's
   * upload) is skipped whole. A shadow pass writes the same multi-draw buffers, so it leaves them dirty.
   */
  private readonly key = new Float64Array(16 + 16 + 16 + 8)
  private keyed = false
  private dirty = true
  /** Geometry id → how far it strays from what it stands in for, metres in its own space (0: exact). */
  private readonly errors: number[] = []
  /**
   * Multiplies every error before it is judged (the quality ladder's lever): 1 swaps where the
   * difference is under a pixel, 2 swaps at half the distance (the coarser tiers from closer in).
   */
  lodBias = 1
  /** Per instance: world bounding sphere (x, y, z, r), its matrix's largest scale, stale flag, cluster. */
  private readonly spheres: number[] = []
  private readonly scales: number[] = []
  private readonly stale: boolean[] = []
  private readonly clusterOf: number[] = []
  private readonly clusters: Cluster[] = []
  /** Per cluster: the shell's crossfade weight in the last main pass (0: parts, 1: shell). */
  private readonly shellWeight: number[] = []
  private counts: LodCounts = { tiers: [0, 0, 0], near: 0, shells: 0 }
  /**
   * The material the crossfading draws use (`batchMaterial(true)`), drawn as a second multi-draw
   * right after the main one; null lists them with the rest (they then need a dithering material).
   */
  fadeMaterial: Material | null = null
  /**
   * The reveal (reveal.ts): per instance, its place in the reveal order (-1: always drawn). Null draws
   * everything. An instance whose place is at or past `revealCount` is not drawn; one within
   * `revealSpan` places under it comes in by `revealLook`: grown from its origin, or dithered in.
   */
  reveal: Int32Array | null = null
  revealCount = Number.POSITIVE_INFINITY
  revealSpan = 1
  revealLook: "grow" | "dither" = "grow"
  /** The second multi-draw's list: the draws mid-crossfade. */
  private fade: List = {
    starts: new Int32Array(0),
    counts: new Int32Array(0),
    count: 0,
    ids: null as DataTexture | null,
  }
  /**
   * The list of every pass that is not the main view's (a shadow cascade, an orthographic still): its
   * own buffers, swapped in for the walk and the draw and out again after. Written into the main
   * pass's buffers, as three's BatchedMesh does, a cascade's re-render left the main list to be walked
   * again on the next frame (18 k instances, the indirect texture's upload) with the camera still: the
   * sun turning a quarter degree cost that walk on top of its own.
   */
  private side: List = {
    starts: new Int32Array(0),
    counts: new Int32Array(0),
    count: 0,
    ids: null,
  }
  /**
   * The list of a shadow pass whose box holds the whole batch (the town cascade): every active
   * instance at the shadow tier, whatever the sun's direction. Kept, with what it was made from
   * (`allKey`; null: none), until the instances or the reveal change: the next such pass swaps it in
   * without a walk and without the indirect texture's upload.
   */
  private all: List = {
    starts: new Int32Array(0),
    counts: new Int32Array(0),
    count: 0,
    ids: null,
  }
  private allKey: ListKey | null = null
  /** The main list's buffers while a side list stands in for them; null when the main list is in place. */
  private kept: {
    starts: Int32Array
    counts: Int32Array
    count: number
    ids: Internals["_indirectTexture"]
    /** The list standing in, to take the draw count back. */
    list: List
  } | null = null
  /** The cull grid (see the top), its marks per instance, which cell each instance is in (-1: none), the loose ones. */
  private grid: Grid | null = null
  private gridStale = true
  private marks = new Uint8Array(0)
  private readonly cellOf: number[] = []
  private readonly loose: number[] = []
  /** How many walks have run (probes and tests: a kept list is no walk). */
  walks = 0

  /** What the last main pass drew. */
  get lod(): LodCounts {
    return this.counts
  }

  /** The instances or what they draw changed: the main list is to be walked again, the whole-batch list is gone. */
  private touch(): void {
    this.dirty = true
    this.allKey = null
  }

  /** Instance `id`'s matrix changed: out of its cell (tested on its own), the grid rebuilt once many have. */
  private moved(id: number): void {
    this.stale[id] = true
    if (this.gridStale) return
    const cell = this.cellOf[id]
    if (cell === undefined || cell < 0) {
      if (cell === undefined) this.gridStale = true
      return
    }
    this.cellOf[id] = -1
    this.loose.push(id)
    if (this.loose.length > LOOSE_MAX) this.gridStale = true
  }

  /** Gives `geometryId` coarser `tiers` (geometry ids, finer first) to draw instead when small. */
  setTiers(geometryId: number, tiers: readonly number[]): void {
    this.tierIds[geometryId] = [geometryId, ...tiers]
    this.touch()
  }

  /** How far `geometryId` (a tier, a shell) strays from the full detail it stands in for, metres. */
  setLodError(geometryId: number, metres: number): void {
    this.errors[geometryId] = metres
    this.touch()
  }

  override addGeometry(
    geometry: BufferGeometry,
    reservedVertexCount?: number,
    reservedIndexCount?: number,
  ): number {
    const id = super.addGeometry(geometry, reservedVertexCount, reservedIndexCount)
    // its own only, until setTiers: the walk then never makes a list per instance
    this.tierIds[id] ??= [id]
    this.touch()
    return id
  }

  override setVisibleAt(instanceId: number, visible: boolean): this {
    super.setVisibleAt(instanceId, visible)
    this.touch()
    return this
  }

  override deleteInstance(instanceId: number): this {
    super.deleteInstance(instanceId)
    this.touch()
    return this
  }

  override setInstanceCount(maxInstanceCount: number): void {
    super.setInstanceCount(maxInstanceCount)
    this.touch()
  }

  override setGeometrySize(maxVertexCount: number, maxIndexCount: number): void {
    super.setGeometrySize(maxVertexCount, maxIndexCount)
    this.touch()
  }

  /** Whether the main pass's list from `camera` into the renderer's buffer is the one already listed. */
  private sameAsListed(renderer: WebGLRenderer, camera: Camera): boolean {
    const k = this.key
    const a = camera.matrixWorld.elements
    const b = camera.projectionMatrix.elements
    const c = this.matrixWorld.elements
    renderer.getDrawingBufferSize(buffer)
    const rest = [
      buffer.x,
      buffer.y,
      renderer.getPixelRatio(),
      lodOn ? 1 : 0,
      this.reveal === null ? 0 : 1,
      this.revealCount,
      this.revealSpan,
      this.revealLook === "grow" ? 1 : 0,
    ]
    let same = this.keyed && !this.dirty
    for (let i = 0; i < 16; i++) {
      if (k[i] !== a[i]) same = false
      k[i] = a[i] as number
      if (k[16 + i] !== b[i]) same = false
      k[16 + i] = b[i] as number
      if (k[32 + i] !== c[i]) same = false
      k[32 + i] = c[i] as number
    }
    for (let i = 0; i < rest.length; i++) {
      if (k[48 + i] !== rest[i]) same = false
      k[48 + i] = rest[i] as number
    }
    this.keyed = true
    return same
  }

  /**
   * Makes `shell` the far stand-in of `parts` (instance ids): one of the two is drawn, or both
   * crossfading. Clusters are fixed once made.
   */
  addCluster(shell: number, parts: readonly number[]): void {
    const c = this.clusters.length
    this.clusters.push({ shell, parts: [...parts] })
    this.shellWeight.push(1)
    this.clusterOf[shell] = c
    for (const id of parts) this.clusterOf[id] = c
    this.touch()
  }

  override addInstance(geometryId: number): number {
    const id = super.addInstance(geometryId)
    this.stale[id] = true
    this.clusterOf[id] = NONE
    // a new instance (or a deleted one's slot again) has no cell yet
    this.cellOf[id] = -1
    this.gridStale = true
    this.touch()
    return id
  }

  override setMatrixAt(instanceId: number, m: Matrix4): this {
    super.setMatrixAt(instanceId, m)
    this.moved(instanceId)
    this.touch()
    return this
  }

  override setGeometryIdAt(instanceId: number, geometryId: number): this {
    super.setGeometryIdAt(instanceId, geometryId)
    this.moved(instanceId)
    this.touch()
    return this
  }

  /** Instance `id`'s world bounding sphere into `sphere`, from the cache. */
  private sphereOf(id: number, geometryId: number): Sphere {
    const s = this.spheres
    if (this.stale[id]) {
      this.getBoundingSphereAt(geometryId, sphere)
      this.getMatrixAt(id, matrix)
      sphere.applyMatrix4(matrix)
      s[id * 4] = sphere.center.x
      s[id * 4 + 1] = sphere.center.y
      s[id * 4 + 2] = sphere.center.z
      s[id * 4 + 3] = sphere.radius
      this.scales[id] = matrix.getMaxScaleOnAxis()
      this.stale[id] = false
    }
    sphere.center.set(s[id * 4] as number, s[id * 4 + 1] as number, s[id * 4 + 2] as number)
    sphere.radius = s[id * 4 + 3] as number
    return sphere
  }

  /** Sizes the crossfade list (or the side list) like the main one (they grow together). */
  private fadeList(size: number, side: number, list: List = this.fade): List {
    const f = list
    if (f.starts.length !== size) {
      f.starts = new Int32Array(size)
      f.counts = new Int32Array(size)
    }
    if (!f.ids || f.ids.image.width !== side) {
      f.ids?.dispose()
      f.ids = new DataTexture(new Uint32Array(side * side), side, side, RedIntegerFormat, UnsignedIntType)
    }
    return f
  }

  /** Puts `list`'s buffers in the main list's place (for a pass that is not the main view's). */
  private standIn(list: List): void {
    const self = this as unknown as Internals
    if (this.kept) return
    const side = this.fadeList(self._multiDrawStarts.length, self._indirectTexture.image.width, list)
    this.kept = {
      starts: self._multiDrawStarts,
      counts: self._multiDrawCounts,
      count: self._multiDrawCount,
      ids: self._indirectTexture,
      list,
    }
    self._multiDrawStarts = side.starts
    self._multiDrawCounts = side.counts
    self._multiDrawCount = side.count
    self._indirectTexture = side.ids as unknown as Internals["_indirectTexture"]
  }

  /** Puts the main list's buffers back after a side pass has drawn. */
  private standDown(): void {
    const self = this as unknown as Internals
    const kept = this.kept
    if (!kept) return
    kept.list.count = self._multiDrawCount
    self._multiDrawStarts = kept.starts
    self._multiDrawCounts = kept.counts
    self._multiDrawCount = kept.count
    self._indirectTexture = kept.ids
    this.kept = null
  }

  /**
   * Bins every active instance by its sphere's centre into the grid's cells (the spheres refreshed
   * where stale), each cell's box grown to hold its members' spheres. Once, after the batch is filled;
   * again only when instances are added or many have moved.
   */
  private buildGrid(): void {
    const self = this as unknown as Internals
    const info = self._instanceInfo
    const n = info.length
    this.loose.length = 0
    this.gridStale = false
    if (this.marks.length !== n) this.marks = new Uint8Array(n)
    if (n < GRID_MIN) {
      this.grid = null
      return
    }
    const s = this.spheres
    let minX = Number.POSITIVE_INFINITY
    let minZ = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxZ = Number.NEGATIVE_INFINITY
    let active = 0
    for (let i = 0; i < n; i++) {
      const instance = info[i] as Internals["_instanceInfo"][number]
      this.cellOf[i] = -1
      if (!instance.active) continue
      this.sphereOf(i, instance.geometryIndex)
      const x = s[i * 4] as number
      const z = s[i * 4 + 2] as number
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (z < minZ) minZ = z
      if (z > maxZ) maxZ = z
      active++
    }
    if (active === 0) {
      this.grid = null
      return
    }
    const size = Math.max(Math.max(maxX - minX, maxZ - minZ) / GRID_SIDE, 1e-3)
    const nx = Math.floor((maxX - minX) / size) + 1
    const nz = Math.floor((maxZ - minZ) / size) + 1
    const cells = nx * nz
    const start = new Int32Array(cells + 1)
    const items = new Int32Array(active)
    const box = new Float64Array(cells * 6)
    for (let c = 0; c < cells; c++) {
      box[c * 6] = box[c * 6 + 1] = box[c * 6 + 2] = Number.POSITIVE_INFINITY
      box[c * 6 + 3] = box[c * 6 + 4] = box[c * 6 + 5] = Number.NEGATIVE_INFINITY
    }
    const min: [number, number, number] = [
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
    ]
    const max: [number, number, number] = [
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]
    for (let i = 0; i < n; i++) {
      if (!(info[i] as Internals["_instanceInfo"][number]).active) continue
      const x = s[i * 4] as number
      const y = s[i * 4 + 1] as number
      const z = s[i * 4 + 2] as number
      const r = s[i * 4 + 3] as number
      const c =
        Math.min(nz - 1, Math.floor((z - minZ) / size)) * nx + Math.min(nx - 1, Math.floor((x - minX) / size))
      this.cellOf[i] = c
      start[c + 1] = (start[c + 1] as number) + 1
      const at = c * 6
      if (x - r < (box[at] as number)) box[at] = x - r
      if (y - r < (box[at + 1] as number)) box[at + 1] = y - r
      if (z - r < (box[at + 2] as number)) box[at + 2] = z - r
      if (x + r > (box[at + 3] as number)) box[at + 3] = x + r
      if (y + r > (box[at + 4] as number)) box[at + 4] = y + r
      if (z + r > (box[at + 5] as number)) box[at + 5] = z + r
    }
    for (let c = 0; c < cells; c++) {
      start[c + 1] = (start[c + 1] as number) + (start[c] as number)
      if (start[c + 1] === start[c]) continue
      const at = c * 6
      for (let k = 0; k < 3; k++) {
        if ((box[at + k] as number) < (min[k] as number)) min[k] = box[at + k] as number
        if ((box[at + 3 + k] as number) > (max[k] as number)) max[k] = box[at + 3 + k] as number
      }
    }
    // in instance order within a cell (the walk keeps the order anyway: it goes by the marks)
    const fill = start.slice(0, cells)
    for (let i = 0; i < n; i++) {
      const c = this.cellOf[i] as number
      if (c < 0) continue
      items[fill[c] as number] = i
      fill[c] = (fill[c] as number) + 1
    }
    this.grid = { nx, nz, size, x0: minX, z0: minZ, start, items, box, min, max }
  }

  /**
   * Whether `frustum` (in the mesh's own space) holds the whole batch: every cell's box inside it and
   * every loose instance's sphere met. False without a grid.
   */
  private holdsAll(): boolean {
    if (this.gridStale) this.buildGrid()
    const grid = this.grid
    if (!grid) return false
    const planes = frustum.planes
    for (let k = 0; k < 3; k++) {
      wholeBox[k] = grid.min[k] as number
      wholeBox[3 + k] = grid.max[k] as number
    }
    if (classify(planes, wholeBox, 0) !== HELD) return false
    const info = (this as unknown as Internals)._instanceInfo
    for (const id of this.loose) {
      const instance = info[id] as Internals["_instanceInfo"][number]
      if (instance.active && !frustum.intersectsSphere(this.sphereOf(id, instance.geometryIndex)))
        return false
    }
    return true
  }

  /**
   * Marks the instances `frustum` (in the mesh's own space) may meet: the members of the cells it
   * touches (HELD where it holds the cell whole), the loose ones always. Null when there is no grid:
   * every instance is then tested.
   */
  private cull(): Uint8Array | null {
    if (this.gridStale) this.buildGrid()
    const grid = this.grid
    if (!grid) return null
    const marks = this.marks
    marks.fill(OUT)
    const planes = frustum.planes
    const { start, items, box } = grid
    const cells = grid.nx * grid.nz
    for (let c = 0; c < cells; c++) {
      const from = start[c] as number
      const to = start[c + 1] as number
      if (from === to) continue
      const mark = classify(planes, box, c * 6)
      if (mark === OUT) continue
      for (let k = from; k < to; k++) marks[items[k] as number] = mark
    }
    for (const id of this.loose) marks[id] = TOUCHED
    return marks
  }

  /** The crossfading draws, after the main ones: the same buffers, the dithering material. */
  override onAfterRender(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: Camera,
    geometry: BufferGeometry,
    _material: Material,
    group: Parameters<BatchedMesh["onAfterRender"]>[5],
  ): void {
    // a side pass's draw (an orthographic still, or a shadow pass through onBeforeRender) is done: the
    // main list comes back, and there is no crossfade to draw (side passes carry no fade codes)
    if (this.kept) {
      this.standDown()
      return
    }
    const f = this.fade
    if (!this.fadeMaterial || f.count === 0 || !f.ids) return
    const self = this as unknown as Internals
    const main = {
      starts: self._multiDrawStarts,
      counts: self._multiDrawCounts,
      count: self._multiDrawCount,
      ids: self._indirectTexture,
    }
    self._multiDrawStarts = f.starts
    self._multiDrawCounts = f.counts
    self._multiDrawCount = f.count
    self._indirectTexture = f.ids as unknown as Internals["_indirectTexture"]
    try {
      renderer.renderBufferDirect(
        camera,
        scene,
        geometry,
        this.fadeMaterial,
        this,
        group as unknown as GeometryGroup,
      )
    } finally {
      self._multiDrawStarts = main.starts
      self._multiDrawCounts = main.counts
      self._multiDrawCount = main.count
      self._indirectTexture = main.ids
    }
  }

  override dispose(): this {
    this.standDown()
    this.fade.ids?.dispose()
    this.side.ids?.dispose()
    this.all.ids?.dispose()
    super.dispose()
    return this
  }

  override onAfterShadow(): void {
    this.standDown()
  }

  override onBeforeRender(
    renderer: WebGLRenderer,
    scene: Object3D | null,
    camera: Camera,
    geometry: BufferGeometry,
    material: Material,
  ): void {
    // Shadow passes come through onBeforeShadow with no scene.
    this.walk(renderer, camera, geometry, material, scene === null)
  }

  override onBeforeShadow(
    renderer: WebGLRenderer,
    _object: Object3D,
    _camera: Camera,
    shadowCamera: Camera,
    geometry: BufferGeometry,
    depthMaterial: Material,
  ): void {
    this.walk(renderer, shadowCamera, geometry, depthMaterial, true)
  }

  private walk(
    renderer: WebGLRenderer,
    camera: Camera,
    geometry: BufferGeometry,
    material: Material,
    shadow: boolean,
  ): void {
    const self = this as unknown as Internals
    const index = geometry.getIndex()
    let bytesPerElement = index === null ? 1 : index.array.BYTES_PER_ELEMENT
    // Wireframe draws lines: twice the elements, in a 16/32-bit index three makes (as three does).
    let multiplier = 1
    if ((material as Material & { wireframe?: boolean }).wireframe) {
      multiplier = 2
      bytesPerElement = geometry.getAttribute("position").count > 65535 ? 4 : 2
    }

    const perspective = (camera as PerspectiveCamera).isPerspectiveCamera === true
    const main = !shadow && perspective
    // the main pass's list is still the one in the buffers: nothing to walk, nothing to upload
    if (main && this.sameAsListed(renderer, camera)) return
    toLocal.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(this.matrixWorld)
    frustum.setFromProjectionMatrix(toLocal, camera.coordinateSystem, camera.reversedDepth)
    viewer.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(inverse.copy(this.matrixWorld).invert())
    // a shadow pass whose box holds the whole batch lists the whole-batch list, kept between passes
    let key: ListKey | null = null
    if (!main) {
      if (shadow && this.holdsAll()) {
        key = {
          reveal: this.reveal,
          count: this.revealCount,
          span: this.revealSpan,
          bytes: bytesPerElement * multiplier,
          capacity: self._multiDrawStarts.length,
          width: self._indirectTexture.image.width,
        }
        const had = this.allKey
        if (
          had &&
          had.reveal === key.reveal &&
          had.count === key.count &&
          had.span === key.span &&
          had.bytes === key.bytes &&
          had.capacity === key.capacity &&
          had.width === key.width
        ) {
          // the same list as the last such pass: in place as it stands, no walk, no upload
          this.standIn(this.all)
          self._multiDrawCount = this.all.count
          self._multiDrawBytesPerElement = bytesPerElement
          self._visibilityChanged = false
          return
        }
      }
      this.standIn(key ? this.all : this.side)
    }
    this.walks++
    // the cull's marks (null: no grid, every instance tested)
    const marks = this.cull()
    // Only the main view picks levels by size; any other camera is drawn coarse, whole.
    const sized = !shadow && perspective && lodOn
    const full = !shadow && perspective && !lodOn
    renderer.getDrawingBufferSize(buffer)
    // CSS pixels a metre covers at one metre away: every switch is judged in CSS px, whatever the DPR.
    const cssPerMetre =
      ((camera.projectionMatrix.elements[5] as number) * buffer.y) / (2 * renderer.getPixelRatio())
    /** CSS px per metre at instance `id`'s sphere (cached by `sphereOf`). */
    const scaleAt = (s: Sphere) => cssPerMetre / Math.max(s.center.distanceTo(viewer), 1e-3)

    const info = self._instanceInfo
    // Clusters first: each is its parts, its shell or a crossfade of the two, by its shell's error.
    let near = 0
    for (let c = 0; c < this.clusters.length; c++) {
      const { shell } = this.clusters[c] as Cluster
      const shellInfo = info[shell]
      if (!shellInfo?.active) continue
      if (sized) {
        const s = this.sphereOf(shell, shellInfo.geometryIndex)
        const error =
          (this.errors[shellInfo.geometryIndex] ?? 0) *
          (this.scales[shell] as number) *
          scaleAt(s) *
          this.lodBias
        this.shellWeight[c] = fadeWeight(error, SWAP_PX)
        if (inCode(this.shellWeight[c] as number) < FADE_STEPS) near++
      } else this.shellWeight[c] = full ? 0 : 1
    }

    const tiers = [0, 0, 0]
    let shells = 0
    const starts = self._multiDrawStarts
    const counts = self._multiDrawCounts
    const indirect = self._indirectTexture.image.data
    const capacity = Math.min(starts.length, indirect.length)
    const geometries = self._geometryInfo
    let drawn = 0
    // the crossfade list is the main pass's own: a side pass (no fade codes) leaves it as it stands
    const fade = main ? this.fadeList(starts.length, self._indirectTexture.image.width) : NO_FADE
    const fadeIds = fade.ids ? (fade.ids.image.data as Uint32Array) : NO_IDS
    fade.count = 0
    const apart = main && this.fadeMaterial !== null
    const emit = (id: number, geometryId: number, code: number) => {
      if (drawsNothing(code)) return
      const range = geometries[geometryId] as { start: number; count: number }
      if (apart && dithers(code)) {
        if (fade.count >= capacity) return
        fade.starts[fade.count] = range.start * bytesPerElement * multiplier
        fade.counts[fade.count] = range.count * multiplier
        fadeIds[fade.count] = packDraw(id, code)
        fade.count++
        return
      }
      if (drawn >= capacity) return
      starts[drawn] = range.start * bytesPerElement * multiplier
      counts[drawn] = range.count * multiplier
      indirect[drawn] = packDraw(id, code)
      drawn++
    }

    const reveal = this.reveal
    const grow = this.revealLook === "grow"
    for (let i = 0; i < info.length; i++) {
      const mark = marks === null ? TOUCHED : (marks[i] as number)
      if (mark === OUT) continue
      const instance = info[i] as Internals["_instanceInfo"][number]
      if (!instance.visible || !instance.active) continue
      // the reveal: left out past the frontier; on it, how far in (1: whole)
      let revealed = 1
      if (reveal !== null) {
        const place = reveal[i] as number
        if (place >= 0) {
          revealed = (this.revealCount - place) / this.revealSpan
          if (revealed <= 0) continue
          if (revealed > 1) revealed = 1
        }
      }
      // shadow and other coarse passes carry no code: a piece half in casts whole, under that not yet
      if (revealed < 1 && !sized) {
        if (revealed < 0.5) continue
        revealed = 1
      }
      const revealCode = revealed < 1 ? (grow ? shrinkCode(revealed) : inCode(revealed)) : 0
      const c = this.clusterOf[i] as number
      const isShell = c !== NONE && this.clusters[c]?.shell === i
      // the cluster's crossfade: the shell comes in as its parts go out
      let clusterCode = 0
      if (c !== NONE) {
        const q = inCode(this.shellWeight[c] as number)
        if (isShell ? q === 0 : q === FADE_STEPS) continue
        clusterCode = isShell ? (q === FADE_STEPS ? 0 : q) : outCode(this.shellWeight[c] as number)
      }
      const geometryId = instance.geometryIndex
      // a pass that sizes needs the sphere anyway; one that does not skips it where the cell is held whole
      if ((sized || mark !== HELD) && !frustum.intersectsSphere(this.sphereOf(i, geometryId))) continue

      const ids = this.tierIds[geometryId] as number[]
      if (isShell) {
        shells++
        emit(i, geometryId, revealCode !== 0 ? revealCode : clusterCode)
        continue
      }
      if (!sized) {
        const tier = full ? 0 : Math.min(shadow ? SHADOW_TIER : ids.length - 1, ids.length - 1)
        tiers[tier] = (tiers[tier] as number) + 1
        emit(i, ids[tier] as number, 0)
        continue
      }
      // `sphere` is this instance's (sphereOf above: a sizing pass always takes it)
      const perMetre = scaleAt(sphere)
      // the coarsest tier fully in, and the next on its way in with its weight (no allocation: per instance)
      let tier = 0
      let next = 0
      let w = 0
      const toPx = (this.scales[i] as number) * perMetre
      for (let k = 1; k < ids.length; k++) {
        // a tier that reuses the finer one's geometry is that one
        if (ids[k] === ids[k - 1]) break
        const wk = fadeWeight((this.errors[ids[k] as number] ?? 0) * toPx * this.lodBias, SWAP_PX)
        if (wk >= 1) {
          tier = k
          continue
        }
        if (wk > 0) {
          next = k
          w = wk
        }
        break
      }
      if (w === 0) next = tier
      // detail shrinks away as it falls through DETAIL_FADE_PX
      const shrink =
        sphere.radius < DETAIL_RADIUS ? 1 - fadeWeight(sphere.radius * perMetre, DETAIL_FADE_PX) : 1
      if (shrink <= 0) continue
      tiers[tier] = (tiers[tier] as number) + 1
      if (revealCode !== 0) {
        // one fade per draw: a piece coming in with its tile keeps one tier
        emit(i, ids[w >= 0.5 ? next : tier] as number, revealCode)
      } else if (clusterCode !== 0) {
        // one fade per draw: a part fading out with its cluster keeps one tier
        emit(i, ids[w >= 0.5 ? next : tier] as number, clusterCode)
      } else if (shrink < 1) {
        emit(i, ids[w >= 0.5 ? next : tier] as number, shrinkCode(shrink))
      } else if (w > 0 && ids[next] !== ids[tier]) {
        emit(i, ids[tier] as number, outCode(w))
        emit(i, ids[next] as number, inCode(w))
      } else emit(i, ids[w >= 0.5 ? next : tier] as number, 0)
    }

    self._indirectTexture.needsUpdate = true
    if (fade.count > 0) (fade.ids as DataTexture).needsUpdate = true
    self._multiDrawCount = drawn
    self._multiDrawBytesPerElement = bytesPerElement
    self._visibilityChanged = false
    if (main) {
      this.counts = { tiers, near, shells }
      this.dirty = false
    } else if (key) this.allKey = key
  }
}
