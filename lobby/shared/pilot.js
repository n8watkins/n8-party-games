// A player's own piece: it moves the moment a key goes down, and tells the room only when
// something changes that the room could not have worked out. Shared by the page and by the
// scripted players in the tests, so the measurements send exactly what a real phone sends.
//
// What is sent (one small "m" message): a change of direction, a jump, and stepping into or
// out of a light that is on. Walking in a straight line sends nothing: everyone else, and the
// room, carry the piece forward from its last known place and direction (lobby/shared/world.js,
// posAt). A light that is off is just more dark, so walking under it sends nothing either.
//
// A bump is one more small message ("b"). Being knocked down sends nothing at all: the room
// put the piece where it landed, and the piece simply cannot walk, jump or bump until it is up.
import { BUMP_COOLDOWN_MS, STUN_MS } from "./bump.js";
import { FADE_COOLDOWN_MS } from "./ghost.js";
import { HOOK_COOLDOWN_MS, HOOK_LIFE_MS, STILT_COOLDOWN_MS, STILT_MS } from "./robot.js";
import { HOLD_MS, SLIME_COOLDOWN_MS } from "./slime.js";
import { JUMP_MS, WALK_SPEED, clampX, lightAt } from "./world.js";

/** Each move's whole cooldown, for the ring and the button (shared/characters.js, moveOf). */
export const MOVE_COOLDOWN = { kick: BUMP_COOLDOWN_MS, fade: FADE_COOLDOWN_MS, hook: HOOK_COOLDOWN_MS, harden: SLIME_COOLDOWN_MS };

/** Messages are at least this far apart, so mashing the keys cannot outrun the room's rate limit. */
export const SEND_GAP_MS = 60;

export class Pilot {
  /**
   * @param {{lights: number | object, send: (message: object) => void, x?: number, rev?: number}} opts
   *   lights: the room's wall (shared/rooms.js, wallFor), or how many boxes hang evenly on it.
   *   send: puts a message on the socket.
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
    /** When the piece may bump again, as far as this page knows; the room has the last word (cool). */
    this.coolUntil = -Infinity;
    /** The same for a ghost's fade (its move in place of the bump), and which move the piece has. */
    this.fadeCoolUntil = -Infinity;
    this.move = "kick";
    /** The same for a robot's hook and its legs, and a slime's harden (shared/robot.js, slime.js). */
    this.hookCoolUntil = -Infinity;
    this.stiltCoolUntil = -Infinity;
    this.slimeCoolUntil = -Infinity;
    /** A robot stands still from its throw until the room has judged its hook. */
    this.rootedUntil = -Infinity;
    /** A robot's legs are up until then (no hook while up). */
    this.upUntil = -Infinity;
    /** When this slime's harden was sent, and whether it has been turned soft (one absorb a press). */
    this.hardenAt = -Infinity;
    this.turned = true;
    /** Knocked down until then: no walking, jumping or bumping. */
    this.stunUntil = -Infinity;
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

