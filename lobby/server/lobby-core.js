// The party room, as plain logic with no network and no clock of its own.
// The Durable Object (lobby-room.js) owns one LobbyCore, feeds it joins, sockets, messages and
// wake-ups, and sends whatever it returns. Tests drive it directly with a fake clock.
//
// A room holds one current activity: the lobby, or a game.
//
//   lobby   Up to four players are pieces in a side-view room. Standing in a game's light is a
//           vote for it. When every connected player stands in some light a count runs; when
//           it ends the game with the most players starts, and a tie is settled by a coin toss.
//   game    One of the hosted games, started with the party's seats. When it is over its
//           places become points on the Tonight board and everyone is back in the lobby.
//
// Nothing here ticks while people merely stand around: the room is told where a piece is and
// which way it walks, and works out the rest (lobby/shared/world.js). Everything that depends
// on time (the count, the toss, a dropped phone's grace, closing) is a wake-up: nextWake().
import { makeRng } from "../../party-kit/src/core/rng.js";
import { IDLE_SHUTDOWN_MS, MAX_SCREENS, NAME_MAX, RECONNECT_GRACE_MS, SEAT_COLOURS, STALE_ROOM_MS, cleanName, randomToken } from "../../party-kit/src/core/room-core.js";
import { COUNT_MS, SETTLE_MS, TOSS_MS, leaders, pointsForPlace, standingsFromRows, tally, whyNot } from "../shared/vote.js";
import { BUMP_COOLDOWN_MS, BUMP_PUSH, POSITION_SLACK, bumpTarget, clampX, lightAt, posAt, spawnX } from "../shared/world.js";

export const MAX_PLAYERS = 4;
/** A room is closed this long after it was made, whatever is going on: a party, not a tenancy. */
export const MAX_ROOM_LIFE_MS = 4 * 60 * 60_000;
/** When the hosting allowance is spent, open rooms are told and close this much later. */
export const BUDGET_CLOSE_MS = 3 * 60_000;
/** How many people who left are remembered by name, so coming back restores their points. */
const MAX_REMEMBERED = 12;

export class LobbyCore {
  /**
   * @param {{boxes: object[], games: Map<string, object>, seed: number, code: string, now: number}} opts
   *   boxes: the wall, in order (lobby/shared/vote.js, boxFromManifest).
   *   games: the server definition of every box that can actually start, by id.
   */
  constructor({ boxes, games, seed, code, now }) {
    this.boxes = boxes;
    this.games = games;
    this.seed = seed >>> 0;
    this.code = code;
    this.pin = null;
    /** @type {Array<null | object>} */
    this.members = new Array(MAX_PLAYERS).fill(null);
    /** Screens show the room and hold no seat. token -> {connected} */
    this.screens = new Map();
    /** {kind: "lobby"} or {kind: "game", id, state, startedAt, ticks, seats} */
    this.activity = { kind: "lobby" };
    this.round = 0;
    this.gamesPlayed = 0;
    /** The last game's result, for the card everyone sees on the way back. */
    this.last = null;
    /** null, or {endsAt}: everyone is in a light. */
    this.count = null;
    /** null, or {between, winner, endsAt}: a tie is being tossed for. */
    this.toss = null;
    this.holdUntil = 0;
    /** null, or {at, reason}: the room has been told it will close. */
    this.closing = null;
    /** lower-case name -> points, for people who left and may come back. */
    this.remembered = new Map();
    this.notes = [];
    this.voteKey = "";
    this.createdAt = now;
    this.emptySince = now;
    this.lastActive = now;
    this.rng = makeRng(`${this.seed}/lobby/${now}`);
  }

  // ---------------------------------------------------------------- coming and going

