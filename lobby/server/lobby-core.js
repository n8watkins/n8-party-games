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
// An outside game (a box with a `url`) is never an activity: when it wins the vote the room says
// so, every page goes to the game's own site, and the room is left to empty and close.
//
// Nothing here ticks while people merely stand around: the room is told where a piece is and
// which way it walks, and works out the rest (lobby/shared/world.js). Everything that depends
// on time (the count, the toss, a dropped phone's grace, closing) is a wake-up: nextWake().
//
// A game runs one of two ways (party-kit/src/core/turns.js):
//   ticking     a game with a tick rate (Cork & Bell) is ticked on the room's timer for the whole
//               round (gameTick), and is not saved: a restart ends it.
//   turn-based  a game with `tickHz: 0` is never ticked on a timer. An input is applied at once
//               (playTurn), its deadline is one more wake-up (nextWake, then gameDeadline), and
//               the game is saved with the room (serialize), so it survives a sleep or a deploy.
//               It is humans only: nobody stands in for a player. A seat whose phone dropped is
//               held for the game's grace, the game is told of every change in who is here
//               (turnUpkeep, game.presence), and a seat gone for good ends the game early
//               (game.abandon). While it is played the room's lifetimes are the game's own.
//
// A game with settings (`game.settings`, party-kit/src/core/settings.js) does not start the moment
// it wins the vote: the room's activity is first `settings`, a short step in which the party's
// host picks them (chooseSettings) and starts the game (startChosen), or goes back to the room
// (cancelSettings). Its time limit is one more wake-up; when it comes the game starts with the
// picks as they stand. A game that leaves something for a rematch (`game.carry`) has it kept for
// the same people in the same seats (carries), and the last settings chosen for a game are the
// first picks the next time it wins (lastSettings).
import { ID_REUSED, answerOf, inputDigest, lookup, remember } from "../../party-kit/src/core/answers.js";
import { hasAudience, needsSpots, openSpots, spotSeats, spotsFull, takeSpots, validSpots } from "../../party-kit/src/core/audience.js";
import { makeRng } from "../../party-kit/src/core/rng.js";
import { abandonOutcome, goneWhy, graceEndsAt, graceOf, lifetimesOf, presenceOutcome, reportOf, sameReport } from "../../party-kit/src/core/presence.js";
import { applyChange, carryFor, carryOf, checkSettings, fieldDefaults, hasCarry, hasSettings, seatsKey, settingFields, settingsProblems } from "../../party-kit/src/core/settings.js";
import { copyState, deadlineOf, gameProblems, inputOutcome, isTurnBased, loadState, saveState, stateKey } from "../../party-kit/src/core/turns.js";
import { viewerFor } from "../../party-kit/src/core/views.js";
import { IDLE_SHUTDOWN_MS, NAME_MAX, SEAT_COLOURS, STALE_ROOM_MS, cleanName, randomToken } from "../../party-kit/src/core/room-core.js";
import { AWAY_MS, COUNT_MS, SETTLE_MS, TOSS_MS, leaders, pointsForPlace, spotLights, standingsFromRows, tally, whyNot } from "../shared/vote.js";
import { bumpTarget, cooldownLeft, isDown, isSafe, knockLanding, knocked, mayBump } from "../shared/bump.js";
import { DEFAULT_ROOM, ROOM_COOLDOWN_MS, isRoom, roomLocked } from "../shared/rooms.js";
import { record } from "../shared/tonight.js";
import { DURING_PLAY, cooldownLeft as emoteLeft, mayEmote, relayEmote, waitMessage } from "../../party-kit/client/emotes.js";
import { POSITION_SLACK, clampX, lightAt, posAt, spawnX } from "../shared/world.js";

export const MAX_PLAYERS = 4;
/** A room is closed this long after it was made, whatever is going on: a party, not a tenancy. */
export const MAX_ROOM_LIFE_MS = 4 * 60 * 60_000;
/** When the hosting allowance is spent, open rooms are told and close this much later. */
export const BUDGET_CLOSE_MS = 3 * 60_000;
/**
 * A room has one screen. When it drops, its place is kept this long (a reload, a wifi blip)
 * before another device may take it. Nothing is timed: it is looked at when somebody asks.
 */
export const SCREEN_GRACE_MS = 15_000;
/**
 * A phone that drops: its piece turns grey at once (the room hears the socket close, or the page
 * closes it when the phone is locked or put away), and if it is not back this long later the
 * piece fades and the room says "Nat left". The vote carries on without it from the drop.
 */
export const DROP_FADE_MS = 12_000;
/**
 * But its seat, points and name are kept this much longer: a phone that comes back within it
 * (unlocked, signal back) is seated again by the door, as itself, without going through the way
 * in. An empty room with a seat held waits for it this long before it closes.
 */
export const SEAT_HOLD_MS = 120_000;
/**
 * A turn-based game that does not choose its own grace (`game.reconnectGraceMs`) holds a dropped
 * seat this long before the game ends without it: the same as a seat held in the lobby.
 */
export const TURN_GRACE_MS = SEAT_HOLD_MS;
/**
 * How long the host has to choose a game's settings once it has won the vote. Then the game
 * starts with the picks as they stand: the defaults, or the last match's, unless the host changed them.
 */
export const SETTINGS_MS = 90_000;
/** How many people who left are remembered by name, so coming back restores their points. */
const MAX_REMEMBERED = 12;

export class LobbyCore {
  /**
   * @param {{boxes: object[], games: Map<string, object>, fields?: Map<string, object[]>, seed: number, code: string, now: number}} opts
   *   boxes: the wall, in order (lobby/shared/vote.js, boxFromManifest).
   *   games: the server definition of every box that can actually start, by id.
   *   fields: each game's settings as its manifest describes them (`manifest.settings`), by id.
   *     They reach the pages only in the settings step's `choosing`; a box says only `settings: true`.
   */
  constructor({ boxes, games, fields = new Map(), seed, code, now }) {
    this.boxes = boxes;
    this.games = games;
    this.fields = fields;
    this.fieldCache = new Map();
    this.seed = seed >>> 0;
    this.code = code;
    this.pin = null;
    /** @type {Array<null | object>} */
    this.members = new Array(MAX_PLAYERS).fill(null);
    /** The room's screen: it shows the room and holds no seat. There is one at most. token -> {connected, droppedAt} */
    this.screens = new Map();
    /**
     * {kind: "lobby"}, {kind: "settings", id, picks, seats, players, endsAt, startedAt} (the host
     * is choosing a game's settings; `players` is each seat's token, so only they play) or {kind: "game", id, state, startedAt, ticks, seats}
     */
    this.activity = { kind: "lobby" };
    /** {gameId: {seats, carry}}: what the last game of each left for a rematch, and for whom (settings.js, seatsKey). */
    this.carries = {};
    /** {gameId: settings}: the last settings each game was started with, the first picks next time. */
    this.lastSettings = {};
    /** Set by restore when a turn-based game was saved and could not be brought back. */
    this.lost = false;
    /**
     * null, or {round, answers}: the answers to inputs with ids in the turn-based game that just
     * ended, so the winning tap sent twice is answered again, not refused. Kept until the next game.
     */
    this.lastAnswers = null;
    this.round = 0;
    this.gamesPlayed = 0;
    /** The games played tonight and who won each, oldest first (lobby/shared/tonight.js). */
    this.history = [];
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
    /** token -> {seat, name, points, at}: seats of dropped players held after their piece faded (SEAT_HOLD_MS). */
    this.held = new Map();
    this.notes = [];
    this.voteKey = "";
    this.createdAt = now;
    this.emptySince = now;
    this.lastActive = now;
    this.rng = makeRng(`${this.seed}/lobby/${now}`);
    /** Which room the party is in (lobby/shared/rooms.js): one choice everyone sees. */
    this.room = DEFAULT_ROOM;
    /** When the room was last changed: the next change waits ROOM_COOLDOWN_MS. */
    this.roomAt = -Infinity;
    /**
     * Who picks the room: the device that made the party (a player or the room's screen). When
     * it leaves for good the first player still here takes over; while it is only dropped, the
     * first connected player picks for it (pickerToken).
     */
    this.hostToken = null;
  }

  // ---------------------------------------------------------------- coming and going

