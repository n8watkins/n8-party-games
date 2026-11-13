// One Durable Object per party: the authority. It owns a LobbyCore, accepts WebSockets, relays
// what players do, settles the vote and runs the chosen game.
//
// A room is billed for every second it is awake, so it is built to be asleep:
//   - Nothing ticks in the lobby. A player's page says where its piece is only when that
//     changes; the room relays it, works out the vote, and is done within the same event.
//   - Everything that depends on time is the alarm (the count, the toss, a dropped phone).
//   - The keep-alive ("ping") is answered by the runtime itself and never wakes the room.
//   - A timer runs only while a game is being played, and only if the game has a tick rate.
// So a lobby where nobody touches anything holds its sockets through the WebSocket Hibernation
// API and costs nothing, and all the time the room is awake is counted against the room budget.
import { DurableObject } from "cloudflare:workers";
import { LagLine } from "../../party-kit/src/core/room-core.js";
import { newSeed } from "../../party-kit/src/core/rng.js";
import { SOCKET_RATE, newBucket, strike, takeMessage } from "../../party-kit/src/worker/limit-logic.js";
import { PIN_DIRECTORY_NAME } from "../../party-kit/src/worker/pin-logic.js";
import { AwakeMeter, EVENT_FLOOR_MS, MESSAGES_PER_REQUEST, REPORT_EVERY_MS, roomBudgetState, spendRoomTime } from "../../party-kit/src/worker/room-budget.js";
import { LobbyCore } from "./lobby-core.js";

const STORAGE_KEY = "lobby";
const CLOSE_ROOM_CLOSED = 4000;
const CLOSE_BAD_TOKEN = 4003;
const CLOSE_TOO_FAST = 4008;
/** Lobby messages are a few dozen bytes; a game's inputs are not much more. Anything longer is dropped. */
export const MAX_MESSAGE_BYTES = 512;
/** The keep-alive the page sends, and the reply the runtime gives without waking the room. */
export const KEEP_ALIVE = { text: "ping", reply: "pong", everyMs: 20_000 };
/** A socket that has said nothing at all for this long (not even a keep-alive) belongs to a phone that is gone. */
const SILENT_MS = 90_000;
const REAP_EVERY_MS = 15_000;
/** The join code is kept alive while the room is in use (it lapses 15 minutes after its last refresh). */
const PIN_REFRESH_MS = 5 * 60_000;
/** An alarm due within this long is a count, a toss, a rest or a grace: worth pushing back when it is no longer wanted. */
const SHORT_FUSE_MS = 35_000;
/** Why a room closed, as the socket's close reason. */
const CLOSE_REASONS = { empty: "room_closed", stale: "room_idle", expired: "room_expired", budget: "allowance_spent" };

/**
 * Makes the party room class.
 * @param {(env: object) => {boxes: object[], games: Map<string, object>}} wallFor  the boxes on the
 *   wall and the games that can start, for a Worker's environment (lobby/wall.js)
 */
