// The seam between the page and the drawing of the room.
//
// The page (main.js) knows the room only as a "room view": something that is told what the room
// says and draws it. There are three drawings today, and all keep this one interface:
//
//   flat   scene.js, one SVG of plain shapes. The default.
//   3d     look3d/room3d.js, a three.js scene with the words laid over it. A preview, asked for
//          with ?look=3d (and &room=<skin>), and remembered on that device until ?look=flat.
//   baked  baked/room-baked.js, the bar as a rendered picture with the pieces drawn live over
//          it. A preview, asked for with ?look=baked, remembered the same way. Bar only.
//
// To retire the flat drawing: delete scene.js, art.js and FlatRoomView below, and make "3d" the
// default in chosenLook. To retire the preview instead: delete look3d/ and this file's 3D half.
import { set, s } from "./dom.js";
import { Scene } from "./scene.js";

/**
 * What main.js asks of a drawing.
 *
 * @typedef {object} RoomView
 * @property {string} look                                   "flat", "3d" or "baked"
 * @property {(room: object) => void} build                  draw everything that does not move, for this room's boxes
 * @property {(room: object, now: number) => void} setRoom   the room changed: who is here, the code, the board
 * @property {(vote: object, now: number) => void} setVote   the vote changed: lights, who stands where, count, toss
 * @property {(msg: object, now: number) => void} onMove     someone moved
 * @property {(msg: object, now: number) => void} onBump     someone bumped (and perhaps hit someone)
 * @property {(now: number) => void} ownJump                 the viewer's own piece jumped
 * @property {(now: number) => void} ownBump                 the viewer's own piece began a bump (the room has not answered yet)
 * @property {() => number} ownX                             where the viewer's own piece is drawn, for the camera
 * @property {(compact: boolean, room: object, now: number) => void} setCompact  the phone's bigger signs and tags, on or off
 * @property {(now: number, dt: number, pilot: object | null, view: object) => void} frame
 *   draw one frame; `view` is the part of the room to show (lobby/shared/camera.js)
 * @property {() => void} destroy                            take it out of the page
 */

/**
 * @typedef {{compact: boolean, own: number, host: string, qr: string, skin?: string, onBoard?: () => void}} RoomViewOptions
 *   onBoard: called when the Tonight board on the wall is tapped, so the page can open it.
 */

const LOOK_KEY = "party-room:look";
/** The looks a device can ask for besides the flat one. */
const LOOKS = ["3d", "baked"];
const SKIN_KEY = "party-room:skin";

function recall(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function remember(key, value) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Private browsing: the choice lasts as long as the page.
  }
}

/**
 * Which drawing this device asked for: {look, skin}. The address decides (?look=3d&room=roof),
 * and the choice is kept on the device, because the room's own address carries no query and a
 * phone that scans the code on the wall arrives without one.
 */
export function chosenLook(params) {
  const asked = params.get("look");
  if (params.has("look")) remember(LOOK_KEY, LOOKS.includes(asked) ? asked : null);
  if (params.has("room")) remember(SKIN_KEY, params.get("room"));
  const kept = recall(LOOK_KEY);
  return { look: LOOKS.includes(kept) ? kept : "flat", skin: recall(SKIN_KEY) ?? "" };
}

/** The flat drawing as a room view: the Scene, plus the SVG it draws into. */
class FlatRoomView extends Scene {
  constructor(root, opts) {
    const svg = s("svg", { class: "scene", preserveAspectRatio: "xMidYMid slice", role: "img", "aria-label": "The party room" });
    root.append(svg);
    super(svg, opts);
    this.look = "flat";
  }

  setCompact(compact, room, now) {
    this.opts.compact = compact;
    this.tagSize = compact ? 26 : 21;
    this.build(room);
    this.setRoom(room, now);
  }

  frame(now, dt, pilot, view) {
    // A blow jolts the picture for a moment (scene.jolt); the framing itself does not move.
    const jolt = this.jolt(now);
    set(this.svg, { viewBox: [view.x + jolt.x, view.y + jolt.y, view.width, view.height].map((n) => n.toFixed(2)).join(" ") });
    super.frame(now, dt, pilot, view);
  }

  destroy() {
    this.svg.remove();
  }
}

/**
 * Puts a drawing of the room into `root` and returns it. The 3D and baked looks are loaded only
 * when asked for. If the baked look cannot start (its picture did not arrive) the 3D look is
 * used; if that cannot start either (no WebGL, or its files did not arrive) the flat drawing is.
 *
 * @param {HTMLElement} root
 * @param {RoomViewOptions & {look: string}} opts
 * @returns {Promise<RoomView>}
 */
export async function openRoomView(root, opts) {
  if (opts.look === "baked") {
    try {
      const { RoomBaked } = await import("./baked/room-baked.js");
      return await RoomBaked.open(root, opts);
    } catch (err) {
      console.warn("The baked look could not start, so the room is drawn in 3D.", err);
    }
  }
  if (opts.look === "3d" || opts.look === "baked") {
    try {
      const { Room3D } = await import("./look3d/room3d.js");
      return await Room3D.open(root, opts);
    } catch (err) {
      console.warn("The 3D look could not start, so the room is drawn flat.", err);
    }
  }
  return new FlatRoomView(root, opts);
}
