/**
 * A BatchedMesh that draws each instance at a level of detail (lod.ts). three r186's BatchedMesh has
 * no LOD of its own: before every pass it walks the instances, frustum-culls them and lists each one's
 * geometry range for the multi-draw. This replaces that walk with one that lists a tier's range
 * instead (the tiers are extra geometries in the same buffers, never assigned to an instance), and
 * swaps a cluster's parts for its shell when it is far. The walk runs anyway, so LOD costs a distance
 * and a compare per visible instance. World bounding spheres are cached per instance, not rebuilt from
 * the matrix texture every pass.
 */
import {
  BatchedMesh,
  type BufferGeometry,
  type Camera,
  Frustum,
  type Material,
  Matrix4,
  type Object3D,
  type PerspectiveCamera,
  Sphere,
  Vector2,
  Vector3,
  type WebGLRenderer,
} from "three"
import { type LodCounts, PIECE_PX, pickTier, SHADOW_TIER, SHELL_PX, screenRadius } from "./lod.ts"

/** The BatchedMesh internals the walk fills (three keeps them private). */
interface Internals {
  _instanceInfo: { visible: boolean; active: boolean; geometryIndex: number }[]
  _geometryInfo: { start: number; count: number }[]
  _multiDrawStarts: Int32Array
  _multiDrawCounts: Int32Array
  _multiDrawCount: number
  _multiDrawBytesPerElement: number
  _visibilityChanged: boolean
  _indirectTexture: { image: { data: Uint32Array }; needsUpdate: boolean }
}

/** A cluster: its shell instance and its parts' instances. */
interface Cluster {
  shell: number
  parts: number[]
}

/** No cluster / not yet decided. */
const NONE = -1

const frustum = new Frustum()
const toLocal = new Matrix4()
const viewer = new Vector3()
const sphere = new Sphere()
const matrix = new Matrix4()
const inverse = new Matrix4()
const buffer = new Vector2()

export class LodBatchedMesh extends BatchedMesh {
  /** Geometry id → its tiers' geometry ids, finest first (a geometry without tiers is its own only). */
  private readonly tierIds: number[][] = []
  /** Per instance: world bounding sphere (x, y, z, r), stale flag, last main-pass tier, cluster. */
  private readonly spheres: number[] = []
  private readonly stale: boolean[] = []
  private readonly tierOf: number[] = []
  private readonly clusterOf: number[] = []
  private readonly clusters: Cluster[] = []
  /** Per cluster: drawn as its shell in the last main pass (0 / 1). */
  private readonly shellOf: number[] = []
  private counts: LodCounts = { tiers: [0, 0, 0], near: 0, shells: 0 }

  /** What the last main pass drew. */
  get lod(): LodCounts {
    return this.counts
  }

  /** Gives `geometryId` coarser `tiers` (geometry ids, finer first) to draw instead when small. */
  setTiers(geometryId: number, tiers: readonly number[]): void {
    this.tierIds[geometryId] = [geometryId, ...tiers]
  }

  /**
   * Makes `shell` the far stand-in of `parts` (instance ids): one of the two is drawn, never both.
   * Clusters are fixed once made.
   */
  addCluster(shell: number, parts: readonly number[]): void {
    const c = this.clusters.length
    this.clusters.push({ shell, parts: [...parts] })
    this.shellOf.push(NONE)
    this.clusterOf[shell] = c
    for (const id of parts) this.clusterOf[id] = c
  }

  override addInstance(geometryId: number): number {
    const id = super.addInstance(geometryId)
    this.stale[id] = true
    this.tierOf[id] = 0
    this.clusterOf[id] = NONE
    return id
  }

  override setMatrixAt(instanceId: number, m: Matrix4): this {
    super.setMatrixAt(instanceId, m)
    this.stale[instanceId] = true
    return this
  }

  override setGeometryIdAt(instanceId: number, geometryId: number): this {
    super.setGeometryIdAt(instanceId, geometryId)
    this.stale[instanceId] = true
    return this
  }