export function createLobbyRoom(wallFor) {
  return class LobbyRoom extends DurableObject {
    constructor(ctx, env) {
      super(ctx, env);
      const wall = (this.wall = wallFor(env));
      /** @type {LobbyCore | null} */
      this.core = null;
      /** socket -> {ws, token, role, seat, kept, out, in, bucket} */
      this.sockets = new Map();
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
        if (!saved) return;
        this.core = LobbyCore.restore(wall, saved, this.wokeAt);
        this.alarmAt = await ctx.storage.getAlarm();
        // Waking from sleep: the sockets are still open, so their owners are still here, and each
        // socket carried its piece and what it owes the budget through the sleep.
        for (const ws of ctx.getWebSockets()) {
          const kept = ws.deserializeAttachment();
          if (!kept || !this.core.resume(kept.token, kept.piece)) continue;
          this.sockets.set(ws, this.entryFor(ws, kept));
          this.flushedAt = Math.max(this.flushedAt, kept.flushedAt ?? 0);
          this.pinAt = Math.max(this.pinAt, kept.pinAt ?? 0);
        }
        // A game cut short by a restart is gone; everyone has to hear they are back in the lobby.
        if (saved.midGame) this.changed(this.wokeAt);
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
      return { code: v.code, game: "party", phase: v.phase, players, full: players.length >= v.members.length, screen: this.core.screenHeld(Date.now()) };
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
      const token = url.searchParams.get("token") ?? "";
      const now = Date.now();
      const who = this.core ? this.core.connect(token, now) : null;
      // Refused through the Hibernation API too: a socket accepted the standard way (accept())
      // keeps the room from sleeping for as long as it lives.
      this.ctx.acceptWebSocket(server);
      if (!who) {
        server.close(CLOSE_BAD_TOKEN, "bad_token");
        return new Response(null, { status: 101, webSocket: client });
      }
      // Simulated latency, each way, for tests. Off unless the Worker allows it.
      const lag = this.env.PARTY_SIM_LATENCY === "on" ? Number(url.searchParams.get("lag") ?? 0) : 0;
      const kept = { token, role: who.role, seat: who.seat, lag, at: now, piece: this.core.pieceOf(who.seat), owed: { ms: 0, n: 0, r: 0 }, flushedAt: this.flushedAt, pinAt: this.pinAt };
      server.serializeAttachment(kept);
      const entry = this.entryFor(server, kept);
      this.sockets.set(server, entry);

      const core = this.core;
      this.send(entry, { t: "hello", you: { role: who.role, seat: who.seat }, room: core.view(now) });
      const a = core.activity;
      if (a.kind === "game") this.send(entry, { t: "snap", s: this.wall.games.get(a.id).snapshot(a.state, now), now, full: true });
      this.changed(now);
      this.bill(now);
      return new Response(null, { status: 101, webSocket: client });
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
      if (!entry || !this.core) return;
      const started = Date.now();
      const readable = typeof data === "string" && data.length <= MAX_MESSAGE_BYTES;
      const verdict = readable ? takeMessage(entry.bucket, started) : strike(entry.bucket);
      if (verdict === "ok") entry.in.push(data);
      else if (verdict === "close") this.kick(ws, entry);
      // What this message cost rides on its own socket, so it is not forgotten if the room sleeps
      // before the next report to the budget.
      const owed = entry.kept.owed;
      if (this.meter.heldFrom === null) owed.ms += Math.max(EVENT_FLOOR_MS, Date.now() - started);
      owed.n += 1;
      // When this socket last said anything: kept on the socket, so a sleep does not make a silent phone look fresh.
      entry.kept.seen = started;
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
      const player = entry.role === "player";
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
          this.settle(now);
          return;
        }
        case "in":
          if (player) core.gameInput(entry.seat, msg.d, now);
          return;
        case "pick": {
          // The party moves to another room: one stored value and one relayed message. Refused
          // (to that page only) when it is not the host's tap or not the moment.
          const picked = core.setRoom(entry.token, msg.v, now);
          if (!picked.ok) return this.send(entry, { t: "pick-no", why: picked.why, room: core.room });
          this.broadcast({ t: "pick", room: picked.room, by: picked.by });
          void this.save();
          return;
        }
        case "leave":
          core.leave(entry.token, now);
          this.drop(ws, entry, 1000, "left");
          this.changed(now);
          return;
        default:
          return;
      }
    }

    /** A socket that floods is closed and its seat given up: dropped messages are still billed. */
    kick(ws, entry) {
      const now = Date.now();
      this.core?.leave(entry.token, now);
      this.drop(ws, entry, CLOSE_TOO_FAST, "too_fast");
      this.changed(now);
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
      const now = Date.now();
      const entry = this.sockets.get(ws);
      // A socket that closed while the room slept may not be among the ones it woke with.
      const token = entry?.token ?? ws.deserializeAttachment()?.token;
      if (entry) this.drop(ws, entry, 1000, "gone");
      if (!this.core || !token) return;
      if (!this.isConnected(token)) this.core.disconnect(token, now);
      this.changed(now);
      this.bill(now);
    }

    /** Closes sockets whose phone has gone without saying so, so nobody waits on a ghost. */
    reap(now) {
      if (now - this.reapedAt < REAP_EVERY_MS) return;
      this.reapedAt = now;
      for (const [ws, entry] of [...this.sockets]) {
        const auto = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0;
        if (now - Math.max(auto, entry.kept.seen ?? 0, entry.kept.at) < SILENT_MS) continue;
        this.drop(ws, entry, 1001, "silent");
        if (!this.isConnected(entry.token)) this.core.disconnect(entry.token, now);
        this.broadcastRoom(now);
      }
    }

    // ------------------------------------------------------------ the vote, the alarm and the game

    /** After anything that may have changed the vote: tell everyone if it did, and set the next wake-up. */
    settle(now) {
      const core = this.core;
      if (!core) return;
      this.reap(now);
      const change = core.evaluate(now);
      if (change.view) this.broadcast({ t: "vote", vote: core.voteView(now) });
      if (change.state) void this.save();
      this.arm(now);
    }

    /** After anything that changed who is here or what the room is doing: everyone gets the whole room. */
    changed(now) {
      const core = this.core;
      if (!core) return;
      for (const note of core.drainNotes()) this.broadcast({ t: "note", ...note });
      core.evaluate(now);
      this.broadcastRoom(now);
      this.arm(now);
      void this.save();
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
      const out = core.tick(now);
      if (out.start) {
        // The allowance for the day or month is spent: no game starts, and the room is told it will close.
        const budget = await roomBudgetState(this.env).catch(() => "open");
        if (this.core !== core) return;
        if (budget === "open") this.startGame(out.start);
        else core.refuseStart(Date.now());
        this.changed(Date.now());
      } else if (out.away) {
        // An outside game won: every page hears where it is going, and goes. Nothing is asked of
        // the budget and nothing is billed but this wake-up: the game is played somewhere else.
        this.broadcast({ t: "away", ...out.away });
        for (const entry of this.sockets.values()) this.keep(entry);
        this.changed(now);
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

    startGame(id) {
      const core = this.core;
      const game = this.wall.games.get(id);
      const now = Date.now();
      const started = core.startGame(id, now);
      if (!started.ok) return;
      if (started.ended) return this.finish(started.ended, now);
      this.broadcast({ t: "start", room: core.view(now), s: game.snapshot(core.activity.state, now), now });
      // The one place a timer runs: while a game with a tick rate is being played.
      this.meter.hold(now);
      this.timer = setInterval(() => this.gameTick(), Math.round(1000 / (game.tickHz ?? 30)));
    }

    gameTick() {
      const core = this.core;
      if (!core || core.activity.kind !== "game") return this.stopTimer();
      const now = Date.now();
      const out = core.gameTick(now);
      if (out.events.length) this.broadcast({ t: "ev", ev: out.events, now });
      if (out.snapshot) this.broadcast({ t: "snap", s: out.snapshot, now });
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

    broadcastRoom(now) {
      if (this.core) this.broadcast({ t: "room", room: this.core.view(now) });
    }

    async save() {
      if (this.core) await this.ctx.storage.put(STORAGE_KEY, { ...this.core.serialize(), midGame: this.core.activity.kind === "game" });
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
