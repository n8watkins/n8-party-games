// One Durable Object per room: the authority. It owns a RoomCore, accepts WebSockets,
// applies inputs, ticks the game and broadcasts state. Clients never send results.
//
// A room is billed for every second it is awake, so it is awake only while a round is on.
// In the lobby and on the results screen it holds its sockets through the WebSocket
// Hibernation API and runs no timer: a message or the alarm wakes it, and it goes back to sleep.
import { DurableObject } from "cloudflare:workers";
import { RoomCore, LagLine } from "../core/room-core.js";
import { newSeed } from "../core/rng.js";
import { PIN_DIRECTORY_NAME } from "./pin-logic.js";
import { REPORT_EVERY_MS, fullMessage, roomBudgetState, spendRoomTime } from "./room-budget.js";

const STORAGE_KEY = "room";
const CLOSE_ROOM_CLOSED = 4000;
const CLOSE_BAD_TOKEN = 4003;
const MAX_MESSAGE_BYTES = 2048;

/**
 * Makes the room class for one game.
 * @param {import("../core/room-core.js").PartyGame} game
 */
export function createPartyRoom(game) {
  return class PartyRoom extends DurableObject {
    constructor(ctx, env) {
      super(ctx, env);
      /** @type {RoomCore | null} */
      this.core = null;
      /** socket -> {token, role, seat, out: LagLine, in: LagLine} */
      this.sockets = new Map();
      this.timer = null;
      /** When the awake time not yet reported to the room budget began; null while the room is asleep. */
      this.meterFrom = null;
      void ctx.blockConcurrencyWhile(async () => {
        const saved = await ctx.storage.get(STORAGE_KEY);
        if (!saved) return;
        const now = Date.now();
        this.core = RoomCore.restore(game, saved, now);
        // Waking from sleep: the sockets are still open, so their owners are still here.
        for (const ws of ctx.getWebSockets()) {
          const kept = ws.deserializeAttachment();
          if (kept && this.core.connect(kept.token, now)) this.sockets.set(ws, this.entryFor(ws, kept));
        }
      });
    }

    // ------------------------------------------------------------ RPC from the Worker

    /** Creates the room. `as` is "player" (takes seat 1) or "screen" (the shared screen, no seat). */
    async create({ code, nickname, as }) {
      if (this.core) return { ok: false, error: "exists", message: "Room code already in use." };
      const now = Date.now();
      const core = new RoomCore({ game, seed: newSeed(), code, now });
      const joined = as === "screen" ? core.watch(now) : core.join(nickname, now);
      if (!joined.ok) return joined;
      this.core = core;
      const issued = await this.env.PARTY_PINS.getByName(PIN_DIRECTORY_NAME).issue(code);
      core.pin = issued ? issued.value : null;
      await this.save();
      return { ok: true, code, pin: core.pin, token: joined.token, seat: joined.seat ?? -1, role: as === "screen" ? "screen" : "player" };
    }

    async preview() {
      if (!this.core) return null;
      const v = this.core.view(Date.now());
      return { code: v.code, game: v.game, phase: v.phase, players: v.seats.filter(Boolean).map((s) => s.name), full: v.seats.every(Boolean) };
    }

    async join({ nickname, as }) {
      if (!this.core) return { ok: false, error: "not_found", message: "This room has closed." };
      const now = Date.now();
      const joined = as === "screen" ? this.core.watch(now) : this.core.join(nickname, now);
      if (!joined.ok) return joined;
      await this.save();
      this.broadcastRoom();
      return { ok: true, code: this.core.code, pin: this.core.pin, token: joined.token, seat: joined.seat ?? -1, role: as === "screen" ? "screen" : "player" };
    }

    // ------------------------------------------------------------ WebSockets

    async fetch(request) {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("Expected WebSocket", { status: 426 });
      const url = new URL(request.url);
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      const token = url.searchParams.get("token") ?? "";
      const who = this.core ? this.core.connect(token, Date.now()) : null;
      if (!who) {
        server.accept();
        server.close(CLOSE_BAD_TOKEN, "bad_token");
        return new Response(null, { status: 101, webSocket: client });
      }
      // Simulated latency, each way, for tests. Off unless the Worker allows it.
      const lag = this.env.PARTY_SIM_LATENCY === "on" ? Number(url.searchParams.get("lag") ?? 0) : 0;
      // A hibernatable socket: the room may sleep while it stays open. What the room has to know
      // about it rides along on the socket, since the room's memory does not survive sleep.
      this.ctx.acceptWebSocket(server);
      const kept = { token, role: who.role, seat: who.seat, lag };
      server.serializeAttachment(kept);
      const entry = this.entryFor(server, kept);
      this.sockets.set(server, entry);

      this.send(entry, { t: "hello", you: { role: who.role, seat: who.seat }, room: this.core.view(Date.now()) });
      if (this.core.phase !== "lobby" && this.core.state) {
        this.send(entry, { t: "snap", s: game.snapshot(this.core.state, Date.now()), now: Date.now(), full: true });
      }
      this.broadcastRoom();
      this.schedule();
      await this.save();
      return new Response(null, { status: 101, webSocket: client });
    }

    entryFor(ws, kept) {
      return {
        token: kept.token,
        role: kept.role,
        seat: kept.seat,
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

    webSocketMessage(ws, data) {
      if (typeof data !== "string" || data.length > MAX_MESSAGE_BYTES) return;
      this.sockets.get(ws)?.in.push(data);
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
        return;
      }
      if (!msg || typeof msg !== "object") return;
      const now = Date.now();
      const isHost = core.hostToken === entry.token;
      // Pings keep the clocks in step; they do not show that anyone is still doing anything.
      if (msg.t !== "ping") core.touch(now);
      switch (msg.t) {
        case "ping":
          // Clock sync: the client learns the room's clock from c (its send time) and s (ours).
          this.send(entry, { t: "pong", c: msg.c, s: now });
          return;
        case "in":
          if (entry.role === "player") core.input(entry.seat, msg.d, now);
          return;
        case "ready":
          if (entry.role === "player" && core.setReady(entry.seat, msg.v)) {
            // Instant rematch: after a round, it starts again the moment every human is ready.
            if (core.phase === "ended" && core.canStart()) return this.startRound(entry, now);
            this.changed();
          }
          return;
        case "name":
          if (entry.role === "player" && core.rename(entry.seat, msg.v)) this.changed();
          return;
        case "character":
          if (entry.role === "player" && core.setCharacter(entry.seat, msg.v)) this.changed();
          return;
        case "addBot":
          if (isHost && core.addBot().ok) this.changed();
          return;
        case "removeBot":
          if (isHost && core.removeBot(msg.seat)) this.changed();
          return;
        case "start": {
          // The host starts; if the host is gone, anyone seated may.
          if (!isHost && core.hostToken && core.identify(core.hostToken) && this.isConnected(core.hostToken)) return;
          return this.startRound(entry, now);
        }
        case "leave":
          core.leave(entry.token, now);
          this.sockets.delete(ws);
          try {
            ws.close(1000, "left");
          } catch {
            // Already closed.
          }
          this.changed();
          return;
        default:
          return;
      }
    }

    async startRound(entry, at) {
      const core = this.core;
      // The allowance for the day or month is spent: the round in play finished, no new one starts.
      const budget = await roomBudgetState(this.env).catch(() => "open");
      if (budget !== "open") return this.send(entry, { t: "error", error: "battles_full", message: fullMessage(budget) });
      if (this.core !== core || core.phase === "playing") return;
      const now = Math.max(at, Date.now());
      const started = core.start(now);
      if (!started.ok) return this.send(entry, { t: "error", error: started.error, message: started.message });
      this.broadcast({ t: "start", room: core.view(now), s: game.snapshot(core.state, now), now });
      this.schedule();
      void this.save();
    }

    isConnected(token) {
      for (const e of this.sockets.values()) if (e.token === token) return true;
      return false;
    }

    onGone(ws) {
      const entry = this.sockets.get(ws);
      if (!entry) return;
      this.sockets.delete(ws);
      if (!this.core) return;
      if (!this.isConnected(entry.token)) this.core.disconnect(entry.token, Date.now());
      this.changed();
    }

    // ------------------------------------------------------------ the loop

    /**
     * A timer runs only while a round is on, and that is the only time the room stays awake.
     * Everything else that depends on time (the reconnect grace, closing an empty or forgotten
     * room) is on the alarm.
     */
    schedule() {
      const core = this.core;
      if (!core || core.phase !== "playing") this.stopTimer();
      else if (!this.timer) {
        this.meterFrom = Date.now();
        this.timer = setInterval(() => this.tick(), Math.round(1000 / (game.tickHz ?? 30)));
      }
      const wake = core?.nextWake(Date.now());
      if (wake) void this.ctx.storage.setAlarm(wake);
    }

    stopTimer() {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      this.meter(Date.now(), true);
    }

    tick() {
      const core = this.core;
      if (!core) return this.stopTimer();
      const now = Date.now();
      this.meter(now);
      const out = core.tick(now);
      if (out.events.length) this.broadcast({ t: "ev", ev: out.events, now });
      if (out.snapshot) this.broadcast({ t: "snap", s: out.snapshot, now });
      if (out.ended) this.broadcast({ t: "end", room: core.view(now), result: core.result, now });
      else if (out.roomChanged) this.broadcastRoom();
      if (out.ended || out.roomChanged) {
        this.schedule();
        void this.save();
      }
      if (out.close) void this.destroy(out.close);
    }

    /**
     * Reports the room's awake time to the room budget, a minute at a time (or all of it with
     * `all`). The room is awake, and billed, from the start of a round to its end.
     */
    meter(now, all = false) {
      if (this.meterFrom === null) return;
      const ms = now - this.meterFrom;
      if (ms <= 0 || (!all && ms < REPORT_EVERY_MS)) return;
      this.meterFrom = all ? null : now;
      this.ctx.waitUntil(
        spendRoomTime(this.env, ms).catch(() => {
          // The budget could not be reached; the next report carries on.
        }),
      );
    }

    async alarm() {
      if (!this.core) return;
      this.tick();
      if (this.core) {
        const wake = this.core.nextWake(Date.now());
        if (wake) await this.ctx.storage.setAlarm(wake);
        this.schedule();
      }
    }

    // ------------------------------------------------------------ sending and saving

    send(entry, message) {
      entry.out.push(JSON.stringify(message));
    }

    broadcast(message) {
      const text = JSON.stringify(message);
      for (const entry of this.sockets.values()) entry.out.push(text);
    }

    broadcastRoom() {
      if (this.core) this.broadcast({ t: "room", room: this.core.view(Date.now()) });
    }

    changed() {
      this.broadcastRoom();
      this.schedule();
      const wake = this.core?.nextWake(Date.now());
      if (wake) void this.ctx.storage.setAlarm(wake);
      void this.save();
    }

    async save() {
      if (this.core) await this.ctx.storage.put(STORAGE_KEY, this.core.serialize());
    }

    /** Empty for a minute, or forgotten: close every socket, give the PIN back, forget everything. */
    async destroy(reason = "empty") {
      const code = this.core?.code;
      this.stopTimer();
      for (const ws of this.ctx.getWebSockets()) {
        try {
          ws.close(CLOSE_ROOM_CLOSED, reason === "stale" ? "room_idle" : "room_closed");
        } catch {
          // Already closed.
        }
      }
      this.sockets.clear();
      this.core = null;
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      if (code) await this.env.PARTY_PINS.getByName(PIN_DIRECTORY_NAME).release(code);
    }

    /** For tests and the health page. */
    async debug() {
      return this.core ? { view: this.core.view(Date.now()), sockets: this.sockets.size } : null;
    }
  };
}
