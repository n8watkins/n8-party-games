// A player's own piece: it moves the moment a key goes down, and tells the room only when
// something changes that the room could not have worked out. Shared by the page and by the
// scripted players in the tests, so the measurements send exactly what a real phone sends.
//
// What is sent (one small "m" message): a change of direction, a jump, and stepping into or
// out of a light. Walking in a straight line sends nothing: everyone else, and the room, carry
// the piece forward from its last known place and direction (lobby/shared/world.js, posAt).
import { BUMP_COOLDOWN_MS, JUMP_MS, WALK_SPEED, clampX, lightAt } from "./world.js";

/** Messages are at least this far apart, so mashing the keys cannot outrun the room's rate limit. */
export const SEND_GAP_MS = 60;

export class Pilot {
  /**
   * @param {{lights: number, send: (message: object) => void, x?: number, rev?: number}} opts
   *   lights: how many boxes hang on the wall. send: puts a message on the socket.
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
    this.zone = lightAt(x, lights);
    this.dirty = false;
    this.jumped = false;
    this.sentAt = -Infinity;
  }

  /** The room put the piece somewhere (the door, or where a bump sent it). The piece says so back. */
  place(x, rev, now) {
    this.advance(now);
    this.x = clampX(x);
    this.rev = rev;
    this.zone = lightAt(this.x, this.lights);
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
    const zone = lightAt(this.x, this.lights);
    if (zone !== this.zone) {
      this.zone = zone;
      this.dirty = true;
    }
  }
}
