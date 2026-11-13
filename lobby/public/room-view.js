// The seam between the page and the drawing of the room.
//
// The page (main.js) knows the room only as a "room view": something that is told what the room
// says and draws it. There are two drawings today, and both keep this one interface:
//
//   3d     look3d/room3d.js, a three.js scene with the words laid over it. The default on a
//          device with hardware WebGL 2. Which room (skin) it draws is the party's choice.
//   flat   scene.js, one SVG of plain shapes. The fallback, and what ?look=flat asks for
//          (remembered on that device until ?look=3d).
//
// To retire the flat drawing: delete scene.js, art.js and FlatRoomView below, and make "3d" the
// default in chosenLook. To retire the preview instead: delete look3d/ and this file's 3D half.
import { set, s } from "./dom.js";
import { Scene } from "./scene.js";

/**
 * What main.js asks of a drawing.
 *
 * @typedef {object} RoomView
 * @property {string} look                                   "flat" or "3d"
 * @property {(room: object) => void} build                  draw everything that does not move, for this room's boxes
 * @property {(room: object, now: number) => void} setRoom   the room changed: who is here, the code, the board
 * @property {(vote: object, now: number) => void} setVote   the vote changed: lights, who stands where, count, toss
 * @property {(msg: object, now: number) => void} onMove     someone moved
 * @property {(msg: object, now: number) => void} onBump     someone bumped (and perhaps hit someone)
 * @property {(msg: object, now: number) => void} onExpress  someone sent an emote ({t: "e", s, e}): shown over
 *   their piece (the kit's rules: party-kit/client/emotes.js). Neither drawing shows it yet: how
 *   emotes look waits on the owner's picks (preview/emotes-artifact-v4.html), and the page says
 *   it in a note meanwhile. A player's new emote replaces their own previous one at once
 *   (its sound is cut by the page's player); other players' emotes overlap as they come. The
 *   poses are data (preview/emotes/rig.js) that either drawing can read.
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
  if (params.has("look")) remember(LOOK_KEY, params.get("look") === "flat" ? "flat" : null);
  if (params.has("room")) remember(SKIN_KEY, params.get("room"));
  return { look: recall(LOOK_KEY) === "flat" ? "flat" : "3d", skin: recall(SKIN_KEY) ?? "" };
}

/** Remembers on this device that it wants the flat drawing (the "Simpler room" offer). */
export function preferFlat() {
  remember(LOOK_KEY, "flat");
}

/**
 * Whether this device can draw the 3D look well: hardware WebGL 2, asked for the same way the 3D
 * look asks (a software renderer does not count unless ?gl=any). Checked before any of the 3D
 * look is fetched, so a device that would fall back downloads none of it.
 */
export function hardware3D(params) {
  const any = params.get("gl") === "any";
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2", { failIfMajorPerformanceCaveat: !any });
    if (!gl) return false;
    // Some browsers hand out a software renderer without calling it a caveat (SwiftShader in a
    // headless Chrome, llvmpipe on a Linux box without drivers): that is not hardware either.
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return any || !/swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer);
  } catch {
    return false;
  }
}

/** The flat drawing as a room view: the Scene, plus the SVG it draws into. */
class FlatRoomView extends Scene {
  constructor(root, opts) {
    const svg = s("svg", { class: "scene", preserveAspectRatio: "xMidYMid slice", role: "img", "aria-label": "The party room" });
    root.append(svg);
    super(svg, opts);
    this.look = "flat";
  }

  /** An emote over someone's piece. Drawn here once the owner has picked how they look. */
  onExpress() {}

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
 * Puts a drawing of the room into `root` and returns it. The 3D look is loaded only when asked
 * for; if it cannot start (no WebGL, or its files did not arrive) the flat drawing is used.
 *
 * @param {HTMLElement} root
 * @param {RoomViewOptions & {look: string}} opts
 * @returns {Promise<RoomView>}
 */
export async function openRoomView(root, opts) {
  if (opts.look === "3d") {
    try {
      const { Room3D } = await import("./look3d/room3d.js");
      return await Room3D.open(root, opts);
    } catch (err) {
      console.warn("The 3D look could not start, so the room is drawn flat.", err);
    }
  }
  return new FlatRoomView(root, opts);
}
