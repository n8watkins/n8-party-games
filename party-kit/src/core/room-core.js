// The room, as plain logic with no network and no clock of its own.
// The Durable Object (src/worker/room.js) owns one RoomCore, feeds it joins, sockets, inputs
// and ticks, and sends whatever it returns. Tests drive it directly with a fake clock.
//
// Phases: "lobby" -> "playing" -> "ended" -> (rematch) "playing" ...
//
// Seats: 2 to 4 (the game says how many). A seat is held by a human or by a bot.
// A human who drops keeps the seat for RECONNECT_GRACE_MS; a bot stands in meanwhile so the
// round goes on. After the grace, or when the human leaves on purpose, the bot keeps the seat.

import { makeRng } from "./rng.js";

export const RECONNECT_GRACE_MS = 30_000;
export const IDLE_SHUTDOWN_MS = 60_000;
/** A room where nobody has done anything for this long, outside a round, is closed: a forgotten tab. */
export const STALE_ROOM_MS = 20 * 60_000;
export const NAME_MAX = 14;
/** Shared screens one room keeps registered: every one is saved with the room, so they are capped. */
export const MAX_SCREENS = 4;
export const SEAT_COLOURS = ["#c8382c", "#2f6f8f", "#d9a02a", "#3f7a4a"]; // oxblood red, enamel blue, gilt yellow, bottle green
export const SEAT_COLOUR_NAMES = ["Red", "Blue", "Gold", "Green"];
const BOT_NAMES = ["Old Tom", "Mabel", "Fitch", "Dolly"];

