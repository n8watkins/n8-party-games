// The characters as the 3D look draws them (and the baked look, which is the 3D look with real
// light): one definition each. The ids are the room's (lobby/shared/characters.js); the flat
// drawings and the emotes are in ../characters/index.js. A test keeps the three lists the same.
//
// No draw site names a character: the room view (room3d.js) and the baked look
// (../baked/room-baked.js) ask the definition. A definition is:
//
//   make(radial)                   a body, with the handles every character has: group, tilt,
//                                  turn, mat, blob, ring, colour, lit, fade, air, dizzy, skin.
//                                  A room reads group, tilt, blob, ring, fade, air and dizzy; `mat`
//                                  and `colour` are the character's own business (a ghost's are a
//                                  white sheet: its player's colour is its hem), and `skin`, the
//                                  meshes of its own surface, is for a Reflection (below)
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
import * as THREE from "./three.js";

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

/** Mirrors the world in the floor (y = 0). */
const FLIP = new THREE.Matrix4().makeScale(1, -1, 1);

/**
 * A body's reflection in a shiny floor, for any character: its own surface (`skin`) standing on
 * its head under the floor, unlit, in whatever colour the body is this frame (a ghost's hem, a
 * fuming piece's red, a dropped player's grey), fading as the body leaves the floor. It shares
 * the body's shapes, so it moves as the body does; nothing is copied per frame but a matrix and
 * a colour. A room adds it to its scene and calls update() each frame just before drawing.
 */
export class Reflection extends THREE.Group {
  constructor(body) {
    super();
    this.body = body;
    this.pairs = body.skin.map((src) => {
      const mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, vertexColors: !!src.material.vertexColors });
      let mesh;
      if (src.isInstancedMesh) {
        mesh = new THREE.InstancedMesh(src.geometry, mat, src.count);
        mesh.instanceMatrix = src.instanceMatrix;
        mesh.instanceColor = src.instanceColor;
      } else mesh = new THREE.Mesh(src.geometry, mat);
      // Placed by hand from the body's own place in the world (update), never by the scene.
      mesh.matrixAutoUpdate = false;
      mesh.matrixWorldAutoUpdate = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = -2;
      this.add(mesh);
      return [src, mesh];
    });
  }

  /**
   * After the body is posed and its world matrices are up to date: `shade` darkens it (0 to 1)
   * and `strength` is how much of it the floor gives back.
   */
  update(shade, strength) {
    const b = this.body;
    const off = Math.max(0, 1 - b.group.position.y * 0.9);
    for (const [src, mesh] of this.pairs) {
      mesh.visible = src.visible;
      mesh.matrixWorld.multiplyMatrices(FLIP, src.matrixWorld);
      mesh.material.color.copy(src.material.color).multiplyScalar(shade);
      mesh.material.opacity = strength * b.fade * off * (src.material.transparent ? src.material.opacity : 1);
    }
  }

  dispose() {
    for (const [, mesh] of this.pairs) mesh.material.dispose();
  }
}

/** The definition for a character id; an id this page does not know is drawn as the default. */
export const modelOf = (id) => (Object.hasOwn(CHARACTER_MODELS, id) ? CHARACTER_MODELS[id] : CHARACTER_MODELS[DEFAULT_CHARACTER]);