  /** Adds a player to the first free seat, by the door. Works at any time, mid-vote included. */
  join(nickname, now, token = randomToken()) {
    const name = cleanName(nickname);
    if (!name) return fail("bad_name", "Pick a nickname first.");
    const seat = this.members.findIndex((m) => m === null);
    if (seat === -1) return fail("room_full", "This party is full: four players at most.");
    const taken = new Set(this.present().map((m) => m.name.toLowerCase()));
    let unique = name;
    for (let n = 2; taken.has(unique.toLowerCase()); n++) unique = `${name.slice(0, NAME_MAX - 2)} ${n}`;
    const points = this.remembered.get(unique.toLowerCase()) ?? 0;
    this.remembered.delete(unique.toLowerCase());
    this.members[seat] = {
      seat,
      token,
      name: unique,
      colour: SEAT_COLOURS[seat],
      connected: false,
      droppedAt: now, // not connected yet: the socket follows the join
      x: spawnX(seat, this.boxes.length),
      d: 0,
      t: now,
      face: 1,
      rev: 0,
      bumpAt: -Infinity,
      points,
    };
    this.emptySince = null;
    this.lastActive = now;
    return { ok: true, seat, token };
  }

  /** Registers a big screen: it shows the room and holds no seat. */
  watch(now, token = randomToken()) {
    if (this.screens.size >= MAX_SCREENS) {
      // A screen that closed stays registered so it can come back; the oldest such one makes way.
      const gone = [...this.screens].find(([, s]) => !s.connected);
      if (!gone) return fail("room_full", "This party has all the screens it can take.");
      this.screens.delete(gone[0]);
    }
    this.screens.set(token, { connected: false });
    this.lastActive = now;
    return { ok: true, token };
  }

  /** Who a token belongs to: {role: "player", seat} | {role: "screen", seat: -1} | null. */
  identify(token) {
    if (!token) return null;
    if (this.screens.has(token)) return { role: "screen", seat: -1 };
    const m = this.members.find((x) => x && x.token === token);
    return m ? { role: "player", seat: m.seat } : null;
  }

  /** A socket opened for this token. Returns the identity, or null when the token is not valid (any more). */
  connect(token, now) {
    const who = this.identify(token);
    if (!who) return null;
    if (who.role === "screen") {
      this.screens.get(token).connected = true;
    } else {
      const m = this.members[who.seat];
      if (!m.connected) this.count = null;
      m.connected = true;
      m.droppedAt = null;
    }
    this.emptySince = null;
    this.lastActive = now;
    return who;
  }

  /**
   * After the room slept: this token's socket is still open, so its owner never left. `piece`
   * is what the socket carried through the sleep: where the piece was and which way it walked.
   */
  resume(token, piece) {
    const who = this.identify(token);
    if (!who) return null;
    if (who.role === "screen") {
      this.screens.get(token).connected = true;
    } else {
      const m = this.members[who.seat];
      m.connected = true;
      m.droppedAt = null;
      // The socket's copy is never older than the saved one: it is rewritten on every move.
      if (piece) Object.assign(m, { x: piece.x, d: piece.d, t: piece.t, face: piece.face, rev: piece.rev });
    }
    this.emptySince = null;
    return who;
  }

  /** What a socket has to carry for resume(): the seat's piece as last heard. */
  pieceOf(seat) {
    const m = this.members[seat];
    return m ? { x: m.x, d: m.d, t: m.t, face: m.face, rev: m.rev } : null;
  }

  /** The last socket for this token closed: the piece stays where it is, grey, for the grace. */
  disconnect(token, now) {
    const who = this.identify(token);
    if (!who) return;
    if (who.role === "screen") {
      this.screens.get(token).connected = false;
    } else {
      const m = this.members[who.seat];
      if (!m.connected) return;
      m.x = posAt(m, now);
      m.d = 0;
      m.t = now;
      m.connected = false;
      m.droppedAt = now;
      // Who is voting has changed, so the count starts over.
      this.count = null;
    }
    this.noteEmpty(now);
  }

