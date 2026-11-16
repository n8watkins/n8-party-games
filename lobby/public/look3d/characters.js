// The characters as the 3D look draws them (and the baked look, which is the 3D look with real
// light): one definition each. The ids are the room's (lobby/shared/characters.js); the flat
// drawings and the emotes are in ../characters/index.js. A test keeps the three lists the same.
//
// No draw site names a character: the room view (room3d.js) and the baked look
// (../baked/room-baked.js) ask the definition. A definition is:
//
//   make(radial)                   a body, with the handles every character has: group, tilt,
//                                  turn, mat, blob, ring, colour, lit, fade, air, dizzy
//   dress(body, hex, connected)    the player's colour, or grey for one who has dropped
//   pose(body, piece, now, dt, how)   stands it where its piece is this frame; returns {up,
//                                  moving, shock, burst, dust, state} (`up`: the top of its head
//                                  above a standing pawn's, in world units)
//   emote(body, pose, now, seat)   an emote's pose laid over it, after pose()
//   hands(body, colour)            its hands for an emote: {set(pose, now), dispose()}
//   fade(body, left)               leaving the room: 1 to 0
//   bake(body)                     the baked look's finish, after pose()
//   dispose(body)
//
// The interface is written down in lobby/README.md, "Characters".
import { DEFAULT_CHARACTER } from "../shared/characters.js";
import { EmoteArms, RIG_UNIT } from "./emote-arms.js";
import { GhostHands, bakeGhost, disposeGhost, dressGhost, emoteGhost, fadeGhost, makeGhost, poseGhost } from "./ghost.js";
import { SIZE, bakePawn, disposePawn, dressPawn, emotePawn, fadePawn, makePawn, posePawn } from "./pieces.js";

const pawn = {
  id: "pawn",
  make: makePawn,
  dress: dressPawn,
  pose: posePawn,
  emote: (body, pose) => emotePawn(body, pose, RIG_UNIT * SIZE),
  hands: (body, colour) => new EmoteArms(body, colour),
  fade: fadePawn,
  bake: bakePawn,
  dispose: disposePawn,
};

const ghost = {
  id: "ghost",
  make: makeGhost,
  dress: dressGhost,
  pose: poseGhost,
  emote: emoteGhost,
  hands: (body, colour) => new GhostHands(body, colour),
  fade: fadeGhost,
  bake: bakeGhost,
  dispose: disposeGhost,
};

export const CHARACTER_MODELS = { pawn, ghost };

/** The definition for a character id; an id this page does not know is drawn as the default. */
export const modelOf = (id) => (Object.hasOwn(CHARACTER_MODELS, id) ? CHARACTER_MODELS[id] : CHARACTER_MODELS[DEFAULT_CHARACTER]);
