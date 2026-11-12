// One Durable Object per room: the authority. It owns a RoomCore, accepts WebSockets,
// applies inputs, ticks the game and broadcasts state. Clients never send results.
import { DurableObject } from "cloudflare:workers";
import { RoomCore, LagLine } from "../core/room-core.js";
import { newSeed } from "../core/rng.js";
import { PIN_DIRECTORY_NAME } from "./pin-logic.js";

const STORAGE_KEY = "room";
const CLOSE_ROOM_CLOSED = 4000;
const CLOSE_BAD_TOKEN = 4003;
const MAX_MESSAGE_BYTES = 2048;
/** While nobody is playing the room only needs a slow heartbeat (grace and idle checks). */
const SLOW_TICK_MS = 1000;

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
      this.timerMs = 0;
      void ctx.blockConcurrencyWhile(async () => {
        const saved = await ctx.storage.get(STORAGE_KEY);
        if (saved) this.core = RoomCore.restore(game, saved, Date.now());
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
      server.accept();
      const token = url.searchParams.get("token") ?? "";
      const who = this.core ? this.core.connect(token, Date.now()) : null;
      if (!who) {
        server.close(CLOSE_BAD_TOKEN, "bad_token");
        return new Response(null, { status: 101, webSocket: client });
      }
      // Simulated latency, each way, for tests. Off unless the Worker allows it.
      const lag = this.env.PARTY_SIM_LATENCY === "on" ? Number(url.searchParams.get("lag") ?? 0) : 0;
      const entry = {
        token,
        role: who.role,
        seat: who.seat,
        out: new LagLine(lag, (text) => {
          try {
            server.send(text);
          } catch {
            // The socket is closing; its close handler updates presence.
          }
        }),
        in: new LagLine(lag, (text) => this.onMessage(server, text)),
      };
      this.sockets.set(server, entry);
      server.addEventListener("message", (event) => {
        if (typeof event.data !== "string" || event.data.length > MAX_MESSAGE_BYTES) return;
        entry.in.push(event.data);
      });
      const gone = () => this.onGone(server);
      server.addEventListener("close", gone);
      server.addEventListener("error", gone);

      this.send(entry, { t: "hello", you: { role: who.role, seat: who.seat }, room: this.core.view(Date.now()) });
      if (this.core.phase !== "lobby" && this.core.state) {
        this.send(entry, { t: "snap", s: game.snapshot(this.core.state, Date.now()), now: Date.now(), full: true });
      }
      this.broadcastRoom();
      this.schedule();
      await this.save();
      return new Response(null, { status: 101, webSocket: client });
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
            this.broadcastRoom();
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

    startRound(entry, now) {
      const core = this.core;
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

    /** One timer drives the room: fast while a round is on, slow otherwise, none when empty and idle is on the alarm. */
    schedule() {
      const core = this.core;
      if (!core) return this.stopTimer();
      const wanted = core.phase === "playing" ? Math.round(1000 / (game.tickHz ?? 30)) : SLOW_TICK_MS;
      if (this.timer && this.timerMs === wanted) return;
      this.stopTimer();
      this.timerMs = wanted;
      this.timer = setInterval(() => this.tick(), wanted);
      // The alarm is the safety net that wakes a room whose timer died with the isolate.
      const wake = core.nextWake(Date.now());
      if (wake) void this.ctx.storage.setAlarm(wake);
    }

    stopTimer() {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      this.timerMs = 0;
    }

    tick() {
      const core = this.core;
      if (!core) return this.stopTimer();
      const now = Date.now();
      const out = core.tick(now);
      if (out.events.length) this.broadcast({ t: "ev", ev: out.events, now });
      if (out.snapshot) this.broadcast({ t: "snap", s: out.snapshot, now });
      if (out.ended) this.broadcast({ t: "end", room: core.view(now), result: core.result, now });
      else if (out.roomChanged) this.broadcastRoom();
      if (out.ended || out.roomChanged) {
        this.schedule();
        void this.save();
      }
      if (out.close) void this.destroy();
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

    /** Idle for a minute: close every socket, give the PIN back, forget everything. */
    async destroy() {
      const code = this.core?.code;
      this.stopTimer();
      for (const ws of this.sockets.keys()) {
        try {
          ws.close(CLOSE_ROOM_CLOSED, "room_closed");
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