  /** Instance `id`'s world bounding sphere into `sphere`, from the cache. */
  private sphereOf(id: number, geometryId: number): Sphere {
    const s = this.spheres
    if (this.stale[id]) {
      this.getBoundingSphereAt(geometryId, sphere)
      sphere.applyMatrix4(this.getMatrixAt(id, matrix))
      s[id * 4] = sphere.center.x
      s[id * 4 + 1] = sphere.center.y
      s[id * 4 + 2] = sphere.center.z
      s[id * 4 + 3] = sphere.radius
      this.stale[id] = false
    }
    sphere.center.set(s[id * 4] as number, s[id * 4 + 1] as number, s[id * 4 + 2] as number)
    sphere.radius = s[id * 4 + 3] as number
    return sphere
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

    toLocal.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(this.matrixWorld)
    frustum.setFromProjectionMatrix(toLocal, camera.coordinateSystem, camera.reversedDepth)
    viewer.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(inverse.copy(this.matrixWorld).invert())
    const perspective = (camera as PerspectiveCamera).isPerspectiveCamera === true
    // Only the main view picks tiers by size (and keeps hysteresis state); any other camera is drawn coarse.
    const sized = !shadow && perspective
    renderer.getDrawingBufferSize(buffer)
    const projectionY = camera.projectionMatrix.elements[5] as number
    const px = (id: number, geometryId: number) => {
      const s = this.sphereOf(id, geometryId)
      return screenRadius(s.radius, s.center.distanceTo(viewer), projectionY, buffer.y)
    }

    const info = self._instanceInfo
    // Clusters first: each is near or far for this pass, by its shell's sphere.
    let near = 0
    for (let c = 0; c < this.clusters.length; c++) {
      const { shell } = this.clusters[c] as Cluster
      const shellInfo = info[shell]
      if (!shellInfo?.active) continue
      if (sized) {
        const previous = this.shellOf[c] === 1 ? 1 : 0
        this.shellOf[c] = pickTier(px(shell, shellInfo.geometryIndex), previous, [SHELL_PX])
        if (this.shellOf[c] === 0) near++
      }
    }

    const tiers = [0, 0, 0]
    let shells = 0
    const starts = self._multiDrawStarts
    const counts = self._multiDrawCounts
    const indirect = self._indirectTexture.image.data
    const geometries = self._geometryInfo
    let drawn = 0
    for (let i = 0; i < info.length; i++) {
      const instance = info[i] as Internals["_instanceInfo"][number]
      if (!instance.visible || !instance.active) continue
      const c = this.clusterOf[i] as number
      const isShell = c !== NONE && this.clusters[c]?.shell === i
      if (c !== NONE) {
        // Shadows always cast from shells; the main view by the cluster's state (unknown → shell).
        const far = shadow || !sized || this.shellOf[c] !== 0
        if (isShell !== far) continue
      }
      const geometryId = instance.geometryIndex
      if (!frustum.intersectsSphere(this.sphereOf(i, geometryId))) continue

      const ids = this.tierIds[geometryId]
      let tier = 0
      if (ids && ids.length > 1) {
        if (sized) {
          tier = pickTier(px(i, geometryId), this.tierOf[i] as number, PIECE_PX)
          this.tierOf[i] = tier
        } else tier = shadow ? SHADOW_TIER : ids.length - 1
        tier = Math.min(tier, ids.length - 1)
        // A tier that reuses the finer one's geometry counts as that one.
        while (tier > 0 && ids[tier] === ids[tier - 1]) tier--
      }
      if (isShell) shells++
      else tiers[tier] = (tiers[tier] as number) + 1
      const range = geometries[ids ? (ids[tier] as number) : geometryId] as { start: number; count: number }
      starts[drawn] = range.start * bytesPerElement * multiplier
      counts[drawn] = range.count * multiplier
      indirect[drawn] = i
      drawn++
    }

    self._indirectTexture.needsUpdate = true
    self._multiDrawCount = drawn
    self._multiDrawBytesPerElement = bytesPerElement
    self._visibilityChanged = false
    if (sized) this.counts = { tiers, near, shells }
  }
}
