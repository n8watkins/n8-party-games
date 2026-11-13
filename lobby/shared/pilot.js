// A player's own piece: it moves the moment a key goes down, and tells the room only when
// something changes that the room could not have worked out. Shared by the page and by the
// scripted players in the tests, so the measurements send exactly what a real phone sends.
//
// What is sent (one small "m" message): a change of direction, a jump, and stepping into or
// out of a light that is on. Walking in a straight line sends nothing: everyone else, and the
// room, carry the piece forward from its last known place and direction (lobby/shared/world.js,
// posAt). A light that is off is just more dark, so walking under it sends nothing either.
import { BUMP_COOLDOWN_MS, JUMP_MS, WALK_SPEED, clampX, lightAt } from "./world.js";

/** Messages are at least this far apart, so mashing the keys cannot outrun the room's rate limit. */
export const SEND_GAP_MS = 60;

export class Pilot {
  /**
   * @param {{lights: number, send: (message: object) => void, x?: number, rev?: number}} opts
   *   lights: how many boxes hang on the wall. send: puts a message on the socket.
   *   Until setLit says otherwise every light counts as on.
   */
  constructor({ lights, send, x = 0, rev = 0 }) {
    this.lights = lights;
    this.send = send;
    this.x = x;
    this.d = 0;
    this.face = 1;
    /** How many times the room has moved this piece itself (a spawn, a bump). Echoed so the room can drop stale news. */
    this.rev = rev;
    this.at = null;
    this.jumpAt = -Infinity;
    this.bumpAt = -Infinity;
    /** The lights that are on, by their place on the wall; null means all of them. */
    this.lit = null;
    this.zone = this.zoneAt(x);
    this.dirty = false;
    this.jumped = false;
    this.sentAt = -Infinity;
  }

  /** Which light on the wall, if any, counts at x: an unlit one is the dark (-1). */
  zoneAt(x) {
    const i = lightAt(x, this.lights);
    return i !== -1 && this.lit && !this.lit.has(i) ? -1 : i;
  }

  /** The room said which lights are on (their places on the wall). Standing in one that just changed is news. */
  setLit(indices, now) {
    this.lit = new Set(indices);
    this.step(now);
  }

  /** The room put the piece somewhere (the door, or where a bump sent it). The piece says so back. */
  place(x, rev, now) {
    this.advance(now);
    this.x = clampX(x);
    this.rev = rev;
    this.zone = this.zoneAt(this.x);
    this.dirty = true;
    this.step(now);
  }

  /** Walk left (-1), right (1) or stand (0). */
  steer(d, now) {
    const next = d < 0 ? -1 : d > 0 ? 1 : 0;
    if (next === this.d) return;
    this.advance(now);
    this.d = next;
    if (next) this.face = next;
    this.dirty = true;
    this.step(now);
  }

  jump(now) {
    if (now - this.jumpAt < JUMP_MS) return false;
    this.advance(now);
    this.jumpAt = now;
    this.jumped = true;
    this.dirty = true;
    this.step(now);
    return true;
  }

  /** Asks the room for a bump. The room decides whether it lands. */
  bump(now) {
    if (now - this.bumpAt < BUMP_COOLDOWN_MS) return false;
    this.bumpAt = now;
    this.send({ t: "b" });
    return true;
  }

  /** Call every frame (or every few tens of milliseconds): moves the piece and sends what is due. */
  step(now) {
    this.advance(now);
    if (!this.dirty || now - this.sentAt < SEND_GAP_MS) return;
    const message = { t: "m", x: Math.round(this.x), d: this.d, r: this.rev };
    if (this.jumped) message.j = 1;
    this.dirty = false;
    this.jumped = false;
    this.sentAt = now;
    this.send(message);
  }

  /** Moves the piece to where it is at `now` and notices a light's edge being crossed. */
  advance(now) {
    if (this.at !== null && this.d) this.x = clampX(this.x + (this.d * WALK_SPEED * Math.max(0, now - this.at)) / 1000);
    this.at = now;
    const zone = this.zoneAt(this.x);
    if (zone !== this.zone) {
      this.zone = zone;
      this.dirty = true;
    }
  }
}
