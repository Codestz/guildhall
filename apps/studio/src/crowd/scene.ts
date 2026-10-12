/** What a crowd bench layout hands the screen: its groups of people (one crowd each) and a camera. */
import type { CameraPose } from "@guildhall/core"
import type { ActorSample, CrowdActor } from "@guildhall/render"
import type { CrowdPath } from "./query.ts"

export interface FolkLabel {
  text: string
  at: readonly [number, number, number]
  small?: boolean
}

export interface FolkGroup {
  path: CrowdPath
  actors: CrowdActor[]
  /** Clips the people play besides their looks' own (for the bake). */
  clips: string[]
  labels: FolkLabel[]
  /** Actor `id` now (after the scene's `advance`). */
  sample(id: number): ActorSample
}

export interface FolkScene {
  groups: FolkGroup[]
  camera: CameraPose
  /** Moves the scene's clock on by `dt` seconds (before the groups are sampled). */
  advance(dt: number): void
  /** A line for the panel. */
  status?(): string
  dispose(): void
}
