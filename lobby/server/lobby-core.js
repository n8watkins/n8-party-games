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
import { COUNT_MS, SETTLE_MS, TOSS_MS, leaders, pointsForPlace, spotLights, standingsFromRows, tally, whyNot } from "../shared/vote.js";
import { BUMP_REACH, CHARGE_HOLD_MS, CHARGE_MIN_MS, COOLDOWN_SLACK_MS, IMMUNE_MS, KICK_CONTACT, bumpTarget, chargeBounce, chargeDash, chargePower, chargeThrow, cooldownLeft, isDown, isSafe, knockLanding, knocked, mayBump, mayCharge } from "../shared/bump.js";
import { BOO_LATE_MS, FADE_MS, SCARE_LANDING, SPOOK_FAR, SPOOK_LANDING, SPOOK_REACH, bigScared, fadeLeft, isFaded, mayFade, maySpook, scared, spooked } from "../shared/ghost.js";
import { HOOK_SCARE_MS, TOUCH_GRACE_MS, slideLanding, touchAt } from "../shared/moves.js";
import { BONK_MS, HOOK_BACK_MS, HOOK_HOLD, HOOK_LATE_MS, HOOK_LIFE_MS, PULLED_SAFE_MS, PULL_MS, STILT_MS, TRAIN_MS, battedAway, firstCatch, hookEndsAt, hookLeft, isUp, jumpedOver, mayHook, mayStilt, stiltLeft } from "../shared/robot.js";
import { ABSORB_MS, HARDEN_MS, SHOVE_AHEAD, SHOVE_FAR, SHOVE_LATE_MS, SHOVE_REACH, SHOVE_SLACK, SHOVE_STEP, isHard, isSoft, mayShove, maySlime, shoved, slimeLeft } from "../shared/slime.js";
import { DEFAULT_ROOM, ROOM_COOLDOWN_MS, isRoom, roomLocked, wallFor } from "../shared/rooms.js";
import { COLOUR_PRESETS, DEFAULT_CHARACTER, LOOK_COOLDOWN_MS, LOOK_SLACK_MS, characterOr, cleanColour, moveOf, readLook } from "../shared/characters.js";
import { record } from "../shared/tonight.js";
import { DURING_PLAY, cooldownLeft as emoteLeft, mayEmote, relayEmote, tooEager, waitMessage } from "../../party-kit/client/emotes.js";
import { JUMP_MS, POSITION_SLACK, acrossWalls, clampX, evenWall, floats, lightAt, posAt, sameWall, spawnX, velAt, walkChanges } from "../shared/world.js";
import { DEFAULT_MODE, MODE_COOLDOWN_MS, isMode, modeLocked, modeNote } from "../shared/mode.js";
import { PLAY_BEAT_MS, tableWhyNot } from "../shared/table.js";

/** The Floor's places: four pieces in the character room. */
export const MAX_PLAYERS = 4;
/**
 * The Table's places: it has no pieces to fit in a room, and its games take bigger groups (Paper
 * Masks is for three to eight). Seats 0 to 3 are the Floor's: a party of more than four cannot
 * move to the Floor (setMode), and one of four or fewer is seated in the Floor's places on the way.
 */
export const TABLE_MAX_PLAYERS = 8;
/** Each seat's first colour: the kit's four, then the next four of the picker's presets. */
export const seatColour = (seat) => SEAT_COLOURS[seat] ?? COLOUR_PRESETS[seat]?.hex ?? SEAT_COLOURS[seat % SEAT_COLOURS.length];
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
/**
 * A host whose phone dropped this recently still holds the controls (pickerToken): long enough
 * for a page to move between the two waiting rooms and reconnect, well inside DROP_FADE_MS.
 */
export const HOST_GRACE_MS = 8000;
/**
 * At the Table people sit and talk and nothing they do reaches the room, so an idle party there
 * is not put away after STALE_ROOM_MS as one on the Floor is: while anyone is connected, it may
 * sit this long. No wake-up is added for it (nextWake): it only moves the room's own limit.
 */
export const TABLE_STALE_MS = 2 * 60 * 60_000;
/** How many people who left are remembered by name, so coming back restores their points. */
const MAX_REMEMBERED = 12;

export class LobbyCore {
  /**
   * @param {{boxes: object[], games: Map<string, object>, fields?: Map<string, object[]>, seed: number, code: string, now: number}} opts
   *   boxes: the wall, in order (lobby/shared/vote.js, boxFromManifest).
   *   games: the server definition of every box that can actually start, by id.
   *   fields: each game's settings as its manifest describes them (`manifest.settings`), by id.
   *     They reach the pages only in the settings step's `choosing`; a box says only `settings: true`.
   *   table: the Table's list (lobby/shared/table.js). Its games that can start are in `games` too.
   */
  constructor({ boxes, games, fields = new Map(), table = [], seed, code, now }) {
    this.boxes = boxes;
    /** The Table's list of games (lobby/shared/table.js, lobby/wall.js buildTurnWall): the host picks from it there. */
    this.table = table;
    this.games = games;
    this.fields = fields;
    this.fieldCache = new Map();
    this.seed = seed >>> 0;
    this.code = code;
    this.pin = null;
    /** @type {Array<null | object>} */
    // One place per seat of the room the party is in (capacity): four on the Floor, more at the Table (fitMembers).
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
    /** What the room did to a move on its own (a hook dropped when its robot was knocked): relayed to everybody by the room (drainMoves). */
    this.moveRelays = [];
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
    /**
     * Which waiting room the party is in (lobby/shared/mode.js): the character room ("party-games")
     * or the plain one ("turn-based"). The host switches it (setMode); in turn-based mode the
     * pieces do not walk, so there is no vote.
     */
    this.mode = DEFAULT_MODE;
    /** When the mode was last switched: the next switch waits MODE_COOLDOWN_MS. */
    this.modeAt = -Infinity;
    /**
     * The game the vote (or the settings step's time) has just chosen, from the wake-up that chose
     * it (tick) until the room has started it or decided not to (the budget check comes between:
     * lobby-room.js, launch, then startDone). Nothing may switch the room or the party meanwhile.
     * Kept in memory only: a restart in that gap starts nothing.
     */
    this.starting = null;
    /**
     * null, or {id, at, by}: the host picked a game at the Table (play), and everyone sees it is
     * starting until `at` (PLAY_BEAT_MS); then the wake-up hands it to the room to start (tick).
     * `starting` is set for the whole of it. Kept in memory only, as `starting` is: a restart in
     * that moment starts nothing, and the host picks again.
     */
    this.beat = null;
    /** A switch between the waiting rooms is being saved (setMode, then modeSaved or undoMode). Memory only. */
    this.switching = false;
  }

  // ---------------------------------------------------------------- coming and going

  /** Adds a player to the first free seat, by the door. Works at any time, mid-vote included. */
  join(nickname, now, token = randomToken(), wantSeat = -1) {
    const name = cleanName(nickname);
    if (!name) return fail("bad_name", "Pick a nickname first.");
    // While a game is on, a seat somebody left in the middle of it is still the game's (a
    // ticking game's stand-in is playing it): a newcomer is never given that seat. The same holds
    // for the seats a settings step was opened for: whoever joins during it watches the game.
    // A seat that left a Table game for good stays the game's too, until it ends (gone).
    const inPlay = this.activity.kind === "game" || this.activity.kind === "settings" ? [...this.activity.seats, ...(this.activity.gone ?? [])] : [];
    // The Floor has four places, the Table more (capacity).
    const cap = this.capacity();
    const free = (i) => i < cap && this.members[i] === null && !inPlay.includes(i);
    const seat = wantSeat >= 0 && free(wantSeat) ? wantSeat : this.members.findIndex((m, i) => free(i));
    if (seat === -1 && this.members.slice(0, cap).includes(null)) return fail("room_full", "A game is on and its seats are taken. Join when it ends.");
    if (seat === -1) return fail("room_full", cap === MAX_PLAYERS ? "This party is full: four players at most." : `This party is full: ${cap} players at most.`);
    const taken = new Set(this.present().map((m) => m.name.toLowerCase()));
    let unique = name;
    for (let n = 2; taken.has(unique.toLowerCase()); n++) unique = `${name.slice(0, NAME_MAX - 2)} ${n}`;
    const points = this.remembered.get(unique.toLowerCase()) ?? 0;
    this.remembered.delete(unique.toLowerCase());
    this.members[seat] = {
      seat,
      token,
      name: unique,
      colour: seatColour(seat),
      character: DEFAULT_CHARACTER,
      connected: false,
      droppedAt: now, // not connected yet: the socket follows the join
      x: spawnX(seat, this.wall),
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
      if (piece) Object.assign(m, { x: piece.x, d: piece.d, t: piece.t, face: piece.face, rev: piece.rev, v: piece.v, vt: piece.vt ?? null });
    }
    this.emptySince = null;
    return who;
  }

