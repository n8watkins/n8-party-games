// One Durable Object per party: the authority. It owns a LobbyCore, accepts WebSockets, relays
// what players do, settles the vote and runs the chosen game.
//
// A room is billed for every second it is awake, so it is built to be asleep:
//   - Nothing ticks in the lobby. A player's page says where its piece is only when that
//     changes; the room relays it, works out the vote, and is done within the same event.
//   - Everything that depends on time is the alarm (the count, the toss, a dropped phone).
//   - The keep-alive ("ping") is answered by the runtime itself and never wakes the room.
//   - A timer runs only while a game is being played, and only if the game has a tick rate.
//     A turn-based game (`tickHz: 0`) runs none: each input is applied and saved as it comes,
//     and the game's deadline is one more alarm. Nobody stands in for its players: a phone that
//     drops keeps its seat for the game's grace (one more alarm), the game is told who is here
//     (upkeep), and a seat gone for good ends it early.
// So a lobby (or a turn-based game) where nobody touches anything holds its sockets through the WebSocket Hibernation
// API and costs nothing, and all the time the room is awake is counted against the room budget.
import { DurableObject } from "cloudflare:workers";
import { LagLine, eventsFor, fanOut } from "../../party-kit/src/core/room-core.js";
import { answerMessage, inputId } from "../../party-kit/src/core/answers.js";
import { allAway, graceOf, presenceSignal } from "../../party-kit/src/core/presence.js";
import { newSeed } from "../../party-kit/src/core/rng.js";
import { CLOSE_BAD_TOKEN, CLOSE_HELLO_EXPECTED, HONOUR_TOKEN_IN_ADDRESS, LEGACY_HELLO_PROTOCOL, UPDATE_REQUIRED, UnknownSockets, clientOf, closeQuietly, readHelloFields, seatToken } from "../../party-kit/src/worker/hello-logic.js";
import { PROTOCOL } from "../../party-kit/src/worker/http.js";
import { releaseSafe } from "./release-points.js";
import { SOCKET_RATE, newBucket, strike, takeMessage } from "../../party-kit/src/worker/limit-logic.js";
import { PIN_DIRECTORY_NAME } from "../../party-kit/src/worker/pin-logic.js";
import { AwakeMeter, EVENT_FLOOR_MS, MESSAGES_PER_REQUEST, REPORT_EVERY_MS, roomBudgetState, spendRoomTime } from "../../party-kit/src/worker/room-budget.js";
import { readEmote, tooEager } from "../../party-kit/client/emotes.js";
import { LobbyCore, TURN_GRACE_MS } from "./lobby-core.js";

const STORAGE_KEY = "lobby";
const CLOSE_ROOM_CLOSED = 4000;
const CLOSE_TOO_FAST = 4008;
/** Lobby messages are a few dozen bytes; a game's inputs are not much more. Anything longer is dropped. */
export const MAX_MESSAGE_BYTES = 512;
/** The keep-alive the page sends, and the reply the runtime gives without waking the room. */
export const KEEP_ALIVE = { text: "ping", reply: "pong", everyMs: 10_000 };
/**
 * A socket that has said nothing at all for this long (not even a keep-alive, which a page sends
 * every ten seconds) belongs to a phone that is gone: it lost its signal without closing. Looked
 * at whenever anything happens in the room, at most every five seconds; nothing is timed for it.
 * A page hidden during a turn-based game is given longer (awayLimit).
 */
const SILENT_MS = 25_000;
const REAP_EVERY_MS = 5_000;
/** The join code is kept alive while the room is in use (it lapses 15 minutes after its last refresh). */
const PIN_REFRESH_MS = 5 * 60_000;
/** An alarm due within this long is a count, a toss, a rest or a grace: worth pushing back when it is no longer wanted. */
const SHORT_FUSE_MS = 35_000;
/**
 * What an emote sent far too soon counts against its socket's rate limit: a script
 * sending them as fast as the limit lets through (20 a second) is closed within about two seconds.
 */
const EAGER_STRIKE = 2;
/** Why a room closed, as the socket's close reason. */
const CLOSE_REASONS = { empty: "room_closed", stale: "room_idle", expired: "room_expired", budget: "allowance_spent" };

/**
 * Makes the party room class.
 * @param {(env: object) => {boxes: object[], games: Map<string, object>}} wallFor  the boxes on the
 *   wall and the games that can start, for a Worker's environment (lobby/wall.js)
 * @param {{release?: {id: string} | null}} [opts]  release: the build's release record
 *   (scripts/release.mjs), which the room tells every page in its hello and again at each safe
 *   point (release-points.js), so an older page can load the new build. Without one the room says
 *   nothing about builds.
 */