  /** Adds a player to the first free seat, by the door. Works at any time, mid-vote included. */
  join(nickname, now, token = randomToken(), wantSeat = -1) {
    const name = cleanName(nickname);
    if (!name) return fail("bad_name", "Pick a nickname first.");
    // While a game is on, a seat somebody left in the middle of it is still the game's (a
    // ticking game's stand-in is playing it): a newcomer is never given that seat. The same holds
    // for the seats a settings step was opened for: whoever joins during it watches the game.
    const inPlay = this.activity.kind === "game" || this.activity.kind === "settings" ? this.activity.seats : [];
    const free = (i) => this.members[i] === null && !inPlay.includes(i);
    const seat = wantSeat >= 0 && free(wantSeat) ? wantSeat : this.members.findIndex((m, i) => free(i));
    if (seat === -1 && this.members.includes(null)) return fail("room_full", "A game is on and its seats are taken. Join when it ends.");
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
      emoteAt: -Infinity,
      stunUntil: 0,
      immuneUntil: 0,
      points,
    };
    this.emptySince = null;
    this.lastActive = now;
    this.hostToken ??= token;
    return { ok: true, seat, token };
  }

  /**
   * Makes a device the room's screen: it shows the room and holds no seat. A room has one. A
   * second device that asks is told so, and can join as a player instead.
   */
  watch(now, token = randomToken()) {
    if (this.screenHeld(now)) return fail("screen_taken", "This party already has its screen. You can join as a player instead.");
    // A screen that has been gone longer than the grace makes way; its token is no longer good.
    if (this.screens.has(this.hostToken)) this.hostToken = this.nextHost();
    this.screens.clear();
    this.screens.set(token, { connected: false, droppedAt: now }); // not connected yet: the socket follows
    this.lastActive = now;
    this.hostToken ??= token;
    return { ok: true, token };
  }

  /** Whether the screen's place is taken: one is connected, or dropped less than the grace ago. */
  screenHeld(now) {
    for (const screen of this.screens.values()) if (screen.connected || now - (screen.droppedAt ?? now) < SCREEN_GRACE_MS) return true;
    return false;
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
    const who = this.identify(token) ?? this.reclaim(token, now);
    if (!who) return null;
    if (who.role === "screen") {
      Object.assign(this.screens.get(token), { connected: true, droppedAt: null });
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
      Object.assign(this.screens.get(token), { connected: true, droppedAt: null });
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
      const screen = this.screens.get(token);
      // Told twice of the same drop, the grace still runs from the first.
      if (screen.connected || screen.droppedAt === null) Object.assign(screen, { connected: false, droppedAt: now });
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

  /**
   * Whether a player's page is hidden while its socket stays open (a desktop tab put behind
   * another; the room's page closes its socket instead when a phone is locked). The room works
   * it out from every open socket of the token (presence.js, allAway). Returns whether it changed.
   * It changes nothing in the lobby; a turn-based game is told of it (turnUpkeep).
   */
  setAway(token, away) {
    const who = this.identify(token);
    if (!who || who.role !== "player") return false;
    const m = this.members[who.seat];
    if (!!m.away === !!away) return false;
    m.away = !!away;
    return true;
  }

  /**
   * A dropped player whose piece faded is back within SEAT_HOLD_MS: seated again by the door with
   * the same name, points and token, in the same seat if it is free. Null when it is too late or
   * the party is full.
   */
  reclaim(token, now) {
    const held = token && this.held.get(token);
    if (!held) return null;
    this.held.delete(token);
    if (now - held.at > SEAT_HOLD_MS) return null;
    if (held.points > 0) this.remembered.set(held.name.toLowerCase(), held.points);
    const taken = new Set(this.present().map((m) => m.name.toLowerCase()));
    const joined = this.join(taken.has(held.name.toLowerCase()) ? `${held.name.slice(0, NAME_MAX - 2)} 2` : held.name, now, token, held.seat);
    return joined.ok ? { role: "player", seat: joined.seat } : null;
  }

  /** Seats held for players who dropped, still within SEAT_HOLD_MS (the rest are forgotten). */
  heldSeats(now) {
    for (const [token, held] of this.held) if (now - held.at > SEAT_HOLD_MS) this.held.delete(token);
    return this.held.size;
  }

  /** The player chose "Leave the party": no grace. */
  leave(token, now) {
    const who = this.identify(token);
    if (!who) return;
    if (who.role === "screen") this.screens.delete(token);
    else this.remove(this.members[who.seat], "left");
    if (this.hostToken === token) this.hostToken = this.nextHost();
    this.noteEmpty(now);
  }

  /** Who becomes host when the host is gone for good: the first player here, else the screen. */
  nextHost() {
    const m = this.present().find((p) => p.token !== this.hostToken);
    if (m) return m.token;
    for (const token of this.screens.keys()) if (token !== this.hostToken) return token;
    return null;
  }

  /** Whose taps change the room right now: the host, or while the host is away the first connected player. */
  pickerToken() {
    const host = this.identify(this.hostToken);
    // A party started on a big screen (a TV, often with nothing to tap) is picked for by its
    // first player; the screen's own taps still count (setRoom).
    if (host?.role === "screen" && this.connected().length) return this.connected()[0].token;
    const here = host && (host.role === "screen" ? this.screens.get(this.hostToken).connected : this.members[host.seat].connected);
    if (here) return this.hostToken;
    return this.connected()[0]?.token ?? (host ? this.hostToken : null);
  }

  /** Who picks the room, for the view: {seat} for a player, {seat: -1} for the room's screen, or null. */
  pickerView() {
    const who = this.identify(this.pickerToken());
    return who ? { seat: who.seat } : null;
  }

  /**
   * The party moves to another room. Only the host's taps apply, never during a count, a coin
   * toss or a game, and not again within a few seconds. Returns {ok, room, by} or {ok: false, why}.
   */
  setRoom(token, id, now) {
    if (!isRoom(id)) return { ok: false, why: "That is not a room." };
    if (token !== this.pickerToken() && token !== this.hostToken) return { ok: false, why: "Only the one who started the party can change the room." };
    if (this.activity.kind === "settings") return { ok: false, why: "A game's settings are being chosen. You can change the room after it." };
    const locked = roomLocked({ phase: this.activity.kind === "game" ? "playing" : "lobby", vote: { count: this.count, toss: this.toss } });
    if (locked) return { ok: false, why: locked };
    if (id === this.room) return { ok: false, why: "The party is in that room already." };
    if (now - this.roomAt < ROOM_COOLDOWN_MS) return { ok: false, why: "Wait a moment before changing it again." };
    this.room = id;
    this.roomAt = now;
    this.lastActive = now;
    return { ok: true, room: id, by: this.identify(token).seat };
  }

  remove(m, why) {
    if (m.points > 0) {
      this.remembered.set(m.name.toLowerCase(), m.points);
      while (this.remembered.size > MAX_REMEMBERED) this.remembered.delete(this.remembered.keys().next().value);
    }
    this.members[m.seat] = null;
    if (this.hostToken === m.token) this.hostToken = this.nextHost();
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
    if (!m || !this.piecesWalk() || !data) return null;
    if (typeof data.x !== "number" || !Number.isFinite(data.x)) return null;
    // Sent before the player's page heard that the room had moved the piece: out of date.
    if ((data.r ?? 0) !== m.rev) return null;
    // A piece that was knocked down lies where it landed until it is up again.
    if (isDown(m, now)) return null;
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
   * A bump: the room decides who, if anyone, it lands on, and knocks them down (the rules are
   * lobby/shared/bump.js). Returns the message for everybody, or null when the piece may not
   * bump yet (bumpWait says how long).
   */
  bump(seat, now) {
    const m = this.members[seat];
    if (!m || this.activity.kind !== "lobby" || !mayBump(m, now).ok) return null;
    m.bumpAt = now;
    this.lastActive = now;
    // A piece on the floor, or just up from it, cannot be knocked: nobody is kept down.
    const others = this.present()
      .filter((o) => o.seat !== seat && !isSafe(o, now))
      .map((o) => ({ seat: o.seat, x: posAt(o, now) }));
    const to = bumpTarget(posAt(m, now), m.face, others);
    if (to === -1) return { t: "b", s: seat, f: m.face, to: -1 };
    const o = this.members[to];
    // Thrown into the dark: clear of every light that is on (one that is off is dark already).
    const lights = this.lights();
    const lit = this.boxes.map((box, i) => (lights[box.id] === null ? i : -1)).filter((i) => i >= 0);
    o.x = knockLanding(posAt(o, now), m.face, this.boxes.length, lit);
    o.d = 0;
    o.t = now;
    o.rev += 1;
    Object.assign(o, knocked(now));
    return { t: "b", s: seat, f: m.face, to, x: o.x, rev: o.rev };
  }

  /** For a bump the room refused: how long until that piece may bump, as the message for its page. */
  bumpWait(seat, now) {
    const m = this.members[seat];
    if (!m || this.activity.kind !== "lobby") return null;
    return { t: "cd", in: Math.round(mayBump(m, now).wait) };
  }

  /**
   * An emote from a player (the kit's rules: party-kit/client/emotes.js). Returns {relay} for
   * everybody else, or {refused, wait} for the sender: too soon, or not allowed while the game
   * being played says so. Nothing is scheduled: the cooldown is a time written on the piece.
   */
  emote(seat, id, now) {
    const m = this.members[seat];
    if (!m) return null;
    const verdict = mayEmote(m.emoteAt, now, { playing: this.activity.kind === "game", rules: this.playRules() });
    if (!verdict.ok) return { refused: waitMessage(verdict.wait), wait: verdict.wait };
    m.emoteAt = now;
    this.lastActive = now;
    return { relay: relayEmote(seat, id) };
  }

  /** What the game being played allows (its box carries the manifest's word), or the defaults. */
  playRules() {
    const a = this.activity;
    if (a.kind !== "game") return DURING_PLAY;
    return this.boxes.find((box) => box.id === a.id)?.play ?? DURING_PLAY;
  }

  /** Connected players and connected big screens: what decides which games can be played. */
  party() {
    return { players: this.connected().length, screens: this.screensConnected() };
  }

  /**
   * Whether the pieces walk: in the lobby, and while a game's players are chosen on its spots
   * (the spots are lights, and standing in one is the choice). Bumping stays the lobby's.
   */
  piecesWalk() {
    return this.activity.kind === "lobby" || this.choosingSpots();
  }

  /** Whether the settings step is choosing the game's players on spots (a party larger than its seats). */
  choosingSpots() {
    return this.activity.kind === "settings" && Array.isArray(this.activity.spots);
  }

  /**
   * {boxId: null (its light is on) or the reason it is off}. While players are chosen on spots,
   * the spots' lights are the only ones on, and the others are off with nothing to say ("").
   */
  lights() {
    if (this.choosingSpots()) {
      const spots = new Set(this.activity.spots.map((spot) => spot.place));
      return Object.fromEntries(this.boxes.map((box) => [box.id, spots.has(box.id) ? null : ""]));
    }
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
   * could change the vote. Returns {view, state, gaveUp}: `view` when what the players see has
   * changed, `state` when the count itself started or stopped (which is worth saving), `gaveUp`
   * when the settings step ended because its players are no longer here (the whole room changed).
   */
  evaluate(now) {
    const before = this.count?.endsAt ?? 0;
    // While settings are chosen, a party that no longer has the players for the game (one left
    // the party) is back in the room at once.
    const gaveUp = this.activity.kind === "settings" && this.choosingFails(now);
    // While players are chosen on spots: who stands on which spot (a piece that stepped off frees
    // its spot). What changes there is in the room view, so the whole room is sent (`room`).
    const spotsMoved = !gaveUp && this.choosingSpots() && this.fillSpots(now);
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
    if (gaveUp) return { view: true, state: true, gaveUp };
    if (spotsMoved) return { view: changed, state: true, room: true };
    return { view: changed, state: (this.count?.endsAt ?? 0) !== before };
  }

  /**
   * The spots after the pieces moved (party-kit/src/core/audience.js, takeSpots): a spot is held
   * by the first connected piece to stand in its light, and freed when it steps off, drops or
   * leaves. The game's seats are the pieces on the spots. Returns whether anything changed.
   */
  fillSpots(now) {
    const a = this.activity;
    const standing = this.standing(now);
    const at = Object.fromEntries(this.connected().map((m) => [m.seat, standing[m.seat] ?? null]));
    // A piece walking across a spot's light does not take it: only one that stops there does.
    const moving = this.connected().filter((m) => m.d !== 0).map((m) => m.seat);
    const { spots, changed } = takeSpots(a.spots, at, { moving });
    if (!changed) return false;
    a.spots = spots;
    a.seats = spotSeats(spots);
    // Who stepped on, by token, as everyone saw it (stepPlayers): a seat on a spot plays only while
    // it is still the same person's. Kept in storage, never in a view.
    a.players = Object.fromEntries(a.seats.map((seat) => [seat, this.members[seat].token]));
    return true;
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
   * A wake-up: lets time-dependent things happen. Returns {start, away, close, changed}: `start`
   * is the game the vote chose (the room then calls startGame, or refuseStart when the hosting
   * allowance is spent), `away` is set instead when the vote chose an outside game (sendAway),
   * `close` is why the room should shut, `changed` that the view moved on.
   */
  tick(now) {
    const out = { start: null, chosen: false, away: null, close: null, changed: false };
    const inLobby = this.activity.kind === "lobby";
    const choosing = this.activity.kind === "settings";
    if (choosing && this.choosingFails(now)) out.changed = true;
    else if (choosing && now >= this.activity.endsAt && this.choosingSpots() && !spotsFull(this.activity.spots)) {
      // The time is up with a spot nobody stands on: nobody plays, and everyone is back in the room.
      const name = this.boxOf(this.activity.id)?.name ?? this.activity.id;
      this.notes.push({ k: "cancelled", text: `Nobody took every spot, so ${name} did not start.` });
      this.toLobby(now);
      out.changed = true;
    } else if (choosing && now >= this.activity.endsAt) {
      // The host's time is up: the game starts with the picks as they stand (startChosen).
      out.start = this.activity.id;
      out.chosen = true;
      out.changed = true;
    }
    if (inLobby) {
      // A dropped phone's grace runs out: the piece fades and its vote stops counting.
      for (const m of this.present()) {
        if (!m.connected && m.droppedAt !== null && now - m.droppedAt >= DROP_FADE_MS) {
          this.held.set(m.token, { seat: m.seat, name: m.name, points: m.points, at: now });
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
        if (this.boxes.find((box) => box.id === out.start)?.url) {
          out.away = this.sendAway(out.start, now);
          out.start = null;
        }
      }
    }
    if (this.emptySince !== null && now - this.emptySince >= this.emptyLimit(now)) out.close = "empty";
    else if ((inLobby || this.activity.kind === "settings") && !out.start && !out.away) {
      if (now - this.lastActive >= STALE_ROOM_MS) out.close = "stale";
      else if (now - this.createdAt >= MAX_ROOM_LIFE_MS) out.close = "expired";
      else if (this.closing && now >= this.closing.at) out.close = this.closing.reason;
    } else if (this.turnGame() && now - this.lastActive >= this.lifetimes().staleRoomMs) {
      // A turn-based match nobody has touched for the game's own stale limit is forgotten.
      out.close = "stale";
    }
    return out;
  }

  /**
   * How long the room waits before it closes as empty and as forgotten: the room's own values,
   * or while a game is played the ones it chooses (`idleShutdownMs`, `staleRoomMs`). A game that
   * chooses nothing (Cork & Bell) keeps the room's.
   */
  lifetimes() {
    const defaults = { idleShutdownMs: IDLE_SHUTDOWN_MS, staleRoomMs: STALE_ROOM_MS };
    const a = this.activity;
    return a.kind === "game" ? lifetimesOf(this.games.get(a.id), defaults) : defaults;
  }

  /**
   * An outside game won the vote. Nothing starts here and nobody scores: every page is told
   * where it is going and goes. The pieces are put back by the door and the room rests, so
   * anyone who chooses to stay is not sent off again at once. Once the pages have gone the room
   * is empty, and closes by the usual rule a minute later.
   */
  sendAway(id, now) {
    const box = this.boxes.find((b) => b.id === id);
    for (const m of this.present()) {
      m.x = spawnX(m.seat, this.boxes.length);
      m.d = 0;
      m.t = now;
      m.rev += 1;
    }
    this.holdUntil = now + AWAY_MS + SETTLE_MS;
    this.lastActive = now;
    return { id, name: box.name, url: box.url, in: AWAY_MS };
  }

  /** The hosting allowance is spent: no game starts, and the room will close after a few minutes. */
  refuseStart(now, reason = "budget") {
    if (this.activity.kind === "settings") this.toLobby(now);
    this.count = null;
    this.toss = null;
    this.setClosing(now, reason);
  }

  setClosing(now, reason) {
    if (!this.closing) this.closing = { at: now + BUDGET_CLOSE_MS, reason };
    this.count = null;
  }

  /**
   * How long an empty room waits before it closes: longer while a dropped player's seat is held,
   * and while a game is played that asks for longer (a match of two locked phones).
   */
  emptyLimit(now) {
    const held = this.heldSeats(now) ? SEAT_HOLD_MS : 0;
    const a = this.activity;
    if (a.kind !== "game") return held || IDLE_SHUTDOWN_MS;
    const { idleShutdownMs, staleRoomMs } = this.lifetimes();
    let limit = Math.max(held, idleShutdownMs);
    const game = this.turnGame();
    if (!game) return limit;
    // A turn-based game holds its dropped seats for its grace, and an empty room waits for them:
    // until the longest grace still running ends, or with a grace that never ends for the game's
    // idleShutdownMs when it chose one, and for its stale limit when it did not.
    const grace = graceOf(game, TURN_GRACE_MS);
    const chose = typeof game.idleShutdownMs === "number" && Number.isFinite(game.idleShutdownMs) && game.idleShutdownMs > 0;
    const since = this.emptySince ?? now;
    for (const seat of a.seats) {
      const m = this.members[seat];
      if (!m || m.connected || m.droppedAt === null || m.droppedAt === undefined) continue;
      if (grace === Infinity) limit = Math.max(limit, chose ? idleShutdownMs : staleRoomMs);
      else limit = Math.max(limit, m.droppedAt + grace - since);
    }
    return limit;
  }

  /** Why the room must end the turn-based game being played now, whatever it is doing: its four hours are up, or it is closing (the budget). */
  roomEnding(now) {
    if (now - this.createdAt >= MAX_ROOM_LIFE_MS) return "expired";
    if (this.closing && now >= this.closing.at) return this.closing.reason;
    return null;
  }

  /** When the room should next be woken if nothing else happens (for the alarm), or null. */
  nextWake(now) {
    let at = Infinity;
    if (this.emptySince !== null) at = Math.min(at, this.emptySince + this.emptyLimit(now));
    if (this.activity.kind === "lobby") {
      at = Math.min(at, this.lastActive + STALE_ROOM_MS, this.createdAt + MAX_ROOM_LIFE_MS);
      if (this.closing) at = Math.min(at, this.closing.at);
      if (this.count) at = Math.min(at, this.count.endsAt);
      if (this.toss) at = Math.min(at, this.toss.endsAt);
      // The rest after a game: a count may be due the moment it is over, if anyone is here to vote.
      if (this.holdUntil > now && this.connected().length) at = Math.min(at, this.holdUntil);
      for (const m of this.present()) if (!m.connected && m.droppedAt !== null) at = Math.min(at, m.droppedAt + DROP_FADE_MS);
    } else if (this.activity.kind === "settings") {
      // The settings step's time limit, and the room's own limits. A dropped phone's piece does
      // not fade while settings are chosen: its seat is one of the game's.
      at = Math.min(at, this.activity.endsAt, this.lastActive + STALE_ROOM_MS, this.createdAt + MAX_ROOM_LIFE_MS);
      if (this.closing) at = Math.min(at, this.closing.at);
    } else if (this.turnGame()) {
      // A turn-based game's deadline (a turn timer running out) is a wake-up like any other, and
      // so are the game's stale limit, the moment a dropped seat's grace runs out, the room's four
      // hours and a budget close (which end the game: turnUpkeep).
      const deadline = this.turnDeadline();
      if (deadline !== null) at = Math.min(at, deadline);
      at = Math.min(at, this.lastActive + this.lifetimes().staleRoomMs, this.createdAt + MAX_ROOM_LIFE_MS);
      if (this.closing) at = Math.min(at, this.closing.at);
      const grace = graceOf(this.turnGame(), TURN_GRACE_MS);
      for (const seat of this.activity.seats) at = Math.min(at, graceEndsAt(this.members[seat], grace) ?? Infinity);
    }
    return at === Infinity ? null : Math.max(at, now + 20);
  }

  // ---------------------------------------------------------------- a game

  /**
   * Starts a game with the party's seats. Returns {ok, ended}: `ended` is set when the game was
   * over the moment it began (a stand-in), otherwise null and the room ticks it.
   *
   * `seed` is the game's own seed. The Durable Object passes a fresh one from the platform's
   * secure source, so a game that shows its seed to the players (Cork & Bell's pages simulate
   * their stalls from it) gives away nothing of the room's seed or of any other game's draw.
   * Left out (the tests), it is derived from the room's seed and the round, so a run repeats.
   */
  startGame(id, now, seed = this.roundSeed(this.round + 1)) {
    const game = this.games.get(id);
    if (!game || this.activity.kind !== "lobby") return fail("not_found", "That game cannot start here.");
    const problems = [...gameProblems(game), ...settingsProblems(game, this.fields.get(id))];
    if (problems.length) return fail("bad_game", problems.join(" "));
    // A party larger than the game's seats chooses its players on spots first (a game with an
    // audience); a game with settings has them chosen first. Either way the room waits for its
    // host (startChosen).
    const spots = this.spotsFor(id);
    if (hasSettings(game) || spots) return this.beginSettings(game, id, now, spots);
    return this.createGame(game, id, now, seed, this.partySeats(id), null);
  }

  /**
   * The spots on which a game's players are chosen, when the party has more members than the game
   * has seats and the game takes an audience (its box says `audience`): one light on the wall for
   * each seat (vote.js, spotLights). Null when no spots are needed. A wall with fewer lights than
   * the game has seats has no spots to offer: the first members by seat play.
   */
  spotsFor(id) {
    const box = this.boxOf(id);
    if (!needsSpots({ audience: box?.audience, seats: box?.max }, this.present().length)) return null;
    const places = spotLights(this.boxes, id, box.max);
    return places ? openSpots(places) : null;
  }

  /** The seats that play a game with no spot step: the party, or its first members when the game takes fewer (a wall too small for spots). */
  partySeats(id) {
    const seats = this.present().map((m) => m.seat);
    const box = this.boxOf(id);
    return box?.audience && seats.length > box.max ? seats.slice(0, box.max) : seats;
  }

  /** A game's settings fields, checked and in one shape (settings.js, settingFields); worked out once per game. */
  fieldsOf(id) {
    if (!this.fieldCache.has(id)) this.fieldCache.set(id, settingFields(this.fields.get(id)).fields);
    return this.fieldCache.get(id);
  }

  /** The box on the wall for a game id. */
  boxOf(id) {
    return this.boxes.find((box) => box.id === id) ?? null;
  }

  /**
   * The vote chose a game with settings: the room's activity is the settings step. Its first picks
   * are the settings this game was last started with, when the game still takes them, and
   * otherwise its defaults (the fields' defaults, cleaned by `game.settings`). The players are the
   * party as it is now; anyone who joins during the step watches the game. Returns {ok, choosing}.
   */
  beginSettings(game, id, now, spots = null) {
    let first = { ok: true, settings: {} };
    if (hasSettings(game)) {
      const fields = this.fieldsOf(id);
      first = this.lastSettings[id] ? checkSettings(game, this.lastSettings[id]) : null;
      if (!first?.ok) first = checkSettings(game, fieldDefaults(fields));
      if (!first.ok) {
        if (first.thrown) console.error(`party room: ${id} settings() failed on its defaults`, first.thrown);
        return fail("bad_game", `settings() refused its own defaults: ${first.message}`);
      }
    }
    const seats = this.present().map((m) => m.seat);
    if (!seats.length) return fail("not_ready", "Nobody is here to play.");
    this.count = null;
    this.toss = null;
    // Who sits in each seat, by token (kept in storage only, never in a view): at Start only these
    // people play, whoever may sit in their seats by then. With spots (a party larger than the
    // game's seats) nobody plays until they stand on one, and a piece is written down here as it
    // steps on (fillSpots): the pieces start again by the door, out of every light, and walk there.
    const chosen = spots ? [] : seats;
    const players = Object.fromEntries(chosen.map((seat) => [seat, this.members[seat].token]));
    this.activity = { kind: "settings", id, picks: first.settings, seats: chosen, players, endsAt: now + SETTINGS_MS, startedAt: now };
    if (spots) {
      this.activity.spots = spots;
      this.respawn(now);
    }
    this.lastActive = now;
    return { ok: true, choosing: true, ended: null };
  }

  /** Every piece back by the door, standing still, moved by the room (so each page takes its place). */
  respawn(now) {
    for (const m of this.present()) {
      m.x = spawnX(m.seat, this.boxes.length);
      m.d = 0;
      m.t = now;
      m.rev += 1;
    }
  }

  /** Whether this device may start the game now: the host, and with every spot taken when players are chosen on spots. */
  mayStart(token) {
    const may = this.mayChoose(token);
    if (!may.ok) return may;
    if (this.choosingSpots() && !spotsFull(this.activity.spots)) {
      const n = this.activity.spots.length;
      return fail("spots_open", `${n === 2 ? "Two" : n} players must stand on the spots first.`);
    }
    return may;
  }

  /** Whether this device may choose the settings: the party's host (the one who picks the room, pickerToken). */
  mayChoose(token) {
    if (this.activity.kind !== "settings") return fail("not_choosing", "No settings are being chosen.");
    if (!token || (token !== this.pickerToken() && token !== this.hostToken)) return fail("not_host", "Only the one who started the party chooses the settings.");
    return { ok: true, id: this.activity.id };
  }

  /**
   * The host changes some settings (`change` is {key: value}). Each value must be one of its
   * field's options, and the whole is checked by `game.settings`; what it gives back is the new
   * picks. Returns {ok, picks} or {ok: false, error, message} with the game's own words.
   */
  chooseSettings(token, change, now) {
    const may = this.mayChoose(token);
    if (!may.ok) return may;
    const a = this.activity;
    const game = this.games.get(a.id);
    const fields = this.fieldsOf(a.id);
    const changed = applyChange(fields, a.picks, change);
    if (!changed.ok) return changed;
    const checked = checkSettings(game, changed.picks);
    if (checked.thrown) console.error(`party room: ${a.id} settings() failed`, checked.thrown);
    if (!checked.ok) return { ok: false, error: checked.error, message: checked.message };
    a.picks = checked.settings;
    this.lastActive = now;
    return { ok: true, picks: a.picks };
  }

  /** The host goes back to the room instead: nobody plays, and the pieces are back by the door. */
  cancelSettings(token, now) {
    const may = this.mayChoose(token);
    if (!may.ok) return may;
    const name = this.boxOf(this.activity.id)?.name ?? this.activity.id;
    this.notes.push({ k: "cancelled", text: `Back to the room. ${name} did not start.` });
    this.toLobby(now);
    return { ok: true };
  }

  /**
   * Ends the settings step when the game can no longer be played by the players chosen for it
   * (one left the party, so fewer than the game needs are here). Returns whether it did.
   */
  choosingFails(now) {
    const a = this.activity;
    const box = this.boxOf(a.id);
    // With spots, the players are not chosen yet: anyone still in the party may take a spot.
    const here = Array.isArray(a.spots) ? this.present().length : this.stepPlayers().length;
    if (here >= Math.max(1, box?.min ?? 1)) return false;
    const name = box?.name ?? a.id;
    this.notes.push({ k: "cancelled", text: `Not enough players are left for ${name}, so it did not start.` });
    this.toLobby(now);
    return true;
  }

  /** Back in the room from the settings step: everyone by the door, and a rest before the next count. */
  toLobby(now) {
    this.activity = { kind: "lobby" };
    this.respawn(now);
    this.holdUntil = now + SETTLE_MS;
    this.lastActive = now;
  }

  /**
   * The settings step is over (the host tapped Start, or its time ran out): the game starts with
   * the picks, and with the seats chosen for it that are still in the party. Returns what
   * startGame returns.
   */
  startChosen(id, now, seed = this.roundSeed(this.round + 1)) {
    const a = this.activity;
    if (a.kind !== "settings" || a.id !== id) return fail("not_choosing", "No settings are being chosen for that game.");
    const game = this.games.get(id);
    if (!game) {
      this.toLobby(now);
      return fail("not_found", "That game cannot start here.");
    }
    // With spots, only a full set starts the game: its players are the pieces on them, each still
    // the person who stepped on (stepPlayers), so exactly the people everyone saw on the spots.
    if (Array.isArray(a.spots) && (!spotsFull(a.spots) || this.stepPlayers().length !== a.spots.length)) return fail("spots_open", "Every spot must be taken first.");
    return this.createGame(game, id, now, seed, this.stepPlayers(), hasSettings(game) ? a.picks : null);
  }

  /**
   * The seats of the settings step still held by the people it was opened for, or, while players
   * are chosen on spots, by the people who stepped on them.
   */
  stepPlayers() {
    const a = this.activity;
    return a.seats.filter((seat) => this.members[seat] && this.members[seat].token === a.players?.[seat]);
  }

  /**
   * Who a carry is kept for: each of the game's seats and whoever sits in it, by the token the
   * room knows them by (only ever compared, never sent). A seat whose player has left has nobody.
   */
  carrySeats(seats) {
    return seats.map((seat) => ({ seat, who: this.members[seat]?.token ?? "-" }));
  }

  /**
   * Creates the game with these seats. A game with settings gets them in its context (`settings`),
   * and a game with a carry gets what its last game with the same people in the same seats left
   * (`carry`, or null). A game with neither is created exactly as before.
   */
  createGame(game, id, now, seed, seatNumbers, settings) {
    const seats = seatNumbers.map((seat) => this.members[seat]).filter(Boolean).map((m) => ({ seat: m.seat, name: m.name, kind: "human", colour: m.colour }));
    if (!seats.length) {
      if (this.activity.kind === "settings") this.toLobby(now);
      return fail("not_ready", "Nobody is here to play.");
    }
    this.round += 1;
    this.lastAnswers = null;
    this.count = null;
    this.toss = null;
    const context = { seed: seed >>> 0, seats, now, round: this.round };
    if (hasSettings(game)) {
      context.settings = structuredClone(settings);
      this.lastSettings[id] = structuredClone(settings);
    }
    if (hasCarry(game)) {
      const carry = carryFor(this.carries, id, this.carrySeats(seats.map((s) => s.seat)));
      context.carry = carry === null ? null : structuredClone(carry);
    }
    const state = game.create(context);
    this.activity = { kind: "game", id, state, startedAt: now, ticks: 0, seats: seats.map((s) => s.seat) };
    if (isTurnBased(game)) {
      // What the game has been told of each seat: it starts with every seat here, as the vote
      // had them, and hears at once of one that is not (before anyone sees the first snapshot).
      this.activity.told = Object.fromEntries(seats.map((s) => [s.seat, { connected: true, away: false }]));
      // The names, so a game a player has left can still say who left.
      this.activity.names = Object.fromEntries(seats.map((s) => [s.seat, s.name]));
      // The answers given to inputs with ids, per seat (answers.js), saved with the game.
      this.activity.answers = {};
      if (!game.isOver(state)) {
        const told = this.tellPresence(game, now);
        this.lastActive = now;
        if (told.error) return { ok: true, events: [], ended: this.stopGame(game, "error", now).ended };
        // What the game says of it goes out with the start, after the first snapshots.
        return { ok: true, events: told.events, ended: game.isOver(state) ? this.finishGame(now) : null };
      }
    }
    this.lastActive = now;
    return { ok: true, ended: game.isOver(state) ? this.finishGame(now) : null };
  }

  /** The seed a round draws from when none is given: repeatable, for the tests. */
  roundSeed(round) {
    return (Math.imul(this.seed ^ 0x9e3779b9, round + 1) ^ (round * 40503)) >>> 0;
  }

  /**
   * The viewer a socket of this identity ({role, seat}) gets for a game's state, by the kit's
   * rules (party-kit/src/core/views.js): a phone whose seat is in the game is that player, the
   * big screen is the screen, and a member whose seat is not in the game (they joined after it
   * began) watches it with a screen's view. The one place the party room decides who sees what.
   * `activity` is the game being shown; it defaults to the current one.
   */
  viewerOf(who, activity = this.activity) {
    if (activity.kind !== "game") return viewerFor(who, null);
    // A game that opts in to an audience (party-kit/src/core/audience.js) gives the members who
    // are not in it `{role: "audience", seat}`; any other keeps them on a screen's view.
    const audience = hasAudience(this.games.get(activity.id), this.boxOf(activity.id));
    return viewerFor(who, new Set(activity.seats), { audience });
  }

  /** The current game's state as this viewer may see it (game.snapshot with the viewer). */
  snapshotFor(viewer, now) {
    const a = this.activity;
    return a.kind === "game" ? this.games.get(a.id).snapshot(a.state, now, viewer) : null;
  }

  /** An input from a player in a ticking game. Seats that joined after it started just watch. */
  gameInput(seat, data, now) {
    const a = this.activity;
    if (a.kind !== "game" || !a.seats.includes(seat) || !this.members[seat]?.connected) return false;
    this.games.get(a.id).input(a.state, seat, data, now);
    return true;
  }

  /** The game being played, when it is turn-based (`tickHz: 0`); otherwise null. */
  turnGame() {
    const a = this.activity;
    if (a.kind !== "game") return null;
    const game = this.games.get(a.id);
    return isTurnBased(game) ? game : null;
  }

  /**
   * When the turn-based game being played next needs the room awake, or null. A deadline its own
   * tick did not move on (`stuck`, gameDeadline) is not a wake-up until the next input or change
   * in who is here, so a game with that mistake cannot keep the room ringing. A `nextDeadline`
   * that throws is no deadline.
   */
  turnDeadline() {
    const game = this.turnGame();
    if (!game) return null;
    let at;
    try {
      at = deadlineOf(game, this.activity.state);
    } catch (err) {
      console.error(`party room: ${this.activity.id} nextDeadline() failed; no deadline is set`, err);
      return null;
    }
    return at !== null && this.activity.stuck === at ? null : at;
  }

  /**
   * An input from a player in a turn-based game, applied at once. Returns {ok: false, error,
   * message} when the room did not take it (no such game, a seat not in it, a phone not
   * connected; `game_error` when `game.input` threw, and nothing it changed is kept; `id_reused`
   * when the id came with another input than the first time), or {ok: true, answer, events,
   * snapshot, viewerOf, ended}, as gameTick returns, with `snapshot` always set and `answer` the
   * game's word to the sender, `{ok: true}` or `{ok: false, error, message}`
   * (party-kit/src/core/answers.js, answerOf). `quiet` is set on a refusal that changed nothing:
   * not saved, and only the sender hears of it.
   *
   * With an `id` (answers.js, inputId), the answer is kept for that seat: the same id again is
   * not applied, and comes back as {ok: true, repeat: true, answer, snapshot, viewerOf} with the
   * first answer and the game as it is now, for the sender only. That holds for a short while
   * after the game is over too (the winning tap sent twice), until the next game starts.
   */
  playTurn(seat, data, now, id = null) {
    const a = this.activity;
    const game = this.turnGame();
    const digest = id !== null ? inputDigest(data) : null;
    if (!game) {
      const known = id !== null ? lookup(this.lastAnswers?.answers, seat, id, digest) : null;
      if (known?.reused) return fail("id_reused", ID_REUSED);
      if (known) return { ok: true, repeat: true, answer: known.answer, events: [], snapshot: null, viewerOf: (who) => this.viewerOf(who), ended: null };
      return fail("not_playing", "No turn-based game is being played.");
    }
    if (!a.seats.includes(seat) || !this.members[seat]?.connected) return fail("not_in_game", "That seat is not playing this game.");
    if (id !== null) {
      // The same id for another input (a page that reloaded and counts from 1 again) is never
      // taken for the first one: it is refused, and the first answer stays.
      const known = lookup(a.answers, seat, id, digest);
      if (known?.reused) return fail("id_reused", ID_REUSED);
      if (known) return { ok: true, repeat: true, answer: known.answer, events: [], snapshot: (viewer) => game.snapshot(a.state, now, viewer), viewerOf: (who) => this.viewerOf(who, a), ended: null };
    }
    // The input is applied to a copy, kept only once the game returned: an input that throws
    // halfway leaves nothing behind, in memory or in storage, and may be sent again.
    let draft;
    try {
      draft = copyState(game, a.state);
    } catch {
      draft = a.state; // a state that cannot be copied is not protected
    }
    let returned;
    try {
      returned = game.input(draft, seat, data, now);
    } catch (err) {
      console.error(`party room: ${a.id} input() failed; nothing it changed is kept`, err);
      return fail("game_error", "The game could not take that. Try again.");
    }
    const outcome = inputOutcome(returned);
    const answer = answerOf(outcome.answer);
    if (id !== null) remember((a.answers ??= {}), seat, id, answer, digest);
    this.lastActive = now;
    // A refusal that changed nothing is not saved, and only its sender hears of it: its snapshot
    // and its share of the events. One that changed the state (a timed-out turn ended first) goes
    // to everyone like any input. The state is compared as it would be saved, and only on a
    // refusal: the real state was left untouched while the input worked on its copy.
    const unchanged = () => {
      const before = stateKey(game, a.state);
      return before !== null && stateKey(game, draft) === before;
    };
    if (!answer.ok && draft !== a.state && unchanged()) {
      return { ok: true, quiet: true, answer, events: outcome.events, snapshot: (viewer) => game.snapshot(a.state, now, viewer), viewerOf: (who) => this.viewerOf(who, a), ended: null };
    }
    a.state = draft;
    delete a.stuck;
    return { ok: true, answer, ...this.turnOut(game, outcome.events, now) };
  }

  /**
   * The alarm rang for a turn-based game: when its deadline has come, `game.tick` is called once.
   * Returns null when nothing was due (an alarm set for a deadline that has since moved), or what
   * playTurn returns, without `answer`.
   */
  gameDeadline(now) {
    const game = this.turnGame();
    const deadline = this.turnDeadline();
    if (!game || deadline === null || now < deadline) return null;
    const a = this.activity;
    let events;
    try {
      events = game.tick(a.state, now) ?? [];
    } catch (err) {
      console.error(`party room: ${a.id} tick() failed; the game ends with no points`, err);
      return this.stopGame(game, "error", now);
    }
    const out = { ok: true, ...this.turnOut(game, events, now) };
    // A tick must move the deadline on. One that moved it forward but still into the past (a
    // fixed step, woken late after a deploy) ticks again on the next alarm, so the game catches
    // up; each of those ticks moves the deadline forward, so they end. One that did not move it at
    // all is ignored until something changes, so it cannot keep the room ringing.
    if (!out.ended) {
      const after = this.turnDeadline();
      if (after !== null && after <= deadline) {
        console.error(`party room: ${a.id} tick() did not move its deadline on; it is ignored until the next input or change in who is here`);
        a.stuck = after;
      }
    }
    return out;
  }

  turnOut(game, events, now) {
    const a = this.activity;
    const out = { events, snapshot: (viewer) => game.snapshot(a.state, now, viewer), viewerOf: (who) => this.viewerOf(who, a), ended: null };
    if (game.isOver(a.state)) out.ended = this.finishGame(now);
    return out;
  }

  /**
   * Who is here, for the turn-based game being played: call it after anything that may have
   * changed it (a socket opening or closing, a page hidden or shown, a player leaving, a wake-up,
   * the room waking from sleep). Only the game's own seats count, never the rest of the party.
   *   - A seat gone for good (its player left the party, or its phone dropped and the game's
   *     grace ran out) ends the game early (abandonGame).
   *   - Otherwise every seat whose presence changed since the game last heard is reported to
   *     `game.presence`.
   * Returns null when the game did not change, or what playTurn returns (without `answer`): the
   * room saves, sends the fresh views and asks for the next deadline, as after an input.
   */
  turnUpkeep(now) {
    const game = this.turnGame();
    if (!game) return null;
    // The room's four hours, or a budget close, end the game whatever it is doing.
    const ending = this.roomEnding(now);
    if (ending) return this.stopGame(game, ending, now);
    const grace = graceOf(game, TURN_GRACE_MS);
    for (const seat of this.activity.seats) {
      const why = goneWhy(this.members[seat], now, grace);
      if (why) return this.abandonGame(game, seat, why, now);
    }
    const told = this.tellPresence(game, now);
    if (told.error) return this.stopGame(game, "error", now);
    if (told.changed) return { ok: true, ...this.turnOut(game, told.events, now) };
    // Only what the game was told changed: saved, so a wake does not tell it again; nothing is sent.
    return told.told ? { ok: true, quiet: true } : null;
  }

  /**
   * Tells the game of every seat whose presence changed since it last heard. Returns {changed,
   * events, told, error}: `told` when what it was told changed, `error` when `game.presence` threw.
   */
  tellPresence(game, now) {
    const a = this.activity;
    const out = { changed: false, events: [], told: false, error: null };
    for (const seat of a.seats) {
      const report = reportOf(this.members[seat]);
      if (sameReport(a.told[seat], report)) continue;
      a.told[seat] = report;
      out.told = true;
      if (typeof game.presence !== "function") continue;
      let returned;
      try {
        returned = game.presence(a.state, seat, { ...report }, now);
      } catch (err) {
        console.error(`party room: ${a.id} presence() failed; the game ends with no points`, err);
        out.error = err;
        return out;
      }
      const { changed, events } = presenceOutcome(returned);
      if (!changed) continue;
      out.changed = true;
      out.events.push(...events);
    }
    if (out.changed) delete a.stuck;
    return out;
  }

  /**
   * Ends the turn-based game being played early, with no points, for a reason that is nobody's
   * doing: a callback of the game threw (`error`), the room's four hours are up (`expired`), or
   * the room is closing (the budget). Everyone gets a note saying why. No last snapshot is sent
   * after an error: the state may be half changed.
   */
  stopGame(game, why, now) {
    const a = this.activity;
    const gameName = this.boxes.find((box) => box.id === a.id)?.name ?? a.id;
    const text =
      why === "error" ? `${gameName} ran into a problem, so it ended.` : why === "expired" ? `This party has reached its four hours, so ${gameName} ended.` : `This party is closing, so ${gameName} ended.`;
    this.notes.push({ k: "ended", why, seat: -1, name: null, colour: null, text });
    const out = { ok: true, events: [], snapshot: why === "error" ? null : (viewer) => game.snapshot(a.state, now, viewer), viewerOf: (who) => this.viewerOf(who, a), ended: null };
    out.ended = this.finishGame(now, { standings: [], result: null, early: { seat: -1, name: null, why, text } });
    return out;
  }

  /**
   * A seat in the turn-based game is gone for good: the game ends now. `game.abandon`, when the
   * game has it, decides the result (presence.js, abandonOutcome); without it the game ends with
   * no points. Everyone hears why in a note, and the room's card says so too (`last.early`).
   */
  abandonGame(game, seat, why, now) {
    const a = this.activity;
    let outcome = abandonOutcome(null);
    if (typeof game.abandon === "function") {
      try {
        outcome = abandonOutcome(game.abandon(a.state, seat, now));
      } catch (err) {
        console.error(`party room: ${a.id} could not be abandoned; it ends with no points`, err);
      }
    }
    const name = this.members[seat]?.name ?? a.names?.[seat] ?? "A player";
    const gameName = this.boxes.find((box) => box.id === a.id)?.name ?? a.id;
    const text = why === "left" ? `${name} left the party, so ${gameName} ended.` : `${name} did not come back, so ${gameName} ended.`;
    this.notes.push({ k: "ended", why, seat, name, colour: SEAT_COLOURS[seat], text });
    const out = { ok: true, events: outcome.events, snapshot: (viewer) => game.snapshot(a.state, now, viewer), viewerOf: (who) => this.viewerOf(who, a), ended: null };
    out.ended = this.finishGame(now, { standings: outcome.standings, result: outcome.result, early: { seat, name, why, text } });
    return out;
  }

  /**
   * Advances the game; call it at the game's tick rate. Returns {events, snapshot, viewerOf, ended}:
   *   events    all of them; the room sends each viewer its own with `eventsFor`
   *   snapshot  null, or `(viewer) => game.snapshot(...)` when one is due (the last one included)
   *   viewerOf  the viewer of a socket ({role, seat}) for this game, which still holds once
   *             `ended` has put the room back in the lobby, so the last snapshot and events go
   *             out by the game's seats
   */
  gameTick(now) {
    const a = this.activity;
    const out = { events: [], snapshot: null, viewerOf: (who) => this.viewerOf(who, a), ended: null };
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
    const snapshot = (viewer) => game.snapshot(a.state, now, viewer);
    if (a.ticks % (game.snapshotEvery ?? 15) === 0) out.snapshot = snapshot;
    if (game.isOver(a.state)) {
      out.snapshot = snapshot;
      out.ended = this.finishGame(now);
    }
    return out;
  }

  /**
   * The game is over: its places become points, and everyone is back by the door. `ending` is
   * set when the game was ended before it was over (abandonGame): its standings and result are
   * what `game.abandon` decided, and the card says why it ended (`last.early`).
   */
  finishGame(now, ending = null) {
    const a = this.activity;
    const game = this.games.get(a.id);
    const result = ending ? ending.result : game.result ? game.result(a.state) : null;
    const places = ending ? ending.standings : game.standings ? game.standings(a.state) : standingsFromRows(result);
    const rows = [];
    for (const { seat, place } of places ?? []) {
      const m = this.members[seat];
      if (!m || !a.seats.includes(seat) || !(place >= 1) || rows.some((r) => r.seat === seat)) continue;
      const points = pointsForPlace(place);
      m.points += points;
      const row = { seat, name: m.name, colour: m.colour, place, points };
      // A game that keeps score says so in its result rows: the card shows it beside the place.
      const score = Array.isArray(result) ? result.find((r) => r?.seat === seat)?.score : undefined;
      if (typeof score === "number") row.score = score;
      rows.push(row);
    }
    rows.sort((p, q) => p.place - q.place || p.seat - q.seat);
    // The night's list of games, for the board opened large: this one's name and who won it.
    record(this.history, { round: this.round, name: this.boxes.find((box) => box.id === a.id)?.name ?? a.id, rows });
    if (rows.length) this.gamesPlayed += 1;
    this.last = { round: this.round, game: a.id, name: this.boxes.find((box) => box.id === a.id)?.name ?? a.id, rows, at: now };
    if (ending) this.last.early = ending.early;
    this.lastAnswers = a.answers ? { round: this.round, answers: a.answers } : null;
    this.keepCarry(game, a, ending);
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

  /**
   * What the game that just ended leaves for a rematch (`game.carry`), kept for its seats and
   * the people in them, in place of the last one. Nothing is kept after a game that ended because
   * one of its callbacks threw (its state may be half changed), or when carry throws or gives back
   * something that is not a small plain-JSON object (logged).
   */
  keepCarry(game, a, ending) {
    if (!hasCarry(game)) return;
    delete this.carries[a.id];
    if (ending?.early?.why === "error") return;
    try {
      const carry = carryOf(game, a.state);
      if (carry) this.carries[a.id] = { seats: seatsKey(this.carrySeats(a.seats)), carry };
    } catch (err) {
      console.error(`party room: ${a.id} carry() failed; nothing is kept for a rematch`, err);
    }
  }

  // ---------------------------------------------------------------- views

  /** What every client may know about the room. Tokens never leave the room. */
  view(now) {
    const a = this.activity;
    return {
      kind: "party",
      code: this.code,
      pin: this.pin,
      // The kit's client paces its pings by this: "playing" while a game is on, and `game.turns`
      // when that game is turn-based, so the pages keep to the keep-alive the room never wakes for.
      phase: a.kind === "game" ? "playing" : a.kind === "settings" ? "settings" : "lobby",
      // While a game's settings are chosen: what they are, who chooses them, and how long is left.
      ...(a.kind === "settings" ? { choosing: this.choosingView(now) } : {}),
      game: a.kind === "game" ? this.gameView() : null,
      boxes: this.boxes,
      members: this.members.map((m) =>
        m ? { seat: m.seat, name: m.name, colour: m.colour, connected: m.connected, ...(m.connected && m.away ? { away: true } : {}), x: Math.round(posAt(m, now)), d: m.d, rev: m.rev, points: m.points, ...this.bumpView(m, now), emoteCool: Math.round(emoteLeft(m.emoteAt, now)) } : null,
      ),
      screens: this.screensConnected(),
      vote: this.voteView(now),
      tonight: { games: this.gamesPlayed, played: this.history },
      last: this.last ? { ...this.last, ago: now - this.last.at } : null,
      closesIn: Math.max(0, this.createdAt + MAX_ROOM_LIFE_MS - now),
      // How long a room may go with nobody doing anything before it is put away (a game being
      // played may choose its own).
      idleLimit: this.lifetimes().staleRoomMs,
      closing: this.closing ? { in: Math.max(0, this.closing.at - now), reason: this.closing.reason } : null,
      // The room the party is in, and who picks it (lobby/shared/rooms.js).
      room: this.room,
      picker: this.pickerView(),
    };
  }

  /**
   * The game being played as every page sees it: its id, name and round, `turns` when it is
   * turn-based, and for a game that opts in to an audience its seats and `audience: true`, so a
   * page can tell its view whether it plays or watches. `upright` when the game is laid out for an
   * upright phone (its manifest's `devices.upright`).
   */
  gameView() {
    const a = this.activity;
    const box = this.boxOf(a.id);
    const out = { id: a.id, name: box?.name ?? a.id, round: this.round };
    if (this.turnGame()) out.turns = true;
    if (hasAudience(this.games.get(a.id), box)) Object.assign(out, { seats: [...a.seats], audience: true });
    if (box?.upright) out.upright = true;
    return out;
  }

  /**
   * The settings step as every page sees it: the game, its fields (settings.js, settingFields),
   * the picks, which seats will play, who chooses (`by`, as the room picker: a seat, or -1 for
   * the room's screen) and the time left (`endsIn` of `of`, in ms). While the players are chosen
   * on spots, `spots` too: [{place, seat}], each spot's light (a box id) and who stands on it.
   */
  choosingView(now) {
    const a = this.activity;
    const box = this.boxOf(a.id);
    return {
      id: a.id,
      name: box?.name ?? a.id,
      fields: this.fieldsOf(a.id),
      picks: a.picks,
      seats: a.seats,
      ...(Array.isArray(a.spots) ? { spots: a.spots.map((spot) => ({ ...spot })) } : {}),
      by: this.pickerView()?.seat ?? null,
      endsIn: Math.max(0, a.endsAt - now),
      of: SETTINGS_MS,
    };
  }

  /**
   * What a page needs to show a piece's bump: milliseconds until it may bump again (`cool`),
   * until it is up from the floor (`down`) and until it can be knocked again (`safe`).
   */
  bumpView(m, now) {
    return { cool: cooldownLeft(m.bumpAt ?? -Infinity, now), down: Math.max(0, (m.stunUntil ?? 0) - now), safe: Math.max(0, (m.immuneUntil ?? 0) - now) };
  }

  /**
   * The room survives being put to sleep, and so does a turn-based game in progress (`game`): its
   * state, its seats, when it started. A ticking game does not: it is short, and held awake.
   * Throws when a turn-based game's state cannot be written down (turns.js, saveState).
   */
  serialize({ withGame = true } = {}) {
    return {
      game: withGame ? this.savedGame() : null,
      seed: this.seed,
      code: this.code,
      pin: this.pin,
      members: this.members,
      screens: [...this.screens].map(([token, screen]) => ({ token, droppedAt: screen.droppedAt })),
      round: this.round,
      gamesPlayed: this.gamesPlayed,
      history: this.history,
      last: this.last,
      count: this.count,
      toss: this.toss,
      holdUntil: this.holdUntil,
      closing: this.closing,
      remembered: [...this.remembered],
      held: [...this.held],
      createdAt: this.createdAt,
      lastActive: this.lastActive,
      emptySince: this.emptySince,
      room: this.room,
      hostToken: this.hostToken,
      lastAnswers: this.lastAnswers,
      choosing: this.activity.kind === "settings" ? { ...this.activity } : null,
      carries: this.carries,
      lastSettings: this.lastSettings,
    };
  }

  /** A turn-based game in progress as it is saved with the room, or null. */
  savedGame() {
    const game = this.turnGame();
    if (!game) return null;
    const { id, state, startedAt, ticks, seats, told, names, answers, stuck } = this.activity;
    return { id, startedAt, ticks, seats, told, names, answers, stuck, state: saveState(game, state) };
  }

  /**
   * The saved game back as the room's activity. Its seats come back with it, so every viewer is
   * who it was before the sleep. A game that cannot be restored (it is no longer on the wall, no
   * longer turn-based, or its save does not read) is lost, as a ticking game is: `lost` is set and
   * everyone is back in the lobby.
   */
  restoreGame(saved) {
    const game = this.games.get(saved.id);
    try {
      if (!isTurnBased(game)) throw new Error(`${saved.id} is not a turn-based game here.`);
      if (!Array.isArray(saved.seats) || !saved.seats.every(Number.isInteger)) throw new Error("The saved game has no seats.");
      const state = loadState(game, saved.state);
      // What the game was last told of each seat comes back too, so a wake tells it only what
      // changed while the room slept (turnUpkeep).
      const told = Object.fromEntries(saved.seats.map((seat) => [seat, saved.told?.[seat] ?? { connected: true, away: false }]));
      this.activity = { kind: "game", id: saved.id, state, startedAt: saved.startedAt, ticks: saved.ticks ?? 0, seats: [...saved.seats], told, names: { ...saved.names }, answers: saved.answers ?? {} };
      if (typeof saved.stuck === "number") this.activity.stuck = saved.stuck;
    } catch (err) {
      console.error("party room: a saved game could not be restored", err);
      this.activity = { kind: "lobby" };
      this.lost = true;
    }
  }

  /**
   * The settings step as it was saved, with its picks and its time limit (which ran on through the
   * sleep). A step for a game that is no longer on the wall, or no longer has settings, is lost:
   * everyone is back in the lobby and hears so.
   */
  restoreChoosing(saved) {
    const game = this.games.get(saved.id);
    // A step that chooses players on spots is kept for a game that still takes an audience.
    const spots = saved.spots === undefined ? null : validSpots(saved.spots) && this.boxOf(saved.id)?.audience ? saved.spots : false;
    const players = saved.players && typeof saved.players === "object" ? saved.players : null;
    const readable =
      players && Array.isArray(saved.seats) && saved.seats.every((seat) => Number.isInteger(seat) && typeof players[seat] === "string") && typeof saved.endsAt === "number" && saved.picks && typeof saved.picks === "object";
    if (game && (hasSettings(game) || spots) && spots !== false && readable) {
      this.activity = { kind: "settings", id: saved.id, picks: saved.picks, seats: [...saved.seats], players: { ...players }, endsAt: saved.endsAt, startedAt: saved.startedAt ?? saved.endsAt - SETTINGS_MS };
      if (spots) this.activity.spots = spots.map((spot) => ({ place: spot.place, seat: spot.seat }));
      return;
    }
    console.error(`party room: the settings step for ${saved.id} could not be restored`);
    this.activity = { kind: "lobby" };
    this.lost = true;
  }

  static restore(config, data, now) {
    const room = new LobbyCore({ ...config, seed: data.seed, code: data.code, now });
    room.pin = data.pin;
    // Nobody is connected until their socket is seen again; a piece left mid-stride stands still.
    room.members = data.members.map((m) => (m ? { ...m, x: m.d ? posAt(m, now) : m.x, d: 0, t: now, connected: false, away: false, droppedAt: m.droppedAt ?? now, bumpAt: -Infinity } : null));
    // One screen at most. A screen that had dropped before the room slept keeps the moment it
    // dropped, so its grace runs on through the sleep; one that was connected is seen again by
    // its socket (resume). A room saved before screens had a grace kept bare tokens.
    for (const saved of data.screens.slice(-1)) {
      const screen = typeof saved === "string" ? { token: saved, droppedAt: null } : saved;
      room.screens.set(screen.token, { connected: false, droppedAt: screen.droppedAt ?? now });
    }
    room.round = data.round;
    room.gamesPlayed = data.gamesPlayed;
    room.history = data.history ?? [];
    room.last = data.last ?? null;
    room.count = data.count ?? null;
    room.toss = data.toss ?? null;
    room.holdUntil = data.holdUntil ?? 0;
    room.closing = data.closing ?? null;
    room.remembered = new Map(data.remembered ?? []);
    room.held = new Map(data.held ?? []);
    room.createdAt = data.createdAt;
    room.lastActive = data.lastActive ?? now;
    // When the last person went, if they had: kept through a sleep, so "empty for a minute" is
    // counted from then and not from every time the room wakes up.
    room.emptySince = data.emptySince ?? now;
    room.room = isRoom(data.room) ? data.room : DEFAULT_ROOM;
    room.hostToken = data.hostToken ?? null;
    room.lastAnswers = data.lastAnswers ?? null;
    room.carries = data.carries ?? {};
    room.lastSettings = data.lastSettings ?? {};
    if (data.game) room.restoreGame(data.game);
    else if (data.choosing) room.restoreChoosing(data.choosing);
    return room;
  }
}

function fail(error, message) {
  return { ok: false, error, message };
}