  /** What a socket has to carry for resume(): the seat's piece as last heard. */
  pieceOf(seat) {
    const m = this.members[seat];
    return m ? { x: m.x, d: m.d, t: m.t, face: m.face, rev: m.rev, ...(m.vt === m.t ? { v: m.v, vt: m.vt } : {}) } : null;
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
      m.vt = null;
      m.chargeAt = null;
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

  /**
   * Whose taps change the room right now: the host, or while the host is away the first connected
   * player. A host whose phone dropped less than HOST_GRACE_MS ago still holds the controls: that
   * is a page moving between the two waiting rooms (hop.js) or a wifi blip, and nobody else may
   * switch or pick in that moment. After the grace the first connected player holds them until the
   * host is back, and the host's piece fades and hands over for good as before (DROP_FADE_MS,
   * nextHost). `now` left out: no grace.
   */
  pickerToken(now = Infinity) {
    const host = this.identify(this.hostToken);
    // A party started on a big screen (a TV, often with nothing to tap) is picked for by its
    // first player; the screen's own taps still count (setRoom).
    if (host?.role === "screen" && this.connected().length) return this.connected()[0].token;
    const place = host && (host.role === "screen" ? this.screens.get(this.hostToken) : this.members[host.seat]);
    if (place && (place.connected || now - (place.droppedAt ?? -Infinity) < HOST_GRACE_MS)) return this.hostToken;
    return this.connected()[0]?.token ?? (host ? this.hostToken : null);
  }

  /** Who picks the room, for the view: {seat} for a player, {seat: -1} for the room's screen, or null. */
  pickerView(now = Infinity) {
    const who = this.identify(this.pickerToken(now));
    return who ? { seat: who.seat } : null;
  }

  /** Why a game cannot be got ready to start right now (the vote's winner waits on the budget check), or null. */
  startingWhy(what) {
    return this.starting ? `A game is starting. You can ${what} when it ends.` : null;
  }

  /**
   * The wall of the party's room (shared/rooms.js, wallFor): where its boxes hang and its pools of
   * light lie. Who stands in which light, where pieces arrive and where a knock lands all go by it.
   */
  get wall() {
    return wallFor(this.room, this.boxes);
  }

  /**
   * The party moves to another room. Only the host's taps apply, never during a count, a coin
   * toss or a game, and not again within a few seconds. Returns {ok, room, by} or {ok: false, why}.
   */
  setRoom(token, id, now) {
    if (!isRoom(id)) return { ok: false, why: "That is not a room." };
    if (token !== this.pickerToken(now) && token !== this.hostToken) return { ok: false, why: "Only the one who started the party can change the room." };
    // At the Table nobody sees the room's look: it is chosen on the Floor.
    if (this.plainRoom()) return { ok: false, why: "The room's look is chosen on the Floor." };
    if (this.activity.kind === "settings") return { ok: false, why: "A game's settings are being chosen. You can change the room after it." };
    const starting = this.startingWhy("change the room");
    if (starting) return { ok: false, why: starting };
    const locked = roomLocked({ phase: this.activity.kind === "game" ? "playing" : "lobby", vote: { count: this.count, toss: this.toss } });
    if (locked) return { ok: false, why: locked };
    if (id === this.room) return { ok: false, why: "The party is in that room already." };
    if (now - this.roomAt < ROOM_COOLDOWN_MS) return { ok: false, why: "Wait a moment before changing it again." };
    const before = this.wall;
    this.room = id;
    this.roomAt = now;
    this.lastActive = now;
    // A room that hangs its boxes elsewhere carries every piece with its pool: nobody's vote changes.
    const moved = this.carryAcross(before, now);
    // And the room rests a moment, as after a switch of waiting room, so no count starts on the change itself.
    this.holdUntil = Math.max(this.holdUntil, now + SETTLE_MS);
    return { ok: true, room: id, by: this.identify(token).seat, moved };
  }

  /**
   * The party's wall changed from `from` (shared/rooms.js, wallFor): each piece is moved with the
   * floor (shared/world.js, acrossWalls), so one in a pool stands in that same pool and one in the
   * dark in that same stretch of dark, and its page takes the new place (rev). Returns whether any
   * piece moved: false when the two walls have their pools in the same places.
   */
  carryAcross(from, now) {
    const to = this.wall;
    if (sameWall(from, to)) return false;
    for (const m of this.members) {
      if (!m) continue;
      // A move going on ends with the room it began in (a hook out is dropped: every page hears `hk` "off").
      this.endMoves(m, now);
      m.x = acrossWalls(posAt(m, now), from, to);
      m.t = now;
      m.rev += 1;
    }
    return true;
  }

  // ---------------------------------------------------------------- the two waiting rooms

  /**
   * The host moves the whole party to the other waiting room (lobby/shared/mode.js). The same
   * rule as setRoom says who may: the host, or whoever holds the controls while the host is away.
   * Refused during a count or a coin toss, the settings step or a game, and again within a few
   * seconds. On a switch the vote starts over: every piece is back by the door, and the room
   * rests a moment before a count may run. Returns {ok, mode, by} or {ok: false, why}.
   */
  setMode(token, v, now) {
    if (!isMode(v)) return { ok: false, why: "That is not a waiting room." };
    if (!token || (token !== this.pickerToken(now) && token !== this.hostToken)) return { ok: false, why: "Only the one who started the party can switch rooms." };
    const phase = this.activity.kind === "game" ? "playing" : this.activity.kind;
    const locked = modeLocked({ phase, vote: { count: this.count, toss: this.toss } }) ?? this.startingWhy("switch");
    if (locked) return { ok: false, why: locked };
    if (v === this.mode) return { ok: false, why: "The party is in that room already." };
    if (now - this.modeAt < MODE_COOLDOWN_MS) return { ok: false, why: "Wait a moment before switching again." };
    // The Floor has four places. More people than that stay at the Table.
    if (v === "party-games" && this.present().length > MAX_PLAYERS) return { ok: false, why: `The Floor has room for ${MAX_PLAYERS}, and ${this.present().length} are here. It can go there when fewer are.` };
    const who = this.identify(token);
    const before = { mode: this.mode, modeAt: this.modeAt };
    // Anyone sitting beyond the Floor's four places takes a free one of them on the way (their
    // pages are told to reconnect: lobby-room.js, switchMode, `moved`).
    const moves = v === "party-games" ? this.seatOnFloor() : [];
    this.mode = v;
    this.fitMembers();
    this.modeAt = now;
    this.count = null;
    this.toss = null;
    this.respawn(now);
    this.holdUntil = now + SETTLE_MS;
    this.lastActive = now;
    // Until the switch is saved (modeSaved) or taken back (undoMode), no game is picked at the Table.
    this.switching = true;
    // Who switched, by the seat they sit in now (they may have just moved into the Floor's places).
    const by = this.identify(token).seat;
    const name = who.role === "screen" ? "The room's screen" : this.members[by].name;
    this.notes.push({ k: "mode", mode: v, seat: by, name, text: modeNote(name, v) });
    if (!moves.length) return { ok: true, mode: v, by, was: { mode: before.mode, modeAt: before.modeAt } };
    return { ok: true, mode: v, by, moved: moves.map((m) => m.token), was: { mode: before.mode, modeAt: before.modeAt, moves } };
  }

  /** The places list is as long as the room the party is in has places: grown with free ones, or cut (only free ones: seatOnFloor). */
  fitMembers() {
    const cap = this.capacity();
    while (this.members.length < cap) this.members.push(null);
    if (this.members.slice(cap).every((m) => m === null)) this.members.length = cap;
  }

  /** How many places the party has in the room it is in: four on the Floor, more at the Table. */
  capacity() {
    return this.plainRoom() ? TABLE_MAX_PLAYERS : MAX_PLAYERS;
  }

  /**
   * Moves everyone sitting beyond the Floor's four places into a free one of them (there is room:
   * setMode checked). A seat whose colour was its seat's own takes the new seat's. Returns the
   * moves, [{token, from, to}], so a switch that cannot be saved puts them back (undoMode).
   */
  seatOnFloor() {
    const moves = [];
    for (let from = MAX_PLAYERS; from < this.members.length; from++) {
      const m = this.members[from];
      if (!m) continue;
      const to = this.members.findIndex((x, i) => i < MAX_PLAYERS && x === null);
      this.moveSeat(m, to);
      moves.push({ token: m.token, from, to });
    }
    return moves;
  }

  moveSeat(m, to) {
    const from = m.seat;
    this.members[from] = null;
    this.members[to] = m;
    if (m.colour === seatColour(from)) m.colour = seatColour(to);
    m.seat = to;
  }

  /**
   * A switch that could not be saved is taken back (lobby-room.js, switchMode): the party is in
   * the room it was in, nobody hears of the switch, and the host may try again at once. The
   * pieces stay by the door, where the switch put them.
   */
  undoMode(was) {
    this.mode = was.mode;
    this.fitMembers();
    for (const move of [...(was.moves ?? [])].reverse()) {
      const m = this.members[move.to];
      if (m?.token === move.token && this.members[move.from] === null) this.moveSeat(m, move.from);
    }
    this.modeAt = was.modeAt;
    this.notes = this.notes.filter((note) => note.k !== "mode");
    this.switching = false;
  }

  /** The switch is saved (lobby-room.js, switchMode): games may be picked at the Table again. */
  modeSaved() {
    this.switching = false;
  }

  /** Whether the party is in the plain waiting room: nothing walks and nothing is voted for there. */
  plainRoom() {
    return this.mode === "turn-based";
  }

  // ---------------------------------------------------------------- the Table's games

  /** Whether a game id is one of the Table's (lobby/wall.js, buildTurnWall), not the Floor's. */
  isTableGame(id) {
    return this.tableEntry(id) !== null;
  }

  /** The Table's list as every page sees it: each entry, and why the party cannot play it right now (`why`, or null). */
  tableView() {
    const players = this.connected().length;
    return this.table.map((entry) => ({ ...entry, why: this.games.has(entry.id) ? tableWhyNot(entry, players) : "Coming soon" }));
  }

  /**
   * Whether the host may start a Table game now (`{t: "play", id}`). The same rule as every host
   * tap says who: the host, or whoever holds the controls while the host is away. Only at the
   * Table, with nothing else going on (no game, no settings step, no other start or switch in
   * progress, the room not closing), for a game on the list that can be played, by the party's
   * size now (connected players). Returns {ok, id} or {ok: false, error, message}.
   */
  mayPlay(token, id, now) {
    if (!this.plainRoom()) return fail("not_table", "Games are picked here only when the party is at the Table.");
    if (!token || (token !== this.pickerToken(now) && token !== this.hostToken)) return fail("not_host", "Only the one who started the party picks the game.");
    if (this.starting) return fail("starting", "A game is starting already.");
    if (this.switching) return fail("busy", "The party is moving. Wait a moment, then pick again.");
    if (this.activity.kind === "game") return fail("playing", "A game is on. You can pick the next one when it ends.");
    if (this.activity.kind !== "lobby") return fail("busy", "Wait a moment, then pick again.");
    if (this.closing) return fail("closing", "This party is closing, so no new game can start.");
    const entry = typeof id === "string" ? this.tableEntry(id) : null;
    if (!entry) return fail("not_found", "That game is not on the Table's list.");
    const why = this.games.has(id) ? tableWhyNot(entry, this.connected().length) : "Coming soon";
    if (why) return fail(entry.soon || !this.games.has(id) ? "not_ready" : "party_size", `${entry.name}: ${why}.`);
    return { ok: true, id };
  }

  /**
   * The host picked a Table game (mayPlay said yes): the starting beat. Everyone sees it in the room
   * view (`starting`) for PLAY_BEAT_MS, and nothing may switch the room or start another game
   * meanwhile; then the wake-up hands it to the room to start (tick, then startGame).
   */
  beginPlay(id, token, now) {
    const who = this.identify(token);
    this.starting = id;
    this.beat = { id, at: now + PLAY_BEAT_MS, by: who?.role === "player" ? who.seat : -1 };
    this.lastActive = now;
  }

  /** The starting beat as every page sees it: {id, name, by, in}, or null. */
  beatView(now) {
    const b = this.beat;
    return b ? { id: b.id, name: this.nameOf(b.id), by: b.by, in: Math.max(0, b.at - now) } : null;
  }

  remove(m, why) {
    if (m.points > 0) {
      this.remembered.set(m.name.toLowerCase(), m.points);
      this.forgetOldest();
    }
    this.members[m.seat] = null;
    if (this.hostToken === m.token) this.hostToken = this.nextHost();
    this.count = null;
    this.notes.push({ k: "left", why, name: m.name, colour: m.colour });
  }

  /**
   * Adds `points` to what the room keeps by name for someone who has left (remove), so coming
   * back with that name restores them (join): a decided match placed them after they left.
   */
  rememberPoints(name, points) {
    if (!(points > 0)) return;
    const key = name.toLowerCase();
    const total = (this.remembered.get(key) ?? 0) + points;
    // Set afresh, so the name counts as the latest one remembered.
    this.remembered.delete(key);
    this.remembered.set(key, total);
    this.forgetOldest();
  }

  /** The room remembers MAX_REMEMBERED people who left at most: the oldest go first. */
  forgetOldest() {
    while (this.remembered.size > MAX_REMEMBERED) this.remembered.delete(this.remembered.keys().next().value);
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

  /** What the room did to the characters' moves by itself since the last call (a hook dropped), for everybody. */
  drainMoves() {
    return this.moveRelays.splice(0);
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
    // Sent before the player's page heard that the room had moved the piece: out of date as a
    // place, but still the phone's word on the walk it had made until then, so a touch the room
    // is holding for that walk is settled by it now (not at the end of its grace).
    if ((data.r ?? 0) !== m.rev) {
      const touches = this.settleTouches(seat, null, clampX(data.x), now);
      return touches.length ? { relay: null, fix: null, touches } : null;
    }
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
    // The touches the room is holding for this piece: did the walk the phone now confirms, from
    // where the walk since its last word began (that word, or where the room put it), reach them?
    // Settled before the piece takes its new place, so each is judged where it happened.
    const touches = this.settleTouches(seat, m.x, x, now);
    m.x = x;
    m.d = d;
    m.t = now;
    m.saidAt = now;
    // A floaty piece (the ghost: shared/world.js) says how fast it still goes as it eases to `d`:
    // carried forward from here by everyone the same way. Any other piece goes at `d` at once.
    const v = floats(m.character) && typeof data.v === "number" && Number.isFinite(data.v) ? Math.max(-1, Math.min(1, Math.round(data.v * 100) / 100)) : d;
    if (v !== d) Object.assign(m, { v, vt: now });
    else m.vt = null;
    if (d) m.face = d;
    // A pawn that walks while it charges its kick has let the charge go: its release is a plain kick.
    if (d && m.chargeAt !== null && m.chargeAt !== undefined) m.chargeAt = null;
    this.lastActive = now;
    const relay = { t: "m", s: seat, x: Math.round(x), d, ...(v !== d ? { v } : {}) };
    if (data.j) {
      relay.j = 1;
      // A jump clears a robot's hook (shared/robot.js, jumpedOver): the room keeps when it heard
      // the last, and only one a jump's length after the one before (a page jumps no faster). A
      // robot's jump is its stilt legs, a message of its own.
      if (moveOf(m.character) !== "hook" && !(now - (m.jumpAt ?? -Infinity) < JUMP_MS - COOLDOWN_SLACK_MS)) m.jumpAt = now;
    }
    return { relay, fix, touches };
  }

  /**
   * A bump: the room decides who, if anyone, it lands on, and knocks them down (the rules are
   * lobby/shared/bump.js). Returns the message for everybody, or null when the piece may not
   * bump yet (bumpWait says how long).
   */
  bump(seat, now, charged = false) {
    const m = this.members[seat];
    // Only a piece whose move is the kick kicks (a ghost fades instead: fade).
    if (!m || moveOf(m.character) !== "kick" || this.activity.kind !== "lobby" || this.plainRoom() || !mayBump(m, now).ok) return null;
    // A charged kick (shared/bump.js): as strong as the room itself timed the hold, from the charge
    // it heard (`kc`); a release with no charge the room took, or one held too long ago, is a tap.
    const heldFor = charged && m.chargeAt !== null && m.chargeAt !== undefined ? now - m.chargeAt + CHARGE_MIN_MS : null;
    m.chargeAt = null;
    const power = heldFor !== null && heldFor <= CHARGE_HOLD_MS + CHARGE_MIN_MS + COOLDOWN_SLACK_MS ? chargePower(heldFor) : null;
    m.bumpAt = now;
    // Which way it kicked: a kick toward a robot as its hook arrives bats the hook away (shared/robot.js).
    m.bumpFace = m.face;
    this.lastActive = now;
    // A piece on the floor, or just up from it, cannot be knocked: nobody is kept down. A robot up
    // on its legs is not there to kick: the kick swings through the gap (shared/robot.js).
    const others = this.present()
      .filter((o) => o.seat !== seat && !isSafe(o, now) && !isUp(o, now))
      .map((o) => ({ seat: o.seat, x: posAt(o, now) }));
    const x0 = posAt(m, now);
    // The dash: as far as the charge carries it, stopping at the piece it reaches (KICK_CONTACT
    // short of it), and never into a light it did not stand in (shared/moves.js, slideLanding).
    const dash = power === null ? 0 : Math.abs(slideLanding(x0, clampX(x0 + m.face * chargeDash(power)), this.landingWall(), this.litPlaces()) - x0);
    const to = bumpTarget(x0, m.face, others, BUMP_REACH + dash);
    const charge = power === null ? {} : { c: Math.round(power * 100) / 100 };
    if (power !== null) {
      const reach = to === -1 ? dash : Math.max(0, Math.min(dash, (posAt(this.members[to], now) - x0) * m.face - KICK_CONTACT));
      const x1 = Math.round(x0 + m.face * reach);
      if (x1 !== Math.round(x0)) {
        Object.assign(m, { x: x1, d: 0, t: now, vt: null });
        m.rev += 1;
      } else Object.assign(m, { x: x0, d: 0, t: now, vt: null });
      Object.assign(charge, { kx: m.x, kr: m.rev });
    }
    const base = { t: "b", s: seat, f: m.face, ...charge };
    if (to === -1) return { ...base, to: -1 };
    const o = this.members[to];
    // A kick that reaches a faded ghost passes through it, and the kicker is scared: it runs as
    // far from the ghost as a kick would have thrown it (lobby/shared/ghost.js). `sc` is the ghost.
    // A charged kick is punished harder: frozen longer, and as far as the charge would have thrown.
    if (this.faded(o, now)) {
      this.throwPiece(m, -m.face, now, power === null ? SCARE_LANDING : chargeThrow(power));
      Object.assign(m, power === null ? scared(now, IMMUNE_MS) : bigScared(now, IMMUNE_MS));
      return { ...base, to: -1, sc: to, x: m.x, rev: m.rev };
    }
    // A kick into a hardened slime bounces off: the kicker is knocked back itself, a kick's
    // distance the other way (shared/slime.js). `bo` is the slime. A charged kick bounces the
    // kicker back further, and keeps it down longer (shared/bump.js, chargeBounce).
    if (isHard(o, now)) {
      const bounce = power === null ? null : chargeBounce(power);
      this.throwPiece(m, -m.face, now, bounce?.reach);
      Object.assign(m, knocked(now, bounce?.down ?? 0), { fright: null });
      return { ...base, to: -1, bo: to, x: m.x, rev: m.rev, ...(bounce?.down ? { ke: bounce.down } : {}) };
    }
    this.throwPiece(o, m.face, now, power === null ? undefined : chargeThrow(power));
    Object.assign(o, knocked(now), { fright: null });
    return { ...base, to, x: o.x, rev: o.rev };
  }

  /**
   * A pawn holds its kick to charge it (shared/bump.js): the room stops it where it stands and
   * times the hold from now; the release is the kick (bump, `charged`). Returns {relay} for
   * everybody, or {ok: false, why, wait, bad} for that page only. Nothing is timed on the room's
   * side: a charge it never hears the release of is forgotten (CHARGE_HOLD_MS) when it next looks.
   */
  charge(seat, now) {
    const m = this.members[seat];
    if (!m) return { ok: false, why: "You are not in this party." };
    const kicks = moveOf(m.character) === "kick";
    if (!kicks) return { ok: false, why: "Only a pawn kicks.", bad: !(now - (m.lookAt ?? -Infinity) <= SHOVE_LATE_MS) };
    if (!this.floorTime()) return { ok: false, why: "You can kick in the room, between games." };
    const may = mayCharge(m, now);
    if (!may.ok) return { ...may, bad: !!may.cooling && tooEager(may.wait) };
    const x = posAt(m, now);
    Object.assign(m, { x, d: 0, t: now, vt: null, chargeAt: now });
    this.lastActive = now;
    return { ok: true, relay: { t: "kc", s: seat, f: m.face, x: Math.round(x) } };
  }

  /** Whether a pawn is charging its kick at `now` (a charge the room never heard the release of is over after CHARGE_HOLD_MS). */
  charging(m, now) {
    return m.chargeAt !== null && m.chargeAt !== undefined && now - m.chargeAt < CHARGE_HOLD_MS + COOLDOWN_SLACK_MS;
  }

  /**
   * The room moves a piece itself, in direction `dir`, into the dark: clear of every light that
   * is on (one that is off is dark already). `reach` is how far (knockLanding): a kick's by default.
   */
  throwPiece(o, dir, now, reach) {
    o.x = knockLanding(posAt(o, now), dir, this.landingWall(), this.litPlaces(), reach);
    o.d = 0;
    o.t = now;
    o.vt = null;
    o.rev += 1;
    this.interrupt(o, now);
  }

  /** The room's wall (shared/world.js, its pools where the room hangs them): what knockLanding and slideLanding are handed. */
  landingWall() {
    return this.wall;
  }

  /** The places on the wall whose lights are on (one that is off is dark). */
  litPlaces() {
    const lights = this.lights();
    return this.boxes.map((box, i) => (lights[box.id] === null ? i : -1)).filter((i) => i >= 0);
  }

  /**
   * The room drags a piece across the floor toward `to`, upright (a hook's pull, a slime's shove):
   * it may leave its light, but never comes to rest in another light that is on
   * (shared/moves.js, slideLanding). Returns where it came to rest.
   */
  slidePiece(o, to, now) {
    o.x = slideLanding(posAt(o, now), clampX(to), this.landingWall(), this.litPlaces());
    o.d = 0;
    o.t = now;
    o.vt = null;
    o.rev += 1;
    return o.x;
  }

  /**
   * A piece the room has just thrown (knocked, scared, spooked) stops what it was doing: a robot's
   * legs drop and its hook, still out, is dropped (every page hears `hk` "off"); a slime's harden
   * or absorb ends.
   */
  interrupt(o, now) {
    if (isUp(o, now)) o.stiltsUntil = now;
    if (isSoft(o, now)) o.softUntil = now;
    if (isHard(o, now)) o.hardUntil = now;
    // A pawn charging its kick loses the charge: its release is a plain kick, if it is up by then.
    o.chargeAt = null;
    this.dropHook(o);
  }

  /** A robot's hook, still out, is dropped: every page winds it back. */
  dropHook(m) {
    if (!m.hook) return;
    m.hook = null;
    this.moveRelays.push({ t: "hk", s: m.seat, o: "off" });
  }

  /** For a bump the room refused: how long until that piece may bump, as the message for its page. */
  bumpWait(seat, now) {
    const m = this.members[seat];
    if (!m || moveOf(m.character) !== "kick" || this.activity.kind !== "lobby" || this.plainRoom()) return null;
    return { t: "cd", in: Math.round(mayBump(m, now).wait) };
  }

  /** Whether a member is a ghost that has faded (lobby/shared/ghost.js): it cannot be touched, and has no vote. */
  faded(m, now) {
    return isFaded(m, now, moveOf(m.character) === "fade");
  }

  /**
   * The ghost's move: it fades for FADE_MS (lobby/shared/ghost.js). Returns {relay} for everybody,
   * or {ok: false, why, wait, bad} for that page only: not a ghost, not in the room's own time,
   * during a count, a coin toss or a game starting, knocked over, or its cooldown not over
   * (`wait`). `bad`: no real page asks that (it is not a ghost, or its cooldown is far from over),
   * so it counts against the socket's rate limit.
   */
  fade(seat, now) {
    const m = this.members[seat];
    if (!m) return { ok: false, why: "You are not in this party." };
    const fades = moveOf(m.character) === "fade";
    const busy = this.count ? "Not during the count." : this.toss ? "Not during the coin toss." : this.starting ? "Not while a game starts." : null;
    const may = mayFade(m, now, { fades, lobby: this.activity.kind === "lobby" && !this.plainRoom(), busy });
    if (!may.ok) return { ...may, bad: !fades || (!!may.cooling && tooEager(may.wait)) };
    Object.assign(m, { fadeAt: now, fadedUntil: now + FADE_MS, spooks: [] });
    this.lastActive = now;
    return { ok: true, relay: { t: "fade", s: seat, for: FADE_MS } };
  }

  /**
   * Boo: a faded ghost says it drifted through the piece in seat `to`, and the room checks it
   * (lobby/shared/ghost.js, maySpook): close enough by the room's own reckoning, not a ghost,
   * not spooked by this fade or a moment ago, not on the floor. Then the piece is spooked out of
   * place, the way the ghost was going, weaker than a kick. Never at the Table (plainRoom): it
   * has no pieces. Returns {relay} for everybody, or {ok: false, why, bad} for that page only.
   * `bad`: no real page sends that boo (lobby/shared/ghost.js, BOO_LATE_MS and SPOOK_FAR), so it
   * counts against the socket's rate limit; the rest are honest boos the room got a moment late.
   */
  boo(seat, to, now, touchedAt = null, walked = null) {
    const m = this.members[seat];
    if (!m) return { ok: false, why: "You are not in this party." };
    const fades = moveOf(m.character) === "fade";
    const real = Number.isInteger(to) && to !== seat && to >= 0 && to < this.members.length;
    // A ghost that has just become something else may have a boo on its way still.
    if (!fades) return { ok: false, why: "Only a faded ghost can spook.", bad: !(now - (m.lookAt ?? -Infinity) <= BOO_LATE_MS) };
    if (!real) return { ok: false, why: "Nobody there to spook.", bad: true };
    if (this.activity.kind !== "lobby" || this.plainRoom()) return { ok: false, why: "Nobody there to spook.", bad: false };
    // The ghost's own phone says it drifted through a piece the room saw it touch and is holding
    // (sweep, pending): that touch is confirmed now, judged when it happened.
    if (touchedAt === null) {
      const held = this.takePending("spook", seat, to);
      if (held) return this.boo(seat, to, now, held.t, held.d);
    }
    // A touch the room saw itself (sweep) counts when it happened: the fade may have ended since.
    const at = touchedAt ?? now;
    if (!this.faded(m, at)) return { ok: false, why: "Only a faded ghost can spook.", bad: !(now - (m.fadedUntil ?? -Infinity) <= BOO_LATE_MS) };
    const o = this.members[to];
    if (!o) return { ok: false, why: "Nobody there to spook.", bad: false };
    // The room may have spooked it already as the ghost drifted through (sweep): an honest page's boo then is only late.
    if ((m.spooks ?? []).includes(to)) return { ok: false, why: "Already spooked by this fade.", bad: false };
    // Both pieces where they were when the touch happened, and the piece as it was then.
    const ghostX = posAt(m, at);
    const x = posAt(o, at);
    const may = maySpook(ghostX, { ...o, x, fades: moveOf(o.character) === "fade" }, at, m.spooks ?? [], touchedAt !== null);
    if (!may.ok) return { ...may, bad: Math.abs(x - ghostX) > SPOOK_FAR };
    (m.spooks ??= []).push(to);
    // The way the ghost was going then (as the room saw it touch, when it did); the spook throws the
    // piece from where it stands now, its usual distance.
    const dir = walked || m.d || (x === ghostX ? m.face : Math.sign(x - ghostX)) || 1;
    this.throwPiece(o, dir, now, SPOOK_LANDING);
    Object.assign(o, spooked(now, IMMUNE_MS));
    this.lastActive = now;
    return { ok: true, relay: { t: "spook", s: seat, to, x: o.x, rev: o.rev } };
  }

  // ---------------------------------------------------------------- the robot and the slime

  /** Whether the pieces have their own time: the room, not a game, its settings or the Table. */
  floorTime() {
    return this.activity.kind === "lobby" && !this.plainRoom();
  }

  /**
   * The robot's move: it throws its hook the way it faces (lobby/shared/robot.js). The room stops
   * the robot where it is and judges the hook by its own clock: it wakes HOOK_LATE_MS after the
   * tip reaches the first piece in its way (or the end of its reach), and says what came of it to
   * everybody then (dueHooks). Returns {relay} for everybody now, or {ok: false, why, wait, bad}
   * for that page only. `bad`: no real page asks that (not a robot, or its cooldown far from
   * over), so it counts against the socket's rate limit.
   */
  hook(seat, now) {
    const m = this.members[seat];
    if (!m) return { ok: false, why: "You are not in this party." };
    const hooks = moveOf(m.character) === "hook";
    const may = mayHook(m, now, { hooks, lobby: this.floorTime(), up: isUp(m, now), hooking: !!m.hook, slack: COOLDOWN_SLACK_MS });
    if (!may.ok) return { ...may, bad: (!hooks && !(now - (m.lookAt ?? -Infinity) <= SHOVE_LATE_MS)) || (!!may.cooling && tooEager(may.wait)) };
    const x0 = posAt(m, now);
    // It stands still to throw: the room says so to every page with the hook.
    Object.assign(m, { x: x0, d: 0, t: now, vt: null, hookAt: now });
    const dir = m.face || 1;
    m.hook = { at: now, x0, dir, past: [] };
    m.hook.judgeAt = this.nextCatch(m, now) + HOOK_LATE_MS;
    this.lastActive = now;
    return { ok: true, relay: { t: "hook", s: seat, f: dir, x: Math.round(x0) } };
  }

  /** The pieces a robot's hook can catch: everyone else who is not down, just up or being pulled, and not one it has flown past. */
  hookTargets(m, now) {
    return this.present()
      .filter((o) => o.seat !== m.seat && !isSafe(o, now) && !m.hook.past.includes(o.seat))
      .map((o) => ({ seat: o.seat, at: (t) => posAt(o, t) }));
  }

  /** When the tip of a robot's hook will next reach a piece, as the room sees everyone now (or the end of its reach). */
  nextCatch(m, now) {
    const hit = firstCatch(m.hook, this.hookTargets(m, now), now, hookEndsAt(m.hook));
    return hit ? hit.t : hookEndsAt(m.hook);
  }

  /**
   * Judges every hook whose time has come (call it on every wake-up, and before anything that
   * looks at the pieces). Returns the messages for everybody: `hk` with what came of each.
   */
  dueHooks(now) {
    const out = [];
    const due = () => this.present().filter((m) => m.hook && m.hook.judgeAt <= now).sort((a, b) => a.hook.judgeAt - b.hook.judgeAt);
    for (let guard = 0; guard < 16; guard++) {
      const [m] = due();
      if (!m) break;
      const relay = this.judgeHook(m, now);
      if (relay) out.push(relay);
    }
    if (out.length) this.lastActive = now;
    return out;
  }

  /**
   * Everything that came due on the floor by itself (call it on every wake-up and every message,
   * before anything else changes a piece): the touches along the pieces' paths (sweep), then the
   * hooks whose time has come (dueHooks). Returns the messages for everybody.
   */
  dueMoves(now) {
    return [...this.sweep(now), ...this.dueHooks(now)];
  }

  /** What a walking piece touches by the room's own rules: "shove" for a slime, "spook" for a ghost, or null. */
  toucher(m) {
    if (!m.d) return null;
    const move = moveOf(m.character);
    return move === "harden" ? "shove" : move === "fade" ? "spook" : null;
  }

  /**
   * From when a toucher may touch, at or after `t`: a slime not down, hard or soft, a ghost faded
   * (Infinity when it no longer will). Judged at the touch's own time, not the look's.
   */
  touchFrom(kind, m, t) {
    if (kind === "spook") return t < (m.fadedUntil ?? 0) ? t : Infinity;
    return Math.max(t, isDown(m, t) ? (m.stunUntil ?? t) : t, m.hardUntil ?? t, m.softUntil ?? t);
  }

  /**
   * From when piece `o` may be touched by `m`, at or after `t` (Infinity: not in this pass): never
   * a slime, nor a ghost by a ghost, nor twice by one fade; a robot up on its legs and a faded
   * ghost once they are down or solid; anyone once no longer down, safe or just shoved or spooked.
   */
  touchedFrom(kind, m, o, t) {
    const busy = Math.max(t, o.stunUntil ?? t, o.immuneUntil ?? t);
    if (kind === "spook") {
      if (moveOf(o.character) === "fade" || (m.spooks ?? []).includes(o.seat)) return Infinity;
      return Math.max(busy, o.spookedUntil ?? t);
    }
    if (moveOf(o.character) === "harden") return Infinity;
    return Math.max(busy, o.shovedUntil ?? t, isUp(o, t) ? (o.stiltsUntil ?? t) : t, this.faded(o, t) ? (o.fadedUntil ?? t) : t);
  }

  /**
   * When, between `a` and `b`, walking piece `m` next touches `o` and may (both judged at that
   * moment): the gap comes into reach, or is in reach when the two may first touch. null if not.
   */
  touchOf(kind, m, o, a, b) {
    const [lo, hi] = this.touchBand(kind, m);
    let t = this.touchTime(m, o, a, b, lo, hi);
    // Each look further on starts where the last one may not touch, so it settles in a few steps
    // (every reason there is ends at a time written on a piece). One that has not settled by the
    // end is no touch: never a touch at a moment it may not happen.
    let settled = false;
    for (let i = 0; i < 24 && t !== null; i++) {
      const may = Math.max(this.touchFrom(kind, m, t), this.touchedFrom(kind, m, o, t));
      if (may <= t) {
        settled = true;
        break;
      }
      t = may <= b ? this.touchTime(m, o, may, b, lo, hi) : null;
    }
    if (!settled) return null;
    if (kind === "spook" && !(t < m.fadedUntil)) return null;
    return t;
  }

  /**
   * The gap a touch is, from the toucher to the other piece: either side of a ghost; in front of
   * a walking slime, or just into it (as mayShove allows: a piece it caught up with while the
   * piece was still sliding from its last shove is pushed on, not walked through).
   */
  touchBand(kind, m) {
    if (kind === "spook") return [-SPOOK_REACH, SPOOK_REACH];
    return m.d > 0 ? [-SHOVE_SLACK / 2, SHOVE_REACH] : [-SHOVE_REACH, SHOVE_SLACK / 2];
  }

  /**
   * When, between `a` and `b` (Infinity: ever), the gap from piece `m` to piece `o` first comes into
   * [lo, hi], as both walk on as they are (each at its own speed, a floaty one easing, each stopping
   * at a wall): piece by piece between the moments either changes speed (shared/world.js,
   * walkChanges), in each of which the gap changes evenly (exact, but for a floaty piece's easing,
   * which is followed in short steps). null when it does not.
   */
  touchTime(m, o, a, b, lo, hi) {
    const gap = (t) => posAt(o, t) - posAt(m, t);
    const inner = [...walkChanges(m), ...walkChanges(o)].filter((t) => t > a && t < b).sort((x, y) => x - y);
    const cuts = [a, ...inner, b];
    for (let i = 0; i < cuts.length - 1; i++) {
      const [s, e] = [cuts[i], cuts[i + 1]];
      const r = gap(s);
      if (r >= lo && r <= hi) return s;
      // How fast the gap changes in this piece of time (after the last change the pieces walk on evenly for good).
      const v = e === Infinity ? gap(s + 1) - r : (gap(e) - r) / (e - s);
      const t = v < 0 && r > hi ? s + (r - hi) / -v : v > 0 && r < lo ? s + (lo - r) / v : Infinity;
      if (t <= e) return t;
    }
    return null;
  }

  /**
   * The room's own look along the floor: a walking slime shoves what it walks into, and a ghost
   * walking while faded spooks what it drifts through, judged along the path each piece covered
   * since the room last looked (`sweptAt`), not only where it stands now, so a phone that draws
   * slowly or stalls cannot walk through anyone. A touch counts as the page's shove or boo does
   * (LobbyCore.shove, boo: the same pieces, cooldowns and landing rules), judged at the moment it
   * happened, once per pair in a look.
   *
   * The room only knows where a walking piece is from its phone's last word and the walk since; a
   * touch on that extrapolated path is held for TOUCH_GRACE_MS (pending) before it counts: the
   * phone's word that it stopped short cancels it, its own shove or boo confirms it at once, and
   * with no word by the end (a stalled phone) the room applies it. Returns the messages.
   */
  sweep(now) {
    const from = this.sweptAt ?? now;
    this.sweptAt = now;
    const out = [];
    this.pending ??= [];
    this.touching ??= new Set();
    if (!this.floorTime()) {
      this.pending.length = 0;
      this.touching.clear();
      return out;
    }
    this.partTouches(now);
    // Held touches whose grace is over: nobody said otherwise, so they happened.
    for (const p of this.pending.filter((p) => p.t + TOUCH_GRACE_MS <= now)) {
      this.pending.splice(this.pending.indexOf(p), 1);
      const relay = this.applyTouch(p, now);
      if (relay) out.push(relay);
    }
    if (now > from) {
      const done = new Set(this.pending.map((p) => `${p.s}>${p.to}`));
      for (let guard = 0; guard < 16; guard++) {
        const touch = this.firstTouch(from, now, done);
        if (!touch) break;
        done.add(touch.key);
        // Kept with it: where the toucher's walk began and which way it walked then, so it is judged
        // as it was even if the room moves or stops the piece meanwhile (a knock, a dropped phone).
        const held = { kind: touch.kind, s: touch.m.seat, to: touch.o.seat, t: touch.t, ox: posAt(touch.o, touch.t), band: this.touchBand(touch.kind, touch.m), from: touch.m.x, d: touch.m.d, sx: posAt(touch.m, touch.t) };
        const said = touch.t <= (touch.m.saidAt ?? -Infinity) + 1;
        // On the phone's own word (the touch came as it said where it is), or held long enough already: it counts now.
        if (said || touch.t + TOUCH_GRACE_MS <= now) {
          const relay = this.applyTouch(held, now);
          if (relay) out.push(relay);
        } else this.pending.push(held);
      }
    }
    if (out.length) this.lastActive = now;
    return out;
  }

  /**
   * A held or seen touch counts: the shove or the spook, judged when it happened (LobbyCore.shove,
   * boo with its time). Returns the message for everybody, or null when it was refused.
   */
  applyTouch(p, now) {
    const result = p.kind === "spook" ? this.boo(p.s, p.to, now, p.t, p.d) : this.shove(p.s, p.to, now, p);
    // Judged: not judged again while the two stay in reach; forgotten as soon as they part. A touch
    // that was refused is not marked (it may yet count while they are in reach), except one against
    // a piece that will not go further (a wall, or a light it may not be pushed into): that stays so
    // while the two stay in reach, and looking at it again would only refuse it again.
    if (result.ok || result.stuck) {
      this.touching ??= new Set();
      this.touching.add(`${p.s}>${p.to}`);
    }
    this.partTouches(now);
    return result.ok ? result.relay : null;
  }

  /** Takes the held touch of `kind` by seat `s` on seat `to`, if there is one. */
  takePending(kind, s, to) {
    const i = (this.pending ?? []).findIndex((p) => p.kind === kind && p.s === s && p.to === to);
    return i === -1 ? null : this.pending.splice(i, 1)[0];
  }

  /**
   * The phone of seat `s` said where its piece is: the walk from where it began (where the room
   * last had it when the touch was held: `from` on each, else `fromX`) to `toX`. Each touch held for
   * that piece happened if that walk reached it (it counts now, judged when it happened), and did
   * not if the piece stopped short (it is dropped). Returns the messages for everybody.
   */
  settleTouches(s, fromX, toX, now) {
    const out = [];
    for (const p of (this.pending ?? []).filter((p) => p.s === s)) {
      this.pending.splice(this.pending.indexOf(p), 1);
      const [lo, hi] = p.band;
      if (touchAt(p.ox - (p.from ?? fromX), p.ox - toX, lo, hi) === null) continue;
      const relay = this.applyTouch(p, now);
      if (relay) out.push(relay);
    }
    return out;
  }

  /**
   * The first touch between `from` and `to` not yet in `done`: {t, m, o, kind, key}, or null. Each
   * piece walks steadily over that time (every change to a piece comes after a look: dueMoves),
   * except one the room moved meanwhile, which is looked at from when it was moved. Whether the
   * toucher may touch is judged at the touch's own time.
   */
  firstTouch(from, to, done) {
    let best = null;
    for (const m of this.present()) {
      const kind = this.toucher(m);
      if (!kind) continue;
      for (const o of this.present()) {
        const key = `${m.seat}>${o.seat}`;
        // A pair judged already and still in reach (touching) is not judged again until it parts.
        if (o === m || done.has(key) || this.touching?.has(key)) continue;
        const start = Math.max(from, m.t, o.t);
        if (!(start < to)) continue;
        const t = this.touchOf(kind, m, o, start, to);
        if (t !== null && (!best || t < best.t)) best = { t, m, o, kind, key };
      }
    }
    return best;
  }

  /** Forgets the pairs judged in reach (touching) that have since parted, or stopped walking. */
  partTouches(now) {
    for (const key of this.touching ?? []) {
      const [m, o] = key.split(">").map((s) => this.members[Number(s)]);
      const kind = m && o ? this.toucher(m) : null;
      const [lo, hi] = kind ? this.touchBand(kind, m) : [0, -1];
      const r = kind ? posAt(o, now) - posAt(m, now) : 0;
      if (!kind || r < lo || r > hi) this.touching.delete(key);
    }
  }

  /**
   * When the room should next look along the floor (sweep): the moment a walking slime or a faded
   * ghost, as everyone walks now, will reach another piece (exactly, however far ahead), a piece a
   * slime pushes against may be shoved again, or a held touch's grace ends. null when none.
   */
  nextTouch(now) {
    if (!this.floorTime()) return null;
    let at = Infinity;
    for (const p of this.pending ?? []) at = Math.min(at, p.t + TOUCH_GRACE_MS);
    for (const m of this.present()) {
      const kind = this.toucher(m);
      if (!kind) continue;
      for (const o of this.present()) {
        const key = `${m.seat}>${o.seat}`;
        if (o === m || this.touching?.has(key) || (this.pending ?? []).some((p) => p.s === m.seat && p.to === o.seat)) continue;
        const t = this.touchOf(kind, m, o, now, Infinity);
        // A touch due now was looked at already (sweep runs first): only one still to come.
        if (t !== null && t > now) at = Math.min(at, t);
      }
    }
    return at === Infinity ? null : at;
  }

  /** One robot's hook, judged: what it caught and what came of it (shared/robot.js). Returns `hk` for everybody, or null when it is not time yet. */
  judgeHook(m, now) {
    const hook = m.hook;
    // Not the pieces' time any more (a game started, the party went to the Table), or long gone (a sleep): dropped.
    if (!this.floorTime() || moveOf(m.character) !== "hook" || now - hook.at > HOOK_LIFE_MS + 5000) {
      m.hook = null;
      return { t: "hk", s: m.seat, o: "off" };
    }
    const seen = Math.min(now - HOOK_LATE_MS, hookEndsAt(hook));
    const hit = firstCatch(hook, this.hookTargets(m, now), hook.at, seen);
    if (!hit) {
      // Nothing yet: someone may still walk into it, or it reaches the end and winds back.
      if (now - HOOK_LATE_MS >= hookEndsAt(hook)) {
        m.hook = null;
        return { t: "hk", s: m.seat, o: "miss" };
      }
      hook.judgeAt = this.nextCatch(m, now - HOOK_LATE_MS) + HOOK_LATE_MS;
      return null;
    }
    const o = this.members[hit.seat];
    const strikeAt = hit.t;
    // The hook is judged by what the piece was doing when the tip reached it (`strikeAt`), with
    // HOOK_LATE_MS for the network: a harden, an absorb or a fade the room heard later than that
    // does not count, however late the room wakes for it (a piece that walked into the hook is met
    // earlier than the room first worked out).
    const heard = (start) => (start ?? -Infinity) <= strikeAt + HOOK_LATE_MS;
    const fadedThen = moveOf(o.character) === "fade" && strikeAt < (o.fadedUntil ?? 0) && heard(o.fadeAt);
    const hardThen = strikeAt < (o.hardUntil ?? 0) && heard(o.slimeAt);
    const softThen = strikeAt < (o.softUntil ?? 0) && heard(o.softAt);
    // Down, just up or being pulled when the tip got there: it passes over it, as over a jump.
    const passed = isSafe(o, strikeAt) && !fadedThen;
    const ox = posAt(o, now);
    const robotX = posAt(m, now);
    const side = Math.sign(ox - robotX) || hook.dir;
    const base = { t: "hk", s: m.seat, to: o.seat, hx: Math.round(ox) };
    // A jump clears it (a robot has no jump: its legs are its jump, and they do not): it flies on.
    const jumped = moveOf(o.character) !== "hook" && jumpedOver(o.jumpAt, strikeAt);
    if (jumped || passed) {
      hook.past.push(o.seat);
      hook.judgeAt = this.nextCatch(m, Math.max(hook.at, now - HOOK_LATE_MS)) + HOOK_LATE_MS;
      if (hook.judgeAt <= now) hook.judgeAt = now + 1;
      return jumped ? { ...base, o: "jumped", go: 1 } : null;
    }
    m.hook = null;
    // A faded ghost: it passes through, and the robot is scared off the other way (shared/ghost.js).
    if (fadedThen) {
      this.throwPiece(m, -side, now, SCARE_LANDING);
      Object.assign(m, { stunUntil: now + HOOK_SCARE_MS, immuneUntil: now + HOOK_SCARE_MS + IMMUNE_MS, fright: "hookscare" });
      return { ...base, o: "scare", x: m.x, rev: m.rev };
    }
    // A pawn's kick as it arrives bats it away.
    if (moveOf(o.character) === "kick" && battedAway(o.bumpAt, o.bumpFace, ox, robotX, strikeAt)) return { ...base, o: "parry" };
    // A hardened slime: it clangs off.
    if (hardThen) return { ...base, o: "clang" };
    // An absorbing slime: it sticks, and the robot is dragged to the slime.
    if (softThen) {
      this.slidePiece(m, ox - side * HOOK_HOLD, now);
      this.interrupt(m, now);
      Object.assign(m, { stunUntil: now + PULL_MS, immuneUntil: now + PULL_MS + PULLED_SAFE_MS, fright: "pull" });
      return { ...base, o: "stuck", x: m.x, rev: m.rev };
    }
    // The hook back: a robot whose own hook is out at this one, or that pulled this one a moment
    // ago. Both are yanked to the middle and bonk heads (the owner's pick: a bonk, no swap).
    const back = o.hook && Math.sign(robotX - posAt(o, now)) === o.hook.dir;
    if (moveOf(o.character) === "hook" && (back || (o.pulled?.seat === m.seat && now - o.pulled.at <= HOOK_BACK_MS))) {
      if (o.hook) o.hook = null;
      const mid = (robotX + ox) / 2;
      this.slidePiece(m, mid - side * (HOOK_HOLD / 2), now);
      this.slidePiece(o, mid + side * (HOOK_HOLD / 2), now);
      for (const r of [m, o]) {
        this.interrupt(r, now);
        Object.assign(r, { stunUntil: now + BONK_MS, immuneUntil: now + BONK_MS + PULLED_SAFE_MS, fright: "bonk" });
      }
      return { ...base, o: "bonk", x: m.x, rev: m.rev, ox: o.x, orev: o.rev };
    }
    // The pull: dragged across the floor to the robot, upright.
    const from = ox;
    this.pulledTo(o, robotX + side * HOOK_HOLD, now);
    m.pulled = { seat: o.seat, at: now, rev: o.rev };
    const relay = { ...base, o: "pull", x: o.x, rev: o.rev };
    // The hook train: a robot pulled while it drags a catch brings the catch along behind it, by
    // the rules of a pull: only a catch that nothing has moved since this robot caught it (not
    // kicked, spooked or shoved meanwhile), and not one that has hardened, gone soft or faded since.
    const caught = o.pulled && now - o.pulled.at <= TRAIN_MS ? this.members[o.pulled.seat] : null;
    const still = caught && caught.seat !== m.seat && caught.rev === o.pulled.rev && !isHard(caught, now) && !isSoft(caught, now) && !this.faded(caught, now);
    o.pulled = null;
    if (still) {
      const behind = Math.sign(posAt(caught, now) - from) || side;
      this.pulledTo(caught, o.x + behind * HOOK_HOLD, now);
      relay.tr = { s: caught.seat, x: caught.x, rev: caught.rev };
    }
    return relay;
  }

  /**
   * A piece a hook drags across the floor to `to` (a pull, or the catch of a hook train): it lands
   * by the room's rule (slidePiece), its legs drop and whatever it was doing ends, and a hook it has
   * out keeps flying from where it now is (hooked while hooking). Then it slides, upright.
   */
  pulledTo(o, to, now) {
    const from = posAt(o, now);
    this.slidePiece(o, to, now);
    if (isUp(o, now)) o.stiltsUntil = now;
    if (isSoft(o, now)) o.softUntil = now;
    if (isHard(o, now)) o.hardUntil = now;
    if (o.hook) o.hook.x0 += o.x - from;
    Object.assign(o, { stunUntil: now + PULL_MS, immuneUntil: now + PULL_MS + PULLED_SAFE_MS, fright: "pull" });
  }

  /**
   * The robot's stilt legs (its jump): up for STILT_MS, over a kick and over pieces. Returns
   * {relay} for everybody, or {ok: false, why, wait, bad} for that page only.
   */
  stilts(seat, now) {
    const m = this.members[seat];
    if (!m) return { ok: false, why: "You are not in this party." };
    const hooks = moveOf(m.character) === "hook";
    // Its legs work wherever the pieces walk, as a jump does.
    const may = mayStilt(m, now, { hooks, lobby: this.piecesWalk(), hooking: !!m.hook, slack: COOLDOWN_SLACK_MS });
    if (!may.ok) return { ...may, bad: (!hooks && !(now - (m.lookAt ?? -Infinity) <= SHOVE_LATE_MS)) || (!!may.cooling && tooEager(may.wait)) };
    Object.assign(m, { stiltAt: now, stiltsUntil: now + STILT_MS });
    this.lastActive = now;
    return { ok: true, relay: { t: "stilts", s: seat, for: STILT_MS } };
  }

  /**
   * The slime's move: `kind` "harden" (the press) or "absorb" (the press held: the harden just
   * begun turns soft). Returns {relay} for everybody, or {ok: false, why, wait, bad} for that page
   * only (lobby/shared/slime.js).
   */
  slime(seat, kind, now) {
    const m = this.members[seat];
    if (!m) return { ok: false, why: "You are not in this party." };
    const slimes = moveOf(m.character) === "harden";
    if (kind !== "harden" && kind !== "absorb") return { ok: false, why: "That is not a move.", bad: true };
    const may = maySlime(m, kind, now, { slimes, lobby: this.floorTime(), slack: COOLDOWN_SLACK_MS });
    if (!may.ok) return { ...may, bad: (!slimes && !(now - (m.lookAt ?? -Infinity) <= SHOVE_LATE_MS)) || (!!may.cooling && tooEager(may.wait)) };
    if (kind === "harden") Object.assign(m, { slimeAt: now, hardUntil: now + HARDEN_MS, softUntil: 0, slimeTurned: false });
    else Object.assign(m, { hardUntil: now, softAt: now, softUntil: now + ABSORB_MS, slimeTurned: true });
    this.lastActive = now;
    return { ok: true, relay: { t: "slime", s: seat, k: kind, for: kind === "harden" ? HARDEN_MS : ABSORB_MS } };
  }

  /**
   * The heavy slime: walking, it says it touched the piece in seat `to`, and the room checks it
   * (shared/slime.js, mayShove: close enough and in front by the room's own reckoning, walking,
   * not a slime, a robot up on its legs or a faded ghost, not shoved a moment ago). The piece is
   * pushed a step on, upright: out of its light perhaps, but never into another
   * (shared/moves.js). Returns {relay} or {ok: false, why, bad}; `bad`: no real page sends it.
   */
  shove(seat, to, now, seen = null) {
    // A touch the room saw along the slime's path (sweep): when it happened, which way the slime
    // walked then and where it stood ({t, d, sx}), judged as it was then, not as the slime is now
    // (its phone may have dropped, or the room knocked or hooked it since).
    const touchedAt = seen?.t ?? null;
    const m = this.members[seat];
    if (!m) return { ok: false, why: "You are not in this party." };
    const slimes = moveOf(m.character) === "harden";
    const real = Number.isInteger(to) && to !== seat && to >= 0 && to < this.members.length;
    if (!slimes) return { ok: false, why: "Only a slime shoves.", bad: !(now - (m.lookAt ?? -Infinity) <= SHOVE_LATE_MS) };
    if (!real) return { ok: false, why: "Nobody there.", bad: true };
    const o = this.members[to];
    if (!o || !this.floorTime()) return { ok: false, why: "Nobody there.", bad: false };
    // The slime's own phone says it touched a piece the room saw it touch and is holding (sweep,
    // pending): that touch is confirmed, and judged as the phone's own shove always is, as things
    // stand now (it keeps pushing what it walks into), with no doubt about the distance.
    const held = touchedAt === null ? this.takePending("shove", seat, to) : null;
    // A touch the room saw itself is judged as it was when it happened: both pieces where they
    // were then, the slime walking and not hard, soft or down then, the piece shovable then.
    const at = touchedAt ?? now;
    if (isDown(m, at) || isHard(m, at) || isSoft(m, at)) return { ok: false, why: "Not now.", bad: false };
    const sx = seen?.sx ?? posAt(m, at);
    const d = seen?.d ?? held?.d ?? m.d;
    const x = posAt(o, at);
    const may = mayShove(sx, d, { ...o, x, slime: moveOf(o.character) === "harden", up: isUp(o, at), faded: this.faded(o, at) }, at, touchedAt !== null || !!held);
    if (!may.ok) return { ...may, bad: Math.abs(x - sx) > SHOVE_FAR };
    // A step on, and in front of the slime: it keeps pushing what it walks into (shared/slime.js).
    // Judged as it was when it happened: never further than a page's own shove then moved it
    // (SHOVE_AHEAD), however late it is counted, from where the piece stands now (it may have
    // walked since).
    const from = posAt(o, now);
    const ahead = d > 0 ? Math.max(x + SHOVE_STEP, sx + SHOVE_AHEAD) : Math.min(x - SHOVE_STEP, sx - SHOVE_AHEAD);
    const shift = Math.max(-SHOVE_AHEAD, Math.min(SHOVE_AHEAD, ahead - x));
    const dest = from + shift;
    // Nowhere to go (a wall, or a light it may not be pushed into): it stays, and nothing is said.
    if (Math.abs(slideLanding(from, clampX(dest), this.landingWall(), this.litPlaces()) - from) < 1) return { ok: false, why: "It will not go further.", bad: false, stuck: true };
    this.slidePiece(o, dest, now);
    // A robot shoved with its hook out throws it from where it now stands.
    if (o.hook) o.hook.x0 += o.x - from;
    Object.assign(o, shoved(now));
    this.lastActive = now;
    return { ok: true, relay: { t: "shove", s: seat, to, x: o.x, rev: o.rev } };
  }

  /** Every move a piece has going ends (a change of character, a switch of room): its hook is dropped. */
  endMoves(m, now) {
    if (isUp(m, now)) m.stiltsUntil = now;
    if (isHard(m, now)) m.hardUntil = now;
    if (isSoft(m, now)) m.softUntil = now;
    m.chargeAt = null;
    this.dropHook(m);
    // And any touch the room was holding for it, either way round.
    if (this.pending) this.pending = this.pending.filter((p) => p.s !== m.seat && p.to !== m.seat);
  }

  /**
   * An emote from a player (the kit's rules: party-kit/client/emotes.js). Returns {relay} for
   * everybody else, or {refused, wait} for the sender: too soon, or not allowed while the game
   * being played says so. Nothing is scheduled: the cooldown is a time written on the piece.
   */
  emote(seat, id, now) {
    const m = this.members[seat];
    // At the Table there are no pieces to perform one: an emote is ignored.
    if (!m || this.plainRoom()) return null;
    const verdict = mayEmote(m.emoteAt, now, { playing: this.activity.kind === "game", rules: this.playRules() });
    if (!verdict.ok) return { refused: waitMessage(verdict.wait), wait: verdict.wait };
    m.emoteAt = now;
    this.lastActive = now;
    return { relay: relayEmote(seat, id) };
  }

  /**
   * A player chooses a character, a colour or both (lobby/shared/characters.js): `msg` is {c, v}.
   * Kept on the member, so it comes back with a reconnect and through a sleep, and is in the room
   * view for every page. Two players may choose the same. Not while a game is on (the game was
   * handed its colours when it began), and not again within a moment: measured at arrival, with
   * LOOK_SLACK_MS given for the network. Returns {ok, changed} or {ok: false, why}, and for a
   * change that came too soon `wait`, the cooldown still left (the page sends it again then).
   */
  setLook(seat, msg, now) {
    const m = this.members[seat];
    if (!m) return { ok: false, why: "You are not in this party." };
    const look = readLook(msg);
    if (look.error) return { ok: false, why: look.error };
    if (this.activity.kind === "game") return { ok: false, why: "A game is on. You can change your piece when it ends." };
    const character = look.character ?? m.character;
    const colour = look.colour ?? m.colour;
    if (character === m.character && colour === m.colour) return { ok: true, changed: false };
    const gap = now - (m.lookAt ?? -Infinity);
    if (gap < LOOK_COOLDOWN_MS - LOOK_SLACK_MS) return { ok: false, why: "Wait a moment before changing it again.", wait: LOOK_COOLDOWN_MS - gap };
    // A ghost that changes character mid-fade is solid at once: the new piece has its vote
    // (lobby-room.js looks at the vote again and tells every page the fade is over: `unfaded`).
    const unfaded = character !== m.character && this.faded(m, now);
    if (unfaded) m.fadedUntil = now;
    // Whatever else its move had going ends too: a robot's legs and hook, a slime's harden.
    if (character !== m.character) {
      this.endMoves(m, now);
      // It walks on from here at the new character's own speed (shared/world.js, walkSpeed).
      Object.assign(m, { x: posAt(m, now), t: now, vt: null });
    }
    Object.assign(m, { character, colour, lookAt: now });
    this.lastActive = now;
    return { ok: true, changed: true, ...(unfaded ? { unfaded: true } : {}) };
  }

  /** What the game being played allows (its box carries the manifest's word), or the defaults. */
  playRules() {
    const a = this.activity;
    if (a.kind !== "game") return DURING_PLAY;
    return this.boxOf(a.id)?.play ?? DURING_PLAY;
  }

  /** Connected players and connected big screens: what decides which games can be played. */
  party() {
    return { players: this.connected().length, screens: this.screensConnected() };
  }

  /**
   * Whether the pieces walk: in the lobby, and while a game's players are chosen on its spots
   * (the spots are lights, and standing in one is the choice). Bumping stays the lobby's. Never
   * in the plain waiting room (plainRoom): it has no pieces.
   */
  piecesWalk() {
    if (this.plainRoom()) return false;
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

  /** Whether a robot's hook still to be judged reached (or will reach) a piece by `t`, as the room works it out now. */
  hookBefore(t) {
    return this.present().some((m) => m.hook && m.hook.judgeAt - HOOK_LATE_MS <= t);
  }

  /** Whether every connected player stands in a light that counts: what the count needs to run on. */
  standingAll(now) {
    const standing = this.standing(now);
    return this.connected().every((m) => standing[m.seat]);
  }

  /**
   * {seat: the box whose light that piece stands in, or null for the dark}. A switched-off light
   * is the dark. A faded ghost has no vote: the light does not count it (lobby/shared/ghost.js).
   */
  standing(now) {
    const lights = this.lights();
    const wall = this.wall;
    const out = {};
    for (const m of this.present()) {
      const box = this.boxes[lightAt(posAt(m, now), wall)];
      out[m.seat] = box && lights[box.id] === null && !this.faded(m, now) ? box.id : null;
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
      // The plain waiting room has no vote: a count never starts there.
      const ready = !this.plainRoom() && voters.length > 0 && voters.every((m) => standing[m.seat]) && now >= this.holdUntil && !this.closing;
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
      // Only the lobby's vote has leaders: a spot somebody stands on is not a game winning.
      leaders: this.activity.kind === "lobby" ? leaders(tally(standing), order) : [],
      count: this.count ? { endsIn: Math.max(0, this.count.endsAt - now) } : null,
      toss: this.toss ? { between: this.toss.between, winner: this.toss.winner, endsIn: Math.max(0, this.toss.endsAt - now), of: TOSS_MS } : null,
    };
  }

  /**
   * A wake-up: lets time-dependent things happen. Returns {start, close, changed}: `start` is the
   * game the vote chose (the room then calls startGame, or refuseStart when the hosting allowance
   * is spent), `close` is why the room should shut, `changed` that the view moved on.
   */
  tick(now) {
    const out = { start: null, chosen: false, close: null, changed: false };
    // A robot's hook whose time has come is judged first: a voter pulled out of the light just
    // before the count ends stops it, as a kick would (shared/robot.js); and so is a touch along
    // the floor (sweep). `hooks`: the messages for each.
    out.hooks = this.dueMoves(now);
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
      } else if (this.count && now >= this.count.endsAt && out.hooks.length && !this.standingAll(now)) {
        // A hook judged just now pulled a voter out of the light: the count stops (evaluate).
        out.changed = true;
      } else if (this.count && now >= this.count.endsAt && this.hookBefore(this.count.endsAt)) {
        // A hook that reached a voter by the count's end is judged first (a kick at that moment
        // stops the count, and so must a hook): the count ends when it is, a third of a second late at most.
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
    if (inLobby && this.beat && now >= this.beat.at) {
      // The Table's starting beat is over: the game the host picked starts, if the party can
      // still play it (someone may have left, or dropped, during the beat).
      const { id } = this.beat;
      this.beat = null;
      const entry = this.tableEntry(id);
      const why = !this.plainRoom() || !entry || !this.games.has(id) ? "it is not at the Table" : this.closing ? "the party is closing" : tableWhyNot(entry, this.connected().length);
      if (why === null) out.start = id;
      else {
        this.starting = null;
        this.notes.push({ k: "cancelled", text: `${this.nameOf(id)} did not start: ${why[0].toLowerCase()}${why.slice(1)}.` });
      }
      out.changed = true;
    }
    // From here until the room has started the game or decided not to (startDone), nothing may
    // move the party to another room or the other waiting room: the budget check comes between.
    if (out.start) this.starting = out.start;
    if (this.emptySince !== null && now - this.emptySince >= this.emptyLimit(now)) out.close = "empty";
    else if ((inLobby || this.activity.kind === "settings") && !out.start) {
      if (now - this.lastActive >= this.staleLimit()) out.close = "stale";
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
    const defaults = { idleShutdownMs: IDLE_SHUTDOWN_MS, staleRoomMs: this.staleLimit() };
    const a = this.activity;
    return a.kind === "game" ? lifetimesOf(this.games.get(a.id), { ...defaults, staleRoomMs: STALE_ROOM_MS }) : defaults;
  }

  /**
   * How long the room may go with nobody doing anything before it is put away, outside a game:
   * STALE_ROOM_MS, or at the Table while anyone is connected TABLE_STALE_MS (people sit and talk
   * there, and nothing they do reaches the room).
   */
  staleLimit() {
    if (this.activity.kind === "lobby" && this.plainRoom() && this.connected().length + this.screensConnected() > 0) return TABLE_STALE_MS;
    return STALE_ROOM_MS;
  }

  /** The vote's winner was started, or will not be (the budget, an error, a refusal): the room may be switched again. */
  startDone() {
    this.starting = null;
  }

  /** The hosting allowance is spent: no game starts, and the room will close after a few minutes. */
  refuseStart(now, reason = "budget") {
    this.startDone();
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
      at = Math.min(at, this.lastActive + this.staleLimit(), this.createdAt + MAX_ROOM_LIFE_MS);
      if (this.closing) at = Math.min(at, this.closing.at);
      // The count's end, unless a hook that reached someone by then is still to be judged: then that (below).
      if (this.count && !(this.count.endsAt <= now && this.hookBefore(this.count.endsAt))) at = Math.min(at, this.count.endsAt);
      if (this.toss) at = Math.min(at, this.toss.endsAt);
      // The Table's starting beat ends: the picked game starts.
      if (this.beat) at = Math.min(at, this.beat.at);
      // The rest after a game: a count may be due the moment it is over, if anyone is here to vote.
      if (this.holdUntil > now && this.connected().length) at = Math.min(at, this.holdUntil);
      for (const m of this.present()) if (!m.connected && m.droppedAt !== null) at = Math.min(at, m.droppedAt + DROP_FADE_MS);
      // A ghost turning solid again has its vote back: the count may be due.
      for (const m of this.present()) if (this.faded(m, now)) at = Math.min(at, m.fadedUntil);
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
      // A game told who hosts hears when the host's controls pass on: when a dropped host's grace ends.
      const host = this.identify(this.hostToken);
      const m = host?.role === "player" ? this.members[host.seat] : null;
      if (typeof this.turnGame().host === "function" && m && !m.connected && m.droppedAt + HOST_GRACE_MS > now) at = Math.min(at, m.droppedAt + HOST_GRACE_MS);
    }
    // A robot's hook is judged when its tip reaches a piece (shared/robot.js): one wake-up a hook.
    // Whatever the room is doing: one still out when the party left the room is dropped then.
    for (const m of this.present()) if (m.hook) at = Math.min(at, m.hook.judgeAt);
    // A walking slime or faded ghost about to reach someone: the room looks then (sweep), whether
    // or not that phone says so.
    at = Math.min(at, this.nextTouch(now) ?? Infinity);
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
    // Whatever happens next, the start the vote chose is being dealt with now.
    this.startDone();
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
   * each seat (vote.js, spotLights). Null when no spots are needed. The phones that are here count,
   * as they do for the game's light (a dropped piece cannot take a spot). A wall with fewer lights
   * than the game has seats has no spots to offer: partySeats decides who plays.
   */
  spotsFor(id) {
    const box = this.boxOf(id);
    // The plain waiting room has no lights to stand on.
    if (this.plainRoom()) return null;
    if (!needsSpots({ audience: box?.audience, seats: box?.max }, this.connected().length)) return null;
    const places = spotLights(this.boxes, id, box.max);
    return places ? openSpots(places) : null;
  }

  /**
   * The seats that play a game with no spot step: the party. When the game takes an audience and
   * fewer seats than the party (a wall too small for spots, or a dropped piece beside as many
   * phones as seats), the members whose phones are here come first, then the rest, each by seat.
   */
  partySeats(id) {
    // At the Table a game is played by the phones that are here when it starts (the party's size
    // it was picked for): a phone that dropped a moment before is not dealt in to hold a seat.
    if (this.isTableGame(id)) return this.connected().map((m) => m.seat);
    const seats = this.present().map((m) => m.seat);
    const box = this.boxOf(id);
    if (!box?.audience || seats.length <= box.max) return seats;
    const here = (seat) => (this.members[seat].connected ? 0 : 1);
    return [...seats]
      .sort((p, q) => here(p) - here(q) || p - q)
      .slice(0, box.max)
      .sort((p, q) => p - q);
  }

  /** A game's settings fields, checked and in one shape (settings.js, settingFields); worked out once per game. */
  fieldsOf(id) {
    if (!this.fieldCache.has(id)) this.fieldCache.set(id, settingFields(this.fields.get(id)).fields);
    return this.fieldCache.get(id);
  }

  /** The box on the wall for a game id. */
  boxOf(id) {
    return this.boxes.find((box) => box.id === id) ?? this.tableEntry(id);
  }

  /** The entry on the Table's list for a game id (lobby/shared/table.js), or null. */
  tableEntry(id) {
    return this.table.find((entry) => entry.id === id) ?? null;
  }

  /** A game's name as people read it, for notes and the card. */
  nameOf(id) {
    return this.boxOf(id)?.name ?? id;
  }

  /**
   * The vote chose a game with settings: the room's activity is the settings step. Its first picks
   * are the settings this game was last started with, when the game still takes them, and
   * otherwise its defaults (the fields' defaults, cleaned by `game.settings`). The players are the
   * party as it is now (its first members by seat, for a game with an audience on a wall too small
   * for spots: partySeats), or with spots nobody yet; anyone who joins during the step watches the
   * game. Returns {ok, choosing}.
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
    // The party, or its first members by seat when the game takes fewer and the wall is too small for spots.
    const seats = this.partySeats(id);
    if (!seats.length) return fail("not_ready", "Nobody is here to play.");
    this.count = null;
    this.toss = null;
    // Who sits in each seat, by token (kept in storage only, never in a view): at Start only these
    // people play, whoever may sit in their seats by then. With spots (a party larger than the
    // game's seats) nobody plays until they stand on one, and a piece is written down here as it
    // steps on (fillSpots): the pieces start again by the door, out of every light, and walk there.
    const chosen = spots ? [] : seats;
    const players = Object.fromEntries(chosen.map((seat) => [seat, this.members[seat].token]));
    this.activity = { kind: "settings", id, picks: first.settings, seats: chosen, players, party: this.partyTokens(), endsAt: now + SETTINGS_MS, startedAt: now };
    if (spots) {
      this.activity.spots = spots;
      this.respawn(now);
    }
    this.lastActive = now;
    return { ok: true, choosing: true, ended: null };
  }

  /** Every piece back by the door, standing still and solid, moved by the room (so each page takes its place). */
  respawn(now) {
    for (const m of this.present()) {
      // A faded ghost's fade ends here (a switch of waiting room, players chosen on spots).
      if ((m.fadedUntil ?? 0) > now) m.fadedUntil = now;
      // And so do a robot's legs and hook and a slime's harden.
      this.endMoves(m, now);
      m.x = spawnX(m.seat, this.wall);
      m.d = 0;
      m.t = now;
      m.rev += 1;
    }
  }

  /** Whether this device may start the game now: the host, and with every spot taken when players are chosen on spots. */
  mayStart(token, now = Infinity) {
    const may = this.mayChoose(token, now);
    if (!may.ok) return may;
    if (this.choosingSpots() && !spotsFull(this.activity.spots)) {
      const n = this.activity.spots.length;
      return fail("spots_open", `${n === 2 ? "Two" : n} players must stand on the spots first.`);
    }
    return may;
  }

  /** Whether this device may choose the settings: the party's host (the one who picks the room, pickerToken). */
  mayChoose(token, now = Infinity) {
    if (this.activity.kind !== "settings") return fail("not_choosing", "No settings are being chosen.");
    if (!token || (token !== this.pickerToken(now) && token !== this.hostToken)) return fail("not_host", "Only the one who started the party chooses the settings.");
    return { ok: true, id: this.activity.id };
  }

  /**
   * The host changes some settings (`change` is {key: value}). Each value must be one of its
   * field's options, and the whole is checked by `game.settings`; what it gives back is the new
   * picks. Returns {ok, picks} or {ok: false, error, message} with the game's own words.
   */
  chooseSettings(token, change, now) {
    const may = this.mayChoose(token, now);
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
    const may = this.mayChoose(token, now);
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
    // With spots, the players are not chosen yet: anyone still in the party may take a spot (a
    // dropped phone may come back), and every spot must be taken, so fewer members than spots end it.
    const spots = Array.isArray(a.spots);
    const here = spots ? this.present().length : this.stepPlayers().length;
    if (here >= (spots ? a.spots.length : Math.max(1, box?.min ?? 1))) return false;
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
    this.startDone();
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
    const seats = seatNumbers.map((seat) => this.members[seat]).filter(Boolean).map((m) => ({ seat: m.seat, name: m.name, kind: "human", colour: m.colour, character: m.character }));
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
    // Who was in the party when the match began: the party the settings step was opened for, or
    // the party now when the game starts straight from the vote (lateJoiner).
    const party = this.activity.kind === "settings" ? (this.activity.party ?? null) : this.partyTokens();
    // The host's seat (-1 for the room's screen), for a game that has a host of its own (a Table game's rules).
    const host = this.pickerView(now)?.seat ?? -1;
    if (typeof game.host === "function") context.host = host;
    let state;
    try {
      state = game.create(context);
    } catch (err) {
      // A game that refuses to start (a Table game's rules refusing these seats) starts nothing.
      console.error(`party room: ${id} could not start`, err);
      this.round -= 1;
      if (this.activity.kind === "settings") this.toLobby(now);
      this.notes.push({ k: "cancelled", text: `${this.nameOf(id)} could not start.` });
      return fail("bad_game", `${id} could not start: ${err?.message ?? err}`);
    }
    // A robot's hook still out, its legs, a slime's harden: all over when a game starts.
    for (const m of this.present()) this.endMoves(m, now);
    this.activity = { kind: "game", id, state, startedAt: now, ticks: 0, seats: seats.map((s) => s.seat), party };
    if (isTurnBased(game)) {
      // The host's seat as the game was last told it (a game with a `host` hook hears of a change: turnUpkeep).
      this.activity.host = host;
      // Seats that left this game for good while it goes on without them (a game with a `leave`
      // hook), and members told they joined it late (a `join` hook) or that it would not take:
      // nobody new sits in a gone seat until the game ends (join).
      this.activity.gone = [];
      this.activity.declined = [];
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
   * big screen is the screen, and a member whose seat is not in the game watches it with a
   * screen's view. The one place the party room decides who sees what. `activity` is the game
   * being shown; it defaults to the current one.
   */
  viewerOf(who, activity = this.activity) {
    if (activity.kind !== "game") return viewerFor(who, null);
    // A game that opts in to an audience (party-kit/src/core/audience.js) gives the members who
    // are not in it `{role: "audience", seat}`; any other keeps them on a screen's view. A member
    // who joined the party in the middle of this match is not its audience: they get the screen's
    // view, with no secrets, until it ends (lateJoiner).
    const audience = hasAudience(this.games.get(activity.id), this.boxOf(activity.id)) && !this.lateJoiner(who, activity);
    return viewerFor(who, new Set(activity.seats), { audience });
  }

  /**
   * The tokens of everyone in the party right now: its members, and the players whose seats are
   * held after their pieces faded (they come back as themselves). Taken when the room leaves the
   * lobby for a match (beginSettings, or createGame straight from the vote) and kept with the
   * activity, in storage only.
   */
  partyTokens() {
    return [...this.present().map((m) => m.token), ...this.held.keys()];
  }

  /**
   * Whether a member ({role, seat}) who does not play this match is new to the party since the
   * room left the lobby for it (the activity's `party`, taken when the vote's game was taken up):
   * a phone or tab opened mid-match, a player's second device included. Such a member watches the
   * match as the big screen does, so a player cannot read their own secret on a second phone.
   * (Someone who joins during a spot step and takes a spot plays: a player's view is the same for
   * whoever holds the seat, and everyone sees who stands on the spots.) Someone who was in the
   * party then keeps their role through a drop, a locked phone, a second socket or a sleep: the
   * token is the same. The mark goes with the activity: every way a match ends puts the room back
   * in the lobby, and the next match takes the party afresh. A step or match saved before the
   * party was kept has no `party`, and marks nobody.
   */
  lateJoiner(who, activity = this.activity) {
    if (who?.role !== "player" || !Array.isArray(activity.party) || activity.seats?.includes(who.seat)) return false;
    const m = this.members[who.seat];
    return !m || !activity.party.includes(m.token);
  }

  /** The seats of the members who joined in the middle of this match (lateJoiner), for the room view. */
  lateSeats(activity = this.activity) {
    return this.present()
      .map((m) => m.seat)
      .filter((seat) => this.lateJoiner({ role: "player", seat }, activity));
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

  /**
   * What a turn-based game's change gives the room. `gone` ({seat, why}) is set when the change
   * was a seat leaving: a game that ended because of it and places nobody (Paper Masks' waiting
   * step, left with fewer than three) ends as an abandoned one does, the note and the card saying
   * who left, so the card is never silent about why.
   */
  turnOut(game, events, now, gone = null) {
    const a = this.activity;
    const out = { events, snapshot: (viewer) => game.snapshot(a.state, now, viewer), viewerOf: (who) => this.viewerOf(who, a), ended: null };
    if (!game.isOver(a.state)) return out;
    const places = gone && game.standings ? game.standings(a.state) : null;
    if (gone && Array.isArray(places) && !places.some((p) => p?.place >= 1)) {
      out.ended = this.finishGame(now, { standings: [], result: game.result ? game.result(a.state) : null, early: this.endedByGoing(gone.seat, gone.why) });
    } else if (gone && Array.isArray(places) && !places.some((p) => p?.seat === gone.seat && p.place >= 1)) {
      // The seat that went forfeits and the game places the rest (Who Am I?): the card says so.
      const winners = places.filter((p) => p?.place === 1).map((p) => this.members[p.seat]?.name ?? a.names?.[p.seat] ?? "The other player");
      out.ended = this.finishGame(now, { standings: places, result: game.result ? game.result(a.state) : null, early: this.endedByGoing(gone.seat, gone.why, winners) });
    } else out.ended = this.finishGame(now);
    return out;
  }

  /**
   * A seat gone for good ended the game being played: everyone's note, and the card's `early`.
   * `winners` (names) when the game gave the match to those who stayed: "Bo left, so Ann wins."
   */
  endedByGoing(seat, why, winners = null) {
    const a = this.activity;
    const name = this.members[seat]?.name ?? a.names?.[seat] ?? "A player";
    const gameName = this.nameOf(a.id);
    const went = why === "left" ? `${name} left` : `${name} did not come back`;
    const text = winners?.length ? `${went}, so ${winners.join(" and ")} ${winners.length > 1 ? "win" : "wins"}.` : why === "left" ? `${name} left the party, so ${gameName} ended.` : `${name} did not come back, so ${gameName} ended.`;
    this.notes.push({ k: "ended", why, seat, name, colour: seatColour(seat), text });
    return { seat, name, why, text };
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
    const a = this.activity;
    const grace = graceOf(game, TURN_GRACE_MS);
    const events = [];
    let changed = false;
    for (const seat of [...a.seats]) {
      const why = goneWhy(this.members[seat], now, grace);
      if (!why) continue;
      // A game without a `leave` hook ends when a seat is gone for good (abandon). One with it is
      // told (a Table game's `{t: "leave", seat}`) and goes on without that seat, or ends by itself.
      if (typeof game.leave !== "function") return this.abandonGame(game, seat, why, now);
      // A match the game had decided before the seat went keeps that seat's place (finishGame).
      if (typeof game.decided === "function" && game.decided(a.state) === true) (a.kept ??= []).push(seat);
      const out = this.callHook(game, "leave", seat, now);
      if (out.error) return this.stopGame(game, "error", now);
      a.seats = a.seats.filter((s) => s !== seat);
      (a.gone ??= []).push(seat);
      delete a.told[seat];
      changed = true;
      events.push(...out.events);
      if (game.isOver(a.state)) return { ok: true, ...this.turnOut(game, events, now, { seat, why }) };
    }
    // Someone in the party who is not in the game (they joined it late, or were not here when it
    // began): a game with a `join` hook is told (a Table game's `{t: "join", seat}`), and from then
    // on that seat is the game's, to see and send what the game allows. One it turns down watches
    // as the big screen does, and is not asked again during this game.
    if (typeof game.join === "function") {
      for (const m of this.connected()) {
        if (a.seats.includes(m.seat) || a.gone?.includes(m.seat) || a.declined?.includes(m.seat)) continue;
        const out = this.callHook(game, "join", m.seat, now);
        if (out.error) return this.stopGame(game, "error", now);
        if (!out.ok) {
          (a.declined ??= []).push(m.seat);
          continue;
        }
        a.seats.push(m.seat);
        a.told[m.seat] = reportOf(m);
        a.names[m.seat] = m.name;
        changed = true;
        events.push(...out.events);
      }
    }
    // The host's controls moved to another player (the host left, or is away past the grace): a
    // game with a `host` hook is told (a Table game's `{t: "host", seat}`).
    if (typeof game.host === "function") {
      const seat = this.pickerView(now)?.seat ?? -1;
      if (seat !== a.host && a.seats.includes(seat)) {
        const out = this.callHook(game, "host", seat, now);
        if (out.error) return this.stopGame(game, "error", now);
        a.host = seat;
        changed = true;
        events.push(...out.events);
      }
    }
    if (changed && game.isOver(a.state)) return { ok: true, ...this.turnOut(game, events, now) };
    const told = this.tellPresence(game, now);
    if (told.error) return this.stopGame(game, "error", now);
    if (told.changed || changed) {
      delete a.stuck;
      // `room`: the game's seats changed (a join or a leave), which every page reads in the room view.
      return { ok: true, room: changed, ...this.turnOut(game, [...events, ...told.events], now) };
    }
    // Only what the game was told changed: saved, so a wake does not tell it again; nothing is sent.
    return told.told ? { ok: true, quiet: true } : null;
  }

  /**
   * Calls one of a turn-based game's room hooks (`join`, `leave`, `host`) for a seat. It returns
   * `false` or `{ok: false}` to turn it down, and otherwise nothing, `true`, a list of events or
   * `{events}`. Returns {ok, events, error}: `error` when the hook threw (the game then ends).
   */
  callHook(game, name, seat, now) {
    const a = this.activity;
    let returned;
    try {
      returned = game[name](a.state, seat, now);
    } catch (err) {
      console.error(`party room: ${a.id} ${name}() failed; the game ends with no points`, err);
      return { ok: false, events: [], error: err };
    }
    if (returned === false || returned?.ok === false) return { ok: false, events: [], error: null };
    const events = Array.isArray(returned) ? returned : Array.isArray(returned?.events) ? returned.events : [];
    return { ok: true, events, error: null };
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
   * the room is closing (the budget), or the host ended it at the Table (`host`, with `by`, who:
   * {seat, name}). Everyone gets a note saying why. No last snapshot is sent after an error: the
   * state may be half changed.
   */
  stopGame(game, why, now, by = null) {
    const a = this.activity;
    const gameName = this.nameOf(a.id);
    const text =
      why === "error"
        ? `${gameName} ran into a problem, so it ended.`
        : why === "expired"
          ? `This party has reached its four hours, so ${gameName} ended.`
          : why === "host"
            ? `${by?.name ?? "The host"} ended ${gameName}.`
            : `This party is closing, so ${gameName} ended.`;
    const seat = by?.seat ?? -1;
    const name = by?.name ?? null;
    this.notes.push({ k: "ended", why, seat, name, colour: seat >= 0 ? seatColour(seat) : null, text });
    const out = { ok: true, events: [], snapshot: why === "error" ? null : (viewer) => game.snapshot(a.state, now, viewer), viewerOf: (who) => this.viewerOf(who, a), ended: null };
    out.ended = this.finishGame(now, { standings: [], result: null, early: { seat, name, why, text } });
    return out;
  }

  /**
   * The game being played could not be shown (its view threw): it ends now, with no points, as
   * one whose tick threw does. Returns what stopGame returns, or null when no game is on.
   */
  breakGame(now) {
    const a = this.activity;
    if (a.kind !== "game") return null;
    return this.stopGame(this.games.get(a.id), "error", now);
  }

  /**
   * The host ends the turn-based game being played at the Table (`{t: "stop"}`): nobody scores,
   * everyone is back at the Table, and the card says who ended it. The same rule as every other
   * host tap says who may: the host, or whoever holds the controls while the host is away.
   * Returns what stopGame returns, or {ok: false, error, message}.
   *
   * A game that says its match is already decided (`game.decided(state)`, optional: a final
   * screen still up, as Paper Masks' curtain) is not thrown away: it ends as a finished match, its
   * places scored as when it ends by itself, once, with no "ended" note and no `last.early`.
   */
  endByHost(token, now) {
    const game = this.turnGame();
    if (!game || !this.plainRoom()) return fail("not_playing", "No game at the Table is being played.");
    if (!token || (token !== this.pickerToken(now) && token !== this.hostToken)) return fail("not_host", "Only the one who started the party can end the game.");
    const who = this.identify(token);
    const by = who.role === "screen" ? { seat: -1, name: "The room's screen" } : { seat: who.seat, name: this.members[who.seat].name };
    this.lastActive = now;
    const a = this.activity;
    let decided = false;
    try {
      decided = typeof game.decided === "function" && game.decided(a.state) === true;
    } catch (err) {
      console.error(`party room: ${a.id} could not say whether its match is decided`, err);
    }
    if (decided) return { ok: true, events: [], snapshot: (viewer) => game.snapshot(a.state, now, viewer), viewerOf: (socket) => this.viewerOf(socket, a), ended: this.finishGame(now) };
    return this.stopGame(game, "host", now, by);
  }

  /**
   * A seat in the turn-based game is gone for good: the game ends now. `game.abandon`, when the
   * game has it, decides the result (presence.js, abandonOutcome); without it the game ends with
   * no points. Everyone hears why in a note, and the room's card says so too (`last.early`).
   *
   * A match the game had already decided before the seat went (Who Am I?'s match summary, up
   * before the tap to its final results) is not ended by it: `abandon` then places the seat that
   * is gone too, and the room takes that place as the game's word that this is the match's real
   * result. It ends as a finished match, with no "ended" note and no `last.early`.
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
    const out = { ok: true, events: outcome.events, snapshot: (viewer) => game.snapshot(a.state, now, viewer), viewerOf: (who) => this.viewerOf(who, a), ended: null };
    const decided = outcome.standings.some((p) => p?.seat === seat && p.place >= 1);
    const early = decided ? null : this.endedByGoing(seat, why);
    out.ended = this.finishGame(now, { standings: outcome.standings, result: outcome.result, early });
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
   * what `game.abandon` decided, and the card says why it ended (`last.early`) unless the game
   * had decided the match already (`early` is null then).
   *
   * A seat the game places whose member has left the party (a decided match, abandonGame) keeps
   * its row on the card, under the name it played with. The Tonight board is the party's own, so
   * its points are kept for that name, as for anyone who leaves (`remembered`): they are back on
   * the board if that player joins again tonight.
   */
  finishGame(now, ending = null) {
    const a = this.activity;
    const game = this.games.get(a.id);
    const result = ending ? ending.result : game.result ? game.result(a.state) : null;
    const places = ending ? ending.standings : game.standings ? game.standings(a.state) : standingsFromRows(result);
    const rows = [];
    for (const { seat, place } of places ?? []) {
      const m = this.members[seat];
      const name = m?.name ?? a.names?.[seat];
      if (!name || !(a.seats.includes(seat) || a.kept?.includes(seat)) || !(place >= 1) || rows.some((r) => r.seat === seat)) continue;
      const points = pointsForPlace(place);
      if (m) m.points += points;
      else this.rememberPoints(name, points);
      const row = { seat, name, colour: m?.colour ?? seatColour(seat), place, points };
      // A game that keeps score says so in its result rows: the card shows it beside the place.
      const score = Array.isArray(result) ? result.find((r) => r?.seat === seat)?.score : undefined;
      if (typeof score === "number") row.score = score;
      rows.push(row);
    }
    rows.sort((p, q) => p.place - q.place || p.seat - q.seat);
    // The night's list of games, for the board opened large: this one's name and who won it.
    record(this.history, { round: this.round, name: this.nameOf(a.id), rows });
    if (rows.length) this.gamesPlayed += 1;
    this.last = { round: this.round, game: a.id, name: this.nameOf(a.id), rows, at: now };
    if (ending?.early) this.last.early = ending.early;
    this.lastAnswers = a.answers ? { round: this.round, answers: a.answers } : null;
    this.keepCarry(game, a, ending);
    this.activity = { kind: "lobby" };
    for (const m of this.present()) {
      this.endMoves(m, now);
      m.x = spawnX(m.seat, this.wall);
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
        m ? { seat: m.seat, name: m.name, colour: m.colour, character: m.character, connected: m.connected, ...(m.connected && m.away ? { away: true } : {}), x: Math.round(posAt(m, now)), d: m.d, ...this.easingView(m, now), rev: m.rev, points: m.points, ...this.bumpView(m, now), emoteCool: Math.round(emoteLeft(m.emoteAt, now)) } : null,
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
      picker: this.pickerView(now),
      // Which waiting room the party is in (lobby/shared/mode.js): a page showing the other one moves.
      mode: this.mode,
      // At the Table: its list of games, each with why the party cannot play it now, and the game
      // the host just picked while everyone waits for it to start (lobby/shared/table.js).
      ...(this.plainRoom() ? { table: this.tableView(), starting: this.beatView(now) } : {}),
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
    // At the Table every page needs to know who plays and who waits for the next game.
    if (this.isTableGame(a.id)) out.seats = [...a.seats];
    if (hasAudience(this.games.get(a.id), box)) {
      Object.assign(out, { seats: [...a.seats], audience: true });
      // Who joined mid-match and so watches it as the big screen does (lateJoiner).
      const late = this.lateSeats();
      if (late.length) out.late = late;
    }
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
      by: this.pickerView(now)?.seat ?? null,
      endsIn: Math.max(0, a.endsAt - now),
      of: SETTINGS_MS,
    };
  }

  /**
   * What a page needs to show a piece's bump: milliseconds until it may bump again (`cool`),
   * until it is up from the floor (`down`) and until it can be knocked again (`safe`). A ghost's
   * fade, when there is one to tell: how long it is still faded (`faded`) and until it may fade
   * again (`fadeCool`), for a page that arrives in the middle. A scare or a spook (`fright`) in
   * place of a knock, and how long until the piece may be spooked again (`spooked`).
   */
  /** A floaty piece still easing (shared/world.js): how fast it goes now, `v`, for a page that carries it on from this view. */
  easingView(m, now) {
    const v = velAt(m, now);
    return v !== m.d ? { v: Math.round(v * 100) / 100 } : {};
  }

  bumpView(m, now) {
    const faded = this.faded(m, now) ? m.fadedUntil - now : 0;
    const move = moveOf(m.character);
    const fadeCool = move === "fade" ? fadeLeft(m.fadeAt, now) : 0;
    const safe = Math.max(0, (m.immuneUntil ?? 0) - now);
    const spookedFor = Math.max(0, (m.spookedUntil ?? 0) - now);
    // The robot's and the slime's moves (shared/robot.js, shared/slime.js), for a page that arrives
    // in the middle: how long until each may be used again, how far into its legs it is
    // (`stilts`, since they went up), how long it stays hard or soft, and a hook still out (`hook`:
    // how long since it was thrown, and which way).
    const hookCool = move === "hook" ? hookLeft(m.hookAt, now) : 0;
    const stiltCool = move === "hook" ? stiltLeft(m.stiltAt, now) : 0;
    const slimeCool = move === "harden" ? slimeLeft(m.slimeAt, now) : 0;
    const hard = isHard(m, now) ? m.hardUntil - now : 0;
    const soft = isSoft(m, now) ? m.softUntil - now : 0;
    const moves = {
      ...(hookCool > 0 ? { hookCool } : {}),
      ...(stiltCool > 0 ? { stiltCool } : {}),
      ...(slimeCool > 0 ? { slimeCool } : {}),
      ...(isUp(m, now) ? { stilts: now - m.stiltAt } : {}),
      ...(hard > 0 ? { hard } : {}),
      ...(soft > 0 ? { soft } : {}),
      ...(m.hook ? { hook: { in: now - m.hook.at, f: m.hook.dir } } : {}),
      // A pawn charging its kick: how long since the press (shared/bump.js, chargePose).
      ...(this.floorTime() && this.charging(m, now) ? { charge: now - m.chargeAt + CHARGE_MIN_MS } : {}),
      // Knocked by a charged kick's bounce: down this much longer than a knock (shared/bump.js, knocked).
      ...((m.knockExtra ?? 0) > 0 && (m.immuneUntil ?? 0) > now && !m.fright ? { ke: m.knockExtra } : {}),
    };
    return {
      ...moves,
      cool: cooldownLeft(m.bumpAt ?? -Infinity, now),
      down: Math.max(0, (m.stunUntil ?? 0) - now),
      safe,
      ...(faded > 0 ? { faded } : {}),
      ...(fadeCool > 0 ? { fadeCool } : {}),
      // Scared or spooked, not knocked: drawn as that (lobby/shared/ghost.js, frightPose).
      ...(safe > 0 && m.fright ? { fright: m.fright } : {}),
      // Cannot be spooked again for this long: a ghost's page does not ask (SPOOK_AGAIN_MS).
      ...(spookedFor > 0 ? { spooked: spookedFor } : {}),
    };
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
      // The wall the pieces' places were laid against, so a room woken after the wall moved (a
      // deploy) carries them across (restore).
      wall: { xs: this.wall.xs, pools: this.wall.pools.map((p) => ({ id: this.boxes[p.i].id, x: p.x, half: p.half })) },
      mode: this.mode,
      modeAt: this.modeAt,
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
    const { id, state, startedAt, ticks, seats, told, names, answers, stuck, party, host, gone, declined } = this.activity;
    return { id, startedAt, ticks, seats, told, names, answers, stuck, party, host, gone, declined, state: saveState(game, state) };
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
      this.activity.party = partyOf(saved.party);
      // The room hooks' memory (turnUpkeep): who the game knows as host, and the seats gone or turned down.
      const seatList = (list) => (Array.isArray(list) ? list.filter(Number.isInteger) : []);
      this.activity.host = Number.isInteger(saved.host) ? saved.host : -1;
      this.activity.gone = seatList(saved.gone);
      this.activity.declined = seatList(saved.declined);
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
      this.activity = { kind: "settings", id: saved.id, picks: saved.picks, seats: [...saved.seats], players: { ...players }, party: partyOf(saved.party), endsAt: saved.endsAt, startedAt: saved.startedAt ?? saved.endsAt - SETTINGS_MS };
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
    // A member saved before characters is a pawn in its seat's colour; a character or colour this room does not know is read the same way.
    room.members = data.members.slice(0, TABLE_MAX_PLAYERS).map((m) => (m ? { ...m, character: characterOr(m.character), colour: cleanColour(m.colour) ?? seatColour(m.seat), x: m.d || m.vt === m.t ? posAt({ ...m, character: characterOr(m.character) }, now) : m.x, d: 0, t: now, vt: null, chargeAt: null, connected: false, away: false, droppedAt: m.droppedAt ?? now, bumpAt: -Infinity } : null));
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
    // The pieces stood on the wall the room was saved with: a save from before rooms hung their
    // boxes in places of their own stood on the even wall. Where this room's wall is not that one
    // now, every piece is carried across, so nobody's vote changes in the sleep.
    room.carryAcross(savedWall(data.wall, room.boxes), now);
    // A room saved before the two waiting rooms is the character room.
    room.mode = isMode(data.mode) ? data.mode : DEFAULT_MODE;
    room.modeAt = typeof data.modeAt === "number" ? data.modeAt : -Infinity;
    // As many places as that room has (a Table party saved before it had eight comes back with eight).
    room.fitMembers();
    room.hostToken = data.hostToken ?? null;
    room.lastAnswers = data.lastAnswers ?? null;
    room.carries = data.carries ?? {};
    room.lastSettings = data.lastSettings ?? {};
    if (data.game) room.restoreGame(data.game);
    else if (data.choosing) room.restoreChoosing(data.choosing);
    return room;
  }
}

/**
 * The wall a room was saved with (serialize: {xs, pools: [{id, x, half}]}), its pools matched to
 * today's boxes by id (a pool whose box is gone is dropped). A save from before pools were kept
 * by box ({xs, half}, or no wall at all: an even wall) had a pool under every box, on a wall of
 * as many boxes as today's: the games that could be played then and now (Cork & Bell first, Tin
 * Derby third) hang in the same places on both, so their pools match by place.
 * A save whose pools carry their boxes' ids is read whatever today's number of boxes: only its
 * pools are needed to carry the pieces across (world.js, acrossWalls), and the box ids say which
 * pool is which on today's wall.
 */
function savedWall(saved, boxes) {
  const n = boxes.length;
  const xs = Array.isArray(saved?.xs) && saved.xs.every(Number.isFinite) ? [...saved.xs] : null;
  if (xs && Array.isArray(saved.pools)) {
    const pools = saved.pools
      .map((p) => ({ i: boxes.findIndex((box) => box.id === p?.id), x: p?.x, half: p?.half }))
      .filter((p) => p.i >= 0 && Number.isFinite(p.x) && Number.isFinite(p.half))
      .sort((a, b) => a.x - b.x);
    return { n: xs.length, xs, pools };
  }
  if (xs && xs.length === n && Number.isFinite(saved.half)) return { n, xs, pools: xs.map((x, i) => ({ i, x, half: saved.half })) };
  return evenWall(n);
}

/** Who was in the party when a saved match began (LobbyCore.partyTokens), or null for a save from before it was kept. */
function partyOf(saved) {
  return Array.isArray(saved) && saved.every((token) => typeof token === "string") ? [...saved] : null;
}

function fail(error, message) {
  return { ok: false, error, message };
}
