// The characters as the page draws them without the 3D look: one definition each, with its flat
// drawing and its emotes. The ids are the room's (lobby/shared/characters.js); the 3D and baked
// looks keep the matching list in ../look3d/characters.js. A test keeps the three lists the same.
//
// Another character is one more file like ./pawn.js and one more line here (and its model in
// ../look3d/). No draw site names a character: the flat room (../scene.js), the bump
// (../bump-draw.js) and the emotes (../emotes/svg.js, play.js) all ask the definition.
// The interface is written down in lobby/README.md, "Characters".
import { ghost } from "./ghost.js";
import { pawn } from "./pawn.js";
import { robot } from "./robot.js";
import { slime } from "./slime.js";

/** The first is the default: what an id this page does not know is drawn as (a test keeps it the room's default). */
export const CHARACTER_DRAWINGS = { pawn, ghost, slime, robot };

/** The definition for a character id. */
export const drawingOf = (id) => (Object.hasOwn(CHARACTER_DRAWINGS, id) ? CHARACTER_DRAWINGS[id] : pawn);
