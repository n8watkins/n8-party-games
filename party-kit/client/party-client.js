// The browser side of the party kit. No build step: import it as an ES module.
//
//   const party = new PartyClient();
//   await party.create({ nickname: "Nat" });         // or party.create({ as: "screen" })
//   await party.join("4821", { nickname: "Sam" });   // by PIN (or room code)
//   party.on("room", (room) => ...)                  // lobby and presence changes
//   party.on("start", ({ room, s }) => ...)          // a round began; s is the first snapshot
//   party.on("events", (events, now) => ...)         // what the room decided
//   party.on("snapshot", (s, now) => ...)
//   party.on("end", ({ room, result }) => ...)
//   party.sendInput({ ... })                         // inputs only, never results
//   party.now()                                      // the room's clock, in ms
//
// The session is kept in sessionStorage, so a reload or a dropped connection comes back to the
// same seat (the room holds it for 30 seconds).

const API = "/api/party";
const STORE_KEY = "party-kit:session";
const PING_EVERY_MS = 2000;

export class PartyClient {
  /**
   * @param {{base?: string, lag?: number, storage?: Storage | null}} [opts]
   *   lag: simulated latency in ms each way (the room must allow it: PARTY_SIM_LATENCY="on").
   */
  constructor(opts = {}) {
    this.base = opts.base ?? "";
    this.lag = opts.lag ?? 0;
    this.storage = opts.storage === undefined ? safeStorage() : opts.storage;
    this.handlers = new Map();
    this.session = null; // {code, pin, token, seat, role}
    this.room = null;
    this.you = null;
    this.ws = null;
    this.status = "idle"; // idle | connecting | open | reconnecting | closed
    this.clockOffset = 0; // room clock minus local clock
    this.rtt = 0;
    this.retry = 0;
    this.wantOpen = false;
    this.pingTimer = null;
  }

