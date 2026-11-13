// The party room's own sounds: footsteps, a jump and its landing, the kick, stepping into and
// out of a light, the count and the coin toss, someone coming and going, the room changing, a
// tap on a poster, a game starting and its result, and the 3D rooms' ambience (a jukebox, a
// cat, a comet). Every one is a short CC0 recording in lobby/public/sounds (CREDITS.txt there),
// played by the kit's player (party-kit/client/sounds.js) with the same volume and mute as the
// emotes. Nothing here sends anything to the room or sets a timer in it: every sound comes from
// something this page already knows.
//
// Where a sound plays (hearsHere):
//   - "own" sounds are this device's own feedback: its piece's steps, jump, landing, kick and
//     light, a blow it gave or took, and a tap on the wall. They play on the player's own phone,
//     always.
//   - everything else is "shared": other pieces' steps and kicks, the count, the toss, people
//     coming and going, the room changing, a game starting, the result, the ambience. With a big
//     screen in the room they play from the screen only, so the phones in the room do not all
//     say the same thing at once. With no screen, every phone plays them, other pieces quieter
//     than its own.
//
// The files are fetched only once the room is up and sound is allowed (warm), never before the
// room is drawn; a sound asked for before that is simply not played.
import { defineSound } from "/party-kit/client/sounds.js";
import { EMOTES } from "/party-kit/client/emotes.js";
import { JUMP_MS, boxCentre, lightHalf } from "./shared/world.js";

const FILES = new URL("./sounds/", import.meta.url);

/** The room's own sounds, by the name they are played by: the file is sounds/<name>.mp3. */
export const ROOM_SOUNDS = ["step-1", "step-2", "jump", "land", "kick-swing", "kick-hit", "kick-tumble", "light-in", "light-out", "count-tick", "count-last", "count-go", "toss-flip", "toss-land", "join", "leave", "lights-down", "lights-up", "tap", "game-start", "result"];

/** The 3D rooms' events (look3d/life.js, "party-room:sound") that have a sound, and its file. */
export const AMBIENCE = {
  "lamp.swing": "amb-lamp-swing",
  "jukebox.skip": "amb-jukebox-skip",
  "cat.walk": "amb-cat",
  "moth.visit": "amb-moth",
  "star.fall": "amb-star-fall",
  "comet.pass": "amb-comet",
  "rocket.pass": "amb-rocket",
  "satellite.pass": "amb-satellite",
  "holo.spin": "amb-holo",
};

/** The file an emote's sound is in, by the emote's id. */
export const emoteSound = (id) => `emote-${id}`;

/** Every sound the room may play, named, so the player can fetch it when asked. Nothing is fetched here. */
export function defineRoomSounds() {
  for (const name of [...ROOM_SOUNDS, ...Object.values(AMBIENCE), ...EMOTES.map((e) => emoteSound(e.id))]) defineSound(name, new URL(`${name}.mp3`, FILES).href);
}

/**
 * Whether a sound plays on this device: "own" feedback on the player's own phone; "shared"
 * sounds from the big screen when the room has one, and on every phone when it has none.
 * @param {"own" | "shared"} kind
 * @param {"player" | "screen" | undefined} role
 * @param {number} screens  how many big screens the room has
 */
export function hearsHere(kind, role, screens) {
  if (role === "screen") return kind === "shared";
  if (kind === "own") return true;
  return screens === 0;
}

/** How far a piece walks between two footsteps (room units), and the quickest they may come. */
const STRIDE = 78;
const STEP_MS = 230;
/** Other pieces are quieter than your own; their steps quieter still. */
const OTHERS = 0.55;
const STEPS = 0.32;
/** Ambience is sparse: one sound at a time in the room, and the same one not again for a while. */
const AMBIENT_GAP_MS = 1500;
const AMBIENT_AGAIN_MS = 8000;

export class RoomSounds {
  /**
   * @param {import("/party-kit/client/sounds.js").SoundBoard} board
   * @param {{role: () => string, seat: () => number, screens: () => number, playing: () => boolean}} where
   */
  constructor(board, where) {
    this.board = board;
    this.where = where;
    /** seat -> {x, walked, stepAt, foot, jumpAt, landed, light} */
    this.pieces = new Map();
    this.ambientAt = -Infinity;
    this.ambientLast = new Map();
    this.warmed = false;
    this.onRoom = (e) => this.ambient(e.detail);
    window.addEventListener("party-room:sound", this.onRoom);
  }

  /** Fetches and decodes the sounds this device will need, one by one, once sound is allowed. Called when the room is up. */
  warm() {
    if (this.warmed || !this.board.unlocked) return;
    this.warmed = true;
    const own = ROOM_SOUNDS;
    const emotes = EMOTES.map((e) => emoteSound(e.id));
    const idle = globalThis.requestIdleCallback ?? ((fn) => setTimeout(fn, 200));
    idle(() => void this.board.warm([...own, ...emotes]));
  }

