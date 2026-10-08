import { type AnimationClip, AnimationMixer } from "three"
import { CARRY_WALK, carryClip } from "../scene/activity.ts"
import { cloneRig } from "../scene/rig.ts"
import { ANIMS_URL, isModel, MODELS, modelUrl } from "../world/cast.ts"
import { createStage, load } from "./stage.ts"

/**
 * The character lab (dev only, `?lab=character&model=mage&clip=Walking_A&at=0.4`): one model from
 * four sides, playing a clip — or frozen at `at` (a fraction of the clip) for a still to compare.
 * `window.lab.pose(clip, at?)` changes it in place; `lab.clips()` lists the clips.
 */
export async function start(root: HTMLElement, params: URLSearchParams): Promise<void> {
  const stage = createStage(root)
  const wanted = params.get("model") ?? "knight"
  const model = isModel(wanted) ? wanted : "knight"
  const [gltf, anims] = await Promise.all([load(modelUrl(model)), load(ANIMS_URL)])
  const clips = new Map<string, AnimationClip>(anims.animations.map((clip) => [clip.name, clip]))
  const carry = carryClip(anims.animations)
  if (carry) clips.set(CARRY_WALK, carry)

  const body = cloneRig(gltf.scene)
  stage.scene.add(body)
  stage.fit(body)
  const mixer = new AnimationMixer(body)
  let frozen: number | undefined

  function pose(name: string, at?: number): string {
    const clip = clips.get(name)
    if (!clip) return `no clip "${name}"`
    mixer.stopAllAction()
    mixer.clipAction(clip).play()
    frozen = at !== undefined && Number.isFinite(at) ? Math.min(1, Math.max(0, at)) : undefined
    if (frozen !== undefined) mixer.setTime(clip.duration * frozen)
    stage.caption(
      `${model} · ${name}${frozen !== undefined ? ` @${frozen}` : " (playing)"}   models: ${MODELS.join(", ")}`,
    )
    return "ok"
  }

  const at = params.get("at")
  const problem = pose(params.get("clip") ?? "Idle_A", at === null ? undefined : Number(at))
  if (problem !== "ok") stage.caption(`${problem}: lab.clips() lists them`)

  stage.run((dt) => {
    if (frozen === undefined) mixer.update(dt)
  })

  Object.assign(window, { lab: { pose, clips: () => [...clips.keys()], models: () => [...MODELS] } })
}