  /** The player chose "Leave the party": no grace. */
  leave(token, now) {
    const who = this.identify(token);
    if (!who) return;
    if (who.role === "screen") this.screens.delete(token);
    else this.remove(this.members[who.seat], "left");
    this.noteEmpty(now);
  }

  remove(m, why) {
    if (m.points > 0) {
      this.remembered.set(m.name.toLowerCase(), m.points);
      while (this.remembered.size > MAX_REMEMBERED) this.remembered.delete(this.remembered.keys().next().value);
    }
    this.members[m.seat] = null;
    this.count = null;
    this.notes.push({ k: "left", why, name: m.name, colour: m.colour });
  }

  present() {
    return this.members.filter(Boolean);
  }

  connected() {
    return this.members.filter((m) => m && m.connected);
  }

  screensConnected() {
    let n = 0;
    for (const screen of this.screens.values()) if (screen.connected) n++;
    return n;
  }

  noteEmpty(now) {
    if (this.connected().length + this.screensConnected() === 0 && this.emptySince === null) this.emptySince = now;
  }

  /** What was said since the last call ("Tom left"), for the room to pass on. */
  drainNotes() {
    return this.notes.splice(0);
  }

  // ---------------------------------------------------------------- the lobby

  /**
   * A player says where their piece is and which way it walks. Returns {relay, fix}: `relay`
   * goes to everyone else, `fix` (or null) back to the sender when the room did not believe it.
   * Returns null when there is nothing to pass on.
   */
  move(seat, data, now) {
    const m = this.members[seat];
    if (!m || this.activity.kind !== "lobby" || !data) return null;
    if (typeof data.x !== "number" || !Number.isFinite(data.x)) return null;
    // Sent before the player's page heard that the room had moved the piece: out of date.
    if ((data.r ?? 0) !== m.rev) return null;
    const d = data.d === 1 ? 1 : data.d === -1 ? -1 : 0;
    const expected = posAt(m, now);
    let x = clampX(data.x);
    let fix = null;
    if (Math.abs(x - expected) > POSITION_SLACK) {
      x = expected;
      m.rev += 1;
      fix = { t: "fix", x: Math.round(x), rev: m.rev };
    }
    m.x = x;
    m.d = d;
    m.t = now;
    if (d) m.face = d;
    this.lastActive = now;
    const relay = { t: "m", s: seat, x: Math.round(x), d };
    if (data.j) relay.j = 1;
    return { relay, fix };
  }

  /**
   * A bump: the room decides who, if anyone, it lands on, and nudges them. Everyone has it and
   * it is weak. Returns the message for everybody, or null inside the cooldown.
   */
  bump(seat, now) {
    const m = this.members[seat];
    if (!m || this.activity.kind !== "lobby") return null;
    if (now - m.bumpAt < BUMP_COOLDOWN_MS - 150) return null;
    m.bumpAt = now;
    this.lastActive = now;
    const others = this.present()
      .filter((o) => o.seat !== seat)
      .map((o) => ({ seat: o.seat, x: posAt(o, now) }));
    const to = bumpTarget(posAt(m, now), m.face, others);
    if (to === -1) return { t: "b", s: seat, f: m.face, to: -1 };
    const o = this.members[to];
    o.x = clampX(posAt(o, now) + m.face * BUMP_PUSH);
    o.t = now;
    o.rev += 1;
    return { t: "b", s: seat, f: m.face, to, x: Math.round(o.x), rev: o.rev };
  }

  /** Connected players and connected big screens: what decides which games can be played. */
  party() {
    return { players: this.connected().length, screens: this.screensConnected() };
  }

  /** {boxId: null (its light is on) or the reason it is off}. */
  lights() {
    const party = this.party();
    return Object.fromEntries(this.boxes.map((box) => [box.id, whyNot(box, party)]));
  }

