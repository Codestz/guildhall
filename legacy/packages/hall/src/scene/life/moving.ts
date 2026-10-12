/**
 * Moving parts of the island's buildings (ADR 0007, Life): separate nodes inside their pieces in
 * lands.glb. Island batches every piece whole, so it must leave these out for Life to turn them —
 * otherwise a still copy shows behind the turning one. The handshake: Island asks `isMovingPart`
 * for each mesh it batches (and skips the ones that are); Life only draws the parts once Island
 * has asked, so there is never a double.
 */
export const MOVING_PARTS = {
  /** The windmill's sails: turn about their local z with the wind. */
  sails: { piece: "building_windmill_blue", part: "building_windmill_top_fan_blue", axis: "z" },
  /**
   * The second town kit's windmill (town2.glb, gen 2): the piece is only the sails (the tower is
   * built of castle pieces), a mesh of its own, so it is turned whole, about its local x.
   */
  kitSails: { piece: "t2_windmill", part: "windmill", axis: "x" },
  /** The watermill's wheel: turns about its local z with the river. */
  wheel: { piece: "building_watermill_blue", part: "building_watermill_wheel_blue", axis: "z" },
  /** The lumber mill's saw blade: spins about its local x while explorers fell trees. */
  saw: { piece: "building_lumbermill_blue", part: "building_lumbermill_saw_blue", axis: "x" },
} as const

const NAMES: ReadonlySet<string> = new Set(Object.values(MOVING_PARTS).map((p) => p.part))
let claimed = false

/** For Island's batching: true for a mesh Life draws (and animates) instead. */
export function isMovingPart(meshName: string): boolean {
  claimed = true
  return NAMES.has(meshName)
}

/** Whether Island leaves the moving parts to Life. */
export function movingPartsClaimed(): boolean {
  return claimed
}