  /** The party is in a room whose boxes hang somewhere else (shared/rooms.js, wallFor): which light the piece is in is worked out afresh. */
  setWall(wall, now) {
    this.lights = wall;
    this.step(now);
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

  /**
   * The room says the piece was knocked to x: it lies there, still, for `stun` milliseconds.
   * Nothing is sent back: the room already knows, and a piece on the floor has no news.
   */
  knock(x, rev, now, stun = STUN_MS) {
    this.advance(now);
    this.x = clampX(x);
    this.rev = rev;
    this.d = 0;
    this.zone = this.zoneAt(this.x);
    this.dirty = false;
    this.jumped = false;
    this.stunUntil = now + stun;
  }

  /** Knocked down right now? */
  down(now) {
    return now < this.stunUntil;
  }

  /** Walk left (-1), right (1) or stand (0). A piece on the floor, or a robot throwing its hook, stands whatever is held. */
  steer(d, now) {
    const next = this.down(now) || now < this.rootedUntil ? 0 : d < 0 ? -1 : d > 0 ? 1 : 0;
    if (next === this.d) return;
    this.advance(now);
    this.d = next;
    if (next) this.face = next;
    this.dirty = true;
    this.step(now);
  }

  jump(now) {
    if (now - this.jumpAt < JUMP_MS || this.down(now)) return false;
    this.advance(now);
    this.jumpAt = now;
    this.jumped = true;
    this.dirty = true;
    this.step(now);
    return true;
  }

  /** Asks the room for a bump. The room decides whether it lands, and enforces the cooldown. */
  bump(now) {
    if (now < this.coolUntil || this.down(now)) return false;
    this.coolUntil = now + BUMP_COOLDOWN_MS;
    // Where it stands and which way it faces said first (a turn still waiting out the send gap),
    // and the kick carries its facing too: the room kicks the way this page shows it facing.
    if (this.dirty) this.sentAt = -Infinity;
    this.step(now);
    this.send({ t: "b", f: this.face });
    return true;
  }

  /** The room's word on the cooldown: the piece may bump again in `left` milliseconds. */
  cool(left, now) {
    this.coolUntil = now + Math.max(0, left);
  }

  /**
   * Milliseconds until the piece's move is ready again (0: ready): the bump, or a ghost's fade
   * when `move` is "fade" (the page keeps `move` as the player's character's: characters.js, moveOf).
   */
  cooling(now) {
    const until = { fade: this.fadeCoolUntil, hook: this.hookCoolUntil, harden: this.slimeCoolUntil }[this.move] ?? this.coolUntil;
    return Math.max(0, until - now);
  }

  /** How far the move has recharged, 0 (just used) to 1 (ready): for the ring under the piece and the button. */
  coolShare(now) {
    return 1 - Math.min(1, this.cooling(now) / (MOVE_COOLDOWN[this.move] ?? BUMP_COOLDOWN_MS));
  }

  /**
   * The robot's move (shared/robot.js): it stops, and asks the room to throw its hook the way it
   * faces. The room judges it; its word on the cooldown comes back as hookCool if it refuses.
   */
  hook(now) {
    if (now < this.hookCoolUntil || this.down(now) || now < this.upUntil || now < this.rootedUntil) return false;
    this.hookCoolUntil = now + HOOK_COOLDOWN_MS;
    this.rootedUntil = now + HOOK_LIFE_MS;
    // It stands still to throw: said first, so the room has it standing where it throws.
    this.steer(0, now);
    if (this.dirty) this.sentAt = -Infinity;
    this.step(now);
    this.send({ t: "hook", f: this.face });
    return true;
  }

  /** The room's word on the hook: it may hook again in `left` milliseconds; the throw is over (it may walk). */
  hookCool(left, now) {
    this.hookCoolUntil = now + Math.max(0, left);
    this.rootedUntil = -Infinity;
  }

  /** The robot's jump: its legs telescope out (shared/robot.js). */
  stilts(now) {
    if (now < this.stiltCoolUntil || this.down(now) || now < this.rootedUntil) return false;
    this.stiltCoolUntil = now + STILT_COOLDOWN_MS;
    this.upUntil = now + STILT_MS;
    this.send({ t: "stilts" });
    return true;
  }

  /** The room's word on the legs: up again in `left` milliseconds, and they are down now. */
  stiltCool(left, now) {
    this.stiltCoolUntil = now + Math.max(0, left);
    this.upUntil = -Infinity;
  }

  /**
   * The slime's move (shared/slime.js): the press hardens it; held past HOLD_MS (absorb) the
   * harden just begun turns soft. Returns whether it was sent.
   */
  slime(kind, now) {
    if (this.down(now)) return false;
    if (kind === "absorb") {
      if (this.turned || now - this.hardenAt < HOLD_MS - 20) return false;
      this.turned = true;
      this.send({ t: "slime", k: "absorb" });
      return true;
    }
    if (now < this.slimeCoolUntil) return false;
    this.slimeCoolUntil = now + SLIME_COOLDOWN_MS;
    this.hardenAt = now;
    this.turned = false;
    this.send({ t: "slime", k: "harden" });
    return true;
  }

  /** The room's word on the slime's move: it may harden again in `left` milliseconds. */
  slimeCool(left, now) {
    this.slimeCoolUntil = now + Math.max(0, left);
    this.turned = true;
  }

  /**
   * The ghost's move (lobby/shared/ghost.js): asks the room to fade the piece, as a bump does.
   * The room decides, and enforces the cooldown; its word comes back as fadeCool.
   */
  fade(now) {
    if (now < this.fadeCoolUntil || this.down(now)) return false;
    this.fadeCoolUntil = now + FADE_COOLDOWN_MS;
    this.send({ t: "fade" });
    return true;
  }

  /** The room's word on the fade's cooldown: the piece may fade again in `left` milliseconds. */
  fadeCool(left, now) {
    this.fadeCoolUntil = now + Math.max(0, left);
  }

  /** Milliseconds until the piece may fade again (0: ready). */
  fadeCooling(now) {
    return Math.max(0, this.fadeCoolUntil - now);
  }

  /** Call every frame (or every few tens of milliseconds): moves the piece and sends what is due. */
  step(now) {
    this.advance(now);
    if (!this.dirty || now - this.sentAt < SEND_GAP_MS) return;
    // `f`: which way it faces, so a turn whose walk ended inside the send gap (a quick tap: its
    // d of 1 overwritten by its key-up's 0 before it went) still reaches the room.
    const message = { t: "m", x: Math.round(this.x), d: this.d, f: this.face, r: this.rev };
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