  /** {seat: the box whose light that piece stands in, or null for the dark}. A switched-off light is the dark. */
  standing(now) {
    const lights = this.lights();
    const out = {};
    for (const m of this.present()) {
      const box = this.boxes[lightAt(posAt(m, now), this.boxes.length)];
      out[m.seat] = box && lights[box.id] === null ? box.id : null;
    }
    return out;
  }

  /**
   * Looks at where everyone stands and starts or stops the count. Call it after anything that
   * could change the vote. Returns {view, state}: `view` when what the players see has changed,
   * `state` when the count itself started or stopped (which is worth saving).
   */
  evaluate(now) {
    const before = this.count?.endsAt ?? 0;
    if (this.activity.kind === "lobby" && !this.toss) {
      const standing = this.standing(now);
      const voters = this.connected();
      const ready = voters.length > 0 && voters.every((m) => standing[m.seat]) && now >= this.holdUntil && !this.closing;
      if (ready && !this.count) this.count = { endsAt: now + COUNT_MS };
      else if (!ready && this.count) this.count = null;
    }
    const view = this.voteView(now);
    const key = JSON.stringify([view.standing, view.lights, this.count?.endsAt ?? 0, this.toss?.endsAt ?? 0]);
    const changed = key !== this.voteKey;
    this.voteKey = key;
    return { view: changed, state: (this.count?.endsAt ?? 0) !== before };
  }

  /** The vote as the players see it. Times are given as "in so many milliseconds", so no clocks need to agree. */
  voteView(now) {
    const standing = this.standing(now);
    const order = this.boxes.map((box) => box.id);
    return {
      lights: this.lights(),
      standing,
      waiting: this.activity.kind === "lobby" ? this.connected().filter((m) => !standing[m.seat]).map((m) => m.seat) : [],
      leaders: leaders(tally(standing), order),
      count: this.count ? { endsIn: Math.max(0, this.count.endsAt - now) } : null,
      toss: this.toss ? { between: this.toss.between, winner: this.toss.winner, endsIn: Math.max(0, this.toss.endsAt - now), of: TOSS_MS } : null,
    };
  }

  /**
   * A wake-up: lets time-dependent things happen. Returns {start, close, changed}: `start` is
   * the game the vote chose (the room then calls startGame, or refuseStart when the hosting
   * allowance is spent), `close` is why the room should shut, `changed` that the view moved on.
   */
  tick(now) {
    const out = { start: null, close: null, changed: false };
    const inLobby = this.activity.kind === "lobby";
    if (inLobby) {
      // A dropped phone's grace runs out: the piece fades and its vote stops counting.
      for (const m of this.present()) {
        if (!m.connected && m.droppedAt !== null && now - m.droppedAt >= RECONNECT_GRACE_MS) {
          this.remove(m, "dropped");
          out.changed = true;
        }
      }
      if (this.toss && now >= this.toss.endsAt) {
        // Somebody may have left during the toss; a game the party can no longer play does not start.
        if (this.lights()[this.toss.winner] === null) out.start = this.toss.winner;
        this.toss = null;
        out.changed = true;
      } else if (this.count && now >= this.count.endsAt) {
        const top = leaders(
          tally(this.standing(now)),
          this.boxes.map((box) => box.id),
        );
        if (top.length === 1) out.start = top[0];
        else if (top.length > 1) this.toss = { between: top, winner: this.rng.pick(top), endsAt: now + TOSS_MS };
        this.count = null;
        out.changed = true;
      }
      if (out.start) {
        this.count = null;
        this.toss = null;
      }
    }
    if (this.emptySince !== null && now - this.emptySince >= IDLE_SHUTDOWN_MS) out.close = "empty";
    else if (inLobby && !out.start) {
      if (now - this.lastActive >= STALE_ROOM_MS) out.close = "stale";
      else if (now - this.createdAt >= MAX_ROOM_LIFE_MS) out.close = "expired";
      else if (this.closing && now >= this.closing.at) out.close = this.closing.reason;
    }
    return out;
  }