  on(type, handler) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(handler);
    return () => this.handlers.get(type).delete(handler);
  }

  emit(type, ...args) {
    for (const h of this.handlers.get(type) ?? []) h(...args);
  }

  /** The room's clock in ms, estimated from pings. Timestamps on inputs use this. */
  now() {
    return Date.now() + this.clockOffset;
  }

  async request(method, path, body) {
    const res = await fetch(this.base + API + path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      // Not JSON: treated as a failure below.
    }
    if (!data || !data.ok) throw new PartyError(data?.error ?? "network", data?.message ?? "Could not reach the room.");
    return data;
  }

  /** Makes a room. `as: "screen"` makes this device the shared screen with no seat. */
  async create({ nickname = "", as = "player" } = {}) {
    const data = await this.request("POST", "/rooms", { nickname, as });
    return this.adopt(data);
  }

  /** Looks a PIN up without joining: {code, game, phase, players, full}. */
  async preview(pinOrCode) {
    return (await this.request("GET", `/join/${encodeURIComponent(pinOrCode)}`)).preview;
  }

  async join(pinOrCode, { nickname = "", as = "player" } = {}) {
    const data = await this.request("POST", `/join/${encodeURIComponent(pinOrCode)}`, { nickname, as });
    return this.adopt(data);
  }

  adopt(data) {
    this.session = { code: data.code, pin: data.pin, token: data.token, seat: data.seat, role: data.role };
    this.storage?.setItem(STORE_KEY, JSON.stringify(this.session));
    this.connect();
    return this.session;
  }

  /** Picks up the session left by an earlier page load, if any. Returns true when one was found. */
  resume() {
    try {
      const saved = JSON.parse(this.storage?.getItem(STORE_KEY) ?? "null");
      if (!saved?.token) return false;
      this.session = saved;
      this.connect();
      return true;
    } catch {
      return false;
    }
  }

  connect() {
    if (!this.session) return;
    this.wantOpen = true;
    this.setStatus(this.retry ? "reconnecting" : "connecting");
    const origin = this.base || location.origin;
    const url = new URL(`${API}/rooms/${this.session.code}/ws`, origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("token", this.session.token);
    if (this.lag) url.searchParams.set("lag", String(this.lag));
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.setStatus("open");
      this.ping();
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => this.ping(), PING_EVERY_MS);
    };
    ws.onmessage = (event) => this.onMessage(event.data);
    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      clearInterval(this.pingTimer);
      this.ws = null;
      // 4000: the room closed. 4003: the seat is no longer ours (the grace ran out).
      if (event.code === 4000 || event.code === 4003 || !this.wantOpen) {
        this.forget();
        this.setStatus("closed");
        this.emit("closed", event.code === 4003 ? "seat_lost" : "room_closed");
        return;
      }
      this.retry += 1;
      this.setStatus("reconnecting");
      setTimeout(() => this.wantOpen && this.connect(), Math.min(4000, 250 * 2 ** Math.min(this.retry, 4)));
    };
  }

  onMessage(text) {
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    switch (msg.t) {
      case "hello":
        this.you = msg.you;
        this.setRoom(msg.room);
        break;
      case "room":
        this.setRoom(msg.room);
        break;
      case "pong": {
        const t1 = Date.now();
        const rtt = t1 - msg.c;
        // Keep the estimate from the quickest round trip seen lately: it has the least error.
        if (!this.rtt || rtt <= this.rtt * 1.5) {
          const offset = msg.s + rtt / 2 - t1;
          this.clockOffset = this.rtt ? this.clockOffset * 0.7 + offset * 0.3 : offset;
          this.rtt = this.rtt ? Math.min(this.rtt * 1.05, rtt) : rtt;
        }
        break;
      }
      case "start":
        this.setRoom(msg.room);
        this.emit("start", msg);
        break;
      case "ev":
        this.emit("events", msg.ev, msg.now);
        break;
      case "snap":
        this.emit("snapshot", msg.s, msg.now, !!msg.full);
        break;
      case "end":
        this.setRoom(msg.room);
        this.emit("end", msg);
        break;
      case "error":
        this.emit("error", new PartyError(msg.error, msg.message));
        break;
      default:
        break;
    }
  }

  setRoom(room) {
    this.room = room;
    if (this.session && room.pin && room.pin !== this.session.pin) this.session.pin = room.pin;
    this.emit("room", room);
  }

  setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    this.emit("status", status);
  }

  send(message) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  ping() {
    this.send({ t: "ping", c: Date.now() });
  }

  /** Inputs only. The room decides what they did. */
  sendInput(data) {
    return this.send({ t: "in", d: data });
  }
  setReady(ready) {
    return this.send({ t: "ready", v: !!ready });
  }
  rename(nickname) {
    return this.send({ t: "name", v: nickname });
  }
  setCharacter(character) {
    return this.send({ t: "character", v: character });
  }
  addBot() {
    return this.send({ t: "addBot" });
  }
  removeBot(seat) {
    return this.send({ t: "removeBot", seat });
  }
  start() {
    return this.send({ t: "start" });
  }

  /** Leaves on purpose: the seat goes to a bot (in a round) or is freed (in the lobby). */
  leave() {
    this.wantOpen = false;
    this.send({ t: "leave" });
    this.forget();
    this.ws?.close();
  }

  /** Drops the connection without leaving, as a bad network would. For tests. */
  dropConnection({ reconnectAfterMs = null } = {}) {
    this.wantOpen = false;
    const ws = this.ws;
    this.ws = null;
    clearInterval(this.pingTimer);
    ws?.close();
    this.setStatus("reconnecting");
    if (reconnectAfterMs !== null) setTimeout(() => this.connect(), reconnectAfterMs);
  }

  forget() {
    this.storage?.removeItem(STORE_KEY);
  }

  /** The address a phone should open to join this room. */
  async joinUrl(path = location.pathname) {
    let origin = location.origin;
    try {
      const config = await this.request("GET", "/config");
      if (config.publicOrigin) origin = config.publicOrigin;
    } catch {
      // The page's own origin will do.
    }
    return `${origin}${path}?join=${this.session?.pin ?? this.session?.code ?? ""}`;
  }

  qrUrl(text) {
    return `${this.base}${API}/qr.svg?text=${encodeURIComponent(text)}`;
  }
}

export class PartyError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function safeStorage() {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}
