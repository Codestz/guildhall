/**
 * The labs (dev and probe builds only, never the showcase bundle: main.tsx imports this behind
 * PROBE): one thing in a tiny scene instead of the whole island, so it loads in a second and a
 * probe shot sees only what is being worked on.
 *
 *   ?lab=grips                                  the grip lab's contact sheets (lab.sheet("pickaxe"))
 *   ?lab=character&model=mage&clip=Walking_A    a model from four sides, playing (or `&at=0.4`: frozen)
 *   ?lab=prop&piece=lantern                     a kit piece or drawn prop from four sides
 *   ?lab=event&kind=dragon&night=1              a world event alone over a flat sea, on repeat
 *   ?lab=crowd&n=300 (&compare=1)               the baked-bone crowd: a field of n, or one beside a real rig
 *
 * Each lab hangs its levers on `window.lab`. A new lab: a module with `start(root, params)`, and a
 * line here.
 */
export const LABS = {
  grips: () => import("./gripLab.ts"),
  character: () => import("./characterLab.ts"),
  prop: () => import("./propLab.ts"),
  event: () => import("./eventLab.tsx"),
  crowd: () => import("./crowdLab.ts"),
} satisfies Record<string, () => Promise<{ start(root: HTMLElement, params: URLSearchParams): unknown }>>

export type LabName = keyof typeof LABS

export function isLab(name: string): name is LabName {
  return Object.hasOwn(LABS, name)
}

export async function start(root: HTMLElement, name: string, params: URLSearchParams): Promise<void> {
  if (!isLab(name)) {
    root.textContent = `No lab "${name}". Labs: ${Object.keys(LABS).join(", ")}`
    return
  }
  const lab = await LABS[name]()
  await lab.start(root, params)
}
