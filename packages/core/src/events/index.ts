/**
 * The guild's wire vocabulary, ported from V1's core unchanged (PROTOCOL.md beside this file): what
 * the legacy hub and its adapters send over wire v1, so V2 is just another hall client of them.
 *
 *   wire      `GuildEvent`, the envelope, and `WIRE_VERSION`
 *   changes   `Change`, what a session did, in one vocabulary for every host
 *   craft     what a deed means (`craftOf`), whatever the host calls its tool
 *   outcome   whether a deed failed (`failedDeed`): the one rule every view of failure reads
 *   sea       what happens to the project on GitHub (`SeaEvent`)
 *   v1, v2    OpenCode 1's and 2's events, as changes (`adaptV1`, `adaptV2`)
 *
 * Pure: no `node:` import, so it runs in a worker or a browser as it does in a test.
 */

export {
  type Change,
  SUBAGENT_PREAMBLE,
  type ToolState,
  taskText,
} from "./changes.ts"
export { CRAFTS, type Craft, craftOf, declaredCraft, deedCraft, isCraft } from "./craft.ts"
export { createdSession } from "./created.ts"
export { endOf, finishedAt } from "./ends.ts"
export { type Deed, failedDeed, isCheck } from "./outcome.ts"
export {
  type CiState,
  isSeaRecord,
  type PrStatus,
  type SeaEvent,
  type SeaKind,
  type SeaRecord,
} from "./sea.ts"
export { adaptV1, agentOfTitle, stripAgentSuffix, type V1Translator } from "./v1.ts"
export { adaptV2, type V2Translator } from "./v2.ts"
export { type GuildEvent, WIRE_VERSION } from "./wire.ts"