export function createLobbyRoom(wallFor, { release = null } = {}) {
  return class LobbyRoom extends DurableObject {
    constructor(ctx, env) {
      super(ctx, env);
      const wall = (this.wall = wallFor(env));
      /** @type {LobbyCore | null} */
      this.core = null;
      /** socket -> {ws, token, role, seat, kept, out, in, bucket}: the sockets that have a seat (or are the screen). */
      this.sockets = new Map();
      /** The sockets that have not said whose they are yet: no seat, and nothing is sent to them. */
      this.unknown = new UnknownSockets();
      this.timer = null;
      this.meter = new AwakeMeter();
      this.flushedAt = 0;
      this.alarmAt = null;
      this.pinAt = 0;
      this.reapedAt = 0;
      /** When this copy of the room came into memory: a later value than the last event means it slept. */
      this.wokeAt = Date.now();
      ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(KEEP_ALIVE.text, KEEP_ALIVE.reply));
      void ctx.blockConcurrencyWhile(async () => {
        const saved = await ctx.storage.get(STORAGE_KEY);
        if (!saved) {
          // No party here: the only sockets there can be are ones that never said whose they are.
          for (const ws of ctx.getWebSockets()) {
            const kept = ws.deserializeAttachment();
            if (kept?.unknown) this.unknown.restore(ws, kept);
          }
          return;
        }
        this.core = LobbyCore.restore(wall, saved, this.wokeAt);
        this.alarmAt = await ctx.storage.getAlarm();
        // Waking from sleep: the sockets are still open, so their owners are still here, and each
        // socket carried its piece and what it owes the budget through the sleep.
        for (const ws of ctx.getWebSockets()) {
          const kept = ws.deserializeAttachment();
          // One that had not said whose it is before the sleep is still nobody's.
          if (kept?.unknown) {
            this.unknown.restore(ws, kept);
            continue;
          }
          if (!kept || !this.core.resume(kept.token, kept.piece)) continue;
          this.sockets.set(ws, this.entryFor(ws, kept));
          this.flushedAt = Math.max(this.flushedAt, kept.flushedAt ?? 0);
          this.pinAt = Math.max(this.pinAt, kept.pinAt ?? 0);
        }
        // A page that was hidden when the room slept is still hidden: its socket says so.
        for (const entry of this.sockets.values()) this.syncAway(entry.token);
        // A ticking game cut short by a restart is gone (a turn-based one was restored with the
        // room, unless its save could not be read); everyone has to hear they are back in the lobby.
        if (saved.midGame || this.core.lost) this.changed(this.wokeAt);
        // A turn-based game hears of a phone whose socket did not come through the sleep, and
        // ends if a seat's grace ran out while the room was asleep.
        else await this.upkeep(this.wokeAt);
      });
    }

    // ------------------------------------------------------------ RPC from the Worker

    /** Creates the room. `as` is "player" (takes the first seat) or "screen" (the big screen, no seat). */
    async create({ code, nickname, as }) {
      if (this.core) return { ok: false, error: "exists", message: "Room code already in use." };
      const now = Date.now();
      const core = new LobbyCore({ ...this.wall, seed: newSeed(), code, now });
      const joined = as === "screen" ? core.watch(now) : core.join(nickname, now);
      if (!joined.ok) return joined;
      this.core = core;
      const issued = await this.env.PARTY_PINS.getByName(PIN_DIRECTORY_NAME).issue(code);
      core.pin = issued ? issued.value : null;
      this.pinAt = now;
      await this.save();
      this.arm(now);
      this.bill(now, 2); // this call, and the one to the PIN directory
      return { ok: true, code, pin: core.pin, token: joined.token, seat: joined.seat ?? -1, role: as === "screen" ? "screen" : "player" };
    }

    async preview() {
      if (!this.core) return null;
      const v = this.core.view(Date.now());
      const players = v.members.filter(Boolean).map((m) => m.name);
      // `screen`: the room's one screen is taken, so the way in does not offer to be it.
      // `mode`: which waiting room the party is in, so a way in can say so before joining.
      return { code: v.code, game: "party", phase: v.phase, players, full: players.length >= v.members.length, screen: this.core.screenHeld(Date.now()), mode: v.mode };
    }

    async join({ nickname, as }) {
      if (!this.core) return { ok: false, error: "not_found", message: "This party has ended." };
      const now = Date.now();
      const joined = as === "screen" ? this.core.watch(now) : this.core.join(nickname, now);
      if (!joined.ok) return joined;
      await this.save();
      this.changed(now);
      this.bill(now);
      return { ok: true, code: this.core.code, pin: this.core.pin, token: joined.token, seat: joined.seat ?? -1, role: as === "screen" ? "screen" : "player" };
    }

    // ------------------------------------------------------------ WebSockets

    async fetch(request) {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("Expected WebSocket", { status: 426 });
      const url = new URL(request.url);
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      const now = Date.now();
      // A hibernatable socket, also when it is about to be refused: one accepted the standard way
      // (accept()) keeps the room from sleeping for as long as it lives.
      this.ctx.acceptWebSocket(server);
      // Simulated latency is for tests, off unless the Worker allows it.
      const lag = this.env.PARTY_SIM_LATENCY === "on" ? Number(url.searchParams.get("lag") ?? 0) : 0;
      const inAddress = HONOUR_TOKEN_IN_ADDRESS ? url.searchParams.get("token") : null;
      if (inAddress !== null) {
        // The old form, from a page loaded before the token left the address (hello-logic.js,
        // HONOUR_TOKEN_IN_ADDRESS): taken as a socket that opened and said hello with it at once.
        this.unknown.clear(now);
        this.meter.event(now, now);
        this.seat(server, seatToken(inAddress), lag, now);
      } else {
        // Nobody's socket yet: it has no seat and is sent nothing until its first message says
        // whose it is (greet). It wakes nothing and saves nothing; opening it is still an event
        // the room was awake for. Its client rides along on it, as the waiting sockets are shared
        // out by client. A code that is no party is answered the same way, and its hello is
        // refused like any wrong token: opening a socket does not tell anyone which codes are
        // parties.
        this.unknown.add(server, now, lag, clientOf(request));
        this.meter.event(now, Date.now());
      }
      return new Response(null, { status: 101, webSocket: client });
    }

    /** The first message on a socket: `{t: "hello", token}` seats it, and anything else closes it. */
    greet(ws, data) {
      const now = Date.now();
      const opened = this.unknown.take(ws);
      this.unknown.clear(now);
      this.meter.event(now, now, "message");
      const hello = readHelloFields(data, MAX_MESSAGE_BYTES);
      if (hello === null) return closeQuietly(ws, CLOSE_HELLO_EXPECTED, "hello_expected");
      this.seat(ws, hello.token, opened.lag, now, hello);
    }

    /**
     * Seats a socket whose hello named `token`, or closes it with nothing said if that names no
     * seat. Only now does the socket hear anything: the room, and a game as its seat may see it.
     * `hello` is what else the hello said: the page's release and protocol (readHelloFields).
     */
    seat(ws, token, lag, now, hello = {}) {
      const core = this.core;
      const who = core ? core.connect(token, now) : null;
      if (!who) return closeQuietly(ws, CLOSE_BAD_TOKEN, "bad_token");
      // What the room has to know about the socket rides along on it, since the room's memory
      // does not survive sleep: from here on that is its seat (the waiting attachment, and the
      // client it came from, are replaced). With it, which build its page is (release-switch).
      const kept = { token, role: who.role, seat: who.seat, lag, at: now, piece: core.pieceOf(who.seat), owed: { ms: 0, n: 0, r: 0 }, flushedAt: this.flushedAt, pinAt: this.pinAt, release: hello.release ?? null, protocol: hello.protocol ?? LEGACY_HELLO_PROTOCOL };
      ws.serializeAttachment(kept);
      const entry = this.entryFor(ws, kept);
      this.sockets.set(ws, entry);

      const view = core.view(now);
      // The room's own build answers the page's, with whether now is a moment to load a new one.
      this.send(entry, { t: "hello", you: { role: who.role, seat: who.seat }, room: view, ...(release && { release: { id: release.id, safe: releaseSafe(view) } }) });
      // A page that speaks an older protocol than the room can only reload: at once when nothing is going on.
      if (release && this.mustUpdate(entry) && releaseSafe(view)) return this.closeForUpdate(ws, entry, now);
      // Mid-game (a reload, a phone back from a drop, a late joiner): the game as this socket may see it.
      // A view that throws ends the game (gameBroke); the rest of the seating goes on as ever.
      if (core.activity.kind === "game") this.sendView(entry, () => ({ t: "snap", s: core.snapshotFor(core.viewerOf(entry), now), now, full: true }));
      // A new socket is a page that is showing; the token is away only if every socket of it is.
      this.syncAway(token);
      this.changed(now);
      // A phone back in a turn-based game: the game hears it is here (its timer may run again).
      void this.upkeep(now);
      this.park(now);
    }

    entryFor(ws, kept) {
      // What the socket owes the budget: time, messages (a twentieth of a request each) and whole requests.
      kept.owed = { ms: kept.owed?.ms ?? 0, n: kept.owed?.n ?? 0, r: kept.owed?.r ?? 0 };
      return {
        ws,
        token: kept.token,
        role: kept.role,
        seat: kept.seat,
        kept,
        bucket: newBucket(Date.now()),
        out: new LagLine(kept.lag, (text) => {
          try {
            ws.send(text);
          } catch {
            // The socket is closing; its close handler updates presence.
          }
        }),
        in: new LagLine(kept.lag, (text) => this.onMessage(ws, text)),
      };
    }

    /** Every message is counted and rate-limited before anything looks inside it. */
    webSocketMessage(ws, data) {
      const entry = this.sockets.get(ws);
      // A socket that has not said whose it is: this is its first message, and its only chance.
      if (!entry && this.unknown.has(ws)) return this.greet(ws, data);
      if (!entry || !this.core) return;
      const started = Date.now();
      // When this socket last said anything, set before the message is handled: what it says may
      // make the room look for silent sockets (reap), and it must not count as one itself. Kept on
      // the socket, so a sleep does not make a silent phone look fresh.
      entry.kept.seen = started;
      const readable = typeof data === "string" && data.length <= MAX_MESSAGE_BYTES;
      const verdict = readable ? takeMessage(entry.bucket, started) : strike(entry.bucket);
      if (verdict === "ok") entry.in.push(data);
      else if (verdict === "close") this.kick(ws, entry);
      // What this message cost rides on its own socket, so it is not forgotten if the room sleeps
      // before the next report to the budget.
      const owed = entry.kept.owed;
      if (this.meter.heldFrom === null) owed.ms += Math.max(EVENT_FLOOR_MS, Date.now() - started);
      owed.n += 1;
      if (this.sockets.has(ws)) ws.serializeAttachment(entry.kept);
      else this.meter.add(owed.ms, owed.n / MESSAGES_PER_REQUEST + owed.r);
      if (started - this.flushedAt >= REPORT_EVERY_MS || !this.sockets.has(ws)) this.flush(started);
    }

    webSocketClose(ws, code, reason) {
      try {
        ws.close(code, reason);
      } catch {
        // Already closed.
      }
      this.onGone(ws);
    }

    webSocketError(ws) {
      this.onGone(ws);
    }

    onMessage(ws, text) {
      const entry = this.sockets.get(ws);
      const core = this.core;
      if (!entry || !core) return;
      let msg;
      try {
        msg = JSON.parse(text);
      } catch {
        msg = null;
      }
      if (!msg || typeof msg !== "object" || Array.isArray(msg)) {
        if (strike(entry.bucket) === "close") this.kick(ws, entry);
        return;
      }
      const now = Date.now();
      // The first message since the room woke: pages of another build hear the room's (offerRelease).
      if (release && this.releaseSafeWas === undefined) this.offerRelease(core.view(now), now);
      if (!this.sockets.has(ws)) return;
      const player = entry.role === "player";
      // A hook whose time came while the alarm was still on its way is judged before anything else
      // is, and so is a touch along the floor since the room last looked (LobbyCore.dueMoves).
      const due = core.dueMoves(now);
      if (due.length) {
        this.tellMoves(due);
        this.settle(now);
      }
      switch (msg.t) {
        case "ping":
          // The clock ping a game's page sends during a round (the kit's client). The lobby's own
          // keep-alive is the plain text the runtime answers by itself.
          this.send(entry, { t: "pong", c: msg.c, s: now });
          return;
        case "m": {
          const moved = player ? core.move(entry.seat, msg, now) : null;
          if (!moved) return;
          this.broadcast(moved.relay, entry);
          if (moved.fix) this.send(entry, moved.fix);
          this.keep(entry);
          // Touches the room held for this piece that its word confirms (LobbyCore.settleTouches).
          if (moved.touches?.length) this.tellMoves(moved.touches);
          this.settle(now);
          return;
        }
        case "b": {
          const hit = player ? core.bump(entry.seat, now) : null;
          if (!hit) {
            // Too soon: only the room knows for sure, so it tells that page how long is left.
            const wait = player ? core.bumpWait(entry.seat, now) : null;
            if (wait) this.send(entry, wait);
            return;
          }
          this.broadcast(hit);
          if (hit.to >= 0) for (const other of this.sockets.values()) if (other.seat === hit.to) this.keep(other);
          // A kick into a faded ghost scared the kicker off (lobby/shared/ghost.js): the room moved the kicker.
          if (hit.sc !== undefined) this.keep(entry);
          // A kick into a hardened slime bounced the kicker back (lobby/shared/slime.js): the room moved it too.
          if (hit.bo !== undefined) this.keep(entry);
          this.settle(now);
          return;
        }
        case "fade":
        case "boo":
          return this.ghostMove(ws, entry, msg, now);
        case "hook":
        case "stilts":
        case "slime":
        case "shove":
          return this.characterMove(ws, entry, msg, now);
        case "e":
          return this.emote(ws, entry, msg, now);
        case "away":
        case "back":
          return this.presence(entry, msg, now);
        case "release?":
          return this.answerRelease(entry, now);
        case "in": {
          // A turn-based game's input is answered when it carries an id, and so is the same id
          // sent again just after that game ended. A ticking game's input is fire and forget.
          const id = inputId(msg.id);
          if (core.turnGame() || (id !== null && core.lastAnswers)) {
            this.playTurn(entry, msg.d, now, id).catch((err) => console.error("party room: an input to a turn-based game failed", err));
          }
          else if (player) core.gameInput(entry.seat, msg.d, now);
          return;
        }
        case "settings":
        case "settings-start":
        case "settings-cancel":
          // The settings step after the vote: only the party's host may change them, start the
          // game or go back to the room; anyone else is refused, to that page only.
          return void this.settings(entry, msg, now).catch((err) => console.error("party room: the settings step failed", err));
        case "mode":
          // The host moves the party to the other waiting room (lobby/shared/mode.js).
          return void this.switchMode(entry, msg, now).catch((err) => console.error("party room: switching rooms failed", err));
        case "play": {
          // At the Table the host picks a game from the list: everyone sees it is starting for a
          // moment (the beat, one wake-up), then the room starts it as it starts any game. A
          // refusal goes to that page only, `play-no {error, message}`.
          const may = core.mayPlay(entry.token, msg.id, now);
          if (!may.ok) return this.send(entry, { t: "play-no", error: may.error, message: may.message });
          core.beginPlay(may.id, entry.token, now);
          return this.changed(now);
        }
        case "stop":
          // The host ends the game being played at the Table: everyone is back there, with the card.
          return void this.stopAtTable(entry, now).catch((err) => console.error("party room: ending a game at the Table failed", err));
        case "pick": {
          // The party moves to another room: one stored value and one relayed message. Refused
          // (to that page only) when it is not the host's tap or not the moment.
          const picked = core.setRoom(entry.token, msg.v, now);
          if (!picked.ok) return this.send(entry, { t: "pick-no", why: picked.why, v: core.room });
          this.broadcast({ t: "pick", v: picked.room, by: picked.by });
          // A room that hangs its boxes elsewhere (shared/rooms.js, wallFor) carried every piece
          // with its pool (LobbyCore.carryAcross): everyone gets the room with the new places.
          if (picked.moved) return this.changed(now);
          void this.save();
          // The room rests a moment after the change (holdUntil): the next wake-up is set by it.
          this.settle(now);
          return;
        }
        case "look": {
          // A player chooses a character or a colour: kept with the room, shown to everyone in
          // the room view. Refused to that page only, with the reason and what it still is, and
          // for one that came too soon how long is left (the page sends it again then). One
          // refused far too soon counts against the socket's rate limit, as an emote does. A
          // choice the piece already is gets a plain yes, so the page is not left waiting.
          if (!player) return;
          const chose = core.setLook(entry.seat, msg, now);
          const m = core.members[entry.seat];
          if (!chose.ok) {
            this.send(entry, { t: "look-no", why: chose.why, c: m?.character, v: m?.colour, ...(chose.wait ? { wait: Math.ceil(chose.wait) } : {}) });
            if (tooEager(chose.wait) && strike(entry.bucket, SOCKET_RATE, EAGER_STRIKE) === "close") this.kick(ws, entry);
            return;
          }
          if (!chose.changed) return this.send(entry, { t: "look-ok", c: m.character, v: m.colour });
          // A ghost that became something else mid-fade is solid at once: every page stops
          // drawing it faded, and the vote is looked at again (it may stand in a light).
          if (chose.unfaded) this.broadcast({ t: "fade", s: entry.seat, for: 0 });
          this.broadcastRoom(now);
          this.settle(now);
          void this.save();
          return;
        }
        case "leave":
          core.leave(entry.token, now);
          this.drop(ws, entry, 1000, "left");
          this.dropToken(entry.token, "left");
          this.changed(now);
          // A seat that leaves a turn-based game on purpose is gone for good: the game ends.
          void this.upkeep(now);
          return;
        default:
          return;
      }
    }

    /**
     * The host's taps in the settings step. A change is checked by the game, saved, and then
     * everyone gets the room with the new picks. Start goes through the same budget check as the
     * vote's end, and Cancel puts everyone back in the room. A refusal goes to the sender alone:
     * `settings-no {error, message}`, with the game's own message for settings it turned down.
     */
    async settings(entry, msg, now) {
      const core = this.core;
      const no = (said) => this.send(entry, { t: "settings-no", error: said.error, message: said.message });
      if (msg.t === "settings") {
        const done = core.chooseSettings(entry.token, msg.v, now);
        if (!done.ok) return no(done);
        await this.save();
        if (this.core === core) this.broadcastRoom(now);
        return;
      }
      if (msg.t === "settings-cancel") {
        const done = core.cancelSettings(entry.token, now);
        if (!done.ok) return no(done);
        return this.changed(now);
      }
      // Start: the host's, and with every spot taken when the players are chosen on spots.
      const may = core.mayStart(entry.token, now);
      if (!may.ok) return no(may);
      await this.launch(may.id, true);
      this.bill(now, 2); // this message's work, and the budget check
    }

    /**
     * The host's switch between the two waiting rooms. A refusal goes to the sender alone
     * (`mode-no {why, v}`, with the mode the party is still in). A switch is saved before anyone
     * hears of it, so a page that moves and reconnects at once, or a room that restarts in
     * between, never finds the party back in the room it left. Then everyone gets the note and
     * the room view, and every page whose mode is not the party's moves itself. A switch that
     * cannot be saved is taken back, and only the sender hears, so it can try again.
     */
    async switchMode(entry, msg, now) {
      const core = this.core;
      const done = core.setMode(entry.token, msg.v, now);
      if (!done.ok) return this.send(entry, { t: "mode-no", why: done.why, v: core.mode });
      // Anyone moved into the Floor's four places: their sockets speak for the new seat at once
      // (every page then moves to the Floor and hears its seat in the hello).
      this.reseat(done.moved);
      try {
        await this.save();
      } catch (err) {
        console.error("party room: a switch could not be saved; it is taken back", err);
        if (this.core !== core) return;
        core.undoMode(done.was);
        this.reseat(done.moved);
        return this.send(entry, { t: "mode-no", why: "The switch did not go through. Try again.", v: core.mode });
      }
      if (this.core !== core) return;
      core.modeSaved();
      this.changed(now);
    }

    /** The sockets of these tokens take the seat the room now has for them (a member moved seat). */
    reseat(tokens = []) {
      if (!tokens?.length) return;
      for (const entry of this.sockets.values()) {
        if (!tokens.includes(entry.token)) continue;
        const who = this.core.identify(entry.token);
        if (!who) continue;
        entry.seat = who.seat;
        entry.kept.seat = who.seat;
        entry.kept.piece = this.core.pieceOf(who.seat);
        entry.ws.serializeAttachment(entry.kept);
      }
    }

    /**
     * The host's "End the game" at the Table. Saved before anyone hears of it, as every change to
     * a turn-based game is; then everyone gets the note, the last snapshots and `end`. A refusal
     * goes to the sender alone, `stop-no {error, message}`.
     */
    async stopAtTable(entry, now) {
      const core = this.core;
      const out = core.endByHost(entry.token, now);
      if (!out.ok) return this.send(entry, { t: "stop-no", error: out.error, message: out.message });
      // The game is over in the room's memory whatever the save does: everyone always hears so
      // (the note, `end` and the room view), even when the save fails or the last view throws.
      try {
        await this.save();
      } catch (err) {
        console.error("party room: a game the host ended could not be saved", err);
      }
      if (this.core !== core) return;
      this.deliverTurn(out, now);
    }

    /**
     * Starts the game the vote (or the settings step, `chosen`) ended on, unless the hosting
     * allowance is spent: then no game starts and the room is told it will close.
     */
    async launch(id, chosen = false) {
      const core = this.core;
      try {
        const budget = await roomBudgetState(this.env).catch(() => "open");
        if (this.core !== core) return;
        // The vote is the Floor's and the list is the Table's: a game never starts in the other
        // waiting room. (The room refuses a switch while a start is pending, core.starting; this is
        // the last guard.)
        if (core.plainRoom() !== core.isTableGame(id)) console.error(`party room: ${id} was not started: the party is ${core.plainRoom() ? "at the Table" : "on the Floor"}`);
        else if (budget === "open") await this.startGame(id, chosen);
        else core.refuseStart(Date.now());
      } finally {
        // Started, refused, or failed: the room may be switched again.
        core.startDone();
      }
      this.changed(Date.now());
    }

    /**
     * An emote: the room checks the cooldown, passes it on to everybody else and is done.
     * Nothing is saved or scheduled, so it costs this one event. One refused far too soon counts
     * against the socket's rate limit (a real page waits out its own cooldown), so a script
     * cannot keep a room busy with refusals either.
     */
    emote(ws, entry, msg, now) {
      const id = entry.role === "player" ? readEmote(msg) : null;
      if (!id) return;
      const out = this.core.emote(entry.seat, id, now);
      if (!out) return;
      if (out.relay) return this.broadcast(out.relay, entry);
      this.send(entry, out.refused);
      if (tooEager(out.wait) && strike(entry.bucket, SOCKET_RATE, EAGER_STRIKE) === "close") this.kick(ws, entry);
    }

    /**
     * The ghost's move (lobby/shared/ghost.js): `{t: "fade"}` fades the sender's ghost, and
     * `{t: "boo", to}` is a faded ghost saying it drifted through the piece in seat `to`. The room
     * judges each at once and tells everybody (`fade`, `spook`), or refuses it to that page only,
     * the way a choice of piece is refused: `{t: "fade-no", why, wait}` (the cooldown or the
     * time on the floor still to wait, when waiting will do) and `{t: "boo-no", why, to}`. Nothing
     * is saved; the vote is looked at again (a faded ghost has none, a spooked piece has left its
     * light). A refusal no real page would have asked for (`bad`: lobby/shared/ghost.js says
     * which) counts against the socket's rate limit, as an emote far too soon does, so a script
     * cannot keep a room busy with them; an honest boo that came a moment late costs nothing.
     */
    ghostMove(ws, entry, msg, now) {
      if (entry.role !== "player") return;
      const core = this.core;
      const out = msg.t === "fade" ? core.fade(entry.seat, now) : core.boo(entry.seat, msg.to, now);
      if (!out.ok) {
        this.send(entry, msg.t === "fade" ? { t: "fade-no", why: out.why, ...(out.wait ? { wait: Math.ceil(out.wait) } : {}) } : { t: "boo-no", why: out.why, to: Number.isInteger(msg.to) ? msg.to : null });
        if (out.bad && strike(entry.bucket, SOCKET_RATE, EAGER_STRIKE) === "close") this.kick(ws, entry);
        return;
      }
      this.broadcast(out.relay);
      if (out.relay.t === "spook") for (const other of this.sockets.values()) if (other.seat === out.relay.to) this.keep(other);
      this.settle(now);
    }

    /**
     * The robot's and the slime's moves (lobby/shared/robot.js, slime.js): `{t: "hook"}` throws the
     * sender's hook, `{t: "stilts"}` puts its legs up, `{t: "slime", k}` hardens ("harden") or turns
     * the harden soft ("absorb"), and `{t: "shove", to}` is a walking slime saying it touched the
     * piece in seat `to`. The room judges each at once and tells everybody, or refuses it to that
     * page only, in the ghost's style: `{t: "<move>-no", why, wait}`. What came of a hook is said
     * when the room wakes for it (`hk`, LobbyCore.dueHooks). A refusal no real page asks for
     * (`bad`) counts against the socket's rate limit; an honest one a moment late costs nothing.
     */
    characterMove(ws, entry, msg, now) {
      if (entry.role !== "player") return;
      const core = this.core;
      const seat = entry.seat;
      const out = msg.t === "hook" ? core.hook(seat, now) : msg.t === "stilts" ? core.stilts(seat, now) : msg.t === "slime" ? core.slime(seat, msg.k, now) : core.shove(seat, msg.to, now);
      if (!out.ok) {
        // A shove the room did not take is only a slime walking by: nothing is said.
        if (msg.t !== "shove") this.send(entry, { t: `${msg.t}-no`, why: out.why, ...(out.wait ? { wait: Math.ceil(out.wait) } : {}), ...(msg.t === "slime" ? { k: msg.k === "absorb" ? "absorb" : "harden" } : {}) });
        if (out.bad && strike(entry.bucket, SOCKET_RATE, EAGER_STRIKE) === "close") this.kick(ws, entry);
        return;
      }
      this.broadcast(out.relay);
      // The room stopped a robot to throw its hook, and moved a shoved piece: each socket carries its piece.
      if (out.relay.t === "hook") this.keep(entry);
      if (out.relay.t === "shove") for (const other of this.sockets.values()) if (other.seat === out.relay.to) this.keep(other);
      this.settle(now);
    }

    /** What came of the robots' hooks whose time has come (LobbyCore.dueHooks), and of moves the room ended by itself: told to everybody. */
    tellMoves(relays) {
      const core = this.core;
      for (const relay of [...relays, ...(core?.drainMoves() ?? [])]) {
        this.broadcast(relay);
        // Pieces the room moved: each socket carries its piece through a sleep.
        const moved = new Set([relay.s, relay.to, relay.tr?.s].filter((s) => Number.isInteger(s)));
        if (relay.o !== "off") for (const other of this.sockets.values()) if (moved.has(other.seat)) this.keep(other);
      }
    }

    /**
     * A page says it is hidden (`away`) or shown again (`back`) while its socket stays open. The
     * seat is away when every open socket of it is. Nothing is saved or relayed in the lobby but
     * the room view; a turn-based game is told (upkeep).
     */
    presence(entry, msg, now) {
      if (entry.role !== "player") return;
      const away = presenceSignal(msg);
      if (entry.kept.away === away) return;
      entry.kept.away = away;
      entry.ws.serializeAttachment(entry.kept);
      if (!this.syncAway(entry.token)) return;
      this.broadcastRoom(now);
      void this.upkeep(now);
    }

    /** Works out whether a token is away from all its open sockets. Returns whether that changed. */
    syncAway(token) {
      const mine = [...this.sockets.values()].filter((e) => e.token === token).map((e) => ({ away: !!e.kept.away }));
      return this.core?.setAway(token, allAway(mine)) ?? false;
    }

    /**
     * After anything that may have changed who is here in a turn-based game: the game is told,
     * or ended when a seat is gone for good (LobbyCore.turnUpkeep). What it did is saved before
     * anyone hears it, as an input is.
     */
    async upkeep(now) {
      const core = this.core;
      try {
        const out = core?.turnUpkeep(now);
        if (!out) return null;
        await this.save();
        if (this.core !== core) return out;
        // Only what the game was told changed: saved, and nothing to send. A seat that dropped
        // may still need its grace-end wake-up.
        if (out.quiet) {
          this.arm(now);
          return out;
        }
        // Who plays changed (a late joiner taken in, a seat that left): the room view says so first,
        // so a page knows it plays before its view of the game arrives.
        if (out.room && !out.ended) this.broadcastRoom(now);
        this.deliverTurn(out, now);
        return out;
      } catch (err) {
        console.error("party room: looking at who is here in a turn-based game failed", err);
        return null;
      }
    }

    /** A socket that floods is closed and its seat given up: dropped messages are still billed. */
    kick(ws, entry) {
      const now = Date.now();
      this.core?.leave(entry.token, now);
      this.drop(ws, entry, CLOSE_TOO_FAST, "too_fast");
      this.dropToken(entry.token, "too_fast");
      this.changed(now);
      void this.upkeep(now);
    }

    /**
     * After a seat is given up (left, or kicked): every other open socket of that token is closed
     * too. Left open, it would still be taken for that seat, and see and play as whoever sits in
     * it next. Closed as a seat that is no longer ours (4003), with why, so its page does not
     * come back.
     */
    dropToken(token, reason) {
      for (const [ws, entry] of [...this.sockets]) if (entry.token === token) this.drop(ws, entry, CLOSE_BAD_TOKEN, reason);
    }

    drop(ws, entry, code, reason) {
      this.sockets.delete(ws);
      this.meter.add(entry.kept.owed.ms, entry.kept.owed.n / MESSAGES_PER_REQUEST + entry.kept.owed.r);
      entry.kept.owed = { ms: 0, n: 0, r: 0 };
      try {
        ws.close(code, reason);
      } catch {
        // Already closed.
      }
    }

    isConnected(token) {
      for (const e of this.sockets.values()) if (e.token === token) return true;
      return false;
    }

    onGone(ws) {
      // A socket that never said whose it was is nobody's drop: nothing changed, nobody is told.
      if (this.unknown.take(ws)) return;
      const now = Date.now();
      const entry = this.sockets.get(ws);
      // A socket that closed while the room slept may not be among the ones it woke with.
      const token = entry?.token ?? ws.deserializeAttachment()?.token;
      if (entry) this.drop(ws, entry, 1000, "gone");
      if (!this.core || !token) return;
      if (!this.isConnected(token)) this.core.disconnect(token, now);
      else this.syncAway(token);
      this.changed(now);
      // A phone gone from a turn-based game: the game hears it (its timer may pause), and the
      // seat is held for the game's grace (a wake-up, LobbyCore.nextWake).
      void this.upkeep(now);
      this.bill(now);
    }

    /**
     * Closes sockets whose phone has gone without saying so, so nobody waits on a ghost. Looked at
     * when anything happens in the lobby, and on every input and wake-up of a turn-based game.
     */
    reap(now) {
      // The sockets that never said whose they are go first: there are only a handful to look at.
      this.unknown.clear(now);
      if (now - this.reapedAt < REAP_EVERY_MS) return;
      this.reapedAt = now;
      let reaped = false;
      for (const [ws, entry] of [...this.sockets]) {
        const auto = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0;
        const heard = Math.max(auto, entry.kept.seen ?? 0, entry.kept.at);
        const away = this.awayInTurnGame(entry);
        if (now - heard < (away ? this.awayLimit() : SILENT_MS)) continue;
        this.drop(ws, entry, 1001, "silent");
        if (!this.isConnected(entry.token)) {
          this.core.disconnect(entry.token, now);
          // An away phone was already given the grace while silent: its drop dates from its last
          // sign of life, so the seat is held one grace in all, and is gone at once if that is past.
          const m = this.core.members[entry.seat];
          if (away && m && !m.connected && m.droppedAt > heard) m.droppedAt = heard;
        } else this.syncAway(entry.token);
        this.broadcastRoom(now);
        reaped = true;
      }
      if (!reaped) return;
      void this.upkeep(now);
      // The grace of a seat that dropped here is a wake-up; nothing else may set it (a quiet upkeep, a quiet refusal).
      this.arm(now);
    }

    /**
     * A hidden page's keep-alive is slowed or stopped by its browser, so a socket that said it is
     * away, of a seat in the turn-based game being played, is not reaped after SILENT_MS like any
     * other: it is given the game's grace (awayLimit). Reaped, its drop dates from when it was last
     * heard, so the seat is held one grace from its last sign of life, not two.
     */
    awayInTurnGame(entry) {
      return !!this.core?.turnGame() && !!entry.kept.away && entry.role === "player" && this.core.activity.seats.includes(entry.seat);
    }

    /** How long an away socket in a turn-based game may say nothing: the game's grace, and at least SILENT_MS. Infinity: never reaped. */
    awayLimit() {
      return Math.max(SILENT_MS, graceOf(this.core.turnGame(), TURN_GRACE_MS));
    }

    // ------------------------------------------------------------ the vote, the alarm and the game

    /** After anything that may have changed the vote: tell everyone if it did, and set the next wake-up. */
    settle(now) {
      const core = this.core;
      if (!core) return;
      this.reap(now);
      // A hook the room dropped by itself (its robot was knocked): every page winds it back.
      this.tellMoves([]);
      const change = core.evaluate(now);
      if (change.gaveUp) return this.changed(now);
      if (change.view) this.broadcast({ t: "vote", vote: core.voteView(now) });
      // Who stands on a game's spots changed (choosing its players): it is in the room view.
      if (change.room) this.broadcastRoom(now);
      if (change.state) void this.save();
      this.arm(now);
    }

    /** Passes on what the room has said since the last time ("Tom left", "Who Am I? ended"). */
    tellNotes() {
      for (const note of this.core?.drainNotes() ?? []) this.broadcast({ t: "note", ...note });
    }

    /** After anything that changed who is here or what the room is doing: everyone gets the whole room. */
    changed(now) {
      const core = this.core;
      if (!core) return;
      // Looked at first: a settings step whose players left ends here, and says so in a note.
      core.evaluate(now);
      this.tellNotes();
      this.tellMoves([]);
      this.broadcastRoom(now);
      this.arm(now);
      // Whatever moved the pieces on the way here (a settings step that ended by itself, a start
      // refused for the budget), each socket carries its piece as the room now has it, so a sleep
      // does not bring back an older one (resume).
      for (const entry of this.sockets.values()) this.keep(entry);
      void this.save().catch((err) => console.error("party room: the room could not be saved", err));
    }

    /**
     * Keeps the alarm at the room's next wake-up, writing it as seldom as it can.
     *   - A wake-up that comes sooner than the alarm always moves it.
     *   - A wake-up that was seconds away and is no longer wanted (a count that stopped, a
     *     dropped phone that came back) is pushed back: an alarm ringing for nothing is a
     *     billed request.
     *   - The slow "forgotten room" check creeps later with every message and is left alone:
     *     it rings early once in twenty minutes, finds nothing to do and is set again.
     */
    arm(now) {
      const wake = this.core?.nextWake(now) ?? null;
      if (wake === null) return;
      const armed = this.alarmAt !== null && this.alarmAt > now ? this.alarmAt : null;
      const sooner = armed === null || wake < armed - 5;
      const unwanted = armed !== null && armed - now < SHORT_FUSE_MS && wake > armed + 1000;
      if (!sooner && !unwanted) return;
      this.alarmAt = wake;
      void this.ctx.storage.setAlarm(wake);
    }

    async alarm() {
      this.alarmAt = null;
      const core = this.core;
      if (!core) return;
      const now = Date.now();
      this.unknown.clear(now);
      if (core.turnGame()) {
        // A phone that went quiet without closing its socket is noticed here too.
        this.reap(now);
        // A turn-based game's deadline: the game is ticked once, saved, and everyone hears what it did.
        const due = core.gameDeadline(now);
        if (due) {
          await this.save();
          if (this.core !== core) return;
          this.deliverTurn(due, now);
        }
        // A dropped seat whose grace has run out ends the game.
        await this.upkeep(now);
        if (this.core !== core) return;
      }
      const out = core.tick(now);
      // What came of the hooks whose time it was (shared/robot.js), before anything else is said.
      this.tellMoves(out.hooks ?? []);
      if (out.start) {
        // The allowance for the day or month is spent: no game starts, and the room is told it
        // will close. `chosen`: the settings step's time ran out, and the game starts with its picks.
        await this.launch(out.start, out.chosen);
        if (this.core !== core) return;
      } else if (out.close) {
        this.bill(now);
        return this.destroy(out.close);
      } else if (out.changed) {
        this.changed(now);
      } else {
        this.settle(now);
      }
      this.bill(now, out.start ? 2 : 1);
    }

    /**
     * Starts a game: the vote's winner, or (`chosen`) the game whose settings were just chosen. A
     * game with settings that won the vote does not start yet: the room is in the settings step,
     * saved before anyone hears of it, and the caller sends everyone the room.
     */
    async startGame(id, chosen = false) {
      const core = this.core;
      const game = this.wall.games.get(id);
      const now = Date.now();
      // Each game its own seed from the secure source: nothing a page is shown leads to the room's or the next game's.
      const started = chosen ? core.startChosen(id, now, newSeed()) : core.startGame(id, now, newSeed());
      if (!started.ok) {
        if (started.error === "bad_game") console.error(`party room: ${id} cannot start: ${started.message}`);
        return;
      }
      if (started.choosing) {
        // Players chosen on spots start again by the door: each socket carries its piece through a sleep.
        for (const entry of this.sockets.values()) this.keep(entry);
        return void (await this.save());
      }
      if (started.ended) {
        this.tellNotes();
        return this.finish(started.ended, now);
      }
      const turns = core.turnGame() !== null;
      // A turn-based game is on record before anyone hears it began.
      if (turns) {
        await this.save();
        if (this.core !== core || core.activity.kind !== "game") return;
      }
      const room = core.view(now);
      // A view that throws ends the game at once (gameBroke): there is nothing more to start.
      const shown = this.broadcastViews(
        (e) => core.viewerOf(e),
        (viewer) => ({ t: "start", room, s: core.snapshotFor(viewer, now), now }),
      );
      if (!shown) return;
      // What a turn-based game said when it heard who was here at the start (a page already hidden).
      if (started.events?.length) {
        const events = started.events;
        this.broadcastViews(
          (e) => core.viewerOf(e),
          (viewer) => {
            const ev = eventsFor(events, viewer);
            return ev.length ? { t: "ev", ev, now } : null;
          },
        );
      }
      // A turn-based game runs no timer: the room sleeps between inputs and wakes at its deadline
      // (the alarm), so only the time it is really awake is counted. A seat whose phone had
      // already dropped when the vote ended is held from then (upkeep, and the grace's wake-up).
      if (turns) return void (await this.upkeep(now));
      // The one place a timer runs: while a game with a tick rate is being played.
      this.meter.hold(now);
      this.timer = setInterval(() => this.gameTick(), Math.round(1000 / (game.tickHz ?? 30)));
    }

    /**
     * An input to a turn-based game: applied at once, the game saved, and only then does anyone
     * hear of it (every viewer gets a fresh snapshot, and the events it produced). The one place
     * where such an input is applied and saved. With an `id`, the sender alone is then answered,
     * after its snapshot: `ack {id}`, or `error {id, error, message}` when the game or the room
     * turned it down. An id answered before is answered again the same way and not applied; the
     * sender gets the game as it is now, and nobody else hears anything.
     */
    async playTurn(entry, data, now, id = null) {
      const core = this.core;
      // The other phone may have gone quiet without closing its socket: the game hears of it first.
      this.reap(now);
      const out = core.playTurn(entry.role === "player" ? entry.seat : -1, data, now, id);
      const answer = (said) => id !== null && this.send(entry, answerMessage(id, said));
      if (!out.ok) {
        answer(out);
        return out;
      }
      if (out.repeat || out.quiet) {
        // Nothing changed (the same id again, or a refusal that moved nothing): nothing is saved,
        // and only the sender hears, its own snapshot and its share of the events, then the answer.
        const viewer = out.viewerOf(entry);
        const events = eventsFor(out.events, viewer);
        if (events.length) this.send(entry, { t: "ev", ev: events, now });
        if (out.snapshot) this.sendView(entry, () => ({ t: "snap", s: out.snapshot(viewer), now }));
        answer(out.answer);
        return out;
      }
      const saving = Date.now();
      await this.save();
      // The wait for storage is time awake too.
      this.meter.add(Date.now() - saving, 0);
      if (this.core !== core) return out;
      this.deliverTurn(out, now);
      answer(out.answer);
      return out;
    }

    /** Sends what a turn-based game did (an input or a deadline), and ends it or sets the next wake-up. */
    deliverTurn(out, now) {
      // A game that ended early says why before its last snapshot and its end, so a page has the
      // reason when it puts the game away.
      if (out.ended) this.tellNotes();
      this.sendGame(out, now);
      if (out.ended) {
        this.finish(out.ended, now);
        this.changed(now);
        this.flush(now);
      } else this.arm(now);
    }

    /**
     * Built per viewer: an event addressed to some seats (`only`) reaches only them, and each
     * snapshot is the one its viewer may see. The game's seats decide, even on the last one.
     */
    sendGame(out, now) {
      if (out.events.length) {
        this.broadcastViews(out.viewerOf, (viewer) => {
          const ev = eventsFor(out.events, viewer);
          return ev.length ? { t: "ev", ev, now } : null;
        });
      }
      if (out.snapshot) this.broadcastViews(out.viewerOf, (viewer) => ({ t: "snap", s: out.snapshot(viewer), now }));
    }

    gameTick() {
      const core = this.core;
      if (!core || core.activity.kind !== "game") return this.stopTimer();
      const now = Date.now();
      const out = core.gameTick(now);
      this.sendGame(out, now);
      if (out.ended) {
        this.stopTimer();
        this.finish(out.ended, now);
        this.changed(now);
        this.flush(now);
      } else if (now - this.flushedAt >= REPORT_EVERY_MS) this.flush(now);
    }

    /** The game is over: everyone hears the result and is back in the lobby, by the door. */
    finish(ended, now) {
      const core = this.core;
      for (const entry of this.sockets.values()) this.keep(entry);
      this.broadcast({ t: "end", room: core.view(now), result: ended.result, last: ended.last, now });
    }

    stopTimer() {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      this.meter.release(Date.now());
    }

    // ------------------------------------------------------------ the budget

    /**
     * Counts an event that was not a message (a join, a socket opening or closing, the alarm).
     * What it cost is parked on a socket, like a message's, so a sleep cannot lose it and no
     * report is spent on it; with nobody connected, or a minute since the last report, it is
     * reported now.
     */
    bill(started, requests = 1) {
      const now = Date.now();
      this.meter.event(started, now);
      if (requests > 1) this.meter.add(0, requests - 1);
      this.park(now);
    }

    /** Parks what the room's own tally holds on a socket, or reports it (see bill). */
    park(now) {
      const carrier = this.sockets.values().next().value;
      if (!carrier || now - this.flushedAt >= REPORT_EVERY_MS) return this.flush(now);
      const owed = this.meter.take(now);
      carrier.kept.owed.ms += owed.ms;
      carrier.kept.owed.r += owed.requests;
      carrier.ws.serializeAttachment(carrier.kept);
    }

    /**
     * Reports everything owed to the room budget: the room's own tally and each socket's. Runs
     * once a minute while anything happens, when a game ends and when the room closes.
     */
    flush(now) {
      const owed = this.meter.take(now);
      // The join code lapses unless it is refreshed now and then; a room in use keeps it alive.
      if (this.core?.pin && now - this.pinAt >= PIN_REFRESH_MS) {
        this.pinAt = now;
        owed.requests += 1;
        this.ctx.waitUntil(
          this.env.PARTY_PINS.getByName(PIN_DIRECTORY_NAME)
            .refresh(this.core.code)
            .catch(() => {}),
        );
      }
      for (const entry of this.sockets.values()) {
        owed.ms += entry.kept.owed.ms;
        owed.requests += entry.kept.owed.n / MESSAGES_PER_REQUEST + entry.kept.owed.r;
        entry.kept.owed = { ms: 0, n: 0, r: 0 };
        // When the room last reported and last refreshed its code: remembered through a sleep.
        entry.kept.flushedAt = now;
        entry.kept.pinAt = this.pinAt;
        entry.ws.serializeAttachment(entry.kept);
      }
      this.flushedAt = now;
      if (owed.ms <= 0 && owed.requests <= 0) return;
      // The report is itself a request to the budget object.
      this.ctx.waitUntil(
        spendRoomTime(this.env, owed.ms, owed.requests + 1).then(
          (state) => {
            if (state !== "open") this.budgetSpent();
          },
          () => this.meter.add(owed.ms, owed.requests), // could not be reached: owed again next time
        ),
      );
    }

    /** The allowance is spent: the game in play finishes, no other starts, and the room closes in a few minutes. */
    budgetSpent() {
      const core = this.core;
      if (!core || core.closing) return;
      const now = Date.now();
      core.setClosing(now, "budget");
      this.changed(now);
    }

    // ------------------------------------------------------------ sending and saving

    /** Writes what a socket must carry through a sleep: its piece as last heard. */
    keep(entry) {
      if (entry.role !== "player") return;
      entry.kept.piece = this.core.pieceOf(entry.seat);
      entry.ws.serializeAttachment(entry.kept);
    }

    send(entry, message) {
      entry.out.push(JSON.stringify(message));
    }

    broadcast(message, except = null) {
      const text = JSON.stringify(message);
      for (const entry of this.sockets.values()) if (entry !== except) entry.out.push(text);
    }

    /**
     * Sends a message that carries a game's state: `make(viewer)` builds it once for each kind of
     * viewer (`viewerOf` says which a socket is), and each socket gets its own. Messages about the
     * room itself (pieces, votes, emotes, the Tonight board) go out with broadcast().
     *
     * Every message is built before any is sent, so a game whose view throws for one viewer sends
     * nobody anything: the game is put away as broken (gameBroke). Returns whether it was sent.
     */
    broadcastViews(viewerOf, make) {
      let sends;
      try {
        sends = fanOut(this.sockets.values(), viewerOf, make);
      } catch (err) {
        this.gameBroke(err);
        return false;
      }
      for (const [entry, text] of sends) entry.out.push(text);
      return true;
    }

    /** One socket's view of the game (`make()` builds the message), sent as broadcastViews sends them. */
    sendView(entry, make) {
      let message;
      try {
        message = make();
      } catch (err) {
        this.gameBroke(err);
        return false;
      }
      if (message) this.send(entry, message);
      return true;
    }

    /**
     * The game's view threw (its `snapshot`, a Table game's `view`): nobody can be shown the game,
     * so it ends now, with no points, as a game whose tick threw does (reason "error"): everyone
     * gets the note, `end` and the room. Never throws, so it cannot wedge the message, the
     * reconnect or the alarm it came from. A game already over (its last view threw after it
     * ended) is left to whoever ended it, which sends `end` itself.
     */
    gameBroke(err) {
      const core = this.core;
      const id = core?.activity.kind === "game" ? core.activity.id : "a game";
      console.error(`party room: ${id} could not be shown; the game ends with no points`, err);
      if (!core) return;
      const now = Date.now();
      try {
        const out = core.breakGame(now);
        if (!out) return;
        this.stopTimer();
        this.tellNotes();
        this.finish(out.ended, now);
        this.changed(now);
        this.flush(now);
        // Saved after everyone has heard: a room that restarts before the save holds a game whose
        // view still throws, and the first page to come back ends it the same way.
        void this.save().catch((e) => console.error("party room: a game ended for an error could not be saved", e));
      } catch (e) {
        console.error("party room: ending a game that could not be shown failed", e);
      }
    }

    broadcastRoom(now) {
      if (!this.core) return;
      const view = this.core.view(now);
      this.broadcast({ t: "room", room: view });
      this.offerRelease(view, now);
    }

    // ------------------------------------------------------------ a new build (site/release-switch.js)

    /** Whether a socket's page speaks an older protocol than the room: it can only reload. */
    mustUpdate(entry) {
      return (entry.kept.protocol ?? LEGACY_HELLO_PROTOCOL) !== PROTOCOL;
    }

    /**
     * The room as it now is, said to the pages of another build: when it has just come to a safe
     * point (release-points.js), or the first time it looks since it woke (a deploy gives a room
     * that sleeps the new code without closing its sockets), each socket whose page said another
     * release hears `{t: "release", id, safe: true}`, and decides itself whether it is the older
     * one. A page of an older protocol is closed at a safe point with UPDATE_REQUIRED (its seat is
     * kept: it comes back by reloading). Sends nothing in a room without a release, or to a page
     * that said none (one from before the release record, which would not know the message).
     */
    offerRelease(view, now) {
      if (!release || !this.core) return;
      const safe = releaseSafe(view);
      const was = this.releaseSafeWas;
      this.releaseSafeWas = safe;
      if (!safe) return;
      for (const [ws, entry] of [...this.sockets]) {
        if (this.mustUpdate(entry)) this.closeForUpdate(ws, entry, now);
        else if (was !== true && entry.kept.release && entry.kept.release !== release.id) this.send(entry, { t: "release", id: release.id, safe: true });
      }
    }

    /** A page that asks (`{t: "release?"}`: it has heard a new build is out) is told the room's, and whether now is safe. */
    answerRelease(entry, now) {
      if (!release || !this.core) return;
      this.send(entry, { t: "release", id: release.id, safe: releaseSafe(this.core.view(now)) });
    }

    /**
     * Closes a socket whose page cannot speak to this room, keeping its seat as a drop keeps it:
     * its page reloads (party-client.js, UPDATE_REQUIRED) and comes back with its saved session.
     */
    closeForUpdate(ws, entry, now) {
      this.drop(ws, entry, CLOSE_ROOM_CLOSED, UPDATE_REQUIRED);
      if (this.core && !this.isConnected(entry.token)) this.core.disconnect(entry.token, now);
    }

    /**
     * Writes the room down, with a turn-based game in progress. `midGame` says a game was on that
     * the save does not hold (a ticking one), so a restart knows to tell everyone it is over. A
     * turn-based game whose state cannot be written is left out the same way, and said so.
     */
    async save() {
      const core = this.core;
      if (!core) return;
      let data;
      try {
        data = core.serialize();
      } catch (err) {
        console.error("party room: the game in progress could not be saved", err);
        data = core.serialize({ withGame: false });
      }
      await this.ctx.storage.put(STORAGE_KEY, { ...data, midGame: core.activity.kind === "game" && !data.game });
    }

    /** Empty, forgotten, too old, or out of allowance: close every socket, give the code back, forget everything. */
    async destroy(reason = "empty") {
      const code = this.core?.code;
      this.stopTimer();
      this.flush(Date.now());
      for (const ws of this.ctx.getWebSockets()) {
        try {
          ws.close(CLOSE_ROOM_CLOSED, CLOSE_REASONS[reason] ?? "room_closed");
        } catch {
          // Already closed.
        }
      }
      this.sockets.clear();
      this.unknown.forget();
      this.core = null;
      this.alarmAt = null;
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      if (code) await this.env.PARTY_PINS.getByName(PIN_DIRECTORY_NAME).release(code);
    }

    /** For the tests and the measurements (the Worker only exposes it when PARTY_DEBUG is "on"). */
    async debug() {
      if (!this.core) return null;
      const now = Date.now();
      return {
        view: this.core.view(now),
        sockets: this.sockets.size,
        // Sockets that have not said whose they are (never more than MAX_UNKNOWN).
        unknown: this.unknown.size,
        timer: this.timer !== null,
        alarmIn: this.alarmAt === null ? null : this.alarmAt - now,
        wokeAgo: now - this.wokeAt,
        // What this room has counted and not yet reported (it rides on the sockets), and when it last reported.
        owed: [...this.sockets.values()].reduce((sum, e) => ({ ms: sum.ms + e.kept.owed.ms, messages: sum.messages + e.kept.owed.n, requests: sum.requests + e.kept.owed.r }), { ms: 0, messages: 0, requests: 0 }),
        reportedAt: this.flushedAt,
        rate: SOCKET_RATE,
      };
    }
  };
}