  /** The hosting allowance is spent: no game starts, and the room will close after a few minutes. */
  refuseStart(now, reason = "budget") {
    this.count = null;
    this.toss = null;
    this.setClosing(now, reason);
  }

  setClosing(now, reason) {
    if (!this.closing) this.closing = { at: now + BUDGET_CLOSE_MS, reason };
    this.count = null;
  }

  /** When the room should next be woken if nothing else happens (for the alarm), or null. */
  nextWake(now) {
    let at = Infinity;
    if (this.emptySince !== null) at = Math.min(at, this.emptySince + IDLE_SHUTDOWN_MS);
    if (this.activity.kind === "lobby") {
      at = Math.min(at, this.lastActive + STALE_ROOM_MS, this.createdAt + MAX_ROOM_LIFE_MS);
      if (this.closing) at = Math.min(at, this.closing.at);
      if (this.count) at = Math.min(at, this.count.endsAt);
      if (this.toss) at = Math.min(at, this.toss.endsAt);
      // The rest after a game: a count may be due the moment it is over.
      if (this.holdUntil > now) at = Math.min(at, this.holdUntil);
      for (const m of this.present()) if (!m.connected && m.droppedAt !== null) at = Math.min(at, m.droppedAt + RECONNECT_GRACE_MS);
    }
    return at === Infinity ? null : Math.max(at, now + 20);
  }

  // ---------------------------------------------------------------- a game

  /**
   * Starts a game with the party's seats. Returns {ok, ended}: `ended` is set when the game was
   * over the moment it began (a stand-in), otherwise null and the room ticks it.
   */
  startGame(id, now) {
    const game = this.games.get(id);
    if (!game || this.activity.kind !== "lobby") return fail("not_found", "That game cannot start here.");
    const seats = this.present().map((m) => ({ seat: m.seat, name: m.name, kind: "human", colour: m.colour }));
    if (!seats.length) return fail("not_ready", "Nobody is here to play.");
    this.round += 1;
    this.count = null;
    this.toss = null;
    const seed = (Math.imul(this.seed ^ 0x9e3779b9, this.round + 1) ^ (this.round * 40503)) >>> 0;
    const state = game.create({ seed, seats, now, round: this.round });
    this.activity = { kind: "game", id, state, startedAt: now, ticks: 0, seats: seats.map((s) => s.seat) };
    this.lastActive = now;
    return { ok: true, ended: game.isOver(state) ? this.finishGame(now) : null };
  }

  /** An input from a player in the game. Seats that joined after it started just watch. */
  gameInput(seat, data, now) {
    const a = this.activity;
    if (a.kind !== "game" || !a.seats.includes(seat) || !this.members[seat]?.connected) return false;
    this.games.get(a.id).input(a.state, seat, data, now);
    return true;
  }

  /** Advances the game. Returns {events, snapshot, ended}; call it at the game's tick rate. */
  gameTick(now) {
    const a = this.activity;
    const out = { events: [], snapshot: null, ended: null };
    if (a.kind !== "game") return out;
    const game = this.games.get(a.id);
    a.ticks += 1;
    if (game.bot) {
      // A seat whose player dropped is played by the game's own stand-in, so the round can finish.
      for (const seat of a.seats) {
        if (this.members[seat]?.connected) continue;
        for (const data of game.bot(a.state, seat, now) ?? []) game.input(a.state, seat, data, now);
      }
    }
    out.events = game.tick(a.state, now) ?? [];
    if (a.ticks % (game.snapshotEvery ?? 15) === 0) out.snapshot = game.snapshot(a.state, now);
    if (game.isOver(a.state)) {
      out.snapshot = game.snapshot(a.state, now);
      out.ended = this.finishGame(now);
    }
    return out;
  }