  /** Plays `name` if it belongs on this device. `seat`: whose it is (-1: the room's). */
  play(name, seat = -1, { gain = 1, minor = false, bus = "main", late = null } = {}) {
    const own = seat >= 0 && seat === this.where.seat() && this.where.role() === "player";
    const kind = own || seat === -2 ? "own" : "shared";
    if (!hearsHere(kind, this.where.role(), this.where.screens())) return;
    // A phone with no screen hears the others quieter than its own; a screen hears everyone alike.
    const level = kind === "shared" && seat >= 0 && this.where.role() === "player" ? gain * OTHERS : gain;
    void this.board.play(name, { gain: level, minor, bus, late });
  }

  // ---------------------------------------------------------------- pieces

  /**
   * Every frame, for every piece: where it is, so steps and lights can be heard. Steps follow the
   * distance walked, never in the air, and never quicker than STEP_MS.
   * @param {{seat: number, x: number}[]} pieces
   * @param {number} lights  how many boxes (and pools of light) the wall has
   */
  frame(pieces, lights, now) {
    if (this.where.playing()) return;
    const seen = new Set();
    for (const { seat, x } of pieces) {
      seen.add(seat);
      let p = this.pieces.get(seat);
      if (!p) {
        p = { x, walked: 0, stepAt: -Infinity, foot: 0, jumpAt: -Infinity, landed: true, light: lightAt(x, lights) };
        this.pieces.set(seat, p);
        continue;
      }
      const air = now - p.jumpAt < JUMP_MS;
      if (!air) p.walked += Math.abs(x - p.x);
      // A jump that is over has landed.
      if (!p.landed && !air) {
        p.landed = true;
        this.play("land", seat, { gain: 0.8 });
        p.walked = 0;
      }
      if (p.walked >= STRIDE && now - p.stepAt >= STEP_MS) {
        p.walked = 0;
        p.stepAt = now;
        p.foot ^= 1;
        this.play(p.foot ? "step-1" : "step-2", seat, { gain: STEPS, minor: true, late: 120 });
      }
      if (Math.abs(x - p.x) < 0.01 && now - p.stepAt > 400) p.walked = Math.min(p.walked, STRIDE * 0.6);
      const light = lightAt(x, lights);
      if (light !== p.light) {
        // Into a pool, or out of one; walking straight from one into the next is one sound, into it.
        this.play(light >= 0 ? "light-in" : "light-out", seat, { gain: 0.45, minor: true, late: 150 });
        p.light = light;
      }
      p.x = x;
    }
    for (const seat of this.pieces.keys()) if (!seen.has(seat)) this.pieces.delete(seat);
  }

  jumped(seat, now) {
    const p = this.pieces.get(seat);
    if (p) {
      p.jumpAt = now;
      p.landed = false;
    }
    this.play("jump", seat, { gain: 0.6, minor: true, late: 120 });
  }

  /** A kick: the swing now; when it lands, the thump for the two pieces and a tumble for the one hit. */
  swung(seat) {
    this.play("kick-swing", seat, { gain: 0.8, late: 150 });
  }

  struck(by, to) {
    const mine = this.where.seat();
    // The thump is feedback for both the kicker and the one kicked.
    this.play("kick-hit", to === mine ? to : by);
    this.play("kick-tumble", to, { gain: 0.8 });
  }

  // ---------------------------------------------------------------- the room

  /** The 3D rooms' life, and the count (count-tick.js), as they announce themselves. */
  ambient({ name } = {}) {
    if (name === "count.tick" || name === "count.last") return this.play(name === "count.last" ? "count-last" : "count-tick", -1, { gain: name === "count.last" ? 0.9 : 0.6, late: 150 });
    const file = AMBIENCE[name];
    if (!file || this.where.playing()) return;
    const now = performance.now();
    if (now - this.ambientAt < AMBIENT_GAP_MS || now - (this.ambientLast.get(name) ?? -Infinity) < AMBIENT_AGAIN_MS) return;
    this.ambientAt = now;
    this.ambientLast.set(name, now);
    this.play(file, -1, { bus: "ambient", minor: true });
  }

  destroy() {
    window.removeEventListener("party-room:sound", this.onRoom);
    this.pieces.clear();
  }
}

/** Which pool of light a piece stands in (its box's index), or -1 between them. */
function lightAt(x, n) {
  const half = lightHalf(n);
  for (let i = 0; i < n; i++) if (Math.abs(x - boxCentre(i, n)) <= half) return i;
  return -1;
}
