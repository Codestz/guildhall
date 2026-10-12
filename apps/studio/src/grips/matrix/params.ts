/**
 * What `?screen=grips` reads from its query: which props (rows), which clips (columns), at which
 * frozen times, and whether to add the slot-axes row.
 *
 *   ?screen=grips&props=held&clips=idle,chop,sit&t=0.3,0.7&axes=1
 */

/** Column keys → Rig_Medium clip names (all verified in the rig's clip list). */
export const CLIPS: Readonly<Record<string, string>> = {
  idle: "Idle_A",
  walk: "Walking_A",
  chop: "Chopping",
  pickaxe: "Pickaxing",
  hammer: "Hammering",
  sit: "Sit_Chair_Idle",
  wave: "Waving",
  hold: "Holding_A",
}

export const DEFAULT_CLIPS = ["idle", "walk", "chop", "pickaxe", "hammer", "sit", "wave", "hold"] as const

/**
 * The default rows: one everyday held prop per kind, KayKit throughout. There is no hand basket in
 * the library, so the metal bucket stands in for the carried-container case.
 */
export const DEFAULT_PROPS: readonly string[] = [
  "kaykit-adventurers/sword-1handed",
  "kaykit-tools/axe",
  "kaykit-tools/pickaxe",
  "kaykit-tools/hammer",
  "kaykit-tools/shovel",
  "kaykit-tools/lantern",
  "kaykit-adventurers/mug-full",
  "kaykit-tools/torch",
  "kaykit-adventurers/staff",
  "kaykit-adventurers/shield-round",
  "kaykit-adventurers/spellbook-closed",
  "kaykit-tools/bucket-metal",
  "kaykit-adventurers/bow",
]

export const DEFAULT_BODY = "kaykit-adventurers/knight"

export interface Column {
  /** The query key (`chop`) or, for a clip given by its rig name, that name. */
  key: string
  clip: string
  /** Frozen fraction of the clip, or null: the clip plays live. */
  t: number | null
}

export interface MatrixParams {
  /** Catalog ids, or "held": every piece the catalog marks `attach: held`. `props=` (empty): none. */
  props: readonly string[] | "held"
  columns: Column[]
  axes: boolean
  body: string
}

const list = (text: string | null): string[] =>
  (text ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "")

/** `t=0.3,0.7` → each in [0, 1]; anything else is dropped. None: live. */
function times(text: string | null): number[] {
  return list(text)
    .map(Number)
    .filter((t) => Number.isFinite(t) && t >= 0 && t <= 1)
}

/** The query → the matrix. A clip key not in `CLIPS` is taken as a rig clip name as written. */
export function parseParams(query: URLSearchParams): MatrixParams {
  const props = list(query.get("props"))
  const keys = list(query.get("clips"))
  const ts = times(query.get("t"))
  const columns = (keys.length > 0 ? keys : [...DEFAULT_CLIPS]).flatMap((key): Column[] => {
    const clip = CLIPS[key] ?? key
    return ts.length > 0 ? ts.map((t) => ({ key, clip, t })) : [{ key, clip, t: null }]
  })
  return {
    props: props[0] === "held" ? "held" : props.length > 0 || query.has("props") ? props : DEFAULT_PROPS,
    columns,
    axes: query.get("axes") === "1",
    body: query.get("body") || DEFAULT_BODY,
  }
}