  /** The game is over: its places become points, and everyone is back by the door. */
  finishGame(now) {
    const a = this.activity;
    const game = this.games.get(a.id);
    const result = game.result ? game.result(a.state) : null;
    const places = game.standings ? game.standings(a.state) : standingsFromRows(result);
    const rows = [];
    for (const { seat, place } of places ?? []) {
      const m = this.members[seat];
      if (!m || !a.seats.includes(seat) || !(place >= 1) || rows.some((r) => r.seat === seat)) continue;
      const points = pointsForPlace(place);
      m.points += points;
      rows.push({ seat, name: m.name, colour: m.colour, place, points });
    }
    rows.sort((p, q) => p.place - q.place || p.seat - q.seat);
    if (rows.length) this.gamesPlayed += 1;
    this.last = { round: this.round, game: a.id, name: this.boxes.find((box) => box.id === a.id)?.name ?? a.id, rows, note: game.note ?? null, at: now };
    this.activity = { kind: "lobby" };
    for (const m of this.present()) {
      m.x = spawnX(m.seat, this.boxes.length);
      m.d = 0;
      m.t = now;
      m.rev += 1;
    }
    this.holdUntil = now + SETTLE_MS;
    this.lastActive = now;
    return { result, last: this.last };
  }

  // ---------------------------------------------------------------- views

  /** What every client may know about the room. Tokens never leave the room. */
  view(now) {
    const a = this.activity;
    return {
      kind: "party",
      code: this.code,
      pin: this.pin,
      // The kit's client paces its pings by this: "playing" while a game is on.
      phase: a.kind === "game" ? "playing" : "lobby",
      game: a.kind === "game" ? { id: a.id, name: this.boxes.find((box) => box.id === a.id)?.name ?? a.id, round: this.round } : null,
      boxes: this.boxes,
      members: this.members.map((m) =>
        m ? { seat: m.seat, name: m.name, colour: m.colour, connected: m.connected, x: Math.round(posAt(m, now)), d: m.d, rev: m.rev, points: m.points } : null,
      ),
      screens: this.screensConnected(),
      vote: this.voteView(now),
      tonight: { games: this.gamesPlayed },
      last: this.last ? { ...this.last, ago: now - this.last.at } : null,
      closesIn: Math.max(0, this.createdAt + MAX_ROOM_LIFE_MS - now),
      closing: this.closing ? { in: Math.max(0, this.closing.at - now), reason: this.closing.reason } : null,
    };
  }

  /** The room survives being put to sleep; a game in progress does not (it is short, and held awake). */
  serialize() {
    return {
      seed: this.seed,
      code: this.code,
      pin: this.pin,
      members: this.members,
      screens: [...this.screens.keys()],
      round: this.round,
      gamesPlayed: this.gamesPlayed,
      last: this.last,
      count: this.count,
      toss: this.toss,
      holdUntil: this.holdUntil,
      closing: this.closing,
      remembered: [...this.remembered],
      createdAt: this.createdAt,
      lastActive: this.lastActive,
    };
  }

  static restore(config, data, now) {
    const room = new LobbyCore({ ...config, seed: data.seed, code: data.code, now });
    room.pin = data.pin;
    // Nobody is connected until their socket is seen again; a piece left mid-stride stands still.
    room.members = data.members.map((m) => (m ? { ...m, x: m.d ? posAt(m, now) : m.x, d: 0, t: now, connected: false, droppedAt: m.droppedAt ?? now, bumpAt: -Infinity } : null));
    for (const token of data.screens) room.screens.set(token, { connected: false });
    room.round = data.round;
    room.gamesPlayed = data.gamesPlayed;
    room.last = data.last ?? null;
    room.count = data.count ?? null;
    room.toss = data.toss ?? null;
    room.holdUntil = data.holdUntil ?? 0;
    room.closing = data.closing ?? null;
    room.remembered = new Map(data.remembered ?? []);
    room.createdAt = data.createdAt;
    room.lastActive = data.lastActive ?? now;
    room.emptySince = now;
    return room;
  }
}

function fail(error, message) {
  return { ok: false, error, message };
}