/** Trims and bounds a nickname; returns "" when nothing printable is left. */
export function cleanName(raw) {
  return String(raw ?? "")
    .replace(/[\u0000-\u001f\u007f<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NAME_MAX);
}

/**
 * @typedef {object} PartyGame
 * @property {string} id
 * @property {number} minSeats
 * @property {number} maxSeats
 * @property {number} [tickHz]        how often the room ticks while playing (default 30)
 * @property {number} [snapshotEvery] send a full snapshot every N ticks (default 15)
 * @property {(ctx: {seed: number, seats: Array<{seat:number,name:string,kind:string}>, now: number, round: number}) => any} create
 * @property {(state: any, seat: number, input: any, now: number) => void} input
 * @property {(state: any, seat: number, now: number) => any[]} [bot]   inputs for a bot seat this tick
 * @property {(state: any, now: number) => any[]} tick     advances the game, returns events to broadcast
 * @property {(state: any, now: number) => any} snapshot
 * @property {(state: any) => boolean} isOver
 * @property {(state: any) => any} [result]
 */

export class RoomCore {
  /**
   * @param {{game: PartyGame, seed: number, code: string, now: number}} opts
   */
  constructor({ game, seed, code, now }) {
    this.game = game;
    this.seed = seed >>> 0;
    this.code = code;
    this.pin = null;
    this.phase = "lobby";
    this.round = 0;
    /** @type {Array<null | Seat>} */
    this.seats = new Array(game.maxSeats).fill(null);
    /** Screens watch the room without a seat (the shared big screen). token -> {connected} */
    this.screens = new Map();
    this.hostToken = null;
    this.state = null;
    this.result = null;
    this.startAt = 0;
    this.tickCount = 0;
    this.createdAt = now;
    this.emptySince = now;
    this.lastActive = now;
    this.rng = makeRng(`${this.seed}/room`);
  }

  // ---------------------------------------------------------------- joining

  /** Adds a human to the first free seat. During a match they take over a bot seat nobody is coming back to. */
  join(nickname, now, token = randomToken()) {
    const name = cleanName(nickname);
    if (!name) return fail("bad_name", "Pick a nickname first.");
    const freeBot = this.seats.findIndex((s) => s && s.kind === "bot" && !s.heldToken);
    let seat = this.phase === "playing" ? freeBot : this.seats.findIndex((s) => s === null);
    if (seat === -1 && this.phase !== "playing") seat = freeBot;
    if (seat === -1) {
      return this.phase === "playing" ? fail("in_progress", "A round is on. Join when it ends.") : fail("room_full", "This room is full.");
    }
    const taken = new Set(this.seats.filter(Boolean).map((s) => s.name.toLowerCase()));
    let unique = name;
    for (let n = 2; taken.has(unique.toLowerCase()); n++) unique = `${name.slice(0, NAME_MAX - 2)} ${n}`;
    this.seats[seat] = {
      seat,
      token,
      heldToken: null,
      name: unique,
      kind: "human",
      connected: false,
      ready: false,
      droppedAt: now, // not connected yet: the socket follows the join
      colour: SEAT_COLOURS[seat],
      character: null, // the lobby character slot: see README "Lobby characters"
    };
    if (!this.hostToken) this.hostToken = token;
    this.emptySince = null;
    return { ok: true, seat, token };
  }

  /** Registers a screen: it sees everything and holds no seat. */
  watch(now, token = randomToken()) {
    if (this.screens.size >= MAX_SCREENS) {
      // A screen that closed stays registered so it can come back; the oldest such one makes way.
      const gone = [...this.screens].find(([t, s]) => !s.connected && t !== this.hostToken);
      if (!gone) return fail("room_full", "This room has all the shared screens it can take.");
      this.screens.delete(gone[0]);
    }
    this.screens.set(token, { connected: false });
    if (!this.hostToken) this.hostToken = token;
    void now;
    return { ok: true, token };
  }

  /** Who a token belongs to: {role:"player", seat} | {role:"screen"} | null. */
  identify(token) {
    if (!token) return null;
    if (this.screens.has(token)) return { role: "screen", seat: -1 };
    const s = this.seats.find((x) => x && (x.token === token || x.heldToken === token));
    return s ? { role: "player", seat: s.seat } : null;
  }

  /** A socket opened for this token. Returns the identity, or null when the token is not valid (any more). */
  connect(token, now) {
    const who = this.identify(token);
    if (!who) return null;
    if (who.role === "screen") {
      this.screens.get(token).connected = true;
    } else {
      const s = this.seats[who.seat];
      if (s.heldToken === token) {
        // The human is back inside the grace: the stand-in bot hands the seat back.
        s.kind = "human";
        s.token = token;
        s.heldToken = null;
        s.name = s.heldName ?? s.name;
        s.heldName = null;
      }
      s.connected = true;
      s.droppedAt = null;
    }
    this.emptySince = null;
    this.lastActive = now;
    return who;
  }

  /** The last socket for this token closed. */
  disconnect(token, now) {
    const who = this.identify(token);
    if (!who) return;
    if (who.role === "screen") {
      this.screens.get(token).connected = false;
    } else {
      const s = this.seats[who.seat];
      if (s.kind !== "human") return;
      s.connected = false;
      s.droppedAt = now;
      s.ready = false;
      if (this.phase !== "lobby") this.standIn(s);
    }
    this.noteEmpty(now);
  }

  /** The player chose to leave: no grace. */
  leave(token, now) {
    const who = this.identify(token);
    if (!who) return;
    if (who.role === "screen") {
      this.screens.delete(token);
    } else {
      const s = this.seats[who.seat];
      if (this.phase === "lobby") this.seats[who.seat] = null;
      else {
        this.standIn(s);
        s.heldToken = null;
        s.heldName = null;
      }
    }
    if (this.hostToken === token) this.hostToken = this.nextHost();
    this.noteEmpty(now);
  }

  standIn(s) {
    s.heldToken = s.token;
    s.heldName = s.name;
    s.token = null;
    s.kind = "bot";
    s.connected = false;
    s.ready = true;
  }

  nextHost() {
    const human = this.seats.find((s) => s && s.kind === "human" && s.connected);
    if (human) return human.token;
    for (const [token, screen] of this.screens) if (screen.connected) return token;
    return null;
  }

  noteEmpty(now) {
    if (this.humansConnected() === 0 && this.emptySince === null) this.emptySince = now;
  }

  humansConnected() {
    let n = 0;
    for (const s of this.seats) if (s && s.kind === "human" && s.connected) n++;
    for (const screen of this.screens.values()) if (screen.connected) n++;
    return n;
  }

  // ---------------------------------------------------------------- lobby

  setReady(seat, ready) {
    const s = this.seats[seat];
    if (!s || s.kind !== "human" || this.phase === "playing") return false;
    s.ready = !!ready;
    return true;
  }

  rename(seat, nickname) {
    const s = this.seats[seat];
    const name = cleanName(nickname);
    if (!s || !name || this.phase !== "lobby") return false;
    s.name = name;
    return true;
  }

  /** Games can attach lobby character data to a seat (see README "Lobby characters"). */
  setCharacter(seat, character) {
    const s = this.seats[seat];
    if (!s) return false;
    s.character = character ?? null;
    return true;
  }

  addBot() {
    if (this.phase === "playing") return fail("in_progress", "A round is on.");
    const seat = this.seats.findIndex((s) => s === null);
    if (seat === -1) return fail("room_full", "Every seat is taken.");
    this.seats[seat] = botSeat(seat, this.seats);
    return { ok: true, seat };
  }

  removeBot(seat) {
    const s = this.seats[seat];
    if (!s || s.kind !== "bot" || s.heldToken || this.phase === "playing") return false;
    this.seats[seat] = null;
    return true;
  }

  /** Somebody did something (anything but a clock ping): the room is not forgotten. */
  touch(now) {
    this.lastActive = now;
  }

  /** True when a round may start: at least one human, and every connected human is ready. */
  canStart() {
    if (this.phase === "playing") return false;
    const humans = this.seats.filter((s) => s && s.kind === "human" && s.connected);
    return humans.length >= 1 && humans.every((s) => s.ready);
  }

  /** Starts a round (also the rematch). Empty seats up to the game's minimum are filled with bots. */
  start(now) {
    if (!this.canStart()) return fail("not_ready", "Everyone has to be ready first.");
    // In the lobby a human who never connected or dropped past the grace gives the seat up.
    for (const s of this.seats) {
      if (s && s.kind === "human" && !s.connected) this.seats[s.seat] = null;
    }
    while (this.seats.filter(Boolean).length < this.game.minSeats) {
      const seat = this.seats.findIndex((s) => s === null);
      this.seats[seat] = botSeat(seat, this.seats);
    }
    this.round += 1;
    this.phase = "playing";
    this.startAt = now;
    this.tickCount = 0;
    this.result = null;
    this.state = this.game.create({
      seed: this.roundSeed(),
      seats: this.seats.filter(Boolean).map((s) => ({ seat: s.seat, name: s.name, kind: s.kind })),
      now,
      round: this.round,
    });
    return { ok: true };
  }

  /** Each round draws from its own seed, derived from the room's. */
  roundSeed() {
    return (Math.imul(this.seed ^ 0x9e3779b9, this.round + 1) ^ (this.round * 40503)) >>> 0;
  }

  // ---------------------------------------------------------------- playing

  /** An input from a human seat. Bots and seats on stand-in are ignored here. */
  input(seat, data, now) {
    const s = this.seats[seat];
    if (this.phase !== "playing" || !s || s.kind !== "human") return false;
    this.game.input(this.state, seat, data, now);
    return true;
  }

  /**
   * Advances the room. Returns what to send: events, an optional snapshot, and flags.
   * Call it at the game's tick rate while playing, and every few seconds otherwise.
   */
  tick(now) {
    const out = { events: [], snapshot: null, ended: false, roomChanged: false, close: false };
    // The reconnect grace runs out: the seat is the bot's for good (or free again in the lobby).
    for (const s of this.seats) {
      if (!s) continue;
      if (s.kind === "bot" && s.heldToken && s.droppedAt !== null && now - s.droppedAt >= RECONNECT_GRACE_MS) {
        s.heldToken = null;
        s.heldName = null;
        s.droppedAt = null;
        s.name = botName(s.seat, this.seats);
        out.roomChanged = true;
      } else if (s.kind === "human" && !s.connected && s.droppedAt !== null && this.phase !== "playing" && now - s.droppedAt >= RECONNECT_GRACE_MS) {
        if (this.hostToken === s.token) this.hostToken = null;
        this.seats[s.seat] = null;
        out.roomChanged = true;
      }
    }
    if (!this.hostToken) {
      this.hostToken = this.nextHost();
      if (this.hostToken) out.roomChanged = true;
    }
    if (this.phase === "playing") {
      this.tickCount += 1;
      if (this.game.bot) {
        for (const s of this.seats) {
          if (!s || s.kind !== "bot") continue;
          for (const data of this.game.bot(this.state, s.seat, now) ?? []) this.game.input(this.state, s.seat, data, now);
        }
      }
      out.events = this.game.tick(this.state, now) ?? [];
      const every = this.game.snapshotEvery ?? 15;
      if (this.tickCount % every === 0) out.snapshot = this.game.snapshot(this.state, now);
      if (this.game.isOver(this.state)) {
        this.phase = "ended";
        this.result = this.game.result ? this.game.result(this.state) : null;
        out.snapshot = this.game.snapshot(this.state, now);
        out.ended = true;
        out.roomChanged = true;
        this.lastActive = now;
        for (const s of this.seats) if (s && s.kind === "human") s.ready = false;
      }
    }
    if (this.emptySince !== null && now - this.emptySince >= IDLE_SHUTDOWN_MS) out.close = "empty";
    else if (this.phase !== "playing" && now - this.lastActive >= STALE_ROOM_MS) out.close = "stale";
    return out;
  }

  /** When the room should next be woken if nothing else happens (for the alarm). */
  nextWake(now) {
    let at = this.phase === "playing" ? Infinity : this.lastActive + STALE_ROOM_MS;
    if (this.emptySince !== null) at = Math.min(at, this.emptySince + IDLE_SHUTDOWN_MS);
    for (const s of this.seats) {
      if (s && s.droppedAt !== null && !s.connected) at = Math.min(at, s.droppedAt + RECONNECT_GRACE_MS);
    }
    return at === Infinity ? null : Math.max(at, now + 50);
  }

  // ---------------------------------------------------------------- views

  /** What every client may know about the room. Tokens never leave the room. */
  view(now) {
    return {
      game: this.game.id,
      code: this.code,
      pin: this.pin,
      phase: this.phase,
      round: this.round,
      seed: this.seed,
      startAt: this.startAt,
      now,
      minSeats: this.game.minSeats,
      maxSeats: this.game.maxSeats,
      canStart: this.canStart(),
      hostSeat: this.seats.find((s) => s && s.token && s.token === this.hostToken)?.seat ?? -1,
      screens: [...this.screens.values()].filter((s) => s.connected).length,
      seats: this.seats.map((s) =>
        s
          ? {
              seat: s.seat,
              name: s.name,
              kind: s.kind,
              colour: s.colour,
              connected: s.kind === "bot" ? true : s.connected,
              ready: s.kind === "bot" ? true : s.ready,
              away: !!s.heldToken, // a human is expected back; the bot is standing in
              character: s.character,
            }
          : null,
      ),
      result: this.result,
    };
  }

  /** The lobby and the results screen survive the object being put to sleep; a running match does not. */
  serialize() {
    return {
      phase: this.phase === "ended" ? "ended" : "lobby",
      result: this.phase === "ended" ? this.result : null,
      lastActive: this.lastActive,
      seed: this.seed,
      code: this.code,
      pin: this.pin,
      round: this.round,
      seats: this.seats,
      screens: [...this.screens.keys()],
      hostToken: this.hostToken,
      createdAt: this.createdAt,
    };
  }

  static restore(game, data, now) {
    const room = new RoomCore({ game, seed: data.seed, code: data.code, now });
    room.pin = data.pin;
    room.round = data.round;
    room.createdAt = data.createdAt;
    room.hostToken = data.hostToken;
    room.phase = data.phase === "ended" ? "ended" : "lobby";
    room.result = data.result ?? null;
    room.lastActive = data.lastActive ?? now;
    room.seats = data.seats.map((s) => (s ? { ...s, connected: false, droppedAt: s.kind === "human" ? now : s.droppedAt } : null));
    for (const token of data.screens) room.screens.set(token, { connected: false });
    room.emptySince = now;
    return room;
  }
}

function botName(seat, seats) {
  const taken = new Set(seats.filter(Boolean).map((s) => s.name));
  return BOT_NAMES.find((n) => !taken.has(n)) ?? `Bot ${seat + 1}`;
}

function botSeat(seat, seats) {
  return {
    seat,
    token: null,
    heldToken: null,
    name: botName(seat, seats),
    kind: "bot",
    connected: true,
    ready: true,
    droppedAt: null,
    colour: SEAT_COLOURS[seat],
    character: null,
  };
}

function fail(error, message) {
  return { ok: false, error, message };
}

export function randomToken() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/**
 * A delay line for simulated latency: items come out in order, each `lagMs` after it went in.
 * `setTimer(fn, ms)` is injectable so tests can drive time by hand.
 */
export class LagLine {
  constructor(lagMs, deliver, setTimer = (fn, ms) => setTimeout(fn, ms)) {
    this.lagMs = Math.max(0, Math.min(2000, Number(lagMs) || 0));
    this.deliver = deliver;
    this.setTimer = setTimer;
  }
  push(item) {
    if (this.lagMs === 0) return this.deliver(item);
    this.setTimer(() => this.deliver(item), this.lagMs);
  }
}
