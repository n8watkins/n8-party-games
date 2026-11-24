// What the preview's drawing files (art.js, table.js, view.js, sound.js) found in the one script they were
// built into: three.js, the numbers, and the table worked out from them. Here it all comes from the room's own
// rules (../shared/rules.js), so what a page draws is what the room drives on.
//
// three.js is round five's release, 0.149.0, loaded as a plain script before any module (index.html), so the
// look is the one the owner tuned.
import { DT, rules } from "../shared/rules.js";

export const THREE = globalThis.THREE;
export const TUNE = rules.T;
export const T = TUNE;
export { DT };
export { hash } from "../shared/rules.js";
export const {
  SEGS, TAG, LEN, segAt, wrapU, wrapS, trackAt, locate, halfAt, EDGE_SIDE, onEdge, sideLimit,
  groundAt, susanH, toastH, bankAt, BANK_SIDE, BANK_EASE, SHAKERS, ARM_TAU, steamAt, toasterAt, eggAt, EGG_DIST, syrupAt, spillAt,
  SUSAN_AT, susanThings, cherryPlan, JUMPS, jumpAt, blockers, clearAhead, clearLane,
} = rules.course;
